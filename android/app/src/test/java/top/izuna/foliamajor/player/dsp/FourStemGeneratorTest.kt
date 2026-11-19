package top.izuna.foliamajor.player.dsp

import java.io.File
import java.util.ArrayDeque
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import top.izuna.foliamajor.automix.NativeInferenceGate

// Exercise generation on a real cache filesystem without invoking MediaCodec or ORT.
class FourStemGeneratorTest {
    @get:Rule val temp = TemporaryFolder()
    private val gate = NativeInferenceGate()
    private val loads = AudioSourceLoads()
    private val original = AudioSourceLoads.Source("https://example.invalid/audio?sig=a", "https://example.invalid/audio?sig=a", "song", false)
    private val queued = ArrayDeque<Runnable>()
    private val generator = FourStemGenerator(queued::addLast)
    private val root by lazy { temp.newFolder() }
    private var probe: () -> Unit = {}
    private var limit = 256L * 1024 * 1024
    private val store by lazy {
        FourStemStore(root, isFinalizedAac = { file, frames -> probe(); frames > 0 && file.length() > 0 }, totalLimitBytes = { limit })
    }
    private var callbacks = 0
    private var result: FourStemStore.Entry? = null

    private fun install(source: AudioSourceLoads.Source = original): AudioSourceLoads.Installed {
        val ticket = loads.requestSource(source)
        assertTrue(loads.beginInstall(ticket))
        loads.markSourceInstalled(ticket, source)
        return AudioSourceLoads.Installed(ticket, source)
    }

    private fun capture(installed: AudioSourceLoads.Installed = install()) =
        checkNotNull(loads.captureFourStem(installed.ticket, epoch(installed), installed.source.actual))

    private fun epoch(installed: AudioSourceLoads.Installed) = checkNotNull(loads.reserveFourStem(installed.ticket))

    private fun enqueue(source: AudioSourceLoads.FourStemSource, pipeline: () -> Pipeline): Boolean = generator.enqueue(
        source, checkNotNull(gate.acquire()), { store }, pipeline,
    ) { completion ->
        callbacks++
        result = null
        completion?.ifCurrent { result = it; true }
    }

    private fun assertNoFiles() = assertFalse(root.walkTopDown().any { it.isFile })

    private class Pipeline : FourStemGenerator.Pipeline {
        var load = 0
        var eos = true
        var validInput = true
        var failFinish: FourStemStore.Track? = null
        var onLoad = {}
        var expectedFrames = 1024L
        var appendBytes = 0
        var starts = 0
        var canEncode: (Long) -> Boolean = { true }
        val appended = mutableListOf<Pair<FourStemStore.Track, Int>>()
        var closed = 0
        var finished = 0

        override fun canContinue(written: Long) = canEncode(written)
        override fun loadModel(cancelled: () -> Boolean) { load++; onLoad() }
        override fun decode(
            cancelled: () -> Boolean,
            prepare: (Long) -> Boolean,
            window: (FloatArray, FloatArray, Int) -> Boolean,
        ): Boolean {
            if (!validInput || !prepare(expectedFrames)) return false
            val left = FloatArray(1024)
            val right = left.copyOf()
            return window(left, right, 1023) && window(left, right, 1) && eos
        }
        override fun separate(left: FloatArray, right: FloatArray, frames: Int, cancelled: () -> Boolean) =
            FourStemStore.Track.entries.associateWith { Array(2) { FloatArray(frames) } }
        override fun writer(file: File, cancelled: () -> Boolean, withinBudget: (Int) -> Boolean): FourStemGenerator.Writer {
            val track = FourStemStore.Track.entries.single { it.fileName == file.name }
            starts++
            return object : FourStemGenerator.Writer {
                override fun append(stereo: Array<FloatArray>, frames: Int) {
                    appended.add(track to frames)
                    if (appendBytes > 0) file.appendBytes(ByteArray(appendBytes))
                }
                override fun finish(frames: Long) {
                    assertEquals(1024L, frames)
                    if (track == failFinish) error("encoder failed to drain EOS")
                    finished++
                    file.writeBytes(byteArrayOf(track.ordinal.toByte()))
                }
                override fun close() { closed++ }
            }
        }
    }

