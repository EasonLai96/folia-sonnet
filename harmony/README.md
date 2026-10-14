# Folia HarmonyOS 版

把 [folia-sonnet](https://github.com/maimai993/folia-sonnet) 的前端产物（`dist/`）装进鸿蒙 NEXT（HarmonyOS 6）原生壳，
参考 [HarmonyOS6-WebView-Shell](https://github.com/ZhaoYuLiOfficial/HarmonyOS6-WebView-Shell) 的套壳结构，
并针对 Folia 的实际情况补了三件模板里没有的事：**本地产物以 https 源提供**、**Capacitor 原生桥协议复刻**、**安全区回传给网页**。

> 定位：这是**外壳工程**，不是重写。页面仍然是那一份 React 前端，原生只做「网页做不了」的部分。

---

## 一、三个关键设计

### 1. 产物不是 `$rawfile` 直接加载，而是拦截出来的 https 站

直接 `Web({ src: $rawfile('index.html') })` 会让子资源走 `resource://` 路径，
ES module 与 `fetch` 在这种源下会被浏览器拦掉，页面根本起不来。

所以这里用一个**不存在的域名** `https://folia.local` 作为页面源，
所有请求在 `onInterceptRequest` 里被 `LocalAssetServer` 从 rawfile 吃掉：

```
https://folia.local/index.html      →  rawfile/web/index.html
https://folia.local/assets/xxx.js   →  rawfile/web/assets/xxx.js
https://folia.local/__folia/bridge.js → rawfile/folia/bridge.js（桥接脚本，不在产物目录里）
https://其它域名/*                   →  返回 null，系统正常发网络请求
```

页面拿到的就是一个再正常不过的 https 源：模块化、fetch、crypto.subtle 全部可用。
没后缀的路径回落 `index.html`，SPA 路由照常工作。

### 2. 复刻 Capacitor 的原生桥协议，前端一行不改

打包好的前端判定「我是不是跑在原生壳里」的落点是这两个东西：

- `window.androidBridge` —— 有它，`Capacitor.getPlatform()` 才返回 `android`
- `Capacitor.PluginHeaders` —— 有它，`registerPlugin('FoliaNative')` 拿到的方法才会走 `nativePromise`

`rawfile/folia/bridge.js` 在 `<head>` 最前面执行，把这两个补上，
于是前端会认为自己在安卓原生壳里，从而走**原生 HTTP** 这条路 —— 这一步是必须的：
音乐平台的接口没有一个会带 `Access-Control-Allow-Origin`，网页里直接 fetch 必然失败。

```
前端 Capacitor 插件调用
   → Capacitor.nativePromise('FoliaNative', 'httpRequest', opts)
   → window.FoliaHarmonyNative.call(id, op, json)      // ArkTS 注入对象
   → FoliaHarmonyBridge.execute()                      // 原生实现
   → runJavaScript("__foliaHarmony.settle(...)")       // 结果回灌
```

**目前声明的插件方法**（没声明的能力前端会直接跳过，比调了再报错干净）：

| 插件 | 方法 | 实现 |
|---|---|---|
| `FoliaNative` | `httpRequest` | ✅ 走 `@kit.NetworkKit`，绕开 CORS，附带简易 cookie 罐 |
| `FoliaNative` | `exitApp` / `moveToBackground` | ✅ |
| `FoliaNative` | `setImmersive` / `setScreenAwake` | ✅ 系统栏显隐、屏幕常亮 |
| `FoliaNative` | `addListener` / `removeListener` | ✅ 只登记，暂无原生事件 |
| `FoliaPlayback` | `update` / `setState` / `stop` / `addListener` | ⚪ 成功但什么都不做（通知栏还没做） |

### 3. 安全区沿用安卓那套变量名

`EntryAbility` 量出 avoidArea（px）换算成 vp 后推给网页，
`bridge.js` 写成 CSS 变量，与安卓侧同名同单位：

```css
--folia-safe-area-top / -bottom / -left / -right
```

页面里已有的避让样式可以直接复用。窗口是边到边布局（`setWindowLayoutFullScreen`），
让位完全交给网页，和安卓 targetSdk 36 强制边到边之后的处理思路一致。

---

## 二、目录结构

```
harmony/                            ← 本工程，位于 folia-sonnet 仓库根目录下
├── AppScope/                      应用级配置 + 分层图标
├── entry/src/main/
│   ├── ets/
│   │   ├── entryability/EntryAbility.ets   入口：边到边、系统栏配色、安全区测量
│   │   ├── pages/Splash.ets                启动页（900ms，与 Capacitor 对齐）
│   │   ├── pages/Index.ets                 WebView 主页：拦截、桥接、返回键、失败重试
│   │   ├── asset/LocalAssetServer.ets      rawfile → https 响应（含 MIME / SPA 回落 / 小文件缓存）
│   │   ├── bridge/FoliaNativeBridge.ets    原生能力分派
│   │   ├── bridge/NativeHttp.ets           原生 HTTP + cookie 罐
│   │   └── common/                         常量与进程内单例
│   ├── module.json5               权限声明
│   └── resources/rawfile/
│       ├── folia/bridge.js        桥接脚本（手写，别放进 web/）
│       └── web/                   前端产物（同步生成，已 gitignore）
└── scripts/sync-web.mjs           把 dist 同步进 rawfile 并注入桥接脚本
```

---

## 三、构建步骤

前置：DevEco Studio 5.0+（建议 6.0.2），HarmonyOS SDK，真机或模拟器。

```bash
# 1. 先在仓库根出前端产物
cd D:/folia/folia-sonnet
npm run build

# 2. 同步进鸿蒙工程（每次改前端都要重跑）
cd D:/folia/folia-sonnet/harmony
node scripts/sync-web.mjs

# 可选：顺手清掉产物里已经不存在的旧文件
node scripts/sync-web.mjs --prune
```

然后用 DevEco Studio 打开 `D:/folia/folia-sonnet/harmony`（注意打开的是**子目录**，不是仓库根）：

1. **File > Project Structure > Signing Configs** 勾上自动签名（工程里刻意没提交任何证书路径）
2. 连真机，Run
3. 出包：`Build > Build Hap(s)/APP(s) > Build APP(s)`，装包用 `hdc install xxx.hap`

改图标：替换 `AppScope/resources/base/media/` 与 `entry/src/main/resources/base/media/` 下的
`foreground.png`（前景）、`background.png`（背景）、`startIcon.png`（启动页图标）。
现在这几张是从仓库的 `android/app/src/main/res/mipmap-xxxhdpi/` 直接搬过来的，与安卓版同源。

---

## 四、能力对照

| 能力 | 状态 | 说明 |
|---|---|---|
| 在线音乐（网易云 / QQ / 酷狗 / 波点） | ✅ | 走原生 HTTP，绕开 CORS；登录态靠进程内 cookie 罐 |
| 播放 | ✅ | WebView 内播放，已放开自动播（`mediaPlayGestureAccess(false)`） |
| 后台播放 | ⚠️ | 已声明 `KEEP_BACKGROUND_RUNNING`，但没有前台服务，实际能撑多久取决于系统调度 |
| 通知栏媒体控制 | ❌ | `FoliaPlayback.*` 目前是空实现 |
| 本地音乐 | ❌ | 安卓走 MediaStore 原生扫描，鸿蒙侧还没做（界面上「本地」页签不要指望） |
| 歌词壁纸 / Lyricon 状态栏歌词 / ColorOS 歌词 | ❌ | 安卓专属原生服务，未声明插件，前端会自动跳过 |
| 应用内更新 | ❌ | 用应用市场更新 |
| 相册选图（`<input type=file>`） | ✅ | `onShowFileSelector` → 系统 PhotoViewPicker |
| 沉浸式（歌词页隐藏系统栏） | ✅ | `FoliaNative.setImmersive` |
| 返回键 | ✅ | 网页内历史后退；到顶后双击退出 |

---

## 五、排查

- **白屏**：看 `index.html` 里有没有被注入 `<script src="/__folia/bridge.js">`（同步脚本会做，
  手动改过产物就再跑一次 `sync-web.mjs`）；再看 rawfile/web 里是否有 `assets/`。
- **模块加载失败 / `Failed to fetch`**：确认页面地址是 `https://folia.local` 而不是 `file://` 或 `resource://`。
- **能进界面但搜不到歌**：说明原生 HTTP 没生效。看 LogCat 里 `FoliaBridge` 标签有没有 `op failed`，
  以及 `FoliaHttp` 的 `request failed`。
- **登录后一退出就没了**：cookie 罐只在内存里，重进应用拉的是本地账号快照，这是已知限制。
- **酷狗请求被拦**：页面是 https 源、接口是 http，已开 `MixedMode.All`；若仍被拦，检查系统网络策略。

日志标签：`FoliaAbility`（入口/安全区）、`FoliaAsset`（资源）、`FoliaBridge`（原生能力）、`FoliaHttp`（网络）。

---

## 六、License

与 folia-sonnet 保持一致。图标与启动图沿用 folia-sonnet 的安卓资源。
