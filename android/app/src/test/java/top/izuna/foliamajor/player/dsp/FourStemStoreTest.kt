package top.izuna.foliamajor.player.dsp

import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit.SECONDS
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.AssumptionViolatedException
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

// Exercise publication and lookup on a real filesystem, with an injected stand-in for AAC validation.
class FourStemStoreTest {
    @get:Rule val temp = TemporaryFolder()

    private val source = FourStemStore.Source(
        "provider:song", "https://user:password@example.invalid/source.m4a?token=secret", "origin-revision",
    )
    private val frames = 123_456L
    private val tracks = FourStemStore.Track.entries

    @Test fun unreadableExistingTrackDoesNotAllowASecondPublisherToReplaceIt() {
        org.junit.Assume.assumeTrue(System.getProperty("os.name").orEmpty().startsWith("Windows"))
        val root = temp.newFolder()
        val store = store(root)
        val first = checkNotNull(store.publish(source, frames) { targets ->
            for ((track, file) in targets) file.writeBytes(payload(track))
            true
        })
        val drums = first.files.getValue(FourStemStore.Track.DRUMS)
        // Android's JVM test compile stubs don't expose jdk.unsupported classes.
        val noShareRead = Class.forName("com.sun.nio.file.ExtendedOpenOption").enumConstants
            .filterIsInstance<java.nio.file.OpenOption>().single { (it as Enum<*>).name == "NOSHARE_READ" }
        java.nio.channels.FileChannel.open(drums.toPath(), java.nio.file.StandardOpenOption.READ, noShareRead).use {
            assertNull(store(root).publish(source, frames) { targets ->
                for ((track, file) in targets) file.writeBytes(payload(track) + byteArrayOf(99))
                true
            })
        }
        assertEquals(first, store.open(source))
        for ((track, file) in first.files) assertArrayEquals(payload(track), file.readBytes())
    }

    @Test fun fourFinalizedTracksBecomeVisibleOnlyAfterPublish() {
        val root = temp.newFolder()
        val store = store(root)
        val published = checkNotNull(store.publish(source, frames) { targets ->
            assertEquals(tracks.toSet(), targets.keys)
            for ((track, file) in targets) {
                file.writeBytes(payload(track))
                assertNull(store(root).open(source))
                assertFalse(root.walkTopDown().any { it.name == "ready" })
            }
            true
        })
        assertEquals(frames, published.frames)
        assertEquals(published, store(root).open(source))
        for ((track, file) in published.files) assertArrayEquals(payload(track), file.readBytes())
        assertEquals(listOf("bass.m4a", "drums.m4a", "other.m4a", "ready", "vocals.m4a"),
            root.walkTopDown().filter { it.isFile }.map { it.name }.sorted().toList())
        assertTrue(root.walkTopDown().filter { it.isFile }.none { file ->
            listOf(source.songKey, source.exactAudioIdentity, source.revision, "source.m4a", "token=secret", "password")
                .any { it in file.readBytes().toString(Charsets.ISO_8859_1) || it in file.path }
        })
    }

    @Test fun cannotReuseSameSongDifferentSourceOrRevisionOrSong() {
        val store = store(temp.newFolder())
        assertNotNull(publish(store))
        assertNull(store.open(source.copy(exactAudioIdentity = "https://other.invalid/source.m4a?token=secret")))
        assertNull(store.open(source.copy(revision = "origin-revision-2")))
        assertNull(store.open(source.copy(songKey = "provider:another")))
        assertNull(store.open(source.copy(exactAudioIdentity = "")))
        assertNull(store.open(source.copy(revision = " ")))
        assertNull(store.publish(source.copy(songKey = ""), frames) { error("Invalid identity must not encode") })
        assertNull(store.publish(source, 0) { error("Invalid frame count must not encode") })
    }

    @Test fun bucketCollisionCannotAuthorizeOtherSource() {
        val root = temp.newFolder()
        val store = store(root, collide = true)
        assertNotNull(publish(store))
        val other = source.copy(exactAudioIdentity = "different content on same songKey")
        assertNull(store(root, collide = true).open(other))
        val otherEntry = checkNotNull(store.publish(other, frames) { targets ->
            targets.values.forEach { it.writeBytes(byteArrayOf(11, 22, 33, 100)) }
            true
        })
        assertEquals(otherEntry, store.open(other))
        val firstEntry = checkNotNull(store.open(source))
        for ((track, file) in firstEntry.files) assertArrayEquals(payload(track), file.readBytes())

        // Even a complete set copied into the other slot cannot substitute for its identity proof.
        val firstDir = firstEntry.files.values.first().parentFile!!
        val otherDir = otherEntry.files.values.first().parentFile!!
        for (file in firstDir.listFiles()!!) file.copyTo(File(otherDir, file.name), overwrite = true)
        assertNull(store.open(other))
        assertEquals(firstEntry, store.open(source))
    }

