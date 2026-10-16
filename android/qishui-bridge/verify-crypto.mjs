// 临时验证脚本：用 node 直接跑 crypto shim，与 node crypto 对比。
// 运行：node android/qishui-bridge/verify-crypto.mjs
import { createRequire } from 'node:module';

const require2 = createRequire(import.meta.url);
const nodeCrypto = require2('node:crypto');

globalThis.btoa ||= s => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ||= s => Buffer.from(s, 'base64').toString('binary');

const mod = await import('./src/shims/crypto.js');

let failures = 0;
function check(name, actual, expected) {
    const ok = String(actual) === String(expected);
    if (!ok) failures++;
    console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + (ok ? '' : '  actual=' + actual + ' expected=' + expected));
}

const cases = ['', 'hello', 'a=1&b=2', '汽水音乐', 'x'.repeat(1000)];
for (const text of cases) {
    check('sha1(' + JSON.stringify(text.slice(0, 10)) + ')',
        mod.createHash('sha1').update(text).digest('hex'),
        nodeCrypto.createHash('sha1').update(text).digest('hex'));
    check('md5(' + JSON.stringify(text.slice(0, 10)) + ')',
        mod.createHash('md5').update(text).digest('hex'),
        nodeCrypto.createHash('md5').update(text).digest('hex'));
}

// 长输入（跨块）+ 与 base64url 一致性
const longText = 'y'.repeat(200);
check('sha1-long', mod.createHash('sha1').update(longText).digest('base64url'),
    nodeCrypto.createHash('sha1').update(longText).digest('base64url'));

// randomBytes / randomUUID / randomInt
check('randomBytes hex length', mod.randomBytes(16).toString('hex').length, 32);
check('randomBytes base64url', /^[A-Za-z0-9_-]+$/.test(mod.randomBytes(88).toString('base64url')), true);
check('randomUUID format', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(mod.randomUUID()), true);
const sample = new Set();
for (let i = 0; i < 200; i++) sample.add(mod.randomInt(1, 9));
check('randomInt range', Array.from(sample).every(v => v >= 1 && v < 9) && sample.size > 5, true);

// 88 字节 base64url 长度必须正好 118（msToken 校验用）
check('msToken shape', /^[A-Za-z0-9_-]{118}==$/.test(mod.randomBytes(88).toString('base64url') + '=='), true);

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
