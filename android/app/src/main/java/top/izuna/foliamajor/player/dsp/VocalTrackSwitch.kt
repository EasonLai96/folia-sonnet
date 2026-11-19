package top.izuna.foliamajor.player.dsp

// android/app/src/main/java/top/izuna/foliamajor/player/dsp/VocalTrackSwitch.kt
// 换源判据的纯逻辑：单独抽出来，是为了能在 JVM 单测里锁定「只留人声 → 关闭人声」
// 这条曾经切错的路径，不必构造依赖 ExoPlayer / Context / Looper 的 FoliaNativePlayer。

/**
 * 此刻该不该换到目标轨。
 *
 * 判据必须是「此刻播的是不是这一轨」，不能是「在不在分离轨」：
 * `isOnInstrumental()` 对伴奏和清唱都返回 true，从清唱轨切到伴奏轨时用它判断会
 * 短路换源 —— 播放器停在清唱轨上，而中置相消已经打开，用户听到的就是「没声音」。
 *
 * `currentUrl` 是上一次 prepare / swapSource 真正装进去的地址（FoliaNativePlayer.lastUrl），
 * 原曲 / 伴奏 / 清唱三态各不相同：跟目标文件不一样就切，一样就不动 —— 后者也避免
 * 状态轮询每次 reconcile 都把同一轨重新 prepare 一遍。
 *
 * 这是纯字符串比较，不碰任何 Android API，可直接进 JVM 单测。
 */
internal fun shouldSwapVocalTrack(currentUrl: String?, targetUrl: String): Boolean =
    currentUrl != targetUrl

/**
 * 界面那一行三选一传下来的值 → 该播哪一轨。
 *
 * 单独抽成纯函数，是为了让「切人声却放了全部 / 切全部却放了人声」这类错位
 * 能在 JVM 单测里被钉死：映射写反一次，两种错位会同时出现。未知值（含 null）
 * 一律当「全部」，不猜、也不留着上一态。
 */
internal fun vocalTrackModeOf(mode: String?): VocalTrackMode? = when (mode) {
    "instrumental" -> VocalTrackMode.INSTRUMENTAL
    "vocal" -> VocalTrackMode.VOCAL
    else -> null
}
