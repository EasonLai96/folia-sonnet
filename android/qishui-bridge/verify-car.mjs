// android/qishui-bridge/verify-car.mjs
//
// 车机协议层的本机验证（不进 APK，仅供开发期跑）：
//
//   node android/qishui-bridge/verify-car.mjs
//
// 模拟签名宿主页面的环境：btoa/atob、WebCrypto、localStorage（Map 兜底）、
// __foliaHttpTransport（这里走 node 的 fetch，真机上是原生 OkHttp 桥）。
// 覆盖两条线：
//   1. 密码学：PKCS#10 CSR 能被 openssl 解析、WebCrypto DER 签名能被 node:crypto
//      的公钥校验通过（证明与参考实现 node:crypto 输出等价）；
//   2. 协议：公共读取（搜索/详情/歌词/音频/推荐/歌单搜索/歌单曲目/场景）与
//      二维码创建（真网络，验证授权参数仍被接受）。
//
// 跑不过不等于上线必挂（上游随时可能变），但跑得过至少说明打包前的模块没有
// 低级错误。真机验证仍以用户安装后的实测为准。

import { createRequire } from 'node:module';
import { createVerify, createPublicKey } from 'node:crypto';

const require2 = createRequire(import.meta.url);
const nodeCrypto = require2('node:crypto');

globalThis.btoa ||= s => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ||= s => Buffer.from(s, 'base64').toString('binary');
// node 24 已带全局 WebCrypto，只在缺失时补。

// localStorage 模拟：真实持久化不重要，重要的是接口形状。
const memoryStore = new Map();
globalThis.window = {
    localStorage: {
        getItem: k => (memoryStore.has(k) ? memoryStore.get(k) : null),
        setItem: (k, v) => memoryStore.set(String(k), String(v)),
        removeItem: k => memoryStore.delete(k),
    },
    // entry.js 用不到；transport 在显式传入时不看 window。
};

let failures = 0;
function check(name, ok, detail = '') {
    if (!ok) failures++;
    console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + (ok || !detail ? '' : '  → ' + detail));
}

// ─── 1. 密码学 ─────────────────────────────────────────────────────────────

const { createGuard, signTextDerBase64 } = await import('./src/car/guard.js');
const { pemFromBytes } = await import('./src/car/bytes.js');
import('./src/car/bytes.js');

const guard = await createGuard();
// 上游要的是「PEM 文本再 base64」：解码后必须是一份带 BEGIN/END 的 PEM 文本，
// 不能是裸 DER —— 早先发 DER base64，扫码确认后 ticket 那一步直接回 10001。
const { base64ToBytes } = await import('./src/car/bytes.js');
const csrPem = new TextDecoder().decode(base64ToBytes(guard.csr));
check('CSR is base64(PEM text), not base64(DER)', csrPem.startsWith('-----BEGIN CERTIFICATE REQUEST-----'),
    csrPem.slice(0, 40));
const { writeFileSync } = await import('node:fs');
writeFileSync('.verify-csr.pem', csrPem);

