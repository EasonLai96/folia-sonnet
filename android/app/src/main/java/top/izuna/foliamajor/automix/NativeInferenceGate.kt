package top.izuna.foliamajor.automix

// #401 的进程级授权。每次重新打开签发一个新许可，旧许可永不复活。
internal class NativeInferenceGate {
    class Permit internal constructor(private val gate: NativeInferenceGate) {
        fun isCurrent(): Boolean = gate.acquire() === this
        fun requireCurrent() = check(isCurrent()) { DISABLED_MESSAGE }

        // 只用于短提交（磁盘改名、换源），不在授权锁里做模型加载或推理。
        fun commit(action: () -> Boolean): Boolean = gate.commit(this, action)

        // 桥发送在此决定是否交付；序列化与传输不持锁，已准许的发送可在关闭后完成。
        fun dispatch(send: () -> Unit): Boolean {
            if (!isCurrent()) return false
            send()
            return true
        }
    }

    @Volatile private var permit: Permit? = null

    fun acquire(): Permit? = permit

    @Synchronized
    fun setEnabled(enabled: Boolean) {
        permit = if (enabled) permit ?: Permit(this) else null
    }

    @Synchronized
    private fun commit(expected: Permit, action: () -> Boolean): Boolean = permit === expected && action()

    companion object {
        val process = NativeInferenceGate()
        const val DISABLED_MESSAGE = "automix-inference-disabled"
    }
}
