import { fetchJsonWithRetry } from '../utils/fetchWithTimeout';

// src/services/appUpdate.ts
// 应用内检查更新。
//
// 桌面端那套走的是 electron-updater（主进程里查、下载、重启安装），Android 这里没有
// 对应能力 —— Capacitor 没装 @capacitor/app，拿不到 App.getInfo()，也**不允许**应用
// 自己静默装更新（非 Play 分发要装别的包必须走系统安装器并要用户点确认）。
//
// 所以这条路只做两件事：查最新版本（对照 CI 挂在 GitHub Release 上的产物），
// 以及把下载地址交给系统浏览器 —— 下载完由系统安装器接手。
//
// 版本号来源是编译期注入的 `__APP_VERSION__`（vite.config.ts 从 package.json 读），
// 和 Release 的标签（CI 用同一个 package.json 版本打的 vX.Y.Z）天然对齐。

/** 出包仓库。CI（.github/workflows/android-release.yml）把 APK/AAB 挂在这个仓库的 Release 上。 */
export const APP_UPDATE_REPO = 'maimai993/folia-sonnet';

/** 查不到更新时给用户兜底的手动入口。 */
export const APP_UPDATE_RELEASES_PAGE = `https://github.com/${APP_UPDATE_REPO}/releases`;

const LATEST_RELEASE_API = `https://api.github.com/repos/${APP_UPDATE_REPO}/releases/latest`;

/**
 * 请求超时。GitHub API 在直连不稳的网络下可能几十秒不回，检查更新这种事等不了那么久；
 * 超时后界面给的是「打开发布页」这条兜底路，而不是一直转圈。
 */
const REQUEST_TIMEOUT_MS = 12_000;

/** GitHub releases/latest 里我们用到的字段。 */
type GitHubReleasePayload = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  body?: string;
  published_at?: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: Array<{
    name?: string;
    browser_download_url?: string;
    size?: number;
  }>;
};

export type AppReleaseAsset = {
  name: string;
  /** 直接下载地址：发给系统浏览器就是一次下载。 */
  downloadUrl: string;
  sizeBytes: number;
};

export type AppReleaseInfo = {
  /** 去掉 v 前缀的版本号，例如 0.7.19；标签不带版本号时退回标签本身。 */
  version: string;
  /** 原始标签，例如 v0.7.19。 */
  tag: string;
  /** Release 标题（可能为空）。 */
  name: string;
  /** Release 页面地址，供「打开发布页」使用。 */
  pageUrl: string;
  /** Release 正文（更新日志）。 */
  notes: string;
  publishedAt: string | null;
  apk: AppReleaseAsset | null;
  aab: AppReleaseAsset | null;
};

export type AppUpdateCheckResult =
  | { status: 'update-available'; currentVersion: string; release: AppReleaseInfo }
  | { status: 'up-to-date'; currentVersion: string; release: AppReleaseInfo }
  | { status: 'failed'; currentVersion: string; message: string };

/**
 * 当前应用版本。
 *
 * `__APP_VERSION__` 是 vite 的 define 注入的全局常量，在 vitest / node 环境下不存在，
 * 所以一律带 typeof 判断（仓库里其它读它的地方也是这个写法）。
 */
export const getCurrentAppVersion = (): string => (
  typeof __APP_VERSION__ === 'undefined' ? '0.0.0' : String(__APP_VERSION__)
);

type ParsedVersion = {
  /** 主版本号三段，缺失的按 0 补齐。 */
  numbers: [number, number, number];
  /** 预发布标识（`-beta.1` 里的 `beta.1`）；正式版为 null。 */
  prerelease: string | null;
};

/**
 * 解析版本号。只认 `[v]X.Y.Z[-pre][+build]` 这种形状：包里的版本和 CI 打的标签都是它。
 * build 元数据（`+build.7`）直接丢掉 —— 它不参与比较，而 semver 规定带它的版本
 * 与不带它的**相等**，当成预发布标识会让「0.7.19+build.7」被误判成比 0.7.19 旧。
 */
export const parseAppVersion = (value: string): ParsedVersion | null => {
  const trimmed = value.trim().replace(/^v/i, '');
  const matched = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(trimmed);
  if (!matched) return null;
  return {
    numbers: [
      Number(matched[1] ?? 0),
      Number(matched[2] ?? 0),
      Number(matched[3] ?? 0),
    ],
    prerelease: matched[4] ?? null,
  };
};

/**
 * 比较版本号：a > b 返回正数，a < b 返回负数，相等返回 0。
 *
 * 预发布排在同一个正式版**之前**（0.7.19-beta.1 < 0.7.19），这是 semver 的约定，
 * 也正好是我们需要的行为：装了 beta 的人应该能收到正式版的更新提示。
 * 两个都是预发布时按标识逐段比（数字段按数值比），比不出来就当相等 —— 宁可漏一次
 * 提示，也不要因为比错方向把人从新版赶回旧版。
 */
