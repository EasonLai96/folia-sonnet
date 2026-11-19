package top.izuna.foliamajor.player.dsp

import android.os.Build
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.NoSuchFileException
import java.nio.file.attribute.BasicFileAttributes
import java.security.MessageDigest
import java.util.UUID

// Standalone four-track AAC cache. It does not read or maintain the existing two-track cache.
internal class FourStemStore(
    cacheDir: File,
    private val isFinalizedAac: (File, Long) -> Boolean,
    private val bucket: (String) -> String = { it },
    private val totalLimitBytes: () -> Long = { 256L * 1024 * 1024 },
) {
    private val cacheDir = cacheDir.absoluteFile
    private val root = File(this.cacheDir, "four-stem-aac")

    // Keep the SCNet output order. The current schema assumes 44.1 kHz stereo AAC-LC in M4A.
    enum class Track(val fileName: String) {
        DRUMS("drums.m4a"), BASS("bass.m4a"), OTHER("other.m4a"), VOCALS("vocals.m4a"),
    }

    /** A cache namespace, not proof that the current player and generator opened the same bytes. */
    data class Source(val songKey: String, val exactAudioIdentity: String, val revision: String) {
        override fun toString() = "FourStemStore.Source(redacted)"
    }

    data class Entry(val files: Map<Track, File>, val frames: Long)

    /** Do this on an I/O worker, not on the audio thread: all four compressed payloads are verified. */
    fun open(source: Source): Entry? = cacheIo {
        val key = key(source) ?: return@cacheIo null
        synchronized(publicationLock) { read(key) }
    }

    /**
     * The encoder receives private staging paths. Return true only after all four encoders have
     * reached EOS, finished the muxers and closed them. Supply a real AAC-LC/M4A probe at construction.
     * The caller must serialize its final authorization/installed-source check with publication.
     * This store does not decide whether separation or playback is allowed.
     */
    fun publish(source: Source, frames: Long, encode: (Map<Track, File>) -> Boolean): Entry? {
        if (frames <= 0) return null
        return build(source, { it() }, reserveExclusive = false) { stage -> frames.takeIf { encode(stage.files) } }
    }

    /** Reserve the remaining payload bytes for the sole staging writer in this cache root. */
    fun stageAndPublish(source: Source, commit: (() -> Boolean) -> Boolean, encode: (Staging) -> Long?): Entry? =
        build(source, commit, reserveExclusive = true, encode)

    internal class Staging internal constructor(
        val files: Map<Track, File>,
        private val capacity: () -> Long,
        private val fileSizes: () -> Long?,
    ) {
        fun fitsEstimate(bytes: Long) = bytes > 0 && bytes <= capacity()
        private var submittedPayload = 0L

        fun withinBudget(): Boolean = fitsNext(0)

        // Count accepted samples independently of file growth: a muxer can buffer them in native code.
        fun reserveSample(bytes: Int): Boolean {
            if (bytes <= 0 || !fitsNext(bytes)) return false
            submittedPayload += bytes
            return true
        }

        private fun fitsNext(bytes: Int): Boolean {
            val accounted = maxOf(fileSizes() ?: return false, submittedPayload)
            val available = capacity()
            return accounted <= available && bytes <= available - accounted
        }
    }

    /** Build until true decoder EOS; authorize only the short final filesystem transaction. */
    private fun build(
        source: Source,
        commit: (() -> Boolean) -> Boolean,
        reserveExclusive: Boolean,
        encode: (Staging) -> Long?,
    ): Entry? = cacheIo {
        val key = key(source) ?: return@cacheIo null
        val staging = File(root, ".part-${UUID.randomUUID()}")
        val (occupied, room) = synchronized(publicationLock) {
            val active = stagingWriters[root] ?: 0
            if (active < 0 || (reserveExclusive && active != 0) || !cacheTree(create = true)) return@cacheIo null
            val ceiling = payloadCeiling()
            val bytes = occupiedBytes(ceiling) ?: return@cacheIo null
            if (reserveExclusive && bytes == ceiling) return@cacheIo null
            if (!staging.mkdir()) return@cacheIo null
            stagingWriters[root] = if (reserveExclusive) -1 else active + 1
            bytes to ceiling - bytes
        }
        try {
            if (!stagingTree(staging)) return@cacheIo null
            val temps = files(staging)
            val stage = Staging(temps.toMap(),
                capacity = { minOf(room, payloadCeiling() - occupied) },
                fileSizes = { stagingBytes(staging, temps) },
            )
            val frames = encode(stage)?.takeIf { it > 0 } ?: return@cacheIo null
            if (reserveExclusive && !stage.withinBudget()) return@cacheIo null
            if (!synchronized(publicationLock) { withinTotalLimit() }) return@cacheIo null
            // Only the designated compressed files may cross the staging boundary.
            val payloads = Track.entries.map { track ->
                val file = temps.getValue(track)
                if (!stagingTree(staging) || kind(file) != Kind.FILE || !isFinalizedAac(file, frames)) return@cacheIo null
                if (!stagingTree(staging)) return@cacheIo null
                payload(file) ?: return@cacheIo null
            }
            synchronized(publicationLock) {
                if (!withinTotalLimit()) return@synchronized null
                // Full digest verification and fsync must not hold the source/permit locks.
                if (publicationTree(key, create = false)) {
                    val partKind = kind(File(key.dir, "$MARKER.part"))
                    if (partKind != Kind.MISSING && partKind != Kind.FILE) return@synchronized null
                }
                // An unreadable entry is not a proven corrupt entry; I/O failure aborts publication.
                val old = read(key)
                if (old != null) return@synchronized old.takeIf { it.frames == frames && commit { true } }
                if (!withinTotalLimit()) return@synchronized null
                val stagedMarker = File(staging, MARKER)
                if (kind(stagedMarker) != Kind.MISSING || !stagedMarker.createNewFile()) return@synchronized null
                val body = markerBody(key, frames, payloads)
                FileOutputStream(stagedMarker).use { file ->
                    file.write(body)
                    file.write(sha256(body))
                    file.fd.sync()
                }
                var entry: Entry? = null
                if (!commit { finish(key, staging, frames).also { entry = it } != null }) null else entry
            }
        } finally {
            cacheIo {
                synchronized(publicationLock) {
                    try {
                        cleanStaging(staging)
                    } finally {
                        val active = stagingWriters.getValue(root)
                        if (active <= 1) stagingWriters.remove(root) else stagingWriters[root] = active - 1
                    }
                }
            }
        }
    }

    private fun payloadCeiling() = totalLimitBytes().coerceAtLeast(0L) - MARKER_BYTES

    private fun withinTotalLimit() = occupiedBytes(payloadCeiling()) != null

    private fun stagingBytes(staging: File, targets: Map<Track, File>): Long? = cacheIo {
        if (!stagingTree(staging)) return@cacheIo null
        var bytes = 0L
        for (file in targets.values) {
            val info = inspect(file)
            if (info.kind == Kind.MISSING) continue
            if (info.kind != Kind.FILE || info.bytes !in 0..(Long.MAX_VALUE - bytes)) return@cacheIo null
            bytes += info.bytes
        }
        bytes
    }

    /** Count old keys, incomplete entries and staging; never traverse links or evict an unleased reader. */
    private fun occupiedBytes(ceiling: Long): Long? {
        var remaining = ceiling
        var inspected = 0
        fun walk(dir: File, depth: Int): Boolean {
            if (depth > 2 || kind(dir) != Kind.DIRECTORY) return false
            val children = dir.listFiles() ?: return false
            for (child in children) {
                if (++inspected > 4096) return false
                val info = inspect(child)
                when (info.kind) {
                    Kind.DIRECTORY -> if (!walk(child, depth + 1)) return false
                    Kind.FILE -> {
                        if (info.bytes !in 0..remaining) return false
                        remaining -= info.bytes
                    }
                    Kind.MISSING, Kind.OTHER -> return false
                }
            }
            return true
        }
        return if (remaining >= 0 && walk(root, 0)) ceiling - remaining else null
    }

    private class Key(val dir: File, val proof: ByteArray)

    private fun key(source: Source): Key? {
        val fields = listOf(source.songKey, source.exactAudioIdentity, source.revision)
        if (fields.any { it.isBlank() }) return null
        // Independent domains/algorithms: the bucket does not grant identity. Length-prefix every field,
        // and preserve UTF-16 code units exactly rather than folding malformed surrogate pairs into '?'.
        val input = fields.flatMap { field -> sequenceOf(field.length.toString(), ":", field).asIterable() }
        fun digest(algorithm: String, domain: String): ByteArray {
            val md = MessageDigest.getInstance(algorithm)
            md.update(domain.toByteArray(Charsets.US_ASCII))
            for (segment in input) for (char in segment) {
                md.update((char.code ushr 8).toByte())
                md.update(char.code.toByte())
            }
            return md.digest()
        }
        val slot = bucket(digest("SHA-256", "four-stem-bucket-v1").hex())
        if (!bucketPattern.matches(slot)) return null
        val proof = digest("SHA-512", "four-stem-proof-v1")
        return Key(File(File(root, slot), proof.hex()), proof)
    }

    private data class Payload(val size: Long, val digest: ByteArray)

    private fun payload(file: File): Payload? {
        if (kind(file) != Kind.FILE) return null
        val digest = MessageDigest.getInstance("SHA-256")
        var length = 0L
        file.inputStream().use { stream ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
                length += count
            }
        }
        return if (length > 0) Payload(length, digest.digest()) else null
    }

    private fun read(key: Key): Entry? {
        if (!publicationTree(key, create = false)) return null
        val marker = File(key.dir, MARKER)
        if (kind(marker) != Kind.FILE || marker.length() != MARKER_BYTES.toLong()) return null
        val body = DataInputStream(marker.inputStream().buffered()).use { input ->
            val data = input.bytes(MARKER_BODY_BYTES)
            val checksum = input.bytes(DIGEST_BYTES)
            if (input.read() != -1 || !sha256(data).contentEquals(checksum)) return null
            data
        }
        val files = files(key.dir)
        return DataInputStream(ByteArrayInputStream(body)).use { input ->
            if (input.readInt() != MAGIC || input.readInt() != SCHEMA) return null
            if (!input.bytes(PROOF_BYTES).contentEquals(key.proof)) return null
            val frames = input.readLong()
            if (frames <= 0) return null
            for (track in Track.entries) {
                val size = input.readLong()
                val digest = input.bytes(DIGEST_BYTES)
                val file = files.getValue(track)
                if (size <= 0 || kind(file) != Kind.FILE || file.length() != size) return null
                val actual = payload(file) ?: return null
                if (actual.size != size || !actual.digest.contentEquals(digest)) return null
            }
            if (input.read() != -1) return null
            Entry(files, frames)
        }
    }

    // Immutable while ready. A broken entry is first unpublished; the marker is renamed last.
    private fun finish(key: Key, staging: File, frames: Long): Entry? {
        if (!stagingTree(staging) || !publicationTree(key, create = true)) return null
        val dir = key.dir
        val marker = File(dir, MARKER)
        val part = File(dir, "$MARKER.part")
        val partKind = kind(part)
        if (partKind != Kind.MISSING && partKind != Kind.FILE) return null
        if (partKind == Kind.FILE && !part.delete()) return null
        if (kind(marker) != Kind.MISSING && !marker.delete()) return null
        val targets = files(dir)
        var published = false
        try {
            for ((track, file) in targets) {
                val input = File(staging, track.fileName)
                if (kind(input) != Kind.FILE || (kind(file) != Kind.MISSING && !file.delete()) ||
                    !input.renameTo(file)
                ) return null
            }
            val stagedMarker = File(staging, MARKER)
            if (kind(stagedMarker) != Kind.FILE || !stagedMarker.renameTo(marker)) return null
            published = true
            return Entry(targets, frames)
        } finally {
            if (!published && publicationTree(key, create = false)) {
                part.delete()
                targets.values.forEach { it.delete() }
            }
        }
    }

    private fun markerBody(key: Key, frames: Long, payloads: List<Payload>): ByteArray {
        val buffer = ByteArrayOutputStream(MARKER_BODY_BYTES)
        DataOutputStream(buffer).use { output ->
            output.writeInt(MAGIC)
            output.writeInt(SCHEMA)
            output.write(key.proof)
            output.writeLong(frames)
            for (payload in payloads) {
                output.writeLong(payload.size)
                output.write(payload.digest)
            }
        }
        return buffer.toByteArray()
    }

    // The caller owns the private cacheDir and its ancestors. Walk our tree one component at a time.
    private fun cacheTree(create: Boolean) = directory(cacheDir, create) && directory(root, create)

    private fun stagingTree(staging: File) = cacheTree(create = false) && directory(staging, create = false)

    private fun publicationTree(key: Key, create: Boolean) =
        cacheTree(create) && directory(checkNotNull(key.dir.parentFile), create) && directory(key.dir, create)

    private fun directory(path: File, create: Boolean): Boolean = when (kind(path)) {
        Kind.DIRECTORY -> true
        Kind.MISSING -> create && run {
            path.mkdir() // Another instance may create it first; either way, check the resulting type.
            kind(path) == Kind.DIRECTORY
        }
        else -> false
    }

    private fun cleanStaging(staging: File) {
        if (!cacheTree(create = false)) return
        // An encoder can replace staging before returning. Unlink the entry itself; never list its target.
        if (kind(staging) == Kind.DIRECTORY) staging.listFiles()?.forEach { it.delete() }
        staging.delete()
    }

    private enum class Kind { MISSING, DIRECTORY, FILE, OTHER }

    private data class FileInfo(val kind: Kind, val bytes: Long = 0L)

    private fun kind(path: File) = inspect(path).kind

    private fun inspect(path: File): FileInfo {
        // java.nio.file needs API 26 on Android. API 24/25 have lstat; desktop JVMs use NIO.
        val api = Build.VERSION.SDK_INT
        if (api != 0 && api < Build.VERSION_CODES.O) {
            val mode = try {
                Os.lstat(path.path)
            } catch (error: ErrnoException) {
                if (error.errno == OsConstants.ENOENT) return FileInfo(Kind.MISSING)
                throw IOException(error)
            }
            return when {
                OsConstants.S_ISDIR(mode.st_mode) -> FileInfo(Kind.DIRECTORY)
                OsConstants.S_ISREG(mode.st_mode) -> FileInfo(Kind.FILE, mode.st_size)
                else -> FileInfo(Kind.OTHER)
            }
        }
        return NioKind.read(path)
    }

    // Keep API 26 types out of the Android 24/25 code path, including its exception table.
    private object NioKind {
        fun read(path: File): FileInfo {
            val attrs = try {
                Files.readAttributes(path.toPath(), BasicFileAttributes::class.java, NOFOLLOW_LINKS)
            } catch (_: NoSuchFileException) {
                return FileInfo(Kind.MISSING)
            }
            return when {
                attrs.isSymbolicLink || attrs.isOther -> FileInfo(Kind.OTHER)
                attrs.isDirectory -> FileInfo(Kind.DIRECTORY)
                attrs.isRegularFile -> FileInfo(Kind.FILE, attrs.size())
                else -> FileInfo(Kind.OTHER)
            }
        }
    }

    private fun files(dir: File): Map<Track, File> = Track.entries.associateWith { File(dir, it.fileName) }
    private fun DataInputStream.bytes(size: Int): ByteArray = ByteArray(size).also { readFully(it) }
    private fun ByteArray.hex(): String = joinToString("") { "%02x".format(it) }
    private fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

    private inline fun <T> cacheIo(block: () -> T?): T? = try {
        block()
    } catch (_: IOException) {
        null
    } catch (_: SecurityException) {
        null
    }

    private companion object {
        const val MARKER = "ready"
        const val MAGIC = 0x4653544D // FSTM
        const val SCHEMA = 3
        const val PROOF_BYTES = 64
        const val DIGEST_BYTES = 32
        const val MARKER_BODY_BYTES =
            2 * Int.SIZE_BYTES + PROOF_BYTES + Long.SIZE_BYTES + 4 * (Long.SIZE_BYTES + DIGEST_BYTES)
        const val MARKER_BYTES = MARKER_BODY_BYTES + DIGEST_BYTES
        val bucketPattern = Regex("[0-9a-f]{64}")
        val publicationLock = Any()
        // Guarded by publicationLock. -1 is the exclusive generation reservation; positive counts are test publishers.
        val stagingWriters = mutableMapOf<File, Int>()
    }
}
