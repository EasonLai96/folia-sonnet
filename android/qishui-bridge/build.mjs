// android/qishui-bridge/build.mjs
//
// 把汽水协议层打包成签名宿主页面能跑的产物，并装配进
// android/app/src/main/assets/qishui/：
//
//   protocol.js    entry.js（协议层 + 裁剪版签名层 + Node shims）的 esbuild 产物
//   folia-xhr.js   假 XHR + 原生 http 桥（源文件直拷，无打包需求）
//   bootstrap.html security_host.html 改造版：最前插 folia-xhr.js、最后插 protocol.js
//   react/react-dom/sdk-glue/bdms.js   上游 qishui-auth-v6 的原版脚本
//
// 产物需要提交进仓库（安卓构建不跑 node），改了 src/ 或上游脚本后要重跑：
//   node android/qishui-bridge/build.mjs

import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const assetsDir = join(repoRoot, 'android', 'app', 'src', 'main', 'assets', 'qishui');
const upstreamDir = join(repoRoot, 'electron', 'qishui', 'qishui-auth-v6');
const upstreamQrLogin = join(repoRoot, 'electron', 'qishui', 'qishui-qr-login.js');
const generatedQrLogin = join(here, 'src', 'generated', 'qishui-qr-login.cjs');

// 桌面端签名层用 bdms.node 做加速，服务端校验的关键是 bdms.js 固定在 1.0.0.41。
// 上游用 session hook 把官方 CDN 的 bdms.js 重定向到本地这份；安卓在
// QishuiSignHost.shouldInterceptRequest 里对同一个 URL 直接回本地资产。
const OFFICIAL_BDMS_URL =
    'https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js';

// 协议层在加载期读取的环境变量（桌面端由 qishuiApiBridge.cjs 写进 process.env）
// 定义在 src/shims/globals.js 的 __foliaProcessEnv：esbuild 的 --define 指向这个
// inject 符号，避开 Windows cmd 对 --define JSON 字面量的引号处理。
// 路径只是 localStorage 键的一部分，见 shims/fs.js。

function esbuild(args) {
    // npx 只在首次需要下载，之后走本地缓存；不往 package.json 里加 devDependency。
    // Windows 上 npx 是 .cmd，shell 必须开；execSync 在失败时把 stderr 一起抛出。
    const command = 'npx -y esbuild@0.25.10 ' + args.map(shellQuote).join(' ');
    try {
        const output = execSync(command, {
            cwd: here,
            shell: true,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (output.trim()) console.log(output.trim());
    } catch (error) {
        const detail = [error.stdout, error.stderr].filter(Boolean).join('\n');
        throw new Error('esbuild failed:\n' + (detail || error.message));
    }
}

function shellQuote(value) {
    return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : '"' + value.replace(/"/g, '\\"') + '"';
}

function copy(src, dest) {
    writeFileSync(dest, readFileSync(src));
}

function buildBootstrap() {
    const source = readFileSync(join(upstreamDir, 'security_host.html'), 'utf8');
    // folia-xhr.js 必须排在所有脚本之前：msToken 预置要先于 bdms 初始化，
    // 全局 XMLHttpRequest 替换要先于 sdk-glue 的原型 hook。
    const xhrTag = '    <script src="folia-xhr.js"></script>\n';
    const firstScript = source.indexOf('    <script>');
    if (firstScript < 0) throw new Error('security_host.html 的第一个内联脚本没找到');
    let html = source.slice(0, firstScript) + xhrTag + source.slice(firstScript);
    // protocol.js 排最后：页面 API（__qishuiRequest 等）与 sdk-glue 都已就绪。
    const headClose = html.indexOf('  </head>');
    if (headClose < 0) throw new Error('security_host.html 缺少 </head>');
    html = html.slice(0, headClose)
        + '    <script src="protocol.js"></script>\n'
        + html.slice(headClose);
    // 与上游的差异点留在注释里，方便日后同步。
    html = html.replace(
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        + '    <!-- Folia Android：由 android/qishui-bridge/build.mjs 从 security_host.html 生成，\n'
        + '         差异仅在首尾各插一个 script（folia-xhr.js / protocol.js）。改上游时重新构建。 -->',
    );
    return html;
}

function buildGeneratedQrLogin() {
    // esbuild 的 alias 不接受相对路径，而 qishui-qr-login.js 里恰有一行
    // require('./qishui-auth-v6') 要改指向裁剪版。构建时生成一个 vendored
    // 副本（.cjs：根 package.json 是 type: module，.js 会被当成 ESM），
    // 其余内容一字不动；源文件结构变了就让构建失败（人工核对）。
    // 注意 require 的相对路径基准是 generated/ 所在目录。
    const source = readFileSync(upstreamQrLogin, 'utf8');
    const needle = "require('./qishui-auth-v6')";
    if (!source.includes(needle)) {
        throw new Error('qishui-qr-login.js 不再包含 ' + needle + '，请人工核对后更新 build.mjs');
    }
    mkdirSync(dirname(generatedQrLogin), { recursive: true });
    writeFileSync(generatedQrLogin, source.split(needle).join("require('../qishui-auth-android.js')"));
}

buildGeneratedQrLogin();

rmSync(assetsDir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });

esbuild([
    join(here, 'src', 'entry.js'),
    '--bundle',
    '--format=iife',
    '--target=chrome110',
    '--platform=browser',
    '--charset=utf8',
    '--legal-comments=none',
    '--outfile=' + join(assetsDir, 'protocol.js'),
    '--inject:' + join(here, 'src', 'shims', 'globals.js'),
    '--define:process.env=__foliaProcessEnv',
    '--alias:fs=./src/shims/fs.js',
    '--alias:os=./src/shims/os.js',
    '--alias:path=./src/shims/path.js',
    '--alias:crypto=./src/shims/crypto.js',
    '--alias:http=./src/shims/http.js',
    '--alias:https=./src/shims/https.js',
    '--alias:electron=./src/shims/electron.js',
]);

copy(join(here, 'src', 'folia-xhr.js'), join(assetsDir, 'folia-xhr.js'));
for (const name of ['react.js', 'react-dom.js', 'sdk-glue.js', 'bdms.js']) {
    copy(join(upstreamDir, name), join(assetsDir, name));
}
writeFileSync(join(assetsDir, 'bootstrap.html'), buildBootstrap());

// 把官方 bdms URL 写进一个清单，QishuiSignHost 读它做重定向（见 Java 侧注释）。
writeFileSync(join(assetsDir, 'manifest.json'), JSON.stringify({
    officialBdmsUrl: OFFICIAL_BDMS_URL,
    version: 1,
}, null, 2));

const produced = readdirSync(assetsDir);
console.log('[qishui-bridge] assets ready:', produced.join(', '));
