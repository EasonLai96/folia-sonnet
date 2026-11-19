package top.izuna.foliamajor.player.dsp

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// 排队期间模式和任务均可能改变；提交时重新确认授权。
class StemBuildGateTest {
    @Test fun `same disk key requires exact owned load ticket to reuse pending build`() {
        val gate = StemBuildGate()
        val loads = AudioSourceLoads()
        val a = AudioSourceIdentity.from("https://cdn.test/track?sign=old", "track")!!
        val b = AudioSourceIdentity.from("https://cdn.test/track?sign=new", "track")!!
        val key = "shared-key"
        val first = loads.request(a)
        gate.begin(key, null)
        assertFalse(gate.canReuse(key, first))
        val old = gate.begin(key, first)
        assertTrue(gate.canReuse(key, first))
        assertFalse(gate.canReuse(key, loads.request(a)))
        val resigned = loads.request(b)
        assertFalse(gate.canReuse(key, resigned))
        gate.begin(key, resigned)
        assertFalse(gate.isCurrent(old))
    }

    @Test fun `next track prebuild cannot replace READY job queued for the player`() {
        val gate = StemBuildGate()
        val selected = VocalTrackMode.VOCAL
        val loads = AudioSourceLoads()
        val source = AudioSourceLoads.Source("https://cdn.test/current", "https://cdn.test/current", "current", false)
        val owner = loads.requestSource(source)
        loads.markSourceInstalled(owner, source)
        val job = gate.begin("current", owner)
        val queue = ArrayDeque<Runnable>()
        var swaps = 0
        var prebuilds = 0
        gate.markReady(job, willSwitch = true)
        loads.queueTrackSwap(owner, true, queue::addLast, { source.actual },
            authorize = { commit -> gate.commit(job, selected, { selected }) { commit("file:///vocal-a.m4a") } },
            publish = {}, install = { swaps++ }, finished = { gate.finishHandoff(job) { loads.isRequested(owner) } })
        val prebuild = {
            gate.schedulePrebuild(isBuilding = false, alreadyReady = { false }) {
                prebuilds++
                gate.begin("next", null)
            }
        }
        prebuild()
        queue.removeFirst().run()
        assertTrue(swaps == 1)
        assertTrue(prebuilds == 0)
        prebuild()
        assertTrue(prebuilds == 1)
    }

    @Test fun `revoked READY handoff cannot swap or hide already published cache`() {
        val gate = StemBuildGate()
        val selected = VocalTrackMode.VOCAL
        var authorized = true
        val job = gate.begin("track", null) { authorized }
        gate.markReady(job, willSwitch = true)
        assertTrue(gate.blocksCache("track"))
        authorized = false
        var swapped = false
        gate.commit(job, selected, { selected }) { swapped = true }
        assertFalse(swapped)
        // 重装后先到的旧回调不能为已撤权的接管留下隔离键。
        gate.finishHandoff(job) { false }
        assertFalse(gate.blocksCache("track"))

        authorized = true
        val next = gate.begin("next", null) { authorized }
        gate.markReady(next, willSwitch = true)
        authorized = false
        // 反过来也要能读缓存：播放器队列还没消费旧回调。
        assertFalse(gate.blocksCache("next"))
    }

    @Test fun `same disk key remains fenced for a different source after revocation`() {
        val gate = StemBuildGate()
        val loads = AudioSourceLoads()
        val a = AudioSourceIdentity.from("https://cdn.test/song?sign=a", "track")!!
        val b = AudioSourceIdentity.from("https://cdn.test/song?sign=b", "track")!!
        var authorized = true
        val job = gate.begin("same", loads.request(a)) { authorized }
        gate.markReady(job, willSwitch = true)
        authorized = false
        assertFalse(gate.blocksCache("same", a))
        assertTrue(gate.blocksCache("same", b))
        gate.finishHandoff(job) { false }
        assertFalse(gate.blocksCache("same", a))
        assertTrue(gate.blocksCache("same", b))
        val replacement = gate.begin("same", loads.request(b))
        gate.cancel()
        assertTrue(gate.blocksCache("same", b)) // replacement never committed a new result.
        gate.cancel(clearCache = true)
        assertFalse(gate.blocksCache("same", b))
        assertFalse(gate.isCurrent(replacement))
    }

    @Test fun `selected track cannot commit after OFF or clear`() {
        val gate = StemBuildGate()
        val selected = VocalTrackMode.VOCAL
        var active: VocalTrackMode? = selected
        val job = gate.begin("key", null)
        var swaps = 0
        val queuedCommit = { gate.commit(job, selected, { active }) { swaps++ } }
        active = null
        queuedCommit()
        active = selected
        gate.cancel()
        queuedCommit()
        assertTrue(swaps == 0)
        gate.commit(gate.begin("key", null), selected, { active }) { swaps++ }
        assertTrue(swaps == 1)
    }
}