    @Test fun incompleteFailedAndNonAacCandidatesNeverBecomeReady() {
        val root = temp.newFolder()
        val store = store(root)
        assertNull(store.publish(source, frames) { targets ->
            targets.entries.take(3).forEach { (track, file) -> file.writeBytes(payload(track)) }
            true
        })
        assertNull(store.publish(source, frames) { targets ->
            targets.forEach { (track, file) -> file.writeBytes(payload(track)) }
            false // Encoder did not confirm completion, even though all paths exist.
        })
        assertNull(store.publish(source, frames) { targets ->
            targets.forEach { (track, file) -> file.writeBytes(payload(track)) }
            targets.getValue(tracks.first()).writeBytes(byteArrayOf(0, 1, 2, 3))
            true
        })
        assertNull(store.publish(source, frames) { targets ->
            targets.getValue(tracks.first()).writeBytes(payload(tracks.first()))
            throw java.io.IOException("Encoder I/O error")
        })
        assertNull(store.open(source))
        assertTrue(root.walkTopDown().none { it.isFile })
        assertNotNull(publish(store))
    }

    @Test fun oneWrongLengthTrackBlocksWholePublication() {
        val root = temp.newFolder()
        val store = FourStemStore(root, isFinalizedAac = { file, expected -> file.length() == expected })
        assertNull(store.publish(source, 4) { targets ->
            targets.forEach { (track, file) -> file.writeBytes(ByteArray(if (track == tracks.last()) 3 else 4)) }
            true
        })
        assertNull(store.open(source))
        assertFalse(root.walkTopDown().any { it.isFile })
    }

    @Test fun cumulativeBudgetIncludesOldKeysAndNeverEvictsThem() {
        val root = temp.newFolder()
        val limited = FourStemStore(root, isFinalizedAac = { _, _ -> true }, totalLimitBytes = { 650 })
        val first = checkNotNull(publish(limited))
        val second = source.copy(revision = "new-install")
        assertNull(limited.publish(second, frames) { paths ->
            // The second staging group fits alone, but not together with the first committed key.
            paths.values.forEach { it.writeBytes(ByteArray(90)) }
            true
        })
        assertEquals(first, limited.open(source))
        assertNull(limited.open(second))
        assertFalse(root.walkTopDown().any { it.name.startsWith(".part-") })
    }

    @Test fun generationReservesSpaceAcrossInstancesAndCountsBufferedSamples() {
        val root = temp.newFolder()
        val store = FourStemStore(root, isFinalizedAac = { _, _ -> true }, totalLimitBytes = { 1_024L })
        assertNull(store.stageAndPublish(source, { it() }) { stage ->
            val second = source.copy(revision = "other")
            assertNull(store(root).stageAndPublish(second, { it() }) { error("reserved root must not allow a second generator") })
            assertNull(store(root).publish(second, frames) { error("reserved root must not allow another publisher") })
            assertTrue(stage.reserveSample(500))
            assertFalse(stage.reserveSample(300)) // 800 exceeds 1024 minus the marker, even with no writes yet.
            val target = stage.files.getValue(tracks.first())
            target.writeBytes(ByteArray(700))
            assertTrue(stage.withinBudget())
            assertFalse(stage.reserveSample(100)) // actual bytes are larger than submitted sample bytes.
            target.appendBytes(ByteArray(100))
            assertFalse(stage.withinBudget())
            null
        })
        assertFalse(root.walkTopDown().any { it.isFile })
        assertNotNull(publish(store))
    }

    @Test fun missingTruncatedAndSameSizeCorruptPayloadsMiss() {
        val store = store(temp.newFolder())
        for (damage in listOf<(File) -> Unit>(
            { assertTrue(it.delete()) },
            { it.writeBytes(byteArrayOf(6)) },
            { val data = it.readBytes(); data[data.lastIndex] = 99; it.writeBytes(data) },
        )) {
            val entry = checkNotNull(publish(store))
            damage(entry.files.getValue(tracks.first()))
            assertNull(store.open(source))
        }
        assertNotNull(publish(store))
    }

    @Test fun markerIsRequiredAndTheSchemaAndShapeMustMatchExactly() {
        val root = temp.newFolder()
        val store = store(root)
        assertNotNull(publish(store))
        val marker = root.walkTopDown().single { it.name == "ready" }
        val bytes = marker.readBytes()
        marker.writeText("123456:4:4:4:4\norigin-revision") // Old songKey-only four-stem marker.
        assertNull(store.open(source))
        marker.writeBytes(bytes + 0.toByte())
        assertNull(store.open(source))
        marker.writeBytes(bytes.copyOf().apply { this[7] = 99 })
        assertNull(store.open(source))
        assertTrue(marker.delete())
        assertNull(store.open(source))
    }

