package top.izuna.foliamajor.automix

import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

// BeatThis 的桥队列与原生会话生命周期；用假会话，不加载 ORT。
class BeatThisLifecycleTest {
    @Test fun `queued requests cannot enter work after disable and reopen`() {
        val gate = NativeInferenceGate().also { it.setEnabled(true) }
        val queue = ArrayDeque<Runnable>()
        val executor = Executor { queue.addLast(it) }
        var work = 0
        var rejected = 0
        // Keep ordinary cancellation unchanged: only the native permit can reject the old call.
        fun submit() = BeatThisRequest.enqueue(executor, gate, { 0 }, { rejected++ }) {
            assertFalse(it.cancelled())
            work++
        }

        submit()
        gate.setEnabled(false)
        gate.setEnabled(true)
        submit()
        while (queue.isNotEmpty()) queue.removeFirst().run()
        assertEquals(1, rejected)
        assertEquals(1, work)
    }

    @Test fun `ordinary cancel also invalidates a queued request without revoking inference`() {
        val gate = NativeInferenceGate().also { it.setEnabled(true) }
        val queue = ArrayDeque<Runnable>()
        var generation = 0
        var wasCancelled = false
        BeatThisRequest.enqueue(Executor { queue.addLast(it) }, gate, { generation }, { error("still enabled") }) {
            wasCancelled = it.cancelled()
        }
        generation++
        queue.removeFirst().run()
        assertTrue(wasCancelled)
    }

    @Test fun `queued event is dropped if its permit is revoked during cancellation sampling`() {
        val gate = NativeInferenceGate().also { it.setEnabled(true) }
        val ui = ArrayDeque<Runnable>()
        var revokeDuringCheck = false
        var delivered = false
        BeatThisRequest.enqueue(Executor { it.run() }, gate, {
            if (revokeDuringCheck) {
                gate.setEnabled(false)
                gate.setEnabled(true)
            }
            0
        }, { error("request was current at submission") }) { request ->
            ui.addLast(Runnable { request.dispatchEvent { delivered = true } })
        }
        revokeDuringCheck = true
        ui.removeFirst().run()
        assertFalse(delivered)
    }

    @Test fun `reply paths distinguish ordinary cancellation from permit revocation`() {
        val gate = NativeInferenceGate().also { it.setEnabled(true) }
        var generation = 0
        val replies = mutableListOf<String>()
        BeatThisRequest.enqueue(Executor { it.run() }, gate, { generation }, { error("still enabled") }) { request ->
            fun success(cancelledResult: Boolean = false) = request.dispatchReply(
                cancelledResult, { replies += "success:$it" }, { replies += "disabled" },
            )
            fun failure() = request.dispatchError(
                { replies += "error" }, { replies += "cancelled" }, { replies += "disabled" },
            )
            success()
            success(cancelledResult = true)
            failure()
            generation++
            success()
            failure()
            gate.setEnabled(false)
            gate.setEnabled(true)
            success()
            failure()
        }
        assertEquals(listOf("success:false", "success:true", "error", "success:true", "cancelled", "disabled", "disabled"), replies)
    }

    @Test fun `ordinary cancellation inside a mel yield stops before another progress report or window`() {
        val gate = NativeInferenceGate().also { it.setEnabled(true) }
        var generation = 0
        var yields = 0
        val progress = mutableListOf<Float>()
        BeatThisRequest.enqueue(Executor { it.run() }, gate, { generation }, { error("still enabled") }) { request ->
            val result = BeatThisRunner.analyze(
                mono = FloatArray(441 * 2048),
                modelFile = File("should-not-open.onnx"),
                request = request,
                onProgress = { stage, done ->
                    assertEquals("mel", stage)
                    progress += done
                },
                yieldMel = { if (++yields == 2) generation++ },
            )
            assertTrue(result.cancelled)
            assertTrue(result.beats.isEmpty())
            assertEquals(0, result.beatLogits.size)
        }
        assertEquals(2, yields)
        assertEquals(listOf(0f), progress)
    }

    @Test fun `revocation during mel yield aborts promptly even after reopen`() {
        val gate = NativeInferenceGate().also { it.setEnabled(true) }
        var yields = 0
        BeatThisRequest.enqueue(Executor { it.run() }, gate, { 0 }, { error("request was current at submission") }) { request ->
            val error = runCatching {
                BeatThisRunner.analyze(
                    FloatArray(441 * 2048), File("should-not-open.onnx"), request,
                    yieldMel = {
                        yields++
                        gate.setEnabled(false)
                        gate.setEnabled(true)
                    },
                )
            }.exceptionOrNull()
            assertEquals(NativeInferenceGate.DISABLED_MESSAGE, error?.message)
        }
        assertEquals(1, yields)
    }

    @Test fun `release cannot close a running window and a delayed release preserves the reopened session`() {
        val gate = NativeInferenceGate().also { it.setEnabled(true) }
        val oldPermit = gate.acquire()!!
        val path = File("beat_this.onnx")
        val old = Any()
        val next = Any()
        val entered = CountDownLatch(1)
        val leave = CountDownLatch(1)
        val closed = java.util.concurrent.ConcurrentLinkedQueue<Any>()
        val pool = Executors.newSingleThreadExecutor()
        val windowExited = AtomicBoolean(false)
        val overlapped = AtomicBoolean(false)
        val sessions = BeatThisSessions(open = { _, permit, _ -> if (permit === oldPermit) old else next }, close = {
            if (it === old && !windowExited.get()) overlapped.set(true)
            closed.add(it)
        })
        try {
            val window = pool.submit {
                sessions.use(oldPermit, path, null) {
                    assertSame(old, it)
                    entered.countDown()
                    assertTrue(leave.await(5, TimeUnit.SECONDS))
                    windowExited.set(true)
                }
            }
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            gate.setEnabled(false)
            val release = FutureTask { sessions.releaseRevoked() }
            val cleanup = Thread(release).apply { isDaemon = true; start() }
            // Hold the window until cleanup either waits on its monitor or incorrectly finishes.
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (cleanup.state != Thread.State.BLOCKED && !release.isDone && System.nanoTime() < deadline) {
                Thread.yield()
            }
            assertFalse("close returned while the native window was held", release.isDone)
            assertEquals(Thread.State.BLOCKED, cleanup.state)
            gate.setEnabled(true)
            leave.countDown()
            window.get(5, TimeUnit.SECONDS)
            release.get(5, TimeUnit.SECONDS)
            assertFalse("close overlapped the native window", overlapped.get())
            assertEquals(listOf(old), closed.toList())
            val nextPermit = gate.acquire()!!
            sessions.use(nextPermit, path, null) { assertSame(next, it) }
            sessions.releaseRevoked()
            sessions.use(nextPermit, path, null) { assertSame(next, it) }
            assertEquals(listOf(old), closed.toList())
        } finally {
            leave.countDown()
            pool.shutdownNow()
        }
    }
}
