package top.izuna.foliamajor.player.dsp

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

// Host regressions for the private snapshot storage and independent leases, not Media3 authorization.
class FourStemInputSnapshotsTest {
    @get:Rule val folder = TemporaryFolder()

    private val a = wav(1)
    private val b = wav(9)

    @Test fun samePathReplacementCannotChangeOldSnapshotOrItsReopens() {
        val sources = folder.newFolder("sources")
        val source = File(sources, "song.wav").apply { writeBytes(a) }
        val store = FourStemInputSnapshots(sources, folder.newFolder("snapshots"), 1024, 2)
        val anchor = checkNotNull(store.stagePcmWav(source.name))
        anchor.use {
            checkNotNull(anchor.retain()).use { held ->
                held.file.inputStream().use { opened ->
                    val replacement = File(sources, "next.wav").apply { writeBytes(b) }
                    Files.move(
                        replacement.toPath(), source.toPath(),
                        StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING,
                    )
                    checkNotNull(store.stagePcmWav(source.name)).use { next ->
                        assertNotEquals(held.file, next.file)
                        assertArrayEquals(b, next.file.readBytes())
                    }
                    assertArrayEquals(a, opened.readBytes())
                }
            }
            checkNotNull(anchor.retain()).use { seekReopen ->
                checkNotNull(anchor.retain()).use { generation ->
                    assertArrayEquals(a, seekReopen.file.readBytes())
                    assertArrayEquals(a, generation.file.readBytes())
                }
            }
        }
        assertArrayEquals(b, source.readBytes())
    }

    @Test fun anchorReaderAndGenerationReleaseIndependentlyAndCannotReviveClosedLease() {
        val sources = folder.newFolder("sources")
        File(sources, "song.wav").writeBytes(a)
        val store = FourStemInputSnapshots(sources, folder.newFolder("snapshots"), a.size.toLong(), 1)
        val anchor = checkNotNull(store.stagePcmWav("song.wav"))
        val reader = checkNotNull(anchor.retain())
        val generator = checkNotNull(anchor.retain())
        val published = anchor.file

        anchor.close()
        anchor.close()
        assertNull(anchor.retain())
        assertNull(store.stagePcmWav("song.wav"))
        reader.close()
        reader.close()
        assertArrayEquals(a, generator.file.readBytes())
        assertNull(store.stagePcmWav("song.wav"))
        generator.close()
        generator.close()
        assertFalse(published.exists())
        assertFalse(published.parentFile!!.exists())
        assertNull(generator.retain())
        checkNotNull(store.stagePcmWav("song.wav")).use { next -> assertNotEquals(published, next.file) }
    }

    @Test fun failedValidationDoesNotPublishOrKeepCapacityAndNonPrivateNamesAreRejected() {
        val sources = folder.newFolder("sources")
        val snapshots = folder.newFolder("snapshots")
        val outside = folder.newFile("outside.wav").apply { writeBytes(a) }
        val source = File(sources, "song.wav")
        val store = FourStemInputSnapshots(sources, snapshots, a.size.toLong(), 1)
        for (name in listOf(outside.path, "../outside.wav", "nested/song.wav", "content://audio/song.wav", "https://host/song.wav", source.name)) {
            assertNull(store.stagePcmWav(name))
        }
        for (invalid in listOf(byteArrayOf(), a.copyOf(a.size + 1), a.copyOf(a.size - 2), a.clone().apply { this[20] = 3 })) {
            source.writeBytes(invalid)
            assertNull(store.stagePcmWav(source.name))
            assertTrue(snapshots.list()!!.isEmpty())
        }
        source.writeBytes(a)
        checkNotNull(store.stagePcmWav(source.name)).use { lease ->
            assertArrayEquals(a, lease.file.readBytes())
            assertEquals(listOf(lease.file.name), lease.file.parentFile!!.list()!!.toList())
        }
        assertTrue(snapshots.list()!!.isEmpty())
    }

    @Test fun concurrentCopiesUseExclusiveSlotsAndShareAggregateCapacity() {
        val sources = folder.newFolder("sources")
        File(sources, "song.wav").writeBytes(a)
        val store = FourStemInputSnapshots(sources, folder.newFolder("snapshots"), 2L * a.size, 3)
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(3)
        try {
            val pending = List(3) {
                pool.submit<FourStemInputSnapshots.Lease?> {
                    check(start.await(5, TimeUnit.SECONDS))
                    store.stagePcmWav("song.wav")
                }
            }
            start.countDown()
            val leases = pending.mapNotNull { it.get(5, TimeUnit.SECONDS) }
            try {
                assertEquals(2, leases.size)
                assertEquals(2, leases.map { it.file }.toSet().size)
                leases.forEach { assertArrayEquals(a, it.file.readBytes()) }
            } finally {
                leases.forEach { it.close() }
            }
            assertNotNull(store.stagePcmWav("song.wav")?.also { it.close() })
        } finally {
            pool.shutdownNow()
        }
    }

    @Test fun failedReclaimDoesNotRemoveForeignFilesOrAdmitOverCapacity() {
        val sources = folder.newFolder("sources")
        File(sources, "song.wav").writeBytes(a)
        val store = FourStemInputSnapshots(sources, folder.newFolder("snapshots"), 1024, 1)
        val lease = checkNotNull(store.stagePcmWav("song.wav"))
        val published = lease.file
        val obstruction = File(published.parentFile!!, "unexpected").apply { writeText("keep") }
        lease.close()
        assertFalse(published.exists())
        assertEquals("keep", obstruction.readText())
        assertNull(store.stagePcmWav("song.wav"))
    }

    @Test fun interruptedWorkerDoesNotPublishOrConsumeSlot() {
        val sources = folder.newFolder("sources")
        val snapshots = folder.newFolder("snapshots")
        File(sources, "song.wav").writeBytes(a)
        val store = FourStemInputSnapshots(sources, snapshots, 1024, 1)
        val worker = Executors.newSingleThreadExecutor()
        try {
            val result = worker.submit<FourStemInputSnapshots.Lease?> {
                Thread.currentThread().interrupt()
                store.stagePcmWav("song.wav")
            }
            assertNull(result.get(5, TimeUnit.SECONDS)?.also { it.close() })
            assertTrue(snapshots.list()!!.isEmpty())
            assertNotNull(store.stagePcmWav("song.wav")?.also { it.close() })
        } finally {
            worker.shutdownNow()
        }
    }

    @Test fun preexistingSnapshotRootContentsAreNotReclaimedOrIgnored() {
        val sources = folder.newFolder("sources")
        val snapshots = folder.newFolder("snapshots")
        File(sources, "song.wav").writeBytes(a)
        val leftover = File(snapshots, "old-copy").apply { writeBytes(b) }
        val store = FourStemInputSnapshots(sources, snapshots, 1024, 1)
        assertNull(store.stagePcmWav("song.wav"))
        assertArrayEquals(b, leftover.readBytes())
        assertEquals(listOf(leftover.name), snapshots.list()!!.toList())
    }

    private fun wav(sample: Short): ByteArray = ByteBuffer.allocate(48).order(ByteOrder.LITTLE_ENDIAN).apply {
        put("RIFF".toByteArray())
        putInt(40)
        put("WAVEfmt ".toByteArray())
        putInt(16)
        putShort(1)
        putShort(1)
        putInt(8_000)
        putInt(16_000)
        putShort(2)
        putShort(16)
        put("data".toByteArray())
        putInt(4)
        putShort(sample)
        putShort(sample)
    }.array()
}
