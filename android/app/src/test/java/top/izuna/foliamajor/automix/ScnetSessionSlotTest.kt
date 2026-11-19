package top.izuna.foliamajor.automix

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

// 验证两个同许可请求对共享 SCNet 会话的故障隔离，不加载 ORT。
class ScnetSessionSlotTest {
    @Test fun `ordinary cancellation is checked under slot lock before loading or running`() {
        val gate = NativeInferenceGate().also { it.setEnabled(true) }
        val permit = gate.acquire()!!
        val slot = ScnetSessionSlot<Any> { }
        // 模拟任务在外层通过检查，但等到进入 slot 时已被切歌取消。
        val cancelled = java.util.concurrent.atomic.AtomicBoolean(false)
        val occupying = java.util.concurrent.CountDownLatch(1)
        val leave = java.util.concurrent.CountDownLatch(1)
        val waiterReady = java.util.concurrent.CountDownLatch(1)
        val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val first = pool.submit {
                slot.use(permit, "first", { Any() }) {
                    occupying.countDown()
                    check(leave.await(5, java.util.concurrent.TimeUnit.SECONDS))
                }
            }
            check(occupying.await(5, java.util.concurrent.TimeUnit.SECONDS))
            val waiter = pool.submit {
                check(!cancelled.get())
                waiterReady.countDown()
                assertThrows(java.util.concurrent.CancellationException::class.java) {
                    slot.use(permit, "second", { error("cancelled task loads model") }, cancelled::get) {
                        error("cancelled task runs")
                    }
                }
            }
            check(waiterReady.await(5, java.util.concurrent.TimeUnit.SECONDS))
            cancelled.set(true)
            leave.countDown()
            waiter.get(5, java.util.concurrent.TimeUnit.SECONDS)
            first.get(5, java.util.concurrent.TimeUnit.SECONDS)
        } finally {
            leave.countDown()
            pool.shutdownNow()
        }
    }

    @Test fun `a native window OOM retires only its session and another request can resume`() {
        val gate = NativeInferenceGate().also { it.setEnabled(true) }
        val permit = gate.acquire()!!
        val closed = mutableListOf<Any>()
        val slot = ScnetSessionSlot<Any> { closed.add(it) }
        val first = Any()
        val second = Any()
        slot.use(permit, "scnet", { first }) { assertSame(first, it) }

        assertThrows(OutOfMemoryError::class.java) {
            slot.use(permit, "scnet", { error("should reuse first") }) { throw OutOfMemoryError("drums") }
        }
        assertEquals(listOf(first), closed)
        slot.use(permit, "scnet", { second }) { assertSame(second, it) }
        slot.releaseRevoked()
        assertEquals(listOf(first), closed)
        slot.use(permit, "scnet", { error("should reuse second") }) { assertSame(second, it) }
    }
}
