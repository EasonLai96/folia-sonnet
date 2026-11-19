package top.izuna.foliamajor.player.dsp

import org.junit.Assert.assertEquals
import org.junit.Test

// 用 FIFO 模拟播放器 Looper，装源请求仍在调用线程上同步发布元数据。
class AudioSourceLoadsTest {
    private val a = AudioSourceIdentity.from("https://cdn.test/a", "a")!!
    private val b = AudioSourceIdentity.from("https://cdn.test/b", "b")!!
    private val loads = AudioSourceLoads()
    private val queue = ArrayDeque<() -> Unit>()
    private var actual: AudioSourceIdentity? = null
    private var metadata: String? = null

    private fun prepare(identity: AudioSourceIdentity): AudioSourceLoads.Ticket {
        val ticket = loads.request(identity) { metadata = identity.uri }
        queue.addLast {
            if (loads.beginInstall(ticket)) {
                actual = identity
                loads.markInstalled(ticket)
            }
        }
        return ticket
    }

    private fun complete(ticket: AudioSourceLoads.Ticket) {
        queue.addLast {
            loads.commitIfCurrent(ticket, actual) { metadata = "file:///old-stem.wav" }
        }
    }

    @Test fun `completion ahead of B in player queue cannot overwrite B request metadata`() {
        val first = prepare(a)
        queue.removeFirst().invoke()
        complete(first)
        prepare(b)
        assertEquals(a.uri, actual?.uri)
        assertEquals(b.uri, metadata)
        queue.removeFirst().invoke()
        assertEquals(b.uri, metadata)
        queue.removeFirst().invoke()
        assertEquals(b.uri, actual?.uri)
        assertEquals(b.uri, metadata)
    }

    @Test fun `same URI and mediaId reload rejects old ticket before and after installation`() {
        val first = prepare(a)
        queue.removeFirst().invoke()
        complete(first)
        val second = prepare(a)
        complete(first)
        complete(second)
        repeat(3) {
            queue.removeFirst().invoke()
            assertEquals(a.uri, metadata)
        }
        queue.removeFirst().invoke()
        assertEquals("file:///old-stem.wav", metadata)
    }

    @Test fun `older request posted behind newer request cannot overwrite actual media`() {
        prepare(a)
        prepare(b)
        queue.removeLast().invoke()
        queue.removeFirst().invoke()
        assertEquals(b.uri, actual?.uri)
        assertEquals(b.uri, metadata)
    }

    private var published: AudioSourceLoads.Source? = null
    private val cachedA = AudioSourceLoads.Source(a.uri, "file:///cached-a.m4a", a.mediaId, true)
    private val sourceB = AudioSourceLoads.Source(b.uri, b.uri, b.mediaId, false)

    private fun prepareSource(source: AudioSourceLoads.Source): AudioSourceLoads.Ticket {
        val ticket = loads.requestSource(source) { published = source }
        queue.addLast {
            if (loads.beginInstall(ticket)) {
                actual = source.actual
                loads.markSourceInstalled(ticket, source)
            }
        }
        return ticket
    }

    private fun queueSwap(ticket: AudioSourceLoads.Ticket, target: String, instrumental: Boolean) {
        loads.queueTrackSwap(ticket, instrumental, { task -> queue.addLast { task.run() } }, { actual },
            authorize = { commit -> commit(target) }, publish = { published = it }, install = { actual = it.actual })
    }

    @Test fun `cached switch and original restore cannot enqueue against B from an A lookup`() {
        val owner = prepareSource(cachedA)
        queue.removeFirst().invoke()
        prepareSource(sourceB)
        queueSwap(owner, "file:///other-a.m4a", true)
        queueSwap(owner, a.uri, false)
        // B is already registered but the player still has A when both late callbacks run.
        val installB = queue.removeFirst()
        repeat(2) { queue.removeFirst().invoke() }
        assertEquals(sourceB, published)
        assertEquals(cachedA.url, actual?.uri)
        installB()
        assertEquals(b.uri, actual?.uri)
    }

    @Test fun `cached derived install preserves original owner for a regenerated other track`() {
        val owner = prepareSource(cachedA)
        queue.removeFirst().invoke()
        assertEquals(owner, loads.requestedFor(a))
        val other = "file:///regenerated-a.m4a"
        queueSwap(owner, other, true)
        queue.removeFirst().invoke()
        assertEquals(other, actual?.uri)
        queueSwap(owner, a.uri, false)
        queue.removeFirst().invoke()
        assertEquals(a.uri, actual?.uri)
        assertEquals(owner, loads.requestedFor(a))
    }

    @Test fun `abort restores the outgoing stem and owner unless a later load was requested`() {
        val owner = prepareSource(cachedA)
        queue.removeFirst().invoke()
        val outgoing = loads.installedSource()
        val incoming = prepareSource(sourceB)
        queue.removeFirst().invoke()
        queue.addLast {
            actual = outgoing?.source?.actual
            loads.restoreOutgoing(incoming, outgoing) { published = it }
        }
        queue.removeFirst().invoke()
        assertEquals(cachedA, published)
        assertEquals(owner, loads.requestedFor(a))
        queueSwap(owner, a.uri, false)
        queue.removeFirst().invoke()
        assertEquals(a.uri, actual?.uri)

        val newOutgoing = loads.installedSource()
        val secondIncoming = prepareSource(sourceB)
        queue.removeFirst().invoke()
        queue.addLast {
            actual = newOutgoing?.source?.actual
            loads.restoreOutgoing(secondIncoming, newOutgoing) { published = it }
        }
        val c = AudioSourceLoads.Source("https://cdn.test/c", "https://cdn.test/c", "c", false)
        val newest = prepareSource(c)
        queue.removeFirst().invoke()
        assertEquals(c, published)
        assertEquals(newest, loads.requestedFor(c.identity!!))
        queue.removeFirst().invoke()
        assertEquals(c.url, actual?.uri)
        // A later request may have already installed, not just registered, by the time abort reaches the Looper.
        assertEquals(false, loads.restoreOutgoing(secondIncoming, newOutgoing) { published = it })
        assertEquals(newest, loads.installedSource()?.ticket)
        assertEquals(c, published)
    }

    @Test fun `matching request without a matching installed source cannot commit`() {
        val first = prepare(a)
        queue.removeFirst().invoke()
        actual = b
        complete(first)
        queue.removeFirst().invoke()
        assertEquals(a.uri, metadata)
    }
}