// openssl 解析 CSR（Git Bash 自带；没有就跳过这一项，下一项的 node 校验仍有效）。
const { execFileSync } = await import('node:child_process');
try {
    const out = execFileSync('openssl', ['req', '-in', '.verify-csr.pem', '-noout', '-verify'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    check('openssl CSR verify', /OK/i.test(String(out)), String(out).trim());
} catch (error) {
    console.log('SKIP openssl CSR verify (openssl unavailable): ' + String(error.message || error).slice(0, 120));
}

// WebCrypto DER 签名 ←→ node:crypto 公钥校验（等价性证明）。
{
    const message = 'ticket=abc&path=/api/luna/v1/platform/me/info/&timestamp=1792575529';
    const signatureB64 = await signTextDerBase64(guard.privateKey, message);
    const publicKey = createPublicKey(guard.guardKey);
    const verified = createVerify('sha256')
        .update(message)
        .verify(publicKey, Buffer.from(signatureB64, 'base64'));
    check('WebCrypto DER signature verified by node:crypto', verified);
}

// guard 响应头的三种失败要各说各话：真机诊断里一句 'invalid guard response'
// 等于没有信息（ticket 那一步就是这样白排查一轮）。
{
    const { readQishuiGuard } = await import('./src/car/protocol.js');
    const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64');
    const expect = (name, run, needle) => {
        let message = '';
        try { run(); } catch (error) { message = String(error.message || error); }
        check(name, message.includes(needle), `message="${message}" want~"${needle}"`);
    };
    expect('guard header missing', () => readQishuiGuard(null), 'guard header is missing');
    expect('guard header not JSON', () => readQishuiGuard('!!!not-base64!!!'), 'not base64 JSON');
    expect('guard field missing', () => readQishuiGuard(b64({ ticket: 't', ts_sign: '' })), 'ts_sign');
    const ok = readQishuiGuard(b64({ ticket: 'T', ts_sign: 'S', client_cert: 'C' }));
    check('guard header parsed', ok.ticket === 'T' && ok.guardTsSign === 'S' && ok.guardCert === 'C');
}

// ─── 2. 协议（真网络）─────────────────────────────────────────────────────

// transport：与真机 folia-xhr.js 的 __foliaHttpTransport 同一形状，
// 底下换成 node fetch。
const transport = {
    async request(payload) {
        const response = await fetch(payload.url, {
            method: payload.method || 'GET',
            headers: payload.headers || {},
            body: payload.body == null ? undefined : payload.body,
        });
        const headers = {};
        response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
        return {
            status: response.status,
            headers,
            body: await response.text(),
        };
    },
};

const { createQishuiCar } = await import('./src/car/api.js');
const car = createQishuiCar({ transport });

async function attempt(name, run) {
    try {
        const result = await run();
        check(name, true, JSON.stringify(result).slice(0, 80));
        return result;
    } catch (error) {
        check(name, false, String(error && error.message || error));
        return null;
    }
}

// 未登录 status：应该给出 loggedIn=false 而不是抛错。
await attempt('status (signed out)', async () => {
    const status = await car.status();
    if (status.loggedIn) throw new Error('expected loggedIn=false');
    return 'loggedIn=false';
});

const search = await attempt('search 晴天', () => car.search('晴天', 5, 0));
let trackId = '';
if (search && search.songs.length) {
    trackId = search.songs[0].id;
    const song = search.songs[0];
    check('search song shape', Boolean(song.name && song.cover && song.duration > 0 && song.artists.length),
        JSON.stringify(song).slice(0, 200));
} else {
    check('search song shape', false, 'no songs');
}

if (trackId) {
    await attempt('song.detail', async () => {
        const detail = await car.songDetail(trackId);
        if (!detail.song?.name) throw new Error('song.name missing');
        return detail.song.name;
    });
    await attempt('lyrics (yrc present)', async () => {
        const lyrics = await car.lyrics(trackId);
        if (!lyrics.yrc && !lyrics.lyric) throw new Error('both lyric and yrc empty');
        return `lyric=${lyrics.lyric.length}b yrc=${lyrics.yrc.length}b`;
    });
    await attempt('audio url', async () => {
        const audio = await car.audio(trackId, 'standard');
        if (!audio.url || !/^https:\/\//.test(audio.url)) throw new Error('no https url');
        // 直链真拉一次头，确认 200 且是音频（不是签名被拒的错误页）。
        const head = await fetch(audio.url, { method: 'GET', headers: { Range: 'bytes=0-1' } });
        if (head.status !== 200 && head.status !== 206) throw new Error('audio fetch HTTP ' + head.status);
        return `HTTP ${head.status} ${head.headers.get('content-type')}`;
    });
}

await attempt('feed', async () => {
    const feed = await car.feed(6);
    if (!feed.songs.length) throw new Error('empty feed');
    return feed.songs.length + ' songs';
});

const playlists = await attempt('searchPlaylists 华语', () => car.searchPlaylists('华语', 3, 0));
if (playlists && playlists.playlists.length) {
    const playlist = playlists.playlists[0];
    check('playlist shape', Boolean(playlist.id && playlist.name) && typeof playlist.trackCount === 'number',
        JSON.stringify(playlist).slice(0, 160));
    await attempt('playlistTracks', async () => {
        const page = await car.playlistTracks(playlist.id, 3, 0);
        if (!page.tracks.length) throw new Error('empty tracks');
        return page.tracks.length + ' tracks';
    });
}

await attempt('feedModes', async () => {
    const modes = await car.feedModes();
    if (!Array.isArray(modes) || !modes.length) throw new Error('no modes');
    return modes.length + ' modes';
});

// 二维码创建：授权参数（client_key/signature/scope）还被人认的证明。
await attempt('login QR created', async () => {
    const result = await car.startLogin();
    if (!result.qrDataUrl.startsWith('data:image/png;base64,')) throw new Error('qr payload malformed');
    car.cancelLogin(result.key);
    return 'qr ok, key=' + result.key.slice(0, 8) + '…';
});

console.log(failures ? `\n${failures} FAILURES` : '\nALL OK');
process.exitCode = failures ? 1 : 0;