    @Test fun queuedPermitCannotReviveAndDoesNotTouchStoreOrModel() {
        val source = capture()
        assertNull(gate.acquire())
        gate.setEnabled(true)
        assertTrue(generator.enqueue(source, checkNotNull(gate.acquire()), { error("store touched") }, { error("model touched") }) {
            callbacks++
            assertNull(it)
        })
        gate.setEnabled(false)
        gate.setEnabled(true)
        queued.removeFirst().run()
        assertEquals(1, callbacks)
        assertNoFiles()
    }

    @Test fun completeWindowsPublishFourFinalizedTracksAndOnlyExactEpochHits() {
        val source = capture()
        gate.setEnabled(true)
        val codec = Pipeline()
        assertTrue(enqueue(source) { codec })
        assertFalse(enqueue(source) { error("must not queue concurrent generation") })
        queued.removeFirst().run()
        assertEquals(4, codec.closed)
        assertEquals(4, codec.finished)
        val tracks = FourStemStore.Track.entries
        assertEquals(tracks.map { it to 1023 } + tracks.map { it to 1 }, codec.appended)
        val built = checkNotNull(result)
        assertEquals(1024L, built.frames)
        assertEquals(built, store.open(source.cacheSource()))
        assertTrue(enqueue(source) { error("exact hit must not use model") })
        queued.removeFirst().run()
        assertEquals(built, result)
        assertNull(store.open(capture().cacheSource()))
        val changed = original.url.replace("sig=a", "sig=b")
        assertNull(store.open(capture(install(original.copy(baseUrl = changed, url = changed))).cacheSource()))
    }

    @Test fun supersededPendingRequestAndTransitionRestoreNeverReviveTheOldOwner() {
        val installed = install()
        val old = capture(installed)
        val oldEpoch = epoch(installed)
        val incoming = loads.requestSource(original)
        assertNull(loads.captureFourStem(installed.ticket, oldEpoch, original.actual))
        loads.markSourceInstalled(incoming, original)
        assertNull(loads.captureFourStem(installed.ticket, oldEpoch, original.actual))
        assertTrue(loads.restoreOutgoing(incoming, installed) {})
        assertFalse(old.isCurrent())
        assertNull(loads.captureFourStem(installed.ticket, oldEpoch, original.actual))
        val restored = capture(installed)
        assertNotEquals(old.cacheSource(), restored.cacheSource())
        assertNull(loads.captureFourStem(installed.ticket, epoch(installed), AudioSourceIdentity.from("file:///different.m4a", "song")))
        assertNull(loads.captureFourStem(installed.ticket, epoch(installed), null))
    }

    @Test fun alreadyPlayingATwoTrackProductDoesNotGrantItsBaseIdentity() {
        val installed = install(original.copy(url = "file:///legacy.m4a", instrumental = true))
        assertNull(loads.captureFourStem(installed.ticket, epoch(installed), installed.source.actual))
        assertNull(loads.captureFourStem(installed.ticket, epoch(installed), original.actual))
    }

    @Test fun revokeAndReopenDuringProbeCannotPublishOrLeakStaging() {
        val source = capture()
        gate.setEnabled(true)
        probe = { gate.setEnabled(false); gate.setEnabled(true) }
        val codec = Pipeline()
        assertTrue(enqueue(source) { codec })
        queued.removeFirst().run()
        assertEquals(4, codec.closed)
        assertNull(result)
        assertNull(store.open(source.cacheSource()))
        assertNoFiles()
    }

    @Test fun sameSongSameUriReloadDuringProbeAlsoCannotPublish() {
        val source = capture()
        gate.setEnabled(true)
        probe = { install() }
        assertTrue(enqueue(source) { Pipeline() })
        queued.removeFirst().run()
        assertNull(result)
        assertNull(store.open(source.cacheSource()))
        assertNoFiles()
    }

    @Test fun partialDecodeOrFailedFinalizeNeverPublishesAndClosesAllWriters() {
        gate.setEnabled(true)
        for (codec in listOf(Pipeline().apply { eos = false }, Pipeline().apply { failFinish = FourStemStore.Track.OTHER })) {
            assertTrue(enqueue(capture()) { codec })
            queued.removeFirst().run()
            assertEquals(4, codec.closed)
            assertNull(result)
            assertNoFiles()
        }
    }

    @Test fun rejectedInputDoesNotLoadModelOrCreateWriters() {
        gate.setEnabled(true)
        val codec = Pipeline().apply { validInput = false }
        assertTrue(enqueue(capture()) { codec })
        queued.removeFirst().run()
        assertEquals(0, codec.load)
        assertEquals(0, codec.closed)
        assertNull(result)
        assertNoFiles()
    }

