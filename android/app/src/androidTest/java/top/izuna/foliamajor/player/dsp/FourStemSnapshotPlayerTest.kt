package top.izuna.foliamajor.player.dsp

import android.os.SystemClock
import android.system.Os
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.BundledExtractorsAdapter
import androidx.media3.exoplayer.source.MediaPeriod
import androidx.media3.exoplayer.source.ProgressiveMediaExtractor
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.exoplayer.source.WrappingMediaSource
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.wav.WavExtractor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

// Device-only experiment: one paused ExoPlayer, one WAV, and independent source/reader/consumer holds.
@UnstableApi
@RunWith(AndroidJUnit4::class)
class FourStemSnapshotPlayerTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Test fun seekReopensSealedWavAndReleaseWaitsForSourceAndLoader() {
        val folder = File(instrumentation.targetContext.cacheDir, "stem-snapshot-player-${UUID.randomUUID()}")
        check(folder.mkdir()) { "Could not create fixture: $folder" }
        var cleanupAnchor: FourStemInputSnapshots.Lease? = null
        var cleanupIndependent: FourStemInputSnapshots.Lease? = null
        var cleanupPlayer: ExoPlayer? = null
        var cleanupSource: ObservedSource? = null
        var cleanupProbe: Probe? = null
        var sourceMayBeInUse = false
        var releaseAttempted = false
        var teardownConfirmed = false
        var failure: Throwable? = null
        try {
            val a = wav(101)
            val b = wav(909)
            val sources = File(folder, "sources").apply { check(mkdir()) }
            val snapshots = File(folder, "snapshots").apply { check(mkdir()) }
            val original = File(sources, "song.wav").apply { writeBytes(a) }
            val store = FourStemInputSnapshots(sources, snapshots, a.size.toLong(), 1)
            val anchor = checkNotNull(store.stagePcmWav(original.name)).also { cleanupAnchor = it }
            val sealed = anchor.file
            val independent = checkNotNull(anchor.retain()).also { cleanupIndependent = it }
            val probe = Probe(FourStemSnapshotDataSource.Factory(anchor)).also { cleanupProbe = it }
            val progressive = ProgressiveMediaSource.Factory(probe.readers, probe.extractors)
                .setContinueLoadingCheckIntervalBytes(8 * 1024)
                .createMediaSource(MediaItem.Builder().setUri(probe.uri).setMimeType(MimeTypes.AUDIO_WAV).build())
            val source = ObservedSource(progressive).also { cleanupSource = it }
            val ready = CountDownLatch(1)
            val playerError = AtomicReference<PlaybackException>()
            val player = createPlayer(ready, playerError).also { cleanupPlayer = it }
            sourceMayBeInUse = true
            onMain {
                player.setMediaSource(source)
                player.prepare()
            }
            ready.awaitOrFail("initial WAV preparation")
            assertNull("initial playback error", playerError.get())
            val initial = checkNotNull(probe.initialRead.get())
            assertEquals(0L, initial.openPosition)
            val initialOffset = initial.position.toInt()
            assertArrayEquals(a.copyOfRange(initialOffset, initialOffset + initial.bytes.size), initial.bytes)

            assertEquals(a.size, b.size)
            val replacement = File(sources, "next.wav").apply { writeBytes(b) }
            Os.rename(replacement.path, original.path)
            assertArrayEquals(b, original.readBytes())
            assertArrayEquals(a, independent.file.readBytes())
            val buffered = onMain { player.bufferedPosition }
            assertTrue("seek must lie outside already buffered samples: buffered=$buffered", buffered < SEEK_MS)
            onMain { player.seekTo(SEEK_MS) }
            probe.seekReadEntered.awaitOrFail("Media3 nonzero reopen and read after seek")
            val seek = checkNotNull(probe.seekRead.get())
            val seekOffset = WAV_HEADER + SEEK_MS.toInt() * SAMPLE_RATE / 1000 * 2
            assertEquals(seekOffset.toLong(), seek.openPosition)
            assertEquals(seek.openPosition, seek.position)
            assertArrayEquals(a.copyOfRange(seekOffset, seekOffset + seek.bytes.size), seek.bytes)
            assertFalse(b.copyOfRange(seekOffset, seekOffset + seek.bytes.size).contentEquals(seek.bytes))
            assertTrue("initial descriptor must have closed before the reopen", probe.closedReaders.get() >= 1)
            assertEquals(1, probe.liveReaders.get())

            releaseAttempted = true
            onMain { player.release() }
            source.periodReleased.awaitOrFail("real MediaPeriod.release")
            source.sourceReleased.awaitOrFail("real MediaSource.release")
            assertNull("ExoPlayer reported an error during seek or release", playerError.get())
            assertEquals("player release must not be treated as extractor release", 1L, probe.extractorReleased.count)
            assertEquals(1, probe.liveReaders.get())
            assertTrue(sealed.exists())
            assertNotNull("installation anchor must still accept a hold", anchor.retain()?.also { it.close() })

            probe.finishSeekRead.countDown()
            confirmSnapshotTeardown(source, probe)
            teardownConfirmed = true
            assertEquals(0, probe.gateTimeouts.get())
            assertNull("seek playback error", playerError.get())
            anchor.close()
            anchor.close()
            assertNull(anchor.retain())
            assertTrue("independent consumer still owns the snapshot", sealed.exists())
            assertNull("one-slot budget must still be occupied", store.stagePcmWav(original.name))
            assertArrayEquals(a, independent.file.readBytes())
            independent.close()
            assertFalse("last consumer must reclaim the snapshot", sealed.exists())
            assertTrue(checkNotNull(snapshots.list()).isEmpty())
            checkNotNull(store.stagePcmWav(original.name)).use { assertArrayEquals(b, it.file.readBytes()) }
        } catch (error: Throwable) {
            failure = error
            throw error
        } finally {
            finishPlayerTest(
                failure,
                release = {
                    cleanupProbe?.finishSeekRead?.countDown()
                    // A throwing release may already have taken effect. Do not retry it.
                    if (!releaseAttempted) cleanupPlayer?.let { onMain { it.release() } }
                },
                confirm = {
                    if (sourceMayBeInUse && !teardownConfirmed) {
                        try {
                            confirmSnapshotTeardown(checkNotNull(cleanupSource), checkNotNull(cleanupProbe))
                        } catch (error: Throwable) {
                            throw AssertionError("Snapshot teardown unconfirmed; keeping leases and fixture at $folder", error)
                        }
                    }
                },
                reclaim = {
                    cleanupAnchor?.close()
                    cleanupIndependent?.close()
                    check(folder.deleteRecursively()) { "Could not delete fixture: $folder" }
                },
            )
        }
    }

    private fun confirmSnapshotTeardown(source: ObservedSource, probe: Probe) {
        // This callback observes the loader's snapshot-related teardown, not its thread exit.
        probe.extractorReleased.awaitOrFail("ProgressiveMediaExtractor.release callback")
        source.sourceReleased.awaitOrFail("real MediaSource.release")
        assertEquals("all wrapped descriptors must have closed", 0, probe.liveReaders.get())
    }

    private fun createPlayer(
        ready: CountDownLatch,
        playerError: AtomicReference<PlaybackException>,
    ): ExoPlayer {
        return onMain {
            val player = ExoPlayer.Builder(instrumentation.targetContext)
                .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(500, 500, 100, 100).build())
                .setUsePlatformDiagnostics(false)
                .setReleaseTimeoutMs(5_000)
                .build()
            player.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_READY) ready.countDown()
                }

                override fun onPlayerError(error: PlaybackException) {
                    playerError.set(error)
                    ready.countDown()
                }
            })
            player
        }
    }

    private fun <T> onMain(action: () -> T): T {
        val result = AtomicReference<Result<T>>()
        instrumentation.runOnMainSync { result.set(runCatching(action)) }
        return checkNotNull(result.get()).getOrThrow()
    }

    private class ObservedSource(child: ProgressiveMediaSource) : WrappingMediaSource(child) {
        val periodReleased = CountDownLatch(1)
        val sourceReleased = CountDownLatch(1)

        override fun releasePeriod(mediaPeriod: MediaPeriod) {
            super.releasePeriod(mediaPeriod)
            periodReleased.countDown()
        }

        override fun releaseSourceInternal() {
            super.releaseSourceInternal()
            sourceReleased.countDown()
        }
    }

    private class Probe(factory: FourStemSnapshotDataSource.Factory) {
        val uri = factory.uri
        val initialRead = AtomicReference<Read>()
        val seekRead = AtomicReference<Read>()
        val seekReadEntered = CountDownLatch(1)
        val finishSeekRead = CountDownLatch(1)
        val extractorReleased = CountDownLatch(1)
        val liveReaders = AtomicInteger()
        val closedReaders = AtomicInteger()
        val gateTimeouts = AtomicInteger()
        val readers = DataSource.Factory {
            Reader(factory.createDataSource())
        }
        val extractors = ProgressiveMediaExtractor.Factory {
            val extractor = BundledExtractorsAdapter(ExtractorsFactory { arrayOf(WavExtractor()) })
            object : ProgressiveMediaExtractor by extractor {
                // Media3 1.11.1 calls this from ProgressiveMediaPeriod.onLoaderReleased.
                // Counting down witnesses the delegate release, not execution of the rest of the callback or thread exit.
                override fun release() {
                    extractor.release()
                    extractorReleased.countDown()
                }
            }
        }

        private inner class Reader(private val delegate: DataSource) : DataSource by delegate {
            private var opened = false
            private var openPosition = 0L
            private var position = 0L

            override fun open(dataSpec: DataSpec): Long {
                // An unsuccessful open may still require close; only a successful close clears the hold.
                check(!opened)
                opened = true
                liveReaders.incrementAndGet()
                openPosition = dataSpec.position
                position = openPosition
                return delegate.open(dataSpec)
            }

            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                val count = delegate.read(buffer, offset, length)
                if (count > 0) {
                    val start = position
                    position += count
                    if ((openPosition == 0L && start >= WAV_HEADER && initialRead.get() == null) ||
                        (openPosition != 0L && seekRead.get() == null)
                    ) {
                        val read = Read(openPosition, start, buffer.copyOfRange(offset, offset + minOf(count, 256)))
                        if (openPosition == 0L) initialRead.compareAndSet(null, read)
                        else if (seekRead.compareAndSet(null, read)) {
                            seekReadEntered.countDown()
                            waitForReleaseGate()
                        }
                    }
                }
                return count
            }

            override fun close() {
                delegate.close()
                if (opened) {
                    opened = false
                    closedReaders.incrementAndGet()
                    liveReaders.decrementAndGet()
                }
            }
        }

        // The loader normally cancels by interrupting this thread. Model an in-flight read that
        // does not exit until allowed, but bound the delay even when the test fails.
        private fun waitForReleaseGate() {
            val deadline = SystemClock.elapsedRealtime() + 15_000
            var interrupted = false
            try {
                while (true) {
                    val remaining = deadline - SystemClock.elapsedRealtime()
                    try {
                        if (remaining > 0 && finishSeekRead.await(remaining, TimeUnit.MILLISECONDS)) return
                        gateTimeouts.incrementAndGet()
                        throw IOException("Release gate timed out")
                    } catch (_: InterruptedException) {
                        interrupted = true
                    }
                }
            } finally {
                if (interrupted) Thread.currentThread().interrupt()
            }
        }
    }

    private data class Read(val openPosition: Long, val position: Long, val bytes: ByteArray)

    private fun CountDownLatch.awaitOrFail(event: String) {
        assertTrue("Timed out waiting for $event", await(10, TimeUnit.SECONDS))
    }

    private companion object {
        const val SAMPLE_RATE = 8_000
        const val WAV_HEADER = 44
        const val SEEK_MS = 45_000L

        fun wav(seed: Int): ByteArray {
            val sampleCount = SAMPLE_RATE * 60
            val payload = sampleCount * 2
            return ByteBuffer.allocate(WAV_HEADER + payload).order(ByteOrder.LITTLE_ENDIAN).apply {
                put("RIFF".toByteArray())
                putInt(36 + payload)
                put("WAVEfmt ".toByteArray())
                putInt(16)
                putShort(1)
                putShort(1)
                putInt(SAMPLE_RATE)
                putInt(SAMPLE_RATE * 2)
                putShort(2)
                putShort(16)
                put("data".toByteArray())
                putInt(payload)
                repeat(sampleCount) { putShort((seed + it % 251).toShort()) }
            }.array()
        }
    }
}

// Keep the first failure, wait even if release throws, and only reclaim after positive confirmation.
private fun finishPlayerTest(
    failure: Throwable?,
    release: () -> Unit,
    confirm: () -> Unit,
    reclaim: () -> Unit,
) {
    var primary = failure
    fun record(error: Throwable) {
        val first = primary
        if (first == null) primary = error
        else if (first !== error) first.addSuppressed(error)
    }

    try {
        release()
    } catch (error: Throwable) {
        record(error)
    }
    try {
        confirm()
        reclaim()
    } catch (error: Throwable) {
        record(error)
    }
    if (failure == null) primary?.let { throw it }
}
