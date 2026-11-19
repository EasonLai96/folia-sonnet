package top.izuna.foliamajor.player.dsp

import java.net.URI
import java.net.URISyntaxException

// 严格的原生音频身份：比较实际装载的 URI 与 mediaId，不使用 #408 的磁盘缓存别名。
internal class AudioSourceIdentity private constructor(
    val uri: String,
    val mediaId: String,
) {
    fun matches(other: AudioSourceIdentity?): Boolean =
        other != null && uri == other.uri && mediaId == other.mediaId

    companion object {
        fun from(uri: String?, mediaId: String?): AudioSourceIdentity? {
            if (uri.isNullOrBlank() || mediaId.isNullOrBlank()) return null
            val absolute = try {
                URI(uri).isAbsolute
            } catch (_: URISyntaxException) {
                false
            }
            if (!absolute) return null
            // 不改写签名、主机或查询参数：它们也可能决定实际返回哪一段音频。
            return AudioSourceIdentity(uri, mediaId)
        }
    }
}
