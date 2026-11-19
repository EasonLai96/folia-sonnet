package top.izuna.foliamajor.player.dsp

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.nio.ByteBuffer

// One AAC-LC/M4A per stem; only a confirmed encoder EOS is publishable.
internal class StemAacWriter(
    path: String,
    private val sampleRate: Int,
    private val channels: Int,
    bitRate: Int,
    private val cancelled: () -> Boolean,
    private val withinBudget: (Int) -> Boolean,
) : FourStemGenerator.Writer {

    private val info = MediaCodec.BufferInfo()
    private val codec: MediaCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    private val muxer = try { MediaMuxer(path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4) }
        catch (error: Throwable) { codec.release(); throw error }
    private var trackIndex = -1
    private var muxerStarted = false
    private var fedFrames = 0L

    init {
        try {
            val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16 * 1024)
            }
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
        } catch (error: Throwable) {
            close()
            throw error
        }
    }

    override fun append(stereo: Array<FloatArray>, frames: Int) {
        require(stereo.size == 2 && stereo.all { it.size >= frames })
        val pcm = ByteBuffer.allocate(frames * 4).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        for (n in 0 until frames) for (channel in stereo) {
            pcm.putShort((channel[n] * 32768f).toInt().coerceIn(-32768, 32767).toShort())
        }
        write(pcm.array(), frames)
    }

    /** 喂一批交织的 16bit 小端 PCM。 */
    fun write(pcm: ByteArray, frames: Int) {
        var offset = 0
        val end = frames * channels * 2
        var attempts = 0
        while (offset < end) {
            check(!cancelled() && attempts++ < 500) { "AAC encoder cancelled or stalled" }
            val index = codec.dequeueInputBuffer(TIMEOUT_US)
            if (index < 0) {
                drain(endOfStream = false)
                continue
            }
            attempts = 0
            val buffer = checkNotNull(codec.getInputBuffer(index))
            buffer.clear()
            val frameBytes = channels * 2
            val take = minOf(buffer.remaining(), end - offset).let { it - it % frameBytes }
            check(take > 0) { "AAC input buffer cannot hold a PCM frame" }
            buffer.put(pcm, offset, take)
            codec.queueInputBuffer(index, 0, take, presentationTimeUs(), 0)
            fedFrames += take / (channels * 2)
            offset += take
            drain(endOfStream = false)
        }
    }

    override fun finish(frames: Long) {
        check(fedFrames == frames)
        var queued = false
        repeat(500) {
            check(!cancelled()) { "AAC encoder cancelled" }
            if (!queued) {
                val index = codec.dequeueInputBuffer(TIMEOUT_US)
                if (index >= 0) {
                    codec.queueInputBuffer(index, 0, 0, presentationTimeUs(), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                    queued = true
                } else drain(false)
            }
            if (queued && drain(true)) {
                check(muxerStarted)
                checkBudget()
                stopMuxer() // If finalising the MP4 fails, never publish it as ready.
                checkBudget()
                return
            }
        }
        error("AAC encoder did not finish")
    }

    override fun close() {
        try {
            try {
                codec.stop()
            } catch (_: IllegalStateException) {
                // 未完成初始化的 codec 可能不能 stop，但仍然必须释放。
            } finally {
                codec.release()
            }
        } finally {
            try {
                if (muxerStarted) stopMuxer()
            } finally {
                muxer.release()
            }
        }
    }

    private fun stopMuxer() {
        muxerStarted = false // Never retry a failed finalization on the cleanup path.
        muxer.stop()
    }

    // A native mux call can buffer and add metadata (even in stop/release); these are observed
    // write boundaries and not a hard cap on what native code can write in a single call.
    private fun checkBudget(nextPayloadBytes: Int = 0) {
        check(withinBudget(nextPayloadBytes)) { "Four-stem staging budget exhausted" }
    }

    private fun presentationTimeUs(): Long = fedFrames * 1_000_000L / sampleRate

    private fun drain(endOfStream: Boolean): Boolean {
        /*
         * 等 EOS 的那几轮要有个上限：真遇到不吐 EOS 的编码器实现，
         * 这里死循环就是「生成伴奏永远卡在 99%」——宁可失败，不能卡死。
         */
        var idle = 0
        while (true) {
            check(!cancelled()) { "AAC encoder cancelled" }
            if (idle > 500) return false
            idle += 1
            val index = codec.dequeueOutputBuffer(info, if (endOfStream) TIMEOUT_US else 0L)
            when {
                index == MediaCodec.INFO_TRY_AGAIN_LATER -> return false
                index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    if (!muxerStarted) {
                        val format = codec.outputFormat
                        // A muxer can discard trim metadata. Require affirmative evidence from the encoder too.
                        check(format.containsKey(MediaFormat.KEY_ENCODER_DELAY) &&
                            format.getInteger(MediaFormat.KEY_ENCODER_DELAY) == 0 &&
                            format.containsKey(MediaFormat.KEY_ENCODER_PADDING) &&
                            format.getInteger(MediaFormat.KEY_ENCODER_PADDING) == 0
                        ) { "AAC encoder trim is not proven zero" }
                        trackIndex = muxer.addTrack(format)
                        checkBudget()
                        muxer.start()
                        muxerStarted = true
                        checkBudget()
                    }
                }
                index >= 0 -> {
                    val buffer = codec.getOutputBuffer(index)
                    // 编码器配置（AudioSpecificConfig）由 muxer 从 outputFormat 里取，
                    // 这一帧本身没有音频数据，直接丢掉。
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                    if (info.size > 0 && muxerStarted) {
                        checkNotNull(buffer).position(info.offset)
                        buffer.limit(info.offset + info.size)
                        checkBudget(info.size)
                        muxer.writeSampleData(trackIndex, buffer, info)
                        checkBudget()
                    }
                    codec.releaseOutputBuffer(index, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return true
                }
            }
        }
    }

    private companion object {
        const val TIMEOUT_US = 10_000L
    }
}
