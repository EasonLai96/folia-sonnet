import { describe, expect, it } from 'vitest';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import {
    feiniuFnIdFromServerUrl,
    feiniuServerUrlFromFnId,
    isFnConnectLoginPage,
    normalizeFeiniuServerUrl,
} from '@/services/onlineMusic/feiniuTransport';

// test/unit/onlineMusic/feiniuLoginMethods.test.ts
// 飞牛的登录有两种方式：FN ID（人在外面，只填那个 ID）与局域网地址（人在家里，手写 IP:端口）。
// 两种方式后面是同一张表单（用户名 + 密码），区别全在第一栏怎么变成地址 ——
// 这里钉住这个翻译：手抄错一点（多了空格、写了 https、带端口、带 /music 尾巴）都要难不倒它。

describe('an FN ID becomes the address of that machine', () => {
    it('adds the domain the vendor hands out, and speaks https', () => {
        // 网关域名是飞牛自己的 5ddd.com（多个公共 DNS 实测一致）；写别的后缀 DNS 直接解析不了，
        // 报出来却是「连不上」，看着像 NAS 没开机 —— 所以这个后缀必须钉住。
        expect(feiniuServerUrlFromFnId('abcd1234')).toBe('https://abcd1234.5ddd.com');
        expect(feiniuServerUrlFromFnId(' ABCD1234 ')).toBe('https://abcd1234.5ddd.com');
    });

    it('takes the ID back out of a full address, or out of a copied one', () => {
        // 用户从浏览器地址栏复制来的往往是整条：域名已经在里面，不该再补一次后缀。
        expect(feiniuServerUrlFromFnId('https://abcd1234.5ddd.com/')).toBe('https://abcd1234.5ddd.com');
        expect(feiniuServerUrlFromFnId('http://192.168.1.5:5666/music/')).toBe('https://192.168.1.5:5666');
        expect(feiniuServerUrlFromFnId('abcd1234.5ddd.com:8443')).toBe('https://abcd1234.5ddd.com:8443');
    });

    it('is empty when nothing was typed', () => {
        expect(feiniuServerUrlFromFnId('')).toBe('');
        expect(feiniuServerUrlFromFnId('   ')).toBe('');
    });

    it('survives the paste that comes with a full-width colon', () => {
        expect(feiniuServerUrlFromFnId('abcd1234.5ddd.com：8443')).toBe('https://abcd1234.5ddd.com:8443');
    });
});

describe('the other way round: whether an address is one of those', () => {
    it('answers the ID only for a machine reached through the vendor domain', () => {
        expect(feiniuFnIdFromServerUrl('https://abcd1234.5ddd.com')).toBe('abcd1234');
        expect(feiniuFnIdFromServerUrl('abcd1234.5ddd.com:8443/music')).toBe('abcd1234');
        // 局域网地址不是 FN ID：那一栏不该被它填上。
        expect(feiniuFnIdFromServerUrl('http://192.168.1.5:5666')).toBe('');
        expect(feiniuFnIdFromServerUrl('')).toBe('');
    });
});

describe('the address typed the other way is left as it is', () => {
    it('keeps http together with its default port', () => {
        expect(normalizeFeiniuServerUrl(' http://192.168.1.5:5666/music/ ')).toBe('http://192.168.1.5:5666');
    });
});

describe('a page the gateway hands back instead of an answer', () => {
    // 网关没有会话时把所有请求都换成自己的登录页（实测：POST 密码登录也回它）。
    // 认得出这一页，界面才能说「先去网页登录一次」，而不是「这个地址上没有服务」。
    const gateway = '<!doctype html><html lang="zh-CN"><head>'
        + '<link rel="icon" href="https://static2.fnnas.com/connect/favicon.ico"/>'
        + '<title>FN Connect 远程访问 - 飞牛 fnOS</title></head><body><div id="app"></div></body></html>';

    it('knows the gateway login page when it sees one', () => {
        expect(isFnConnectLoginPage(gateway)).toBe(true);
    });

    it('leaves any other page alone, so a wrong address still says service not found', () => {
        expect(isFnConnectLoginPage('<html><head><title>fnOS</title></head><body>登录</body></html>')).toBe(false);
        expect(isFnConnectLoginPage('')).toBe(false);
    });
});

describe('the two sign-in methods a platform of this kind declares', () => {
    const methods = getOnlineMusicProvider('feiniu')!.auth!.getLoginMethods!();

    it('offers both, and each of them leads to the form rather than to a code', () => {
        expect(methods.map(method => method.id)).toEqual(['fnid', 'server']);
        // 没有二维码可言的平台：两种方式都必须通向表单，否则会停在等着取码那一屏。
        expect(methods.every(method => Boolean(method.passwordField))).toBe(true);
    });

    it('names its own first field, so the window stays clear of platforms', () => {
        expect(Object.fromEntries(methods.map(method => [method.id, method.passwordField?.labelKey]))).toEqual({
            fnid: 'home.loginFeiniuFnId',
            server: 'home.loginServerUrl',
        });
    });
});
