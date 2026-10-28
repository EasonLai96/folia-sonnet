package top.izuna.foliamajor.wallpaper

/**
 * 群唱（Cappella）自定义头像 / 表情图在原生这一侧的暂存。
 *
 * 为什么需要它：叠层是**另一个 WebView**（https://localhost），里头的 IndexedDB 与主
 * 应用不是同一份 —— 用户上传的头像 / 表情包在 App 里存的是 IndexedDB 里的 blob，
 * 叠层那边一张都读不到。于是 `avatarSource === 'custom'` 但列表是空的，Cappella
 * 按「没有自定义头像」回退到封面 —— 用户看到的正是「群唱自定义头像显示的是封面」。
 *
 * 所以主 App 把图解析成 data URL（与 OBS 浏览器源同一条解析路径）之后推给这里，
 * 由叠层在推状态时单独发一条消息带下去。
 *
 * 只存不落盘：这些图本来就是从 IndexedDB 现解出来的，App 重新 publish 一次就会再推。
 * 存盘还会让「用户删掉图之后重启」照样显示旧图。
 */
object WallpaperCappellaImages {

    /** 一组 JSON 数组字符串（[{id,name,url}]）。url 是 data URL，体积可能上百 KB。 */
    @Volatile
    private var avatarsJson: String = "[]"

    @Volatile
    private var emojisJson: String = "[]"

    /**
     * 每次 set 都会 +1。
     *
     * 叠层那边靠它判「这一份图推过没有」—— 图本身是几百 KB 的 base64，不能塞进整包
     * 的签名里，也不该每 250ms 重推一次。
     */
    @Volatile
    private var revision: Int = 0

    fun set(avatars: String?, emojis: String?) {
        val nextAvatars = avatars ?: "[]"
        val nextEmojis = emojis ?: "[]"
        if (nextAvatars == avatarsJson && nextEmojis == emojisJson) {
            return
        }
        avatarsJson = nextAvatars
        emojisJson = nextEmojis
        revision += 1
    }

    fun avatars(): String = avatarsJson

    fun emojis(): String = emojisJson

    fun revision(): Int = revision
}
