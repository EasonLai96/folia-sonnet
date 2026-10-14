import { hilog } from '@kit.PerformanceAnalysisKit';
import { common } from '@kit.AbilityKit';
import { FoliaConfig } from '../common/FoliaConfig';
import { FoliaRuntime } from '../common/FoliaRuntime';

// 当前文件：把 rawfile 里的前端产物当作一个 https 站点喂给 WebView。
//
// 为什么不直接 $rawfile('index.html')：那样子资源会走 resource:// 路径，
// ES module 与 fetch 在这种源下会被浏览器拦掉（CORS / scheme 限制），页面根本起不来。
// 用「假域名 + 请求拦截」，页面看到的就是一个再正常不过的 https 源。

const DOMAIN = 0xF01A;
const TAG: string = 'FoliaAsset';

/** 单个文件超过这个体积就不进内存缓存（封面、字体、音频都走磁盘重读）。 */
const CACHE_FILE_LIMIT: number = 512 * 1024;
/** 缓存总量上限。 */
const CACHE_TOTAL_LIMIT: number = 16 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  'html': 'text/html',
  'htm': 'text/html',
  'js': 'text/javascript',
  'mjs': 'text/javascript',
  'cjs': 'text/javascript',
  'css': 'text/css',
  'json': 'application/json',
  'map': 'application/json',
  'svg': 'image/svg+xml',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'avif': 'image/avif',
  'ico': 'image/x-icon',
  'bmp': 'image/bmp',
  'woff': 'font/woff',
  'woff2': 'font/woff2',
  'ttf': 'font/ttf',
  'otf': 'font/otf',
  'mp3': 'audio/mpeg',
  'm4a': 'audio/mp4',
  'flac': 'audio/flac',
  'wav': 'audio/wav',
  'ogg': 'audio/ogg',
  'mp4': 'video/mp4',
  'webm': 'video/webm',
  'wasm': 'application/wasm',
  'txt': 'text/plain',
  'xml': 'application/xml',
  'lrc': 'text/plain',
};

export class LocalAssetServer {
  private cache: Map<string, ArrayBuffer> = new Map();
  private cacheBytes: number = 0;

  /**
   * @param url 完整请求地址。
   * @returns 本地能给出内容时返回响应；不是本站的请求返回 null 交给系统正常发网络请求。
   */
  handle(url: string): WebResourceResponse | null {
    if (!url.startsWith(FoliaConfig.ORIGIN)) {
      return null;
    }
    const rawPath: string = this.toRawFilePath(url);
    const bytes: ArrayBuffer | undefined = this.readAsset(rawPath);
    if (!bytes) {
      return this.notFound(url);
    }
    const mime: string = mimeOf(rawPath);
    const response: WebResourceResponse = new WebResourceResponse();
    response.setResponseMimeType(mime);
    response.setResponseCode(200);
    response.setReasonMessage('OK');
    response.setResponseHeader([
      { headerKey: 'Access-Control-Allow-Origin', headerValue: '*' },
      { headerKey: 'Cache-Control', headerValue: 'no-cache' },
    ]);
    if (isTextMime(mime)) {
      response.setResponseEncoding('utf-8');
    }
    response.setResponseData(bytes);
    return response;
  }

  /** 请求地址 → rawfile 里的相对路径；缺文件且不像静态资源时回落 index.html（SPA 路由）。 */
  private toRawFilePath(url: string): string {
    let path: string = url.substring(FoliaConfig.ORIGIN.length);
    const queryIndex: number = path.indexOf('?');
    if (queryIndex >= 0) {
      path = path.substring(0, queryIndex);
    }
    const hashIndex: number = path.indexOf('#');
    if (hashIndex >= 0) {
      path = path.substring(0, hashIndex);
    }
    if (path.length === 0 || path === '/') {
      return 'index.html';
    }
    if (path.startsWith('/')) {
      path = path.substring(1);
    }
    // 桥接脚本不在产物目录里，单独从 folia/ 下取，重新同步产物不会把它一起删掉。
    if (path === '__folia/bridge.js') {
      return FoliaConfig.BRIDGE_RAWFILE;
    }
    const lastSegment: string = path.substring(path.lastIndexOf('/') + 1);
    const looksLikeFile: boolean = lastSegment.indexOf('.') > 0;
    const candidate: string = FoliaConfig.RAWFILE_WEB_DIR + '/' + path;
    if (looksLikeFile && this.exists(candidate)) {
      return candidate;
    }
    if (!looksLikeFile) {
      return FoliaConfig.RAWFILE_WEB_DIR + '/index.html';
    }
    return candidate;
  }

  private exists(rawPath: string): boolean {
    const context: common.UIAbilityContext | undefined = FoliaRuntime.get().getContext();
    if (!context) {
      return false;
    }
    try {
      context.resourceManager.getRawFileContentSync(rawPath);
      return true;
    } catch (err) {
      return false;
    }
  }

  private readAsset(rawPath: string): ArrayBuffer | undefined {
    const cached: ArrayBuffer | undefined = this.cache.get(rawPath);
    if (cached) {
      return cached;
    }
    const context: common.UIAbilityContext | undefined = FoliaRuntime.get().getContext();
    if (!context) {
      hilog.error(DOMAIN, TAG, 'UIAbilityContext is unavailable');
      return undefined;
    }
    let bytes: Uint8Array;
    try {
      bytes = context.resourceManager.getRawFileContentSync(rawPath);
    } catch (err) {
      hilog.warn(DOMAIN, TAG, 'rawfile miss: %{public}s', rawPath);
      return undefined;
    }
    const buffer: ArrayBuffer = bytes.buffer as ArrayBuffer;
    this.putCache(rawPath, buffer);
    return buffer;
  }

  private putCache(rawPath: string, buffer: ArrayBuffer): void {
    const size: number = buffer.byteLength;
    if (size > CACHE_FILE_LIMIT) {
      return;
    }
    if (this.cacheBytes + size > CACHE_TOTAL_LIMIT) {
      this.cache.clear();
      this.cacheBytes = 0;
    }
    this.cache.set(rawPath, buffer);
    this.cacheBytes += size;
  }

  private notFound(url: string): WebResourceResponse {
    hilog.warn(DOMAIN, TAG, 'asset not found: %{public}s', url);
    const response: WebResourceResponse = new WebResourceResponse();
    response.setResponseMimeType('text/plain');
    response.setResponseCode(404);
    response.setReasonMessage('Not Found');
    response.setResponseEncoding('utf-8');
    response.setResponseData('Not Found');
    return response;
  }
}

function extensionOf(path: string): string {
  const lastSlash: number = path.lastIndexOf('/');
  const lastDot: number = path.lastIndexOf('.');
  if (lastDot <= lastSlash) {
    return '';
  }
  return path.substring(lastDot + 1).toLowerCase();
}

function mimeOf(path: string): string {
  const ext: string = extensionOf(path);
  const mime: string = MIME_TYPES[ext];
  return mime ? mime : 'application/octet-stream';
}

function isTextMime(mime: string): boolean {
  return mime.startsWith('text/')
    || mime === 'application/json'
    || mime === 'application/javascript'
    || mime === 'application/xml'
    || mime === 'image/svg+xml';
}
