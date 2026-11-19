package top.izuna.foliamajor.player.dsp

import android.content.Context
import android.net.Uri
import android.util.Log
import top.izuna.foliamajor.automix.NativeInferenceGate
import top.izuna.foliamajor.player.FoliaNativePlayer
import top.izuna.foliamajor.settings.FoliaSettingsStore
import java.util.concurrent.Executors

// android/app/src/main/java/top/izuna/foliamajor/player/dsp/InstrumentalCoordinator.kt
// 「关闭人声」的调度：决定这一刻该播原曲还是播伴奏、要不要开始生成。
//
// 三种时机都会走到这里：
//   1. 用户拨开关；
//   2. 换歌（插件 prepare）；
//   3. 后台生成完成（要判断「用户还在听这首吗、开关还开着吗」再换源）。
//
// 它自己不认识 UI：状态靠 [status] 给插件轮询，进度靠 [notify] 往外发事件。
//
// 一条纪律：**换源永远走 FoliaNativePlayer.swapSourceIfCurrent()**，不要在这里自己 setMediaItem ——
// 位置、播放状态、songKey、交叉淡化收尾都在那一个方法里处理。

internal object InstrumentalCoordinator {

    private const val TAG = "Instrumental"

    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "folia-instrumental").apply {
            isDaemon = true
            /*
             * 比普通线程低一格：生成伴奏是几十秒的推理，正在放的这首歌不能因为它
             * 卡一下（解码、AudioTrack 都在同几个核上）。
             */
            priority = Thread.NORM_PRIORITY - 1
        }
    }

    /** 每次开始生成 +1。旧的活干完时对不上号就直接丢掉结果。 */
    private val builds = StemBuildGate()
    // 清理或显式意图更新后，已排队的缓存切换不再有权提交。
    private var cacheIntent = 0L

    fun <T> withTrackIntent(action: () -> T): T = builds.ordered(action)

    // 进行中的同键任务不能借磁盘命中直接接管一次新的 prepare。
    fun cachedTrackForPrepare(context: Context, url: String, songKey: String?, mode: VocalTrackMode) =
        withTrackIntent {
            discardRevokedBuild()
            if (AudioSourceIdentity.from(url, songKey) == null) return@withTrackIntent null
            val key = InstrumentalStore.keyFor(url, songKey)
            if ((state == STATE_BUILDING && activeKey == key) || builds.blocksCache(key, AudioSourceIdentity.from(url, songKey))) return@withTrackIntent null
            InstrumentalStore.find(context, key, mode)
        }

    @Volatile private var state: String = STATE_IDLE
    @Volatile private var percent: Int = 0
    @Volatile private var activeKey: String? = null

    /**
     * 这一趟跑完要不要换源。
     *
     * 预生成跑着的时候用户拨了开关，不应该把已经跑了半首的推理作废重来 ——
     * 把标志翻过来，跑完直接切过去就行。这正是「提前分析、拨开关秒切」的意义。
     */
    @Volatile private var switchOnDone: Boolean = false

    var notify: ((String, Int) -> Unit)? = null

    /**
     * 「这条原曲地址已经不该再用了，请 Web 侧重新解析一个」。
     *
     * 为什么原生这边不能自己解决：原曲地址是**平台给的签名直链**（B 站带 `deadline=`，
     * 音乐平台也会过期），重新要一个要走各平台的 adapter 与账号会话，那是 Web 侧
     * （omni）的活，原生不认识任何一个平台。
     *
     * 参数是这一首的身份（songKey）；Web 侧据此确认「要重解析的确实是此刻这一首」，
     * 拿到新地址后按正常装源换过去 —— 与播放页自己恢复音源走的是同一条路。
     */
    var requestFreshSource: ((songKey: String?, reason: String) -> Unit)? = null

    /**
     * 一条地址**多久之后就可能已经过期**。
     *
     * B 站的取流地址一般撑几个小时，音乐平台的 CDN 地址也差不多；从这个量级往下取，
     * 主要防的是「分离跑了几十秒到几分钟之后，手里那条已经不新鲜了」这一种。
     * 判据只用来决定「切回全部时要不要顺手要一条新的」，不是严格的过期时刻 ——
     * 早一点要新的只是多一次请求，晚一点就是放不出来。
     */
    private const val SOURCE_LIKELY_STALE_MS = 45L * 60 * 1000

    /**
     * 这条原曲地址是不是**可能已经过期**（装了很久，或者带取流签名）。
     *
     * 纯函数版可单测。`signed` 由调用方按地址判断（见 [looksSigned]）。
     */
    internal fun sourceMayBeStale(
        preparedAt: Long,
        now: Long,
        signed: Boolean,
    ): Boolean {
        if (signed) return true
        if (preparedAt <= 0L) return true
        return now - preparedAt >= SOURCE_LIKELY_STALE_MS
    }

    /**
     * 这条地址看着像带时效的取流签名。
     *
     * 命中就认为它随时可能失效：视频站的 CDN 地址一律带这些参数，音乐平台的直链也常带
     * `expires` / `token`。没有签名的（本地文件、回环地址、平台长链）走计时那条判据。
     */
    internal fun looksSigned(url: String?): Boolean {
        val text = url.orEmpty()
        if (text.isEmpty()) return false
        // 本地文件 / 本机回环（媒体缓存、音频服务、视频中转）永远不会过期，别把要新的请求发出去。
        if (text.startsWith("file:")) return false
        if (text.startsWith("http://127.0.0.1") || text.startsWith("http://localhost")) return false
        return text.contains("deadline=") || text.contains("upsig=") ||
            text.contains("expires=") || text.contains("sign=") || text.contains("token=")
    }

    private var buildPermit: NativeInferenceGate.Permit? = null

    // 撤销是即时的；状态读写时收回已经不能完成的工作，不碰已提交的缓存。
    private fun discardRevokedBuild() {
        if (state != STATE_BUILDING || buildPermit?.isCurrent() != false) return
        builds.invalidateBuild()
        switchOnDone = false
        buildPermit = null
        state = STATE_IDLE
        percent = 0
        activeKey = null
    }

    fun status(): Triple<String, Int, String?> = withTrackIntent {
        discardRevokedBuild()
        Triple(state, percent, activeKey)
    }

    /**
     * 拨开关 / 换歌之后的统一入口。
     *
     * 播哪一轨由 [NativeEqualizerState.activeMode] 决定（两个开关互斥），
     * 调用方不要再传布尔 —— 之前那种「两个都开」会一会儿换伴奏一会儿换清唱。
     *
     * 原地址与曲目身份从同一装源请求快照读取，不能混用桥侧 songKey 和播放器地址。
     */
    fun reconcile(context: Context, player: FoliaNativePlayer?) = withTrackIntent {
        discardRevokedBuild()
        val current = player?.requestedAudioSource()
        if (player == null || current == null) {
            cancel()
            return@withTrackIntent
        }
        val url = current.source.baseUrl
        val songKey = current.source.mediaId
        val mode = NativeEqualizerState.activeMode()
        if (mode == null) {
            /*
             * 关掉开关只该把音源换回原曲，**不该把正在跑的提前分析作废**。
             *
             * 那趟任务是给「下次拨开关」备缓存的，跟此刻开关开没开无关；
             * cancel() 会 generation+1 让它白跑。判据是 switchOnDone：
             * true 表示这趟是用户拨开关发起的，关掉就该停；false 是预生成，留着。
             */
            val prebuilding = !switchOnDone && state == STATE_BUILDING
            if (!prebuilding) cancel()
            /*
             * 换回原曲的判据也必须是「此刻装的是不是这一轨」，不能是 isOnInstrumental()
             * 那个布尔：伴奏与清唱都为 true，它说不清现在到底在哪一轨。用户从「人声」
             * 切「全部」时若播放器还停在清唱轨上，用目标地址比一次才不会漏切；已经在
             * 原曲上则短路，不重复 prepare。
             *
             * 再加一道身份校验：url 必须与播放器记着的原曲地址一致。切歌竞态里
             * reconcile 可能拿着上一首的地址进来，少了这一条就会把旧歌装到新歌上。
             */
            if (current.source.instrumental && shouldSwapVocalTrack(current.source.url, url)) {
                /*
                 * ★ 从**分离轨**切回原曲时，手上那条原曲地址可能已经过期：先让 Web 侧要一条
                 * 新的，别把一条放不出来的地址塞给播放器。
                 *
                 * 用户报的是「分离缓存生成完之后切回全部，播放器不会重新去拉原曲音频，
                 * 本地又没有缓存，于是放不出来」。根因就在这里：分离跑了几十秒到几分钟，
                 * 期间手上那条签名直链可能已经过期；而本地没有原曲的媒体缓存副本，
                 * swapSource 之后就是一个读不出来的源 —— 界面显示「全部」，却没有声音。
                 *
                 * 只在「此刻确实装在分离轨上」才查这件事：已经在放原曲时拨开关（比如开着
                 * 伴奏模式又点了一次全部）地址还是同一条，没必要为了它白要一次流。
                 *
                 * 判据见 [looksSigned] / [sourceMayBeStale]：带签名的一律要新的（重新要一次
                 * 只是一个请求），没签名的按装了多久算。请求交给 Web 侧（omni 认平台），
                 * 拿到新地址后由它正常装源；这里**不**先用旧地址 swapSource，否则会先响一下
                 * 断流再跳回来。
                 */
                if (sourceMayBeStale(current.source.preparedAtMs, System.currentTimeMillis(), looksSigned(url))) {
                    player.ifRequestedAudioSource(current.ticket) {
                        requestFreshSource?.invoke(songKey, "switched back to the original")
                    }
                    /*
                     * 已经在分离轨上、又准备重新装源：换回原曲这一步交给 Web 侧那次装源做。
                     * 但状态要归位，否则界面还挂着「伴奏 / 人声」的进度。
                     */
                    if (!prebuilding) {
                        state = STATE_IDLE
                        percent = 0
                        activeKey = null
                        notify?.invoke(state, percent)
                    }
                    return@withTrackIntent
                }
                queueOriginal(player, current)
            }
            // 预生成那趟还在跑：状态留着，别让下一句「这首歌没备好」的判断再发起第二趟。
            if (!prebuilding) {
                state = STATE_IDLE
                percent = 0
                activeKey = null
                notify?.invoke(state, percent)
            }
            return@withTrackIntent
        }
        val key = InstrumentalStore.keyFor(url, songKey)
        val source = current.ticket.takeIf { it.identity != null }
        val sameKeyBuilding = state == STATE_BUILDING && activeKey == key
        if (sameKeyBuilding && builds.canReuse(key, source)) {
            switchOnDone = true
            return@withTrackIntent
        }
        val replacingHandoff = builds.blocksCache(key, source?.identity) && !builds.canReuse(key, source)
        val cached = if (sameKeyBuilding || replacingHandoff) null else InstrumentalStore.find(context, key, mode)
        if (cached != null && source != null) {
            cancel()
            val intent = cacheIntent
            activeKey = key
            percent = 100
            state = STATE_READY
            notify?.invoke(state, percent)
            /*
             * 换源判据必须是「此刻播的是不是这一轨」，不能是「在不在分离轨」。
             *
             * isOnInstrumental() 只是个布尔：伴奏和清唱都算 true。于是从「只留人声」
             * 切到「关闭人声」时，`!isOnInstrumental()` 为 false，换源被短路 —— 播放器
             * 还停在清唱轨上，状态和界面却已经是伴奏，听起来就是「切过去没声音」。
             * currentUrl() 是上一次 prepare/swapSource 真正装进去的地址，天然区分
             * 原曲 / 伴奏 / 清唱三轨：跟目标文件不一样就切，一样就不动（避免轮询
             * 每次 reconcile 都重新 prepare 一遍）。
             */
            val target = Uri.fromFile(cached).toString()
            player.swapSourceIfCurrent(source, instrumental = true, authorize = { commit ->
                withTrackIntent {
                    if (cacheIntent == intent && NativeEqualizerState.activeMode() == mode) commit(target)
                }
            })
            return@withTrackIntent
        }
        startBuild(context, player, url, key, source, wantSwitch = true)
    }

    /**
     * 提前分析：把这首歌的两轨伴奏都备好，**不换源**。
     *
     * 这是「下次拨开关秒开」的关键 —— 用户还在听原曲时后台就把活干完了。
     * 与 [reconcile] 共用同一条 worker：仅已经绑定同一个装源请求的任务才能接管。
     * 队列预取没有 owner，期间拨开关时重新发起，不把正在生成的结果授权给另一音源。
     */
    fun prebuild(context: Context, url: String?, songKey: String?, player: FoliaNativePlayer? = null) = withTrackIntent {
        discardRevokedBuild()
        if (url.isNullOrBlank()) return@withTrackIntent
        val key = InstrumentalStore.keyFor(url, songKey)
        builds.schedulePrebuild(state == STATE_BUILDING, alreadyReady = { builds.blocksCache(key, AudioSourceIdentity.from(url, songKey)) || InstrumentalStore.bothReady(context, key) }) {
            startBuild(context, player, url, key, player?.requestedAudioSource(url, songKey), wantSwitch = false)
        }
    }

    /** 换歌时调用：旧任务作废。 */
    fun cancel(clearCache: Boolean = false) = withTrackIntent {
        ++cacheIntent
        builds.cancel(clearCache)
        buildPermit = null
        switchOnDone = false
        if (state == STATE_BUILDING) {
            state = STATE_IDLE
            percent = 0
        }
    }

    private fun startBuild(
        context: Context,
        player: FoliaNativePlayer?,
        url: String,
        key: String,
        source: AudioSourceLoads.Ticket?,
        wantSwitch: Boolean,
    ) {
        val permit = NativeInferenceGate.process.acquire() ?: return
        buildPermit = permit
        switchOnDone = wantSwitch
        val job = builds.begin(key, source, permit::isCurrent)
        state = STATE_BUILDING
        percent = 0
        activeKey = key
        notify?.invoke(state, percent)
        val appContext = context.applicationContext
        fun isCurrent() = permit.isCurrent() && builds.isCurrent(job)
        worker.execute {
            if (!isCurrent()) return@execute
            val tracks = try {
                InstrumentalBuilder.build(
                    appContext,
                    url,
                    key,
                    onProgress = { value ->
                        withTrackIntent {
                            if (isCurrent()) {
                                percent = value
                                notify?.invoke(state, percent)
                            }
                        }
                    },
                    permit = permit,
                    cancelled = { !isCurrent() },
                    publish = { commit ->
                        withTrackIntent { permit.commit { builds.isCurrent(job) && commit() } }
                    },
                    /*
                     * 用户拨着开关等结果的那一趟（reconcile）算 eager：播放中的
                     * 让路比例降一档，尽快出活。预生成那趟（prebuild）保持默认，
                     * 时间片尽量还给正在放的歌 —— 不然就是「负载太大，卡到
                     * 歌词对不上曲子」。
                     */
                    eager = wantSwitch,
                )
            } catch (error: Throwable) {
                Log.w(TAG, "生成伴奏异常", error)
                null
            }
            var selected: VocalTrackMode? = null
            withTrackIntent {
                permit.commit {
                    if (!builds.isCurrent(job)) return@commit false
                    if (tracks == null) {
                        state = STATE_FAILED
                        percent = 0
                        InstrumentalStore.drop(appContext, key)
                        if (switchOnDone && source != null && player != null &&
                            player.isRequestedAudioSource(source) && NativeEqualizerState.activeMode() != null
                        ) {
                            NativeEqualizerState.setVocalTrackMode(FoliaSettingsStore.get(appContext), null)
                        }
                    } else {
                        state = STATE_READY
                        percent = 100
                        activeKey = key
                        selected = NativeEqualizerState.activeMode().takeIf { switchOnDone }
                        builds.markReady(job, willSwitch = selected != null && player != null && source != null)
                    }
                    switchOnDone = false
                    notify?.invoke(state, percent)
                    true
                }
            }
            if (tracks == null) return@execute
            val wanted = if (selected == VocalTrackMode.VOCAL) tracks.vocal else tracks.instrumental
            if (permit.isCurrent()) InstrumentalStore.trim(appContext, keep = wanted)
            val modeToSwap = selected ?: return@execute
            if (player == null || source == null) return@execute
            player.swapSourceIfCurrent(
                source, instrumental = true,
                authorize = { commit ->
                    builds.commit(job, modeToSwap, NativeEqualizerState::activeMode) {
                        permit.commit {
                            commit(Uri.fromFile(wanted).toString())
                            true
                        }
                    }
                },
                finished = { builds.finishHandoff(job) { player.isRequestedAudioSource(source) } },
            )
        }
    }

    private fun queueOriginal(player: FoliaNativePlayer, current: AudioSourceLoads.Installed) {
        player.swapSourceIfCurrent(current.ticket, instrumental = false, authorize = { commit ->
            withTrackIntent {
                if (NativeEqualizerState.activeMode() == null) commit(current.source.baseUrl)
            }
        })
    }

    fun sweep(context: Context) {
        InstrumentalStore.sweep(context)
        InstrumentalStore.trim(context)
    }

    /**
     * 「删除人声分离缓存」：作废在跑的生成、把状态归零、删掉两轨文件、重算用量。
     *
     * 必须先 cancel()：不清掉 generation，正在跑的那趟几十秒后会把刚删掉的
     * 文件重新写回来，界面上就是「删了又自己长出来」。
     */
    fun clear(context: Context, player: FoliaNativePlayer?) = withTrackIntent {
        discardRevokedBuild()
        val current = player?.requestedAudioSource()
        if (player != null && current != null) queueOriginal(player, current)
        cancel(clearCache = true)
        state = STATE_IDLE
        percent = 0
        activeKey = null
        switchOnDone = false
        InstrumentalStore.clearAll(context)
        notify?.invoke(state, percent)
        Unit
    }

    const val STATE_IDLE = "idle"
    const val STATE_BUILDING = "building"
    const val STATE_READY = "ready"
    const val STATE_FAILED = "failed"
}
