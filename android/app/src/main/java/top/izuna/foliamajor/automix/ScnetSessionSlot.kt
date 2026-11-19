package top.izuna.foliamajor.automix

// SCNet 在加锁的窗口里重新取会话；只有当场出错的窗口可以回收它。
internal class ScnetSessionSlot<T : Any>(private val close: (T) -> Unit) {
    private data class Loaded<T>(val permit: NativeInferenceGate.Permit, val path: String, val session: T)
    private var loaded: Loaded<T>? = null

    class Cancelled : java.util.concurrent.CancellationException()

    // cancelled 必须无锁：调用方可能持有调度锁在尝试关闭或作废任务。
    @Synchronized
    fun <R> use(
        permit: NativeInferenceGate.Permit,
        path: String,
        open: () -> T,
        cancelled: (() -> Boolean)? = null,
        run: (T) -> R,
    ): R {
        permit.requireCurrent()
        if (cancelled?.invoke() == true) throw Cancelled()
        val previous = loaded
        val active = if (previous != null && previous.permit === permit && previous.path == path) {
            previous
        } else {
            release()
            permit.requireCurrent()
            if (cancelled?.invoke() == true) throw Cancelled()
            Loaded(permit, path, open()).also { loaded = it }
        }
        if (!permit.isCurrent()) {
            release()
            permit.requireCurrent()
        }
        if (cancelled?.invoke() == true) throw Cancelled()
        try {
            return run(active.session)
        } catch (error: OutOfMemoryError) {
            release()
            throw error
        }
    }

    @Synchronized
    fun releaseRevoked() {
        if (loaded?.permit?.isCurrent() == false) release()
    }

    private fun release() {
        val retiring = loaded ?: return
        loaded = null
        runCatching { close(retiring.session) }
    }
}
