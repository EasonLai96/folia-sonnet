import { describe, expect, it } from 'vitest';
import {
  compareAppVersions,
  parseAppVersion,
  pickReleaseAsset,
} from '../../../src/services/appUpdate';

// test/unit/services/appUpdate.test.ts
// 版本比较与应用内更新用的产物挑选。这两块全是「比错方向」就会静默出错的地方：
// 比反了是「明明有新版本却提示已是最新」，挑错了是「点下载拿到个 AAB 装不上」，
// 而且都不会抛异常 —— 只能靠用例钉住。

describe('parseAppVersion', () => {
  it('认 v 前缀与三段版本号', () => {
    expect(parseAppVersion('v0.7.19')).toEqual({ numbers: [0, 7, 19], prerelease: null });
    expect(parseAppVersion('0.7.19')).toEqual({ numbers: [0, 7, 19], prerelease: null });
  });

  it('缺段按 0 补齐', () => {
    expect(parseAppVersion('0.7')?.numbers).toEqual([0, 7, 0]);
    expect(parseAppVersion('1')?.numbers).toEqual([1, 0, 0]);
  });

  it('带预发布标识', () => {
    expect(parseAppVersion('v0.7.19-beta.1')?.prerelease).toBe('beta.1');
    expect(parseAppVersion('v0.7.19-rc.2')?.prerelease).toBe('rc.2');
  });

  it('build 元数据不进预发布标识', () => {
    expect(parseAppVersion('v0.7.19+build.7')).toEqual({ numbers: [0, 7, 19], prerelease: null });
    expect(parseAppVersion('v0.7.19-beta.1+build.7')?.prerelease).toBe('beta.1');
  });

  it('非版本号返回 null', () => {
    expect(parseAppVersion('nightly')).toBeNull();
    expect(parseAppVersion('')).toBeNull();
  });
});

describe('compareAppVersions', () => {
  it('逐段比大小', () => {
    expect(compareAppVersions('0.7.19', '0.7.18')).toBeGreaterThan(0);
    expect(compareAppVersions('0.7.18', '0.7.19')).toBeLessThan(0);
    expect(compareAppVersions('0.8.0', '0.7.99')).toBeGreaterThan(0);
    expect(compareAppVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });

  it('相等与 v 前缀', () => {
    expect(compareAppVersions('0.7.19', '0.7.19')).toBe(0);
    expect(compareAppVersions('v0.7.19', '0.7.19')).toBe(0);
    expect(compareAppVersions('0.7', '0.7.0')).toBe(0);
  });

  it('预发布排在同一个正式版之前', () => {
    // 装了 beta 的人应该能收到正式版的更新提示。
    expect(compareAppVersions('0.7.19', '0.7.19-beta.1')).toBeGreaterThan(0);
    expect(compareAppVersions('0.7.19-beta.1', '0.7.19')).toBeLessThan(0);
    expect(compareAppVersions('0.7.19-beta.2', '0.7.19-beta.1')).toBeGreaterThan(0);
    expect(compareAppVersions('0.7.19-beta', '0.7.19-beta.1')).toBeLessThan(0);
  });

  it('候选解析不出来时退回字符串比较，不抛异常', () => {
    expect(compareAppVersions('nightly', 'nightly')).toBe(0);
    expect(() => compareAppVersions('nightly', '0.7.19')).not.toThrow();
  });
});

describe('pickReleaseAsset', () => {
  const asset = (name: string, size = 1000) => ({
    name,
    browser_download_url: `https://example.com/${name}`,
    size,
  });

  it('按后缀挑，apk 不会挑成 aab', () => {
    const assets = [asset('folia-sonnet-0.7.19-release.aab'), asset('folia-sonnet-0.7.19-release.apk')];
    expect(pickReleaseAsset(assets, 'apk')?.name).toBe('folia-sonnet-0.7.19-release.apk');
    expect(pickReleaseAsset(assets, 'aab')?.name).toBe('folia-sonnet-0.7.19-release.aab');
  });

  it('没有对应后缀时返回 null', () => {
    expect(pickReleaseAsset([asset('folia-sonnet-0.7.19-release.aab')], 'apk')).toBeNull();
    expect(pickReleaseAsset(undefined, 'apk')).toBeNull();
    expect(pickReleaseAsset([], 'apk')).toBeNull();
  });

  it('多个 apk 时优先带 release 的那个', () => {
    const assets = [asset('folia-sonnet-0.7.19-unsigned.apk', 999_999), asset('folia-sonnet-0.7.19-release.apk', 1)];
    expect(pickReleaseAsset(assets, 'apk')?.name).toBe('folia-sonnet-0.7.19-release.apk');
  });

  it('没有 release 关键字时取体积大的', () => {
    const assets = [asset('folia-sonnet-0.7.19-arm64.apk', 10), asset('folia-sonnet-0.7.19-universal.apk', 5000)];
    expect(pickReleaseAsset(assets, 'apk')?.name).toBe('folia-sonnet-0.7.19-universal.apk');
  });

  it('后缀大写也认，带查询串也认', () => {
    expect(pickReleaseAsset([asset('Folia-0.7.19.APK')], 'apk')?.name).toBe('Folia-0.7.19.APK');
    expect(pickReleaseAsset([asset('folia.apk?token=1')], 'apk')?.name).toBe('folia.apk?token=1');
  });

  it('缺字段的条目直接跳过', () => {
    const assets = [{ name: 'folia.apk' }, { name: undefined, browser_download_url: 'x' }, asset('real.apk')];
    expect(pickReleaseAsset(assets, 'apk')?.name).toBe('real.apk');
  });
});