export const compareAppVersions = (a: string, b: string): number => {
  const left = parseAppVersion(a);
  const right = parseAppVersion(b);
  if (!left || !right) {
    // 解析不了就按字符串比，至少不会崩。
    return a === b ? 0 : a > b ? 1 : -1;
  }

  for (let index = 0; index < 3; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index] - right.numbers[index];
    }
  }

  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;

  const leftParts = left.prerelease.split('.');
  const rightParts = right.prerelease.split('.');
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === rightPart) continue;
    // 段数少的那个更小（beta < beta.1）。
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    const bothNumeric = !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber);
    if (bothNumeric && leftNumber !== rightNumber) return leftNumber - rightNumber;
    if (!bothNumeric) return leftPart > rightPart ? 1 : -1;
  }
  return 0;
};

/**
 * 解析产物后缀名。`folia-sonnet-0.7.19-release.apk` → `apk`。
 * 带查询串的地址也认（GitHub 的 browser_download_url 不带，但别的地方可能带）。
 */
const assetExtensionOf = (name: string): string => {
  const withoutQuery = name.split('?')[0];
  const dot = withoutQuery.lastIndexOf('.');
  return dot === -1 ? '' : withoutQuery.slice(dot + 1).toLowerCase();
};

/**
 * 从 Release 的产物里挑出要装的那一个。
 *
 * 只按后缀挑，不认文件名格式：CI 现在叫 `folia-sonnet-<version>-release.apk`，
 * 但名字会变（换版本号拼法、加渠道后缀），而后缀不会。同一后缀有多个时优先带
 * `release` 的，其次取体积大的（真正的安装包总比校验文件大）。
 */
export const pickReleaseAsset = (
  assets: Array<{ name?: string; browser_download_url?: string; size?: number }> | undefined,
  extension: string,
): AppReleaseAsset | null => {
  const candidates = (assets ?? [])
    .filter((asset): asset is { name: string; browser_download_url: string; size?: number } => (
      typeof asset?.name === 'string'
      && typeof asset.browser_download_url === 'string'
      && assetExtensionOf(asset.name) === extension
    ));
  if (candidates.length === 0) return null;

  const preferred = candidates.filter(asset => /release/i.test(asset.name));
  const pool = preferred.length > 0 ? preferred : candidates;
  const chosen = pool.reduce((best, asset) => ((asset.size ?? 0) > (best.size ?? 0) ? asset : best));
  return {
    name: chosen.name,
    downloadUrl: chosen.browser_download_url,
    sizeBytes: chosen.size ?? 0,
  };
};

const toReleaseInfo = (payload: GitHubReleasePayload): AppReleaseInfo => {
  const tag = payload.tag_name ?? '';
  return {
    version: tag.replace(/^v/i, '') || tag,
    tag,
    name: payload.name ?? '',
    pageUrl: payload.html_url ?? APP_UPDATE_RELEASES_PAGE,
    notes: payload.body?.trim() ?? '',
    publishedAt: payload.published_at ?? null,
    apk: pickReleaseAsset(payload.assets, 'apk'),
    aab: pickReleaseAsset(payload.assets, 'aab'),
  };
};

/** 把失败原因翻成人话。「检查失败」这三个字本身不足以让人判断该不该重试。 */
const describeFetchFailure = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP 404/.test(message)) {
    // releases/latest 404 = 还没发过正式版（或仓库改成了私有 / 改名）。
    return 'no-release';
  }
  if (/timed out|AbortError/i.test(message)) {
    return 'timeout';
  }
  return message;
};

/**
 * 检查更新。
 *
 * 走 `/releases/latest`：GitHub 会自己排除草稿与预发布，所以装了正式版的人不会被
 * beta 打扰（要发 beta 就发 pre-release，那条链是另外几个 workflow 管的）。
 * 请求失败不抛异常 —— 界面要的是一条能展示的失败原因 + 手动入口，不是一次未捕获拒绝。
 */
export const checkForAppUpdate = async (signal?: AbortSignal): Promise<AppUpdateCheckResult> => {
  const currentVersion = getCurrentAppVersion();
  try {
    const payload = await fetchJsonWithRetry<GitHubReleasePayload>(
      LATEST_RELEASE_API,
      {
        signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      { timeoutMs: REQUEST_TIMEOUT_MS },
    );

    const release = toReleaseInfo(payload ?? {});
    if (!release.version) {
      return { status: 'failed', currentVersion, message: 'empty-release' };
    }

    return compareAppVersions(release.version, currentVersion) > 0
      ? { status: 'update-available', currentVersion, release }
      : { status: 'up-to-date', currentVersion, release };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error; // 调用方主动取消不算失败。
    }
    return { status: 'failed', currentVersion, message: describeFetchFailure(error) };
  }
};