    @Test fun oldTwoTrackFilesAreNeitherReadNorChanged() {
        val root = temp.newFolder()
        val legacy = File(root, "instrumental").apply { mkdir() }
        val accompaniment = File(legacy, "legacy.m4a").apply { writeText("accompaniment") }
        val vocal = File(legacy, "legacy.vocal.m4a").apply { writeText("vocal") }
        val store = store(root)
        assertNull(store.open(source))
        assertNotNull(publish(store))
        assertEquals("accompaniment", accompaniment.readText())
        assertEquals("vocal", vocal.readText())
    }

    @Test fun positiveFrameCountCorruptionMissesAndCanBeRebuilt() {
        val root = temp.newFolder()
        val first = checkNotNull(publish(store(root)))
        val marker = File(first.files.values.first().parentFile, "ready")
        RandomAccessFile(marker, "rw").use {
            it.seek(2L * Int.SIZE_BYTES + 64) // Magic, schema, and identity proof precede the frame count.
            it.writeLong(frames + 1)
        }
        assertNull(store(root).open(source))
        val rebuilt = checkNotNull(publish(store(root)))
        assertEquals(frames, rebuilt.frames)
        assertEquals(rebuilt, store(root).open(source))
    }

    @Test fun linkedCacheRootIsNeitherReadNorUsedToEncode() {
        val root = temp.newFolder()
        val outside = temp.newFolder()
        val existing = checkNotNull(publish(store(outside)))
        withLink(File(root, "four-stem-aac"), File(outside, "four-stem-aac")) {
            assertNull(store(root).open(source))
            assertNull(store(root).publish(source, frames) { error("Linked cache root must not encode") })
            assertEquals(existing, store(outside).open(source))
        }
    }

    @Test fun replacedStagingDirectoryIsNotTraversedDuringCleanup() {
        val root = temp.newFolder()
        val outside = temp.newFolder()
        val retained = File(outside, "retained").apply { writeText("untouched") }
        var staging: File? = null
        try {
            assertNull(store(root).publish(source, frames) { paths ->
                val dir = paths.values.first().parentFile!!
                staging = dir
                assertTrue(dir.delete())
                link(dir, outside)
                false
            })
            assertEquals("untouched", retained.readText())
            assertFalse(Files.exists(checkNotNull(staging).toPath(), java.nio.file.LinkOption.NOFOLLOW_LINKS))
        } finally {
            staging?.let { Files.deleteIfExists(it.toPath()) }
        }
    }

    @Test fun linkedBucketAndPublicationDirectoryAreRejected() {
        for (linkBucket in listOf(true, false)) {
            val root = temp.newFolder()
            val outside = temp.newFolder()
            val entry = checkNotNull(publish(store(root)))
            val dir = entry.files.values.first().parentFile!!
            val path = if (linkBucket) dir.parentFile!! else dir
            val target = File(outside, path.name)
            val outsideDir = if (linkBucket) File(target, dir.name) else target
            assertTrue(path.renameTo(target))
            withLink(path, target) {
                assertNull(store(root).open(source))
                assertNull(publish(store(root)))
                for ((track, file) in entry.files) {
                    assertArrayEquals(payload(track), File(outsideDir, file.name).readBytes())
                }
                assertTrue(File(outsideDir, "ready").delete())
                assertNull(publish(store(root)))
                assertFalse(File(outsideDir, "ready").exists())
            }
        }
    }

    @Test fun linkedTemporaryMarkerIsRejectedWithoutWritingItsTarget() {
        val root = temp.newFolder()
        val entry = checkNotNull(publish(store(root)))
        val dir = entry.files.values.first().parentFile!!
        assertTrue(File(dir, "ready").delete())
        val retained = temp.newFile().apply { writeText("untouched") }
        withLink(File(dir, "ready.part"), retained) {
            assertNull(publish(store(root)))
            assertEquals("untouched", retained.readText())
            assertNull(store(root).open(source))
        }
        assertNotNull(publish(store(root)))
    }

    @Test fun linkedTemporaryMarkerDirectoryIsRejectedBeforeReplacingPayloads() {
        val root = temp.newFolder()
        val entry = checkNotNull(publish(store(root)))
        val dir = entry.files.values.first().parentFile!!
        assertTrue(File(dir, "ready").delete())
        val outside = temp.newFolder()
        val retained = File(outside, "retained").apply { writeText("untouched") }
        withLink(File(dir, "ready.part"), outside) {
            assertNull(store(root).publish(source, frames) { paths ->
                paths.forEach { (track, file) -> file.writeBytes(payload(track) + 1.toByte()) }
                true
            })
            assertEquals("untouched", retained.readText())
            assertNull(store(root).open(source))
            for ((track, file) in entry.files) assertArrayEquals(payload(track), file.readBytes())
        }
        assertNotNull(publish(store(root)))
    }

