package top.izuna.foliamajor

import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.ActivityInfo

/**
 * 「强制横屏」的方向锁。
 *
 * 只认方向本身：横屏就把 Activity 锁成横屏，其它一律交回系统（UNSPECIFIED，
 * 跟着传感器转）。
 *
 * **不再看「手机布局」那个总开关** —— 那个开关已经从设置里删掉了，而正是这道门
 * 让「横竖屏兼容」那一行单独打开时毫无反应（用户原话「打开也不生效」）：
 * `isEnabled()` 默认是 false，方向锁于是永远走 UNSPECIFIED 那一支。
 */
class PhoneLayoutOrientation private constructor() {

    companion object {
        private const val PREFS_NAME = "folia_native_prefs"
        private const val KEY_ENABLED = "phone_fit_enabled"
        private const val KEY_ORIENTATION = "phone_fit_orientation"
        private const val MODE_PORTRAIT = "portrait"
        private const val MODE_LANDSCAPE = "landscape"

        private fun prefs(context: Context?): SharedPreferences? {
            if (context == null) return null
            return context.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }

        @JvmStatic
        fun isEnabled(context: Context?): Boolean {
            val prefs = prefs(context) ?: return false
            return prefs.getBoolean(KEY_ENABLED, false)
        }

        @JvmStatic
        fun getOrientation(context: Context?): String {
            return normalize(prefs(context)?.getString(KEY_ORIENTATION, MODE_PORTRAIT))
        }

        @JvmStatic
        fun update(context: Context?, enabled: Boolean, orientation: String?) {
            val prefs = prefs(context) ?: return
            prefs.edit()
                .putBoolean(KEY_ENABLED, enabled)
                .putString(KEY_ORIENTATION, normalize(orientation))
                .apply()
        }

        /**
         * 按当前状态定屏幕方向。
         *
         * 两条规则，**自动横屏优先**：
         *   · 「进入可视化自动横屏」开着、且当前在播放页 → 锁横屏，不看设备方向；
         *   · 否则按用户选的「强制横屏」——横屏就锁横屏，其它交回系统。
         *
         * 自动横屏为什么优先：它的语义就是「进播放页直接横屏」，用户开它是为了躺着看可视化，
         * 此时手机多半是竖着的。如果还让「强制横屏那个开关也必须是开」或「落盘方向必须是
         * 竖屏」来参与判断，开关就等于没开 —— 之前那版正是这么写的，真机上「没有用」。
         *
         * 判定放在原生而不是前台：前台被冻结时不能替它决定；而且一处判定，不会出现
         * 「进来那一刻前台还没算完，于是没转」这种时序问题。
         */
        @JvmStatic
        fun apply(activity: Activity?) {
            if (activity == null) return
            activity.setRequestedOrientation(resolve(activity))
        }

        /** 当前是否在播放页（可视化）。由 Web 上报「我进了哪一页」，原生据此决定要不要转。 */
        @Volatile
        private var playerVisible = false

        @JvmStatic
        fun setPlayerVisible(visible: Boolean) {
            playerVisible = visible
        }

        /** 当前该用的方向。抽出来是为了能在单测里直接钉住判定，不必起 Activity。 */
        @JvmStatic
        fun resolve(context: Context?): Int {
            val settings = top.izuna.foliamajor.settings.FoliaSettingsStore.get(
                context ?: return ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            ).snapshot()
            /*
             * SENSOR_LANDSCAPE 而不是 LANDSCAPE：前者允许 180° 转向（手机倒过来拿，
             * 屏幕跟着倒），后者会把它钉死在某一个方向。
             */
            if (playerVisible && settings.optBoolean("autoLandscapeForVisualizer", false)) {
                return ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            }
            return if (MODE_LANDSCAPE == getOrientation(context))
                ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            else
                ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }

        private fun normalize(value: String?): String {
            return if (MODE_LANDSCAPE == value) MODE_LANDSCAPE else MODE_PORTRAIT
        }
    }
}
