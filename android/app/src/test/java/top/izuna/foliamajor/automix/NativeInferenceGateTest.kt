package top.izuna.foliamajor.automix

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

// 不加载 ORT，在 JVM 上验证实际用于排队、模型操作与发布的授权边界。
class NativeInferenceGateTest {
    @Test fun `default denial cannot enter work but a compatible cache remains readable`() {
        val gate = NativeInferenceGate()
        var modelTouches = 0
        fun request(cached: String?) = cached ?: gate.acquire()?.let {
            if (it.isCurrent()) modelTouches++
            "generated"
        }
        assertEquals("cache", request("cache"))
        assertNull(request(null))
        assertEquals(0, modelTouches)
        gate.setEnabled(true)
        assertEquals("generated", request(null))
        assertEquals(1, modelTouches)
    }

    @Test fun `revoked permit stops at the actual SCNet load and separation boundaries`() {
        val gate = NativeInferenceGate()
        gate.setEnabled(true)
        val stale = gate.acquire()!!
        gate.setEnabled(false)
        gate.setEnabled(true)
        val loading = assertThrows(IllegalStateException::class.java) {
            ScnetRunner.ensureLoaded(File("not-a-model"), stale)
        }
        val inference = assertThrows(IllegalStateException::class.java) {
            ScnetRunner.separate(FloatArray(0), FloatArray(0), stale, File("not-a-model"))
        }
        assertEquals(NativeInferenceGate.DISABLED_MESSAGE, loading.message)
        assertEquals(NativeInferenceGate.DISABLED_MESSAGE, inference.message)
    }

    @Test fun `an authorized bridge response cannot block revocation while sending`() {
        val gate = NativeInferenceGate().also { it.setEnabled(true) }
        val permit = gate.acquire()!!
        val sending = CountDownLatch(1)
        val finish = CountDownLatch(1)
        val workers = Executors.newFixedThreadPool(2)
        try {
            val reply = workers.submit<Boolean> {
                permit.dispatch {
                    sending.countDown()
                    check(finish.await(5, TimeUnit.SECONDS))
                }
            }
            assertTrue(sending.await(2, TimeUnit.SECONDS))
            workers.submit { gate.setEnabled(false) }.get(2, TimeUnit.SECONDS)
            gate.setEnabled(true)
            assertFalse(permit.dispatch { error("stale reply dispatched") })
            finish.countDown()
            assertTrue(reply.get(2, TimeUnit.SECONDS))
        } finally {
            finish.countDown()
            workers.shutdownNow()
        }
    }

    @Test fun `settings and memory updates revoke queued running and publishing work`() {
        val gate = NativeInferenceGate()
        gate.setEnabled(true)
        val queued = gate.acquire()!!
        val running = gate.acquire()!!
        assertTrue(running.isCurrent())
        gate.setEnabled(true) // 同一个允许态的重复同步不应取消任务。
        assertTrue(queued.isCurrent())
        gate.setEnabled(false) // 设置关闭或内存压力经同一 #401 入口生效。
        assertFalse(running.isCurrent())
        assertNull(gate.acquire())
        gate.setEnabled(true)
        assertFalse(queued.isCurrent())
        assertFalse(running.isCurrent())
        var published = 0
        assertFalse(running.commit { published++; true })
        assertTrue(gate.acquire()!!.commit { published++; true })
        assertEquals(1, published)
        assertNotNull(gate.acquire())
    }
}