    @Test fun revocationDuringModelLoadDoesNotAllocateAnyEncoders() {
        gate.setEnabled(true)
        val source = capture()
        val codec = Pipeline().apply { onLoad = { gate.setEnabled(false); gate.setEnabled(true) } }
        assertTrue(enqueue(source) { codec })
        queued.removeFirst().run()
        assertEquals(1, codec.load)
        assertEquals(0, codec.closed)
        assertTrue(codec.appended.isEmpty())
        assertNull(result)
        assertNoFiles()
    }

    @Test fun completionKeepsOriginalPermitAndInstallEpochAcrossDeferredUse() {
        gate.setEnabled(true)
        val installed = install()
        val source = capture(installed)
        fun generate(): FourStemGenerator.Result {
            var completion: FourStemGenerator.Result? = null
            assertTrue(generator.enqueue(source, checkNotNull(gate.acquire()), { store }, { Pipeline() }) { completion = it })
            queued.removeFirst().run()
            return checkNotNull(completion)
        }
        val oldPermit = generate()
        assertTrue(oldPermit.ifCurrent { true })
        gate.setEnabled(false)
        gate.setEnabled(true)
        assertFalse(oldPermit.ifCurrent { error("old permit revived") })
        val oldEpoch = generate()
        // Same ticket and URI, but a new actual installation epoch.
        loads.markSourceInstalled(installed.ticket, original)
        assertFalse(oldEpoch.ifCurrent { error("old epoch revived") })
    }

    @Test fun throwingCompletionCannotEscapeWorkerOrPoisonNextRequest() {
        gate.setEnabled(true)
        val source = capture()
        assertTrue(generator.enqueue(source, checkNotNull(gate.acquire()), { store }, { Pipeline() }) {
            callbacks++
            error("consumer threw")
        })
        queued.removeFirst().run()
        assertEquals(1, callbacks)
        assertTrue(enqueue(source) { error("exact hit must not use model") })
        queued.removeFirst().run()
        assertNotNull(result)
    }

    @Test fun knownNonAlignedLengthDoesNotStartModelOrEncoders() {
        gate.setEnabled(true)
        val codec = Pipeline().apply { expectedFrames = 26_460_000L }
        assertTrue(enqueue(capture()) { codec })
        queued.removeFirst().run()
        assertEquals(0, codec.load)
        assertEquals(0, codec.starts)
        assertNull(result)
        assertNoFiles()
    }

    @Test fun remainingBudgetAfterOtherKeysBlocksModelEvenWhenGlobalLimitIsLarge() {
        gate.setEnabled(true)
        limit = 4L * 1024 * 1024
        val first = checkNotNull(store.publish(capture().cacheSource(), 1024) { paths ->
            paths.values.forEach { it.writeBytes(byteArrayOf(1)) }
            true
        })
        val oldFile = first.files.values.first()
        // About 60 s (~3.84 MB) fits the global limit but not the 1 MiB left by the old key.
        java.io.RandomAccessFile(oldFile, "rw").use { it.setLength(limit - 1024 * 1024) }
        val codec = Pipeline().apply { expectedFrames = 2_646_016L }
        assertTrue(enqueue(capture()) { codec })
        queued.removeFirst().run()
        assertEquals(0, codec.load)
        assertEquals(0, codec.starts)
        assertNull(result)
        assertEquals(limit - 1024 * 1024, oldFile.length())
        assertFalse(root.walkTopDown().any { it.name.startsWith(".part-") })
    }

    @Test fun actualStagingOverrunStopsFurtherAppendsAndCleansUp() {
        gate.setEnabled(true)
        limit = 1024L * 1024
        val codec = Pipeline().apply { appendBytes = limit.toInt() }
        assertTrue(enqueue(capture()) { codec })
        queued.removeFirst().run()
        assertEquals(1, codec.appended.size)
        assertEquals(0, codec.finished)
        assertEquals(4, codec.closed)
        assertNull(result)
        assertNoFiles()
    }

    @Test fun lowBudgetBeforeModelStopsAndReleasesWorkerSlot() {
        gate.setEnabled(true)
        val source = capture()
        val codec = Pipeline().apply { canEncode = { false } }
        assertTrue(enqueue(source) { codec })
        queued.removeFirst().run()
        assertEquals(0, codec.load)
        assertNull(result)
        assertNoFiles()
        assertTrue(enqueue(source) { Pipeline() })
        queued.removeFirst().run()
        assertNotNull(result)
    }
}
