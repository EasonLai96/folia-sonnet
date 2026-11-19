package top.izuna.foliamajor.automix

import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.FileDescriptor
import java.net.URI

// Four-stem decoding never opens a URL, provider, device, or pipe through MediaExtractor.
internal object FourStemLocalInput {
    private const val MAX_BYTES = 384L * 1024 * 1024

    fun privatePath(uri: String, privateRoot: File): File? {
        val parsed = runCatching { URI(uri) }.getOrNull() ?: return null
        if (parsed.scheme != "file" || parsed.rawAuthority != null || parsed.rawQuery != null || parsed.rawFragment != null) return null
        val file = runCatching { File(parsed) }.getOrNull() ?: return null
        return file.takeIf {
            it.isAbsolute && it.canonicalPath == it.path &&
                it.path.startsWith(privateRoot.canonicalPath + File.separator)
        }
    }

    fun <T> withFile(file: File, read: (FileDescriptor, Long) -> T): T? {
        val fd = Os.open(file.path, OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW or OsConstants.O_NONBLOCK, 0)
        try {
            val stat = Os.fstat(fd)
            if (!OsConstants.S_ISREG(stat.st_mode) || stat.st_size !in 1..MAX_BYTES) return null
            val result = read(fd, stat.st_size)
            val end = Os.fstat(fd)
            val current = Os.lstat(file.path)
            return result.takeIf {
                stat.st_size == end.st_size && stat.st_mtime == end.st_mtime && stat.st_ctime == end.st_ctime &&
                    stat.st_dev == current.st_dev && stat.st_ino == current.st_ino
            }
        } finally {
            Os.close(fd)
        }
    }
}
