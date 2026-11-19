package top.izuna.foliamajor.player.dsp

import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import top.izuna.foliamajor.automix.FourStemPcmTimeline
import top.izuna.foliamajor.automix.NativeInferenceGate

// Worker-only four-stem generation. PCM never escapes one window or reaches disk.
internal class FourStemGenerator(
    private val worker: Executor,
    private val failed: (Throwable) -> Unit = {},
) {
    interface Writer : AutoCloseable {
        fun append(stereo: Array<FloatArray>, frames: Int)
        fun finish(frames: Long)
    }

    interface Pipeline {
        fun canContinue(written: Long): Boolean
        fun loadModel(cancelled: () -> Boolean)
        fun decode(
            cancelled: () -> Boolean,
            prepare: (expectedFrames: Long) -> Boolean,
            window: (FloatArray, FloatArray, Int) -> Boolean,
        ): Boolean
        fun separate(left: FloatArray, right: FloatArray, frames: Int, cancelled: () -> Boolean): Map<FourStemStore.Track, Array<FloatArray>>?
        fun writer(file: File, cancelled: () -> Boolean, withinBudget: (nextPayloadBytes: Int) -> Boolean): Writer
    }

    companion object {
        const val AAC_BIT_RATE = 128_000
    }

    private val busy = AtomicBoolean()

    class Result internal constructor(
        private val permit: NativeInferenceGate.Permit,
        private val source: AudioSourceLoads.FourStemSource,
        private val entry: FourStemStore.Entry,
    ) {
        /** Only for short checks/commits, never file I/O. No reader lease or playback authorization. */
        fun ifCurrent(action: (FourStemStore.Entry) -> Boolean): Boolean = permit.commit {
            source.commit { action(entry) }
        }
    }

    /** False means no work or callback. Every accepted job completes once on the worker. */
    fun enqueue(
        source: AudioSourceLoads.FourStemSource,
        permit: NativeInferenceGate.Permit,
        store: () -> FourStemStore,
        pipeline: () -> Pipeline,
        done: (Result?) -> Unit,
    ): Boolean {
        if (!permit.isCurrent() || !source.isCurrent() || !busy.compareAndSet(false, true)) return false
        try {
            worker.execute {
                val entry = try {
                    recover { generate(source, permit, store, pipeline) }
                } finally {
                    busy.set(false)
                }
                val result = entry?.let { Result(permit, source, it) }?.takeIf { it.ifCurrent { true } }
                recover { done(result) }
            }
        } catch (_: RejectedExecutionException) {
            busy.set(false)
            return false
        }
        return true
    }

    private fun generate(
        source: AudioSourceLoads.FourStemSource,
        permit: NativeInferenceGate.Permit,
        createStore: () -> FourStemStore,
        createPipeline: () -> Pipeline,
    ): FourStemStore.Entry? {
        fun cancelled() = !permit.isCurrent() || !source.isCurrent()
        fun commit(action: () -> Boolean) = permit.commit { source.commit(action) }
        if (cancelled()) return null
        val store = createStore()
        val key = source.cacheSource()
        store.open(key)?.let { return it.takeIf { commit { true } } }
        if (cancelled()) return null
        return store.stageAndPublish(key, ::commit) { stage ->
            if (cancelled()) null else encode(stage, createPipeline(), ::cancelled)
        }
    }

    private fun encode(
        stage: FourStemStore.Staging,
        pipeline: Pipeline,
        cancelled: () -> Boolean,
    ): Long? {
        val writers = linkedMapOf<FourStemStore.Track, Writer>()
        var written = 0L
        var expected = 0L
        fun withinBudget(nextPayloadBytes: Int) = !cancelled() &&
            if (nextPayloadBytes == 0) stage.withinBudget() else stage.reserveSample(nextPayloadBytes)
        try {
            if (!withinBudget(0) || !pipeline.canContinue(0)) return null
            var stopped = false
            fun prepare(frames: Long): Boolean {
                if (stopped || expected != 0L || cancelled() || !FourStemAacTimeline.aligned(frames) ||
                    !stage.fitsEstimate(estimatedBytes(frames))
                ) {
                    stopped = true
                    return false
                }
                expected = frames
                return true
            }
            val eos = pipeline.decode(cancelled, ::prepare) { left, right, frames ->
                fun accept(): Boolean {
                    if (stopped || cancelled() || frames <= 0 || frames > minOf(left.size, right.size)) return false
                    val next = written + frames
                    if (next > expected || !pipeline.canContinue(next) || !stage.fitsEstimate(estimatedBytes(expected)) ||
                        !withinBudget(0)
                    ) return false
                    if (writers.isEmpty()) {
                        pipeline.loadModel(cancelled)
                        for ((track, file) in stage.files) {
                            if (!withinBudget(0)) return false
                            writers[track] = pipeline.writer(file, cancelled, ::withinBudget)
                        }
                        if (!withinBudget(0)) return false
                    }
                    val tracks = pipeline.separate(left, right, frames, cancelled) ?: return false
                    if (tracks.keys != writers.keys) return false
                    for ((track, writer) in writers) {
                        if (!withinBudget(0)) return false
                        val stereo = tracks.getValue(track)
                        if (stereo.size != 2 || stereo.any { it.size != frames }) return false
                        writer.append(stereo, frames)
                        if (!withinBudget(0)) return false
                    }
                    written = next
                    return true
                }
                accept().also { if (!it) stopped = true }
            }
            if (!eos || stopped || written != expected || !FourStemAacTimeline.aligned(written)) return null
            for (writer in writers.values) {
                if (!withinBudget(0)) return null
                writer.finish(written)
                if (!withinBudget(0)) return null
            }
            return written
        } finally {
            // A failed finalize/release on one track cannot prevent releasing the other three.
            var closeFailure: Throwable? = null
            for (writer in writers.values) {
                try {
                    writer.close()
                } catch (error: Throwable) {
                    if (closeFailure == null) closeFailure = error
                }
            }
            closeFailure?.let { throw it }
        }
    }

    private fun estimatedBytes(frames: Long): Long {
        val bytesPerSecond = AAC_BIT_RATE * FourStemStore.Track.entries.size / 8L
        val rate = FourStemPcmTimeline.RATE
        // Planning estimate only; the actual lengths are verified at the write boundaries.
        return (frames * bytesPerSecond + rate - 1) / rate
    }

    private inline fun <T> recover(action: () -> T): T? = try {
        action()
    } catch (error: Throwable) {
        if (error is ThreadDeath || (error is VirtualMachineError && error !is OutOfMemoryError)) throw error
        try {
            failed(error)
        } catch (loggingError: Throwable) {
            if (loggingError is ThreadDeath || (loggingError is VirtualMachineError && loggingError !is OutOfMemoryError)) throw loggingError
        }
        null
    }
}