    @Test fun firstPublisherWinsAcrossInstancesAndReaderNeverSeesIncompleteGroup() {
        val root = temp.newFolder()
        val staged = CountDownLatch(2)
        val finishFirst = CountDownLatch(1)
        val finishSecond = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        fun encode(release: CountDownLatch, difference: Byte) = store(root).publish(source, frames) { paths ->
            paths.getValue(tracks.first()).writeBytes(payload(tracks.first()) + difference)
            staged.countDown()
            assertTrue("Publisher was not released", release.await(10, SECONDS))
            paths.forEach { (track, file) -> file.writeBytes(payload(track) + difference) }
            true
        }
        try {
            val first = pool.submit<FourStemStore.Entry?> { encode(finishFirst, 1) }
            val second = pool.submit<FourStemStore.Entry?> { encode(finishSecond, 2) }
            assertTrue("Both publishers must reach their staging barrier", staged.await(10, SECONDS))
            val reader = store(root)
            assertNull(reader.open(source))
            finishFirst.countDown()
            val winner = checkNotNull(first.get(10, SECONDS))
            fun assertWinner() {
                val entry = checkNotNull(reader.open(source))
                assertEquals(winner, entry)
                entry.files.forEach { (track, file) -> assertArrayEquals(payload(track) + 1.toByte(), file.readBytes()) }
            }
            assertWinner() // The second publisher still has only one staged track.
            finishSecond.countDown()
            assertEquals(winner, second.get(10, SECONDS))
            assertWinner()
        } finally {
            finishFirst.countDown()
            finishSecond.countDown()
            pool.shutdownNow()
            assertTrue(pool.awaitTermination(10, SECONDS))
        }
    }

    @Test fun simultaneousPublishersReturnTheSameCompleteGeneration() {
        val root = temp.newFolder()
        val ready = CountDownLatch(2)
        val publishTogether = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val publishes = (1..2).map { tag ->
                pool.submit<FourStemStore.Entry?> {
                    store(root).publish(source, frames) { paths ->
                        paths.forEach { (track, file) -> file.writeBytes(payload(track) + tag.toByte()) }
                        ready.countDown()
                        assertTrue(publishTogether.await(10, SECONDS))
                        true
                    }
                }
            }
            val reader = store(root)
            assertTrue(ready.await(10, SECONDS))
            assertNull(reader.open(source))
            publishTogether.countDown()
            fun assertComplete(entry: FourStemStore.Entry) {
                val tag = entry.files.getValue(tracks.first()).readBytes().last()
                assertTrue(tag == 1.toByte() || tag == 2.toByte())
                entry.files.forEach { (track, file) -> assertArrayEquals(payload(track) + tag, file.readBytes()) }
            }
            reader.open(source)?.let(::assertComplete)
            val winner = checkNotNull(publishes.first().get(10, SECONDS))
            assertEquals(winner, publishes.last().get(10, SECONDS))
            assertEquals(winner, reader.open(source))
            assertComplete(winner)
        } finally {
            publishTogether.countDown()
            pool.shutdownNow()
            assertTrue(pool.awaitTermination(10, SECONDS))
        }
    }

    private fun withLink(path: File, target: File, test: () -> Unit) {
        link(path, target)
        try {
            test()
        } finally {
            Files.deleteIfExists(path.toPath())
        }
    }

    private fun link(path: File, target: File) {
        try {
            Files.createSymbolicLink(path.toPath(), target.toPath())
        } catch (error: IOException) {
            if (System.getProperty("os.name")?.startsWith("Windows") != true) throw error
            // Windows without symlink privilege can still exercise the directory boundaries with junctions.
            if (target.isDirectory) {
                val junction = ProcessBuilder("cmd.exe", "/c", "mklink", "/J", "\\\\?\\${path.path}", "\\\\?\\${target.path}")
                    .redirectErrorStream(true).start()
                val output = junction.inputStream.bufferedReader().use { it.readText() }
                check(junction.waitFor(10, SECONDS) && junction.exitValue() == 0) { output }
            } else {
                throw AssumptionViolatedException("Windows file symlink unavailable", error)
            }
        }
    }

    private fun store(root: File, collide: Boolean = false): FourStemStore = FourStemStore(
        root,
        isFinalizedAac = { file, _ -> file.readBytes().take(3) == listOf<Byte>(11, 22, 33) },
        bucket = if (collide) ({ "0".repeat(64) }) else ({ it }),
    )

    private fun publish(store: FourStemStore) = store.publish(source, frames) { targets ->
        targets.forEach { (track, file) -> file.writeBytes(payload(track)) }
        true
    }

    private fun payload(track: FourStemStore.Track) = byteArrayOf(11, 22, 33, track.ordinal.toByte())
}
