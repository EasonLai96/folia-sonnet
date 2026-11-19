package top.izuna.foliamajor.player.dsp

// 分离任务去重与最终换轨授权：磁盘键相同不等于同一条装源请求。
internal class StemBuildGate {
    class Job(val key: String, val source: AudioSourceLoads.Ticket?, val authorized: () -> Boolean)

    @Volatile private var current: Job? = null
    private var pendingHandoff: Job? = null
    private var isolated: Job? = null

    @Synchronized
    fun begin(key: String, source: AudioSourceLoads.Ticket?, authorized: () -> Boolean = { true }): Job = Job(key, source, authorized).also {
        rememberPendingSource()
        current = it
        pendingHandoff = null
    }

    @Synchronized
    fun markReady(job: Job, willSwitch: Boolean) {
        if (current !== job) return
        if (isolated?.key == job.key) isolated = null
        pendingHandoff = job.takeIf { willSwitch }
    }

    @Synchronized
    fun blocksCache(key: String, source: AudioSourceIdentity? = null): Boolean =
        blocksCache(pendingHandoff, key, source) || blocksCache(isolated, key, source)

    // 撤权允许精确同源读取成品，但不能把已知不同的同键来源当成同一音频。
    private fun blocksCache(job: Job?, key: String, source: AudioSourceIdentity?): Boolean =
        job != null && job.key == key && (job.authorized() || job.source?.identity?.matches(source) == false)

    private fun activeHandoff(): Job? = pendingHandoff?.takeIf { it.authorized() }

    @Synchronized
    fun finishHandoff(job: Job, stillRequested: () -> Boolean) {
        if (pendingHandoff !== job) return
        pendingHandoff = null
        // 旧成品仍不能接管新的同键装源，但不能在回调已退场后永久拖住其他预拆。
        if (job.authorized()) {
            if (!stillRequested()) isolated = job
        } else if (job.source?.identity != null) {
            isolated = job
        }
    }

    // 预拆的调度边界：READY 已对 UI 可见，但显式接管尚未在播放器消费。
    @Synchronized
    fun schedulePrebuild(isBuilding: Boolean, alreadyReady: () -> Boolean, start: () -> Unit) {
        if (!isBuilding && activeHandoff() == null && !alreadyReady()) start()
    }

    @Synchronized
    fun canReuse(key: String, source: AudioSourceLoads.Ticket?): Boolean =
        source != null && current?.let { it.key == key && it.source === source && it.authorized() } == true

    @Synchronized
    fun cancel(clearCache: Boolean = false) {
        invalidateBuild()
        if (clearCache) isolated = null
    }

    @Synchronized
    fun invalidateBuild() {
        rememberPendingSource()
        current = null
        pendingHandoff = null
    }

    private fun rememberPendingSource() {
        pendingHandoff?.takeIf { it.source?.identity != null }?.let { isolated = it }
    }

    // SCNet 持有会话锁时也会调用；current 与生产授权检查均不拿调度锁。
    fun isCurrent(job: Job): Boolean = current === job && job.authorized()

    @Synchronized
    fun <T> ordered(change: () -> T): T = change()

    @Synchronized
    fun commit(job: Job, selected: VocalTrackMode, active: () -> VocalTrackMode?, swap: () -> Unit) {
        if (isCurrent(job) && active() == selected) swap()
    }
}
