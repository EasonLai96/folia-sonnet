package top.izuna.foliamajor.player.dsp

import android.net.Uri
import android.system.ErrnoException
import android.system.Os
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.FileDataSource
import androidx.media3.datasource.TransferListener
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith

// Device-side Media3 and filesystem contract tests; no decoder, player or generation authorization.
@UnstableApi
@RunWith(AndroidJUnit4::class)
class FourStemSnapshotDataSourceTest {
    @get:Rule val folder = TemporaryFolder(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir)

    private val a = wav(1)
    private val b = wav(9)

    @Test fun samePathReplacementLeavesOpenReaderSeekAndIndependentConsumerOnSnapshot() {
        val fixture = fixture()
        fixture.anchor.use { anchor ->
            val factory = FourStemSnapshotDataSource.Factory(anchor)
            val dataSource = factory.createDataSource()
            val otherReader = factory.createDataSource()
            val direct = FileDataSource()
            val spec = DataSpec(factory.uri)
            val directSpec = DataSpec(Uri.fromFile(fixture.source))
            checkNotNull(anchor.retain()).use { independent ->
                try {
                    assertEquals(a.size.toLong(), direct.open(directSpec))
                    assertEquals(a.size.toLong(), dataSource.open(spec))
                    assertEquals(factory.uri, dataSource.uri)
                    assertEquals(a.size, b.size)
                    val next = File(fixture.source.parentFile, "next.wav").apply { writeBytes(b) }
                    Os.rename(next.path, fixture.source.path)
                    assertArrayEquals(b, fixture.source.readBytes())
                    assertArrayEquals(a, direct.drain()) // Negative control: old open original inode.
                    assertArrayEquals(a, dataSource.drain())
                    dataSource.close()
                    assertNull(dataSource.uri)
                    direct.close()
                    direct.open(directSpec)
                    assertArrayEquals(b, direct.drain()) // Opening the same original path now sees B.

                    val range = spec.subrange(44, 2)
                    assertEquals(2L, dataSource.open(range))
                    assertEquals(2L, otherReader.open(spec.subrange(46)))
                    val independentBytes = independent.file.readBytes()
                    assertArrayEquals(a, independentBytes)
                    assertArrayEquals(independentBytes.copyOfRange(44, 46), dataSource.drain())
                    dataSource.close()
                    assertArrayEquals(independentBytes.copyOfRange(46, 48), otherReader.drain())
                    assertEquals(4L, dataSource.open(spec.subrange(46, 4)))
                    assertArrayEquals(a.copyOfRange(46, 48), dataSource.drain())
                    dataSource.close()
                    assertEquals(0L, dataSource.open(spec.subrange(a.size.toLong())))
                    assertEquals(0, dataSource.read(ByteArray(1), 0, 0))
                    assertEquals(C.RESULT_END_OF_INPUT, dataSource.read(ByteArray(1), 0, 1))
                } finally {
                    dataSource.close()
                    otherReader.close()
                    direct.close()
                }
            }
        }
        assertTrue(fixture.snapshots.list()!!.isEmpty())
    }

    @Test fun retainsBeforeOpenAndReleasesOnlyAfterRealDescriptorCloses() {
        val fixture = fixture()
        fixture.anchor.use { anchor ->
            val published = anchor.file
            val factory = FourStemSnapshotDataSource.Factory(anchor)
            val dataSource = factory.createDataSource()
            val spec = DataSpec(factory.uri)
            val events = mutableListOf<String>()
            dataSource.addTransferListener(object : TransferListener {
                override fun onTransferInitializing(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {
                    assertFalse(isNetwork)
                    anchor.close()
                    assertTrue(published.exists())
                    assertFalse(hasOpenDescriptor(published))
                    events += "initializing"
                }

                override fun onTransferStart(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {
                    assertTrue(hasOpenDescriptor(published))
                    events += "start"
                }

                override fun onBytesTransferred(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean, bytes: Int) {
                    events += "bytes:$bytes"
                }

                override fun onTransferEnd(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {
                    assertFalse(hasOpenDescriptor(published))
                    assertTrue(published.exists())
                    events += "end"
                }
            })
            try {
                assertEquals(a.size.toLong(), dataSource.open(spec))
                assertNull(fixture.store.stagePcmWav(fixture.source.name))
                assertEquals(1, dataSource.read(ByteArray(1), 0, 1))
            } finally {
                dataSource.close()
                dataSource.close()
            }
            assertEquals(listOf("initializing", "start", "bytes:1", "end"), events)
            assertFalse(published.exists())
            assertThrows(IOException::class.java) { dataSource.open(spec) }
            dataSource.close()
            checkNotNull(fixture.store.stagePcmWav(fixture.source.name)).close()
        }
    }

    @Test fun rejectsOtherUriAndCleansFailedOpenBeforeRetry() {
        val fixture = fixture()
        fixture.anchor.use { anchor ->
            val published = anchor.file
            val factory = FourStemSnapshotDataSource.Factory(anchor)
            val spec = DataSpec(factory.uri)
            val dataSource = factory.createDataSource()
            try {
                assertThrows(IOException::class.java) { dataSource.open(DataSpec(Uri.fromFile(fixture.source))) }
                val pastEnd = spec.subrange(a.size + 1L, 1L)
                assertTrue(DataSourceException.isCausedByPositionOutOfRange(
                    assertThrows(IOException::class.java) { dataSource.open(pastEnd) },
                ))
                assertNull(dataSource.uri)
                assertFalse(hasOpenDescriptor(published))
                dataSource.close() // Required by the caller contract even after open throws.
                assertEquals(a.size.toLong(), dataSource.open(spec))
                assertArrayEquals(a, dataSource.drain())
            } finally {
                dataSource.close()
            }
        }
        assertTrue(fixture.snapshots.list()!!.isEmpty())
    }

    private fun fixture(): Fixture {
        val sources = folder.newFolder("sources")
        val source = File(sources, "song.wav").apply { writeBytes(a) }
        val snapshots = folder.newFolder("snapshots")
        val store = FourStemInputSnapshots(sources, snapshots, a.size.toLong(), 1)
        return Fixture(source, snapshots, store, checkNotNull(store.stagePcmWav(source.name)))
    }

    private data class Fixture(
        val source: File,
        val snapshots: File,
        val store: FourStemInputSnapshots,
        val anchor: FourStemInputSnapshots.Lease,
    )

    private fun DataSource.drain(): ByteArray {
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(13)
        while (true) {
            val count = read(buffer, 0, buffer.size)
            if (count == C.RESULT_END_OF_INPUT) return output.toByteArray()
            assertTrue(count > 0)
            output.write(buffer, 0, count)
        }
    }

    private fun hasOpenDescriptor(file: File): Boolean {
        val path = file.canonicalPath
        return checkNotNull(File("/proc/self/fd").listFiles()).any { fd ->
            // Other process threads may close unrelated descriptors between list and readlink.
            val target = try { Os.readlink(fd.path) } catch (_: ErrnoException) { return@any false }
            target == path || (target.startsWith('/') && File(target).canonicalPath == path)
        }
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
        putShort((sample + 1).toShort())
    }.array()
}
