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

        @JvmStatic
        fun apply(activity: Activity?) {
            if (activity == null) return
            /*
             * 只有「强制横屏」这一条会锁方向；关掉就是交回系统，不再有中间那道总开关。
             *
             * SENSOR_LANDSCAPE 而不是 LANDSCAPE：前者允许 180° 转向（手机倒过来拿，
             * 屏幕跟着倒），后者会把它钉死在某一个方向。
             */
            activity.setRequestedOrientation(
                if (MODE_LANDSCAPE == getOrientation(activity))
                    ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                else
                    ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            )
        }

        private fun normalize(value: String?): String {
            return if (MODE_LANDSCAPE == value) MODE_LANDSCAPE else MODE_PORTRAIT
        }
    }
}
