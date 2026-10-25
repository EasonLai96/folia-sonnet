package top.izuna.foliamajor;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 汽水音乐（FoliaQishui）的原生桥。
 *
 * 与 FoliaNative 那种「代发一次 HTTP」的插件不同：汽水的签名必须由官方 bdms.js 在一个
 * 真的页面里算，所以这里做的只是把 operation 递给 {@link QishuiSignHost} 里那个隐藏
 * WebView，再把页面算出来的结果原样带回去 —— 信封与桌面端
 * electron/qishuiApiBridge.cjs 完全一致，渲染层两边不用分叉。
 *
 * 插件方法一律不阻塞：request() 只是发一个 evaluateJavascript，结果由页面的回调带回。
 * 桥线程一旦被占住，其它平台的登录与二维码会集体超时（见 FoliaNativePlugin 那条教训）。
 */
@CapacitorPlugin(name = "FoliaQishui")
public class FoliaQishuiPlugin extends Plugin {
    private static final String TAG = "FoliaQishui";

    /** 宿主建起来最多等这么久；等不到就明确报 unavailable，别让界面一直转圈。 */
    private static final long READY_TIMEOUT_MS = 25000;

    private QishuiSignHost host;

    private QishuiSignHost host() {
        if (host == null) {
            android.app.Activity activity = getActivity();
            if (!(activity instanceof MainActivity)) {
                Log.w(TAG, "activity is not MainActivity; the signing host cannot start");
                return null;
            }
            host = new QishuiSignHost((MainActivity) activity);
            // 播放服务（原生兜底切歌）要过这座宿主拿取流地址与歌词；它够不到
            // 插件实例，注册到静态桥上（dispose 时注销）。
            QishuiGatewayBridge.registerHost(host);
        }
        return host;
    }

    @PluginMethod
    public void request(PluginCall call) {
        final String operation = call.getString("operation");
        if (operation == null || operation.isEmpty()) {
            call.reject("operation is required");
            return;
        }
        // 前端传的是字符串（见 foliaNative.ts 的说明）；保留 getObject 分支是为了
        // 兼容任何还在传对象的调用方（Capacitor 的嵌套对象转换个别版本会丢内层）。
        String paramsJson = call.getString("params", "");
        if (paramsJson == null || paramsJson.isEmpty()) {
            JSObject params = call.getObject("params", null);
            paramsJson = params != null ? params.toString() : "{}";
        }
        final String resolvedParamsJson = paramsJson;

        final QishuiSignHost signHost = host();
        if (signHost == null) {
            call.resolve(failure("unavailable", "Qishui signing host is unavailable"));
            return;
        }
        // 需要参数的 operation 收到空 params 时立刻失败：往页面走只会得到一句
        // 「token 缺失」，看不出是过桥丢了还是本来就没传。
        if (("{}".equals(resolvedParamsJson) || resolvedParamsJson.isEmpty())
                && ("login.check".equals(operation) || "search".equals(operation))) {
            call.resolve(failure("params-missing", "Qishui operation " + operation + " requires params"));
            return;
        }
        signHost.ensureStarted();
        // 保留这次调用：结果要等页面算完才回来，方法必须立刻返回。
        call.setKeepAlive(true);
        final PluginCall pendingCall = call;
        waitForReady(signHost, 0, () -> signHost.request(operation, resolvedParamsJson, json -> {
            try {
                pendingCall.resolve(new JSObject(json));
            } catch (Exception error) {
                pendingCall.resolve(failure("invalid-response", "Qishui host returned a malformed envelope"));
            }
            // 不需要手动释放 keepAlive：resolve() 自己会清掉 saved 标记
            // （这个 Capacitor 版本的 PluginCall 没有 releaseKeepAlive()）。
        }));
    }

    @PluginMethod
    public void status(PluginCall call) {
        QishuiSignHost signHost = host();
        JSObject result = new JSObject();
        if (signHost == null) {
            result.put("ready", false);
            result.put("reason", "unavailable");
            call.resolve(result);
            return;
        }
        result.put("ready", signHost.isReady());
        if (signHost.getFailureReason() != null) result.put("reason", signHost.getFailureReason());
        call.resolve(result);
    }

    @PluginMethod
    public void dispose(PluginCall call) {
        if (host != null) {
            QishuiGatewayBridge.unregisterHost(host);
            host.dispose();
            host = null;
        }
        JSObject result = new JSObject();
        result.put("disposed", true);
        call.resolve(result);
    }

    /** 宿主是异步加载的：没准备好就隔 200ms 再看，超时就报 unavailable。 */
    private void waitForReady(QishuiSignHost signHost, long waitedMs, Runnable onReady) {
        if (signHost.isReady()) {
            onReady.run();
            return;
        }
        if (signHost.getFailureReason() != null) {
            onReady.run();
            return;
        }
        if (waitedMs >= READY_TIMEOUT_MS) {
            onReady.run();
            return;
        }
        final long next = waitedMs + 200;
        getActivity().runOnUiThread(() -> waitForReady(signHost, next, onReady));
    }

    private static JSObject failure(String code, String message) {
        JSObject result = new JSObject();
        result.put("ok", false);
        JSObject error = new JSObject();
        error.put("code", code);
        error.put("message", message);
        try {
            result.put("error", error);
        } catch (Exception ignored) {
        }
        return result;
    }
}
