// 当前文件：鸿蒙壳的常量。改这里等于改「网页从哪儿来、原生怎么被叫到」。

export class FoliaConfig {
  /**
   * 网页运行的源。
   *
   * 必须是 http(s)：ES module、fetch、crypto.subtle 这些在 file:// 下会被浏览器拦掉，
   * 而 rawfile 里的页面如果直接用 $rawfile 加载，子资源走的就是 resource:// 那套路径。
   * 所以这里刻意用一个**不存在**的域名，全部请求在 onInterceptRequest 里被本地吃掉，
   * 页面拿到的依然是一个正常的 https 源。
   */
  static readonly ORIGIN: string = 'https://folia.local';

  /** WebView 首屏要加载的地址。 */
  static readonly ENTRY_URL: string = FoliaConfig.ORIGIN + '/index.html';

  /** 前端构建产物在 rawfile 里的目录（由 scripts/sync-web.mjs 同步过来）。 */
  static readonly RAWFILE_WEB_DIR: string = 'web';

  /** 桥接脚本对网页暴露的路径 —— 刻意放在 /__folia/ 下，避免和产物里的文件重名。 */
  static readonly BRIDGE_PATH: string = '/__folia/bridge.js';

  /** 桥接脚本在 rawfile 里的真实位置（不在 web/ 里，重新同步产物不会把它删掉）。 */
  static readonly BRIDGE_RAWFILE: string = 'folia/bridge.js';

  /** 启动页停留时长，与 Capacitor 的 launchShowDuration 对齐。 */
  static readonly SPLASH_DURATION_MS: number = 900;

  /** 网页背景色，避免首帧闪白。 */
  static readonly BACKGROUND: string = '#09090B';
}
