package top.izuna.foliamajor.player.dsp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// 定向回归：分离结果接管只认已装载的 URI + mediaId；与 #408 的缓存兼容规则分开。
class AudioSourceIdentityTest {
    private val original = "https://cdn.example.com/track.m4a?quality=high&token=old"
    private val song = "provider:123"
    private val expected = requireNotNull(AudioSourceIdentity.from(original, song))

    @Test
    fun `同一个完整地址与媒体 ID 才放行`() {
        assertTrue(expected.matches(AudioSourceIdentity.from(original, song)))
        assertFalse(expected.matches(AudioSourceIdentity.from(original, "provider:456")))
        assertFalse(expected.matches(AudioSourceIdentity.from(original.replace("high", "low"), song)))
        assertFalse(expected.matches(AudioSourceIdentity.from(original.replace("track.m4a", "mv.m4a"), song)))
        assertFalse(expected.matches(AudioSourceIdentity.from("file:///cache/track.vocal.m4a", song)))
    }

    @Test
    fun `未知的 URI 或媒体 ID 不构成身份`() {
        for (uri in listOf(null, "", "  ", "track.m4a", "https://bad host/track.m4a")) {
            assertNull(AudioSourceIdentity.from(uri, song))
        }
        for (mediaId in listOf(null, "", "  ")) {
            assertNull(AudioSourceIdentity.from(original, mediaId))
        }
        assertFalse(expected.matches(null))
    }

    @Test
    fun `未知的查询参数也不能当成无关信息忽略`() {
        val alternateStream = "$original&stream=mv"
        assertEquals(InstrumentalStore.keyFor(original, song), InstrumentalStore.keyFor(alternateStream, song))
        assertFalse(expected.matches(AudioSourceIdentity.from(alternateStream, song)))
    }

    @Test
    fun `旧缓存跨 CDN 和签名复用不代表当前音频可以接管`() {
        val refreshed = "https://other.example.com/track.m4a?token=new&quality=high"
        assertEquals(InstrumentalStore.keyFor(original, song), InstrumentalStore.keyFor(refreshed, song))
        assertFalse(expected.matches(AudioSourceIdentity.from(refreshed, song)))
        assertFalse(expected.matches(AudioSourceIdentity.from(original.replace("old", "new"), song)))
    }
}
