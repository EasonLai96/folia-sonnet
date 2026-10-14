import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { hilog } from '@kit.PerformanceAnalysisKit';

// 当前文件：给网页用的原生 HTTP 通道。
//
// 存在的理由只有一个：绕开 WebView 的 CORS。音乐平台的接口（网易云 / QQ / 酷狗 / 波点）
// 没有一个会带上允许 folia.local 的跨域头，网页里直接 fetch 必然失败，
// 安卓上这件事是 OkHttp 干的，鸿蒙上就由这里干。

const DOMAIN = 0xF01A;
const TAG: string = 'FoliaHttp';
const DEFAULT_TIMEOUT_MS: number = 15000;

export interface HttpHeaderEntry {
  name: string;
  value: string;
}

export interface NativeHttpResult {
  status: number;
  headers: Array<HttpHeaderEntry>;
  bodyBase64: string;
}

export interface HttpRequestOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyText: string;
  bodyBase64: string;
  redirect: string;
  timeoutMs: number;
}

/**
 * 极简 cookie 罐。
 *
 * 音乐平台的登录态是 cookie，而鸿蒙的 http 模块每次请求都是独立的、不带 cookie 上下文。
 * 没有这层的话二维码登录拿到的 kw_token / MUSIC_U 下一次请求就没了，等于永远登录不上。
 * 进程内存活即可：重进应用走的是本地已存的账号快照。
 */
class CookieJar {
  private static store: Map<string, Map<string, string>> = new Map();

  static remember(url: string, setCookieValue: string): void {
    const host: string = hostOf(url);
    if (!host) {
      return;
    }
    const pair: string = setCookieValue.split(';')[0].trim();
    const separator: number = pair.indexOf('=');
    if (separator <= 0) {
      return;
    }
    const name: string = pair.substring(0, separator).trim();
    const value: string = pair.substring(separator + 1).trim();
    let jar: Map<string, string> | undefined = CookieJar.store.get(host);
    if (!jar) {
      jar = new Map();
      CookieJar.store.set(host, jar);
    }
    const expired: boolean = /max-age\s*=\s*0/i.test(setCookieValue) || value.length === 0;
    if (expired) {
      jar.delete(name);
      return;
    }
    jar.set(name, value);
  }

  static headerFor(url: string): string {
    const host: string = hostOf(url);
    const jar: Map<string, string> | undefined = CookieJar.store.get(host);
    if (!jar || jar.size === 0) {
      return '';
    }
    const parts: Array<string> = [];
    jar.forEach((value: string, name: string) => {
      parts.push(name + '=' + value);
    });
    return parts.join('; ');
  }
}

function hostOf(url: string): string {
  const withoutScheme: string = url.substring(url.indexOf('://') >= 0 ? url.indexOf('://') + 3 : 0);
  let end: number = withoutScheme.length;
  const slash: number = withoutScheme.indexOf('/');
  const question: number = withoutScheme.indexOf('?');
  if (slash >= 0) {
    end = slash;
  }
  if (question >= 0 && question < end) {
    end = question;
  }
  const authority: string = withoutScheme.substring(0, end);
  const at: number = authority.lastIndexOf('@');
  return at >= 0 ? authority.substring(at + 1) : authority;
}

function toRequestMethod(method: string): http.RequestMethod {
  switch ((method || 'GET').toUpperCase()) {
    case 'POST':
      return http.RequestMethod.POST;
    case 'PUT':
      return http.RequestMethod.PUT;
    case 'DELETE':
      return http.RequestMethod.DELETE;
    case 'HEAD':
      return http.RequestMethod.HEAD;
    case 'PATCH':
      return http.RequestMethod.PATCH;
    case 'OPTIONS':
      return http.RequestMethod.OPTIONS;
    case 'TRACE':
      return http.RequestMethod.TRACE;
    case 'CONNECT':
      return http.RequestMethod.CONNECT;
    default:
      return http.RequestMethod.GET;
  }
}

