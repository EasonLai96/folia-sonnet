package top.izuna.foliamajor.player.dsp

// 装源请求与播放器线程实际装载分别记代次；同一 URI / mediaId 重装也得到不同票据。
internal class AudioSourceLoads {
    class Ticket internal constructor(val identity: AudioSourceIdentity?, internal val generation: Long)

    data class Source(
        val baseUrl: String,
        val url: String,
        val mediaId: String?,
        val instrumental: Boolean,
        val preparedAtMs: Long = System.currentTimeMillis(),
    ) {
        val identity = AudioSourceIdentity.from(baseUrl, mediaId)
        val actual = AudioSourceIdentity.from(url, mediaId)
    }

    data class Installed(val ticket: Ticket, val source: Source)

    // A restored outgoing ticket is usable again by playback, but does not revive old four-stem jobs.
    private val fourStemOwner = nextFourStemOwner.incrementAndGet()
    @Volatile private var fourStemEpoch = 0L

    class FourStemSource internal constructor(
        private val owner: AudioSourceLoads,
        private val epoch: Long,
        val identity: AudioSourceIdentity,
    ) {
        // No origin content revision exists yet. Reuse only within this player's exact installation.
        fun cacheSource() = FourStemStore.Source(identity.mediaId, identity.uri, "$processScope:${owner.fourStemOwner}:$epoch")

        fun isCurrent() = owner.fourStemCurrent(epoch)
        fun commit(action: () -> Boolean) = owner.commitFourStem(epoch, action)
    }

    // Reservation predates Looper dispatch, so even a restored outgoing ticket cannot revive queued work.
    @Synchronized
    fun reserveFourStem(expected: Ticket): Long? = fourStemEpoch.takeIf { requested === expected && installed === expected }

    // Called on the player Looper, with the real MediaItem rather than caller metadata.
    @Synchronized
    fun captureFourStem(expected: Ticket, epoch: Long, actual: AudioSourceIdentity?): FourStemSource? {
        val snapshot = installedSource ?: return null
        val requested = requestedSource ?: return null
        if (epoch != fourStemEpoch || actual == null || expected !== snapshot.ticket || installed !== expected || this.requested !== expected ||
            snapshot.source.instrumental || requested.instrumental ||
            !actual.matches(expected.identity) || !actual.matches(snapshot.source.actual) ||
            !actual.matches(requested.actual)
        ) return null
        return FourStemSource(this, fourStemEpoch, actual)
    }

    private fun fourStemCurrent(epoch: Long) = fourStemEpoch == epoch

    @Synchronized
    private fun commitFourStem(epoch: Long, action: () -> Boolean): Boolean = fourStemEpoch == epoch && action()

    private companion object {
        val nextFourStemOwner = java.util.concurrent.atomic.AtomicLong()
        val processScope by lazy { java.util.UUID.randomUUID().toString() }
    }

    private var installedSource: Installed? = null
    private var requestedSource: Source? = null

    @Synchronized
    fun requestSource(source: Source, publish: () -> Unit = {}): Ticket = request(source.identity) {
        requestedSource = source
        publish()
    }

    @Synchronized
    fun markSourceInstalled(ticket: Ticket, source: Source) {
        markInstalled(ticket)
        installedSource = Installed(ticket, source)
    }

    @Synchronized
    fun installedSource(): Installed? = installedSource

    @Synchronized
    fun requestedSource(): Installed? {
        val ticket = requested ?: return null
        val source = requestedSource ?: return null
        return Installed(ticket, source)
    }

    fun queueTrackSwap(
        ticket: Ticket,
        instrumental: Boolean,
        enqueue: (Runnable) -> Unit,
        actual: () -> AudioSourceIdentity?,
        authorize: ((String) -> Unit) -> Unit,
        publish: (Source) -> Unit,
        install: (Source) -> Unit,
        finished: () -> Unit = {},
    ) = enqueue(Runnable {
        try {
            val item = actual() ?: return@Runnable
            authorize { url ->
                val source = installedSource()?.source?.copy(url = url, instrumental = instrumental)
                if (source != null && item.uri != url && commitIfCurrent(ticket, item) {
                        ++fourStemEpoch
                        requestedSource = source
                        publish(source)
                    }
                ) {
                    install(source)
                    markSourceInstalled(ticket, source)
                }
            }
        } finally {
            finished()
        }
    })

    @Synchronized
    fun restoreOutgoing(incoming: Ticket, outgoing: Installed?, publish: (Source) -> Unit): Boolean {
        if (installed !== incoming) return false
        ++fourStemEpoch
        installed = outgoing?.ticket
        installedSource = outgoing
        if (requested === incoming && outgoing != null) {
            requested = outgoing.ticket
            requestedSource = outgoing.source
            publish(outgoing.source)
        }
        return true
    }

    private var nextGeneration = 0L
    private var applyingGeneration = 0L
    private var requested: Ticket? = null
    private var installed: Ticket? = null

    @Synchronized
    fun request(identity: AudioSourceIdentity?, publish: () -> Unit = {}): Ticket {
        ++fourStemEpoch
        val ticket = Ticket(identity, ++nextGeneration)
        requested = ticket
        requestedSource = null
        publish()
        return ticket
    }

    @Synchronized
    fun requestedFor(identity: AudioSourceIdentity): Ticket? =
        requested?.takeIf { identity.matches(it.identity) }

    @Synchronized
    fun isRequested(ticket: Ticket): Boolean = requested === ticket

    @Synchronized
    fun ifRequested(ticket: Ticket, action: () -> Unit) {
        if (requested === ticket) action()
    }

    // 先登记、后 post 的并发调用方可能反序抵达 Looper；已开始的新请求不允许被旧的覆盖。
    @Synchronized
    fun beginInstall(ticket: Ticket): Boolean {
        if (ticket.generation < applyingGeneration) return false
        ++fourStemEpoch
        applyingGeneration = ticket.generation
        return true
    }

    @Synchronized
    fun markInstalled(ticket: Ticket?) {
        ++fourStemEpoch
        installed = ticket
        installedSource = null
    }

    @Synchronized
    fun publishIfRequested(ticket: Ticket, publish: () -> Unit): Boolean {
        if (requested !== ticket) return false
        publish()
        return true
    }

    // 事务只覆盖验证与同步元数据；Media3 操作仍然留在播放器线程且不持锁。
    @Synchronized
    fun commitIfCurrent(ticket: Ticket, actual: AudioSourceIdentity?, publish: () -> Unit): Boolean {
        val snapshot = installedSource
        val knownActual = if (snapshot == null) ticket.identity else snapshot.source.actual
        if (requested !== ticket || installed !== ticket || ticket.identity == null || knownActual?.matches(actual) != true) return false
        publish()
        return true
    }
}
