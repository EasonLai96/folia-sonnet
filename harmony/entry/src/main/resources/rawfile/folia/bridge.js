/**
 * Folia 鸿蒙桥接层。
 *
 * 这个文件在 index.html 的 <head> 最前面被同步脚本插入，是页面里**第一个**执行的脚本，
 * 所以它能决定后面整包前端代码看到的世界长什么样。
 *
 * 它做两件事：
 *
 * 1. 复刻 Capacitor Android 的原生桥协议。
 *    打包好的前端里全是 `Capacitor.isNativePlatform()` / `registerPlugin('FoliaNative')`，
 *    而这些判定的落点是 `window.androidBridge` 与 `Capacitor.PluginHeaders` ——
 *    把这两个补上，前端就会认为自己跑在安卓原生壳里，从而走原生 HTTP 那条路
 *    （在线音乐的接口没有一个带跨域头，网页里直接 fetch 是必然失败的）。
 *    插件方法最终由 `Capacitor.nativePromise` 转到这里，再交给 ArkTS 的 FoliaHarmonyNative。
 *
 * 2. 把安全区内缩写成 CSS 变量 `--folia-safe-area-*`，与安卓侧那套同名。
 */
(function () {
  if (window.__foliaHarmonyInstalled) {
    return;
  }
  window.__foliaHarmonyInstalled = true;

  var native = window.FoliaHarmonyNative || null;
  var seq = 0;
  var pending = {};
  var listeners = {};
  var safeArea = { top: 0, bottom: 0, left: 0, right: 0 };

  /** 网页 → 原生。原生那边是异步的，结果由 runJavaScript 回灌。 */
  function call(op, payload) {
    if (!native) {
      return Promise.reject(new Error('Folia 鸿蒙原生桥未挂载：' + op));
    }
    var id = ++seq;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      try {
        native.call(id, op, JSON.stringify(payload === undefined ? {} : payload));
      } catch (error) {
        delete pending[id];
        reject(error);
      }
    });
  }

  function unwrap(raw) {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  /** 原生 → 网页：一次调用的结算。 */
  function settle(raw) {
    var message = unwrap(raw);
    var entry = pending[message.id];
    if (!entry) {
      return;
    }
    delete pending[message.id];
    if (message.ok) {
      entry.resolve(message.data === undefined ? null : message.data);
      return;
    }
    var error = new Error(message.error || '原生调用失败');
    error.code = 'UNIMPLEMENTED';
    entry.reject(error);
  }

  function onNativeEvent(raw) {
    var message = unwrap(raw);
    var name = message.event;
    var data = message.data;
    if (name === 'safeArea') {
      applySafeArea(data);
    }
    var handlers = listeners[name] || [];
    handlers.forEach(function (handler) {
      try {
        handler(data);
      } catch (error) {
        console.error('[folia] 原生事件处理出错', error);
      }
    });
    try {
      window.dispatchEvent(new CustomEvent('folia:native-' + name, { detail: data }));
    } catch (error) {
      // CustomEvent 在极老的 WebView 里可能不可用，事件只是锦上添花。
    }
  }

  /** 与安卓侧同名同单位（CSS px）：页面里已有的避让样式可以直接复用。 */
  function applySafeArea(insets) {
    if (!insets) {
      return;
    }
    safeArea = {
      top: Number(insets.top) || 0,
      bottom: Number(insets.bottom) || 0,
      left: Number(insets.left) || 0,
      right: Number(insets.right) || 0,
    };
    var root = document.documentElement;
    if (!root) {
      return;
    }
    Object.keys(safeArea).forEach(function (side) {
      root.style.setProperty('--folia-safe-area-' + side, safeArea[side] + 'px');
    });
  }

  /**
   * 对外声明的插件方法清单。
   *
   * 不在清单里的能力（壁纸、Lyricon 状态栏歌词、ColorOS 歌词、应用内更新）
   * 一律不声明 —— 前端会因为 `isPluginAvailable` 为假而跳过它们，
   * 比「声明了但调用时报错」要干净。
   */
  var PLUGIN_METHODS = {
    FoliaNative: [
      'httpRequest',
      'exitApp',
      'moveToBackground',
      'setImmersive',
      'setScreenAwake',
      'downloadUpdate',
      'installUpdate',
      'addListener',
      'removeListener'
    ],
    FoliaPlayback: ['update', 'setState', 'stop', 'addListener', 'removeListener']
  };

  var pluginHeaders = Object.keys(PLUGIN_METHODS).map(function (name) {
    return {
      name: name,
      methods: PLUGIN_METHODS[name].map(function (method) {
        return { name: method, rtype: 'promise' };
      })
    };
  });

  // Capacitor 靠它判定「这是安卓原生壳」，随后 getPlatform() 才会返回 android。
  if (!window.androidBridge) {
    window.androidBridge = { postMessage: function () {} };
  }

  var capacitor = window.Capacitor || {};
  capacitor.Plugins = capacitor.Plugins || {};
  capacitor.PluginHeaders = pluginHeaders;
  capacitor.nativePromise = function (pluginId, methodName, options) {
    return call(pluginId + '.' + methodName, options || {});
  };
  capacitor.nativeCallback = function (pluginId, methodName) {
    throw new Error(pluginId + '.' + methodName + '：鸿蒙壳不支持回调式插件');
  };
  capacitor.triggerEvent = function () {};
  capacitor.convertFileSrc = capacitor.convertFileSrc || function (url) {
    return url;
  };
  window.Capacitor = capacitor;

  // 原生回灌用的入口，名字与 ArkTS 里拼的字符串一致，改一处要改两处。
  window.__foliaHarmony = {
    settle: settle,
    onNativeEvent: onNativeEvent
  };

  window.FoliaHarmony = {
    isNative: true,
    platform: 'harmony',
    call: call,
    getSafeArea: function () {
      return safeArea;
    },
    on: function (name, handler) {
      if (!listeners[name]) {
        listeners[name] = [];
      }
      listeners[name].push(handler);
      return function () {
        listeners[name] = (listeners[name] || []).filter(function (item) {
          return item !== handler;
        });
      };
    }
  };

  // 启动阶段那次推送可能早于本脚本执行，主动要一次。
  call('system.getSafeArea', {}).then(applySafeArea).catch(function () {});
})();