export async function performHttpRequest(options: HttpRequestOptions): Promise<NativeHttpResult> {
  const client: http.HttpRequest = http.createHttp();
  const timeout: number = options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  try {
    const header: Record<string, string> = {};
    const incoming: Record<string, string> = options.headers ? options.headers : {};
    Object.keys(incoming).forEach((key: string) => {
      header[key] = incoming[key];
    });
    const cookie: string = CookieJar.headerFor(options.url);
    if (cookie.length > 0 && !hasHeader(header, 'cookie')) {
      header['Cookie'] = cookie;
    }

    let extraData: string | ArrayBuffer | undefined = undefined;
    if (options.bodyBase64 && options.bodyBase64.length > 0) {
      const helper: util.Base64Helper = new util.Base64Helper();
      const decoded: Uint8Array = helper.decodeSync(options.bodyBase64);
      extraData = decoded.buffer as ArrayBuffer;
    } else if (options.bodyText && options.bodyText.length > 0) {
      extraData = options.bodyText;
    }

    const response: http.HttpResponse = await client.request(options.url, {
      method: toRequestMethod(options.method),
      header: header,
      extraData: extraData,
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
      usingCache: false,
      connectTimeout: timeout,
      readTimeout: timeout,
    });

    const headers: Array<HttpHeaderEntry> = normalizeHeaders(response.header as Object);
    headers.forEach((entry: HttpHeaderEntry) => {
      if (entry.name.toLowerCase() === 'set-cookie') {
        CookieJar.remember(options.url, entry.value);
      }
    });

    return {
      status: typeof response.responseCode === 'number' ? response.responseCode : 0,
      headers: headers,
      bodyBase64: encodeResult(response.result as Object),
    };
  } catch (err) {
    hilog.warn(DOMAIN, TAG, 'request failed: %{public}s', JSON.stringify(err));
    throw new Error('网络请求失败：' + describe(err));
  } finally {
    client.destroy();
  }
}

function hasHeader(header: Record<string, string>, name: string): boolean {
  const keys: Array<string> = Object.keys(header);
  for (let i: number = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === name) {
      return true;
    }
  }
  return false;
}

/**
 * 响应头两种形状都会出现：对象（多数时候）与整段字符串（某些代理 / 老版本）。
 * 前端那边要按 name/value 数组来读（Set-Cookie 得逐个 append），所以统一成数组。
 */
function normalizeHeaders(raw: Object): Array<HttpHeaderEntry> {
  const headers: Array<HttpHeaderEntry> = [];
  if (!raw) {
    return headers;
  }
  if (typeof raw === 'string') {
    const lines: Array<string> = (raw as string).split('\n');
    lines.forEach((line: string) => {
      const separator: number = line.indexOf(':');
      if (separator <= 0) {
        return;
      }
      headers.push({
        name: line.substring(0, separator).trim(),
        value: line.substring(separator + 1).trim(),
      });
    });
    return headers;
  }
  const map: Record<string, string> = raw as Record<string, string>;
  Object.keys(map).forEach((key: string) => {
    const value: string = map[key];
    headers.push({ name: key, value: value === undefined ? '' : String(value) });
  });
  return headers;
}

function encodeResult(result: Object): string {
  const helper: util.Base64Helper = new util.Base64Helper();
  const encoder: util.TextEncoder = new util.TextEncoder();
  if (result instanceof ArrayBuffer) {
    return helper.encodeToStringSync(new Uint8Array(result));
  }
  if (typeof result === 'string') {
    return helper.encodeToStringSync(encoder.encode(result as string));
  }
  if (result === undefined || result === null) {
    return '';
  }
  return helper.encodeToStringSync(encoder.encode(JSON.stringify(result)));
}

function describe(err: Object): string {
  if (err instanceof Error) {
    return err.message;
  }
  return JSON.stringify(err);
}
