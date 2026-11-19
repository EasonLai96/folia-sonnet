package top.izuna.foliamajor.player.dsp

import android.content.Context
import android.media.MediaExtractor
import android.media.MediaFormat
import android.util.Log
import java.io.File
import java.util.concurrent.Executors
import top.izuna.foliamajor.automix.AutomixModels
import top.izuna.foliamajor.automix.FourStemLocalInput
import top.izuna.foliamajor.automix.FourStemPcmTimeline
import top.izuna.foliamajor.automix.NativeInferenceGate
import top.izuna.foliamajor.automix.ScnetRunner
import top.izuna.foliamajor.automix.TrackPcmDecoder

// Android bindings for the single four-stem worker; not called by the audio sink or current two-track flow.
internal object FourStemGeneration {
    private const val CHANNELS = 2
    private const val RATE = ScnetRunner.SAMPLE_RATE
    private const val MAX_FRAMES = FourStemPcmTimeline.MAX_FRAMES
    private val worker = Executors.newSingleThreadExecutor { task ->
        Thread(task, "folia-four-stems").apply { isDaemon = true }
    }
    private val generator = FourStemGenerator(worker) { error ->
        // Android codec/extractor exceptions can include the signed source address; don't put it in logs.
        Log.w("FourStemGeneration", "四轨生成失败 (${error.javaClass.simpleName})")
    }

    // Diagnostic only. Do not wire to playback: a URI and install epoch do not bind the bytes
    // Media3 actually opened. Require an immutable installed artifact, reader leases and device AAC proof.
    fun enqueue(
        context: Context,
        source: AudioSourceLoads.FourStemSource,
        permit: NativeInferenceGate.Permit,
        done: (FourStemGenerator.Result?) -> Unit,
    ): Boolean = generator.enqueue(
        source, permit,
        store = {
            val input = FourStemLocalInput.privatePath(source.identity.uri, context.filesDir)
                ?: throw IllegalArgumentException("Unsupported four-stem input")
            check(FourStemLocalInput.withFile(input) { _, _ -> true } == true) { "Unbounded four-stem input" }
            FourStemStore(context.cacheDir, { file, frames ->
                permit.isCurrent() && source.isCurrent() && isFinalizedAac(file, frames) {
                    !permit.isCurrent() || !source.isCurrent()
                }
            }, totalLimitBytes = { InstrumentalStore.cacheLimitBytes(context) })
        },
        pipeline = {
            val input = FourStemLocalInput.privatePath(source.identity.uri, context.filesDir)
                ?: throw IllegalArgumentException("Unsupported four-stem input")
            AndroidPipeline(context, input, permit)
        },
        done = done,
    )

    private class AndroidPipeline(
        val context: Context,
        val input: File,
        val permit: NativeInferenceGate.Permit,
    ) : FourStemGenerator.Pipeline {
        private lateinit var model: File

        override fun canContinue(written: Long): Boolean {
            if (written > MAX_FRAMES) return false
            val manager = context.getSystemService(android.app.ActivityManager::class.java) ?: return false
            val memory = android.app.ActivityManager.MemoryInfo().also(manager::getMemoryInfo)
            if (memory.lowMemory) return false
            return written != 0L || InstrumentalStore.cacheLimitBytes(context) >= 16L * 1024 * 1024
        }

        override fun loadModel(cancelled: () -> Boolean) {
            model = AutomixModels.ensureScnetForInference(context, permit, cancelled)
            ScnetRunner.ensureLoaded(model, permit, cancelled)
        }

        override fun decode(
            cancelled: () -> Boolean,
            prepare: (Long) -> Boolean,
            window: (FloatArray, FloatArray, Int) -> Boolean,
        ): Boolean =
            TrackPcmDecoder.decodeStemWindows(context, input, cancelled, prepare) { samples, frames ->
                window(samples.left, samples.right, frames)
            }

        override fun separate(
            left: FloatArray, right: FloatArray, frames: Int, cancelled: () -> Boolean,
        ): Map<FourStemStore.Track, Array<FloatArray>>? {
            var completed = false
            val result = ScnetRunner.separate(left, right, permit, model, toSample = frames, cancelled = cancelled,
                onProgress = { done, total -> completed = done == total })
            if (!completed || result.sampleRate != RATE || result.fromSample != 0) return null
            return FourStemStore.Track.entries.associateWith { track ->
                result.stems[track.name.lowercase()] ?: return null
            }
        }

        override fun writer(file: File, cancelled: () -> Boolean, withinBudget: (Int) -> Boolean) =
            StemAacWriter(file.absolutePath, RATE, CHANNELS, FourStemGenerator.AAC_BIT_RATE, cancelled, withinBudget)
    }

    /** Check every access unit, including the last. Missing trim metadata is not proof of gapless output. */
    private fun isFinalizedAac(file: File, frames: Long, cancelled: () -> Boolean): Boolean {
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(file.absolutePath)
            if (extractor.trackCount != 1) return false
            val format = extractor.getTrackFormat(0)
            if (format.getString(MediaFormat.KEY_MIME) != MediaFormat.MIMETYPE_AUDIO_AAC ||
                format.getInteger(MediaFormat.KEY_SAMPLE_RATE) != RATE ||
                format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) != CHANNELS
            ) return false
            val timeline = FourStemAacTimeline(frames)
            fun optionalInt(key: String) = if (format.containsKey(key)) format.getInteger(key) else null
            if (!timeline.allows(format.getLong(MediaFormat.KEY_DURATION),
                    optionalInt(MediaFormat.KEY_ENCODER_DELAY), optionalInt(MediaFormat.KEY_ENCODER_PADDING))
            ) return false
            // Exact AAC-LC ASC: 44.1 kHz, stereo, frameLengthFlag/core dependency/extension all zero.
            val config = format.getByteBuffer("csd-0") ?: return false
            if (config.remaining() != 2 || (config.get().toInt() and 0xff) != 0x12 || config.get().toInt() != 0x10) return false
            extractor.selectTrack(0)
            val buffer = java.nio.ByteBuffer.allocateDirect(32 * 1024)
            while (extractor.sampleTrackIndex != -1) {
                if (cancelled() || extractor.sampleTrackIndex != 0 || extractor.sampleFlags != MediaExtractor.SAMPLE_FLAG_SYNC ||
                    !timeline.accept(extractor.sampleTime)
                ) return false
                buffer.clear()
                if (extractor.readSampleData(buffer, 0) !in 1..buffer.capacity()) return false
                if (!extractor.advance()) break
            }
            return !cancelled() && extractor.sampleTrackIndex == -1 && timeline.complete()
        } finally {
            extractor.release()
        }
    }
}
