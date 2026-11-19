package top.izuna.foliamajor.player.dsp

import java.io.Closeable
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID

// In-process input snapshots for the private four-stem experiment; no installed-source authorization.
internal class FourStemInputSnapshots(
    private val sourceRoot: File,
    private val snapshotRoot: File,
    private val maxTotalBytes: Long,
    private val maxSnapshots: Int,
) {
    // One store owns a dedicated, initially empty app-private directory. All writers cooperate:
    // sources are complete regular files replaced by rename, never edited in place; only this store
    // writes snapshots. Pass stable roots separate from existing media caches and external storage.
    // Neither a hostile writer nor recovery of directories abandoned by process death is supported.
    private val lock = Any()
    private var initialized = false
    private var reservedBytes = 0L
    private var reservedSlots = 0

    init {
        require(maxTotalBytes > 0 && maxSnapshots > 0)
    }

    sealed interface Lease : Closeable {
        val file: File
        fun retain(): Lease?

        // Close actual descriptors first; this may delete files and belongs on an I/O worker.
        override fun close()
    }

    // Synchronous I/O-worker entry point. The returned lease is the installation anchor:
    // keep it until the source can no longer open a reader. The path is read-only by app contract
    // and only usable while holding a lease. No waiter, cache eviction, URL or arbitrary file path.
    fun stagePcmWav(privateName: String): Lease? = try {
        stage(privateName)
    } catch (_: IOException) {
        null
    } catch (_: SecurityException) {
        null
    }

    private fun stage(privateName: String): Lease? {
        if (!PRIVATE_WAV_NAME.matches(privateName) || Thread.currentThread().isInterrupted) return null
        val sources = sourceRoot.canonicalFile
        val snapshots = snapshotRoot.canonicalFile
        if (sources.isWithin(snapshots) || snapshots.isWithin(sources)) return null
        val source = File(sources, privateName)
        if (!source.isFile || source.canonicalFile != source) return null

        var reserved = 0L
        var directory: File? = null
        var ownedFile: File? = null
        var delivered = false
        try {
            val part = source.inputStream().use { input ->
                val size = input.channel.size()
                if (size < WAV_HEADER_BYTES || !reserve(snapshots, size)) return null
                reserved = size
                // Exclusive mkdir reserves the destination namespace; createTempFile claims the writer's path.
                val slot = File(snapshots, "snapshot-${UUID.randomUUID()}")
                if (!slot.mkdir()) return null
                directory = slot
                val part = File.createTempFile("copy-", ".part", slot)
                ownedFile = part
                part.outputStream().use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var remaining = size
                    while (remaining > 0) {
                        if (Thread.currentThread().isInterrupted) return null
                        val read = input.read(buffer, 0, minOf(remaining, buffer.size.toLong()).toInt())
                        if (read <= 0) return null
                        output.write(buffer, 0, read)
                        remaining -= read
                    }
                    if (input.read() != -1) return null
                }
                part
            }
            if (Thread.currentThread().isInterrupted || !isPcmWav(part, reserved)) return null
            val slot = checkNotNull(directory)
            val target = File(slot, "input.wav")
            if (target.exists() || !part.renameTo(target)) return null
            ownedFile = target
            if (Thread.currentThread().isInterrupted) return null
            val anchor = Hold(target, slot, reserved).Handle()
            delivered = true
            return anchor
        } finally {
            if (!delivered && reserved > 0) reclaim(ownedFile, directory, reserved)
        }
    }

    private fun reserve(root: File, size: Long): Boolean = synchronized(lock) {
        if (!initialized) {
            // Fail closed on leftovers rather than allowing an unaccounted second allocation.
            if (root.list()?.isEmpty() != true) return false
            initialized = true
        }
        if (reservedSlots == maxSnapshots || size > maxTotalBytes - reservedBytes) return false
        reservedSlots++
        reservedBytes += size
        true
    }

    private inner class Hold(private val file: File, private val directory: File, private val size: Long) {
        private var holders = 1L

        inner class Handle : Lease {
            private var closed = false
            override val file: File get() = synchronized(lock) {
                check(!closed) { "Snapshot lease closed" }
                this@Hold.file
            }

            override fun retain(): Lease? = synchronized(lock) {
                if (closed) return null
                holders++
                Handle()
            }

            override fun close() {
                val last = synchronized(lock) {
                    if (closed) return
                    closed = true
                    --holders == 0L
                }
                if (last) reclaim(this@Hold.file, directory, size)
            }
        }
    }

    private fun reclaim(file: File?, directory: File?, size: Long) {
        // If cleanup fails, leave this budget charged. Never recursively delete unknown entries.
        if (!remove(file) || !remove(directory)) return
        synchronized(lock) {
            reservedSlots--
            reservedBytes -= size
        }
    }

    private fun remove(file: File?): Boolean = try {
        file == null || file.delete() || !file.exists()
    } catch (_: SecurityException) {
        false
    }

    private fun File.isWithin(root: File): Boolean =
        this == root || parentFile?.isWithin(root) == true

    private companion object {
        val PRIVATE_WAV_NAME = Regex("[A-Za-z0-9_-][A-Za-z0-9_.-]{0,123}\\.wav")
        const val WAV_HEADER_BYTES = 44

        // The experiment only accepts canonical RIFF PCM16 WAV (mono/stereo, no optional chunks).
        fun isPcmWav(file: File, size: Long): Boolean {
            val bytes = ByteArray(WAV_HEADER_BYTES)
            RandomAccessFile(file, "r").use { it.readFully(bytes) }
            val header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            if (String(bytes, 0, 4, Charsets.US_ASCII) != "RIFF" ||
                String(bytes, 8, 8, Charsets.US_ASCII) != "WAVEfmt " ||
                String(bytes, 36, 4, Charsets.US_ASCII) != "data" ||
                header.getInt(4).toUInt().toLong() != size - 8 || header.getInt(16) != 16 ||
                header.getShort(20).toInt() != 1 || header.getShort(34).toInt() != 16
            ) return false
            val channels = header.getShort(22).toInt()
            val sampleRate = header.getInt(24).toLong()
            val bytesPerFrame = channels * 2
            val payload = size - WAV_HEADER_BYTES
            return channels in 1..2 && sampleRate > 0 &&
                header.getInt(28).toUInt().toLong() == sampleRate * bytesPerFrame &&
                header.getShort(32).toInt() == bytesPerFrame &&
                header.getInt(40).toUInt().toLong() == payload && payload > 0 && payload % bytesPerFrame == 0L
        }
    }
}
