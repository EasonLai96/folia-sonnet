package top.izuna.foliamajor.player.dsp

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import java.io.IOException
import java.io.RandomAccessFile
import java.util.UUID

// Unwired Media3 experiment: an opaque URI names one sealed snapshot, not a filesystem path.
@UnstableApi
internal class FourStemSnapshotDataSource private constructor(
    private val anchor: FourStemInputSnapshots.Lease,
    private val snapshotUri: Uri,
) : BaseDataSource(false) {
    // The caller owns the anchor until no instance can reopen. Each instance is used serially
    // on an I/O worker; closing an instance never releases the anchor or another reader.
    class Factory(private val anchor: FourStemInputSnapshots.Lease) : DataSource.Factory {
        val uri: Uri = Uri.fromParts("four-stem-snapshot", UUID.randomUUID().toString(), null)

        override fun createDataSource(): DataSource = FourStemSnapshotDataSource(anchor, uri)
    }

    private var reader: FourStemInputSnapshots.Lease? = null
    private var descriptor: RandomAccessFile? = null
    private var openedUri: Uri? = null
    private var bytesRemaining = 0L

    override fun open(dataSpec: DataSpec): Long {
        check(reader == null) { "Close the previous snapshot read before opening again" }
        if (dataSpec.uri != snapshotUri) throw IOException("DataSpec does not identify this snapshot")
        val lease = anchor.retain() ?: throw IOException("Snapshot anchor closed")
        reader = lease
        try {
            transferInitializing(dataSpec)
            val file = RandomAccessFile(lease.file, "r").also { descriptor = it }
            val available = file.length() - dataSpec.position
            if (available < 0) throw DataSourceException(PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE)
            file.seek(dataSpec.position)
            val requested = dataSpec.length
            bytesRemaining = if (requested == C.LENGTH_UNSET.toLong()) available else minOf(available, requested)
            openedUri = snapshotUri
            transferStarted(dataSpec)
            // A bounded open reports the requested length; read still ends at the real EOF.
            return if (requested == C.LENGTH_UNSET.toLong()) available else requested
        } catch (error: Throwable) {
            try {
                close()
            } catch (cleanup: Throwable) {
                if (cleanup !== error) error.addSuppressed(cleanup)
            }
            throw error
        }
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        check(openedUri != null) { "Snapshot reader is not open" }
        val file = checkNotNull(descriptor)
        if (bytesRemaining == 0L) return C.RESULT_END_OF_INPUT
        val read = file.read(buffer, offset, minOf(bytesRemaining, length.toLong()).toInt())
        if (read == C.RESULT_END_OF_INPUT) throw IOException("Sealed snapshot ended early")
        bytesRemaining -= read
        bytesTransferred(read)
        return read
    }

    override fun getUri(): Uri? = openedUri

    override fun close() {
        val ended = openedUri != null
        openedUri = null
        bytesRemaining = 0L
        val file = descriptor
        val fd = file?.fd
        try {
            file?.close()
            if (fd?.valid() == true) throw IOException("Snapshot descriptor is still open")
        } finally {
            try {
                if (ended) transferEnded()
            } finally {
                // Fail closed if close did not invalidate the descriptor: don't reclaim its file.
                if (fd?.valid() != true) {
                    descriptor = null
                    val lease = reader
                    reader = null
                    lease?.close()
                }
            }
        }
    }
}
