// android/qishui-bridge/build.mjs
//
// 把汽水协议层（车机协议版）打包成签名宿主页面能跑的产物，并装配进
// android/app/src/main/assets/qishui/：
//
//   protocol.js    entry.js（车机协议 + WebCrypto 签名）的 esbuild 产物
//   folia-xhr.js   原生 http 桥（源文件直拷，无打包需求）
//   bootstrap.html 签名宿主页面：只剩上面两个脚本
//
// 旧版从 electron/qishui/qishui-auth-v6/security_host.html 生成页面并携带
// sdk-glue / bdms / react —— 那一套是给 passport a_bogus 签名用的，车机协议
// （/api/luna/v1/platform + bd-ticket-guard WebCrypto）不再需要，整体移除。
//
// 产物需要提交进仓库（安卓构建不跑 node），改了 src/ 后要重跑：
//   node android/qishui-bridge/build.mjs

import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const assetsDir = join(repoRoot, 'android', 'app', 'src', 'main', 'assets', 'qishui');

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
    // 极简宿主页：挂在假源 https://www.qishui.com/__folia/bootstrap.html 下加载
    // （QishuiSignHost.shouldInterceptRequest 按这个路径回本文件），协议层需要的
    // 全局只有 FoliaQishuiHost（原生注入）与 __foliaHttpTransport（folia-xhr.js）。
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Folia Qishui Car Protocol</title>
<!-- Folia Android：由 android/qishui-bridge/build.mjs 生成。
     车机协议版：不再加载 sdk-glue / bdms / react（那是旧 passport a_bogus
     签名的依赖），只保留原生 http 桥与协议层两个脚本。改 src/ 后重新构建。 -->
<script src="folia-xhr.js"></script>
<script src="protocol.js"></script>
</head>
<body></body>
</html>
`;
}

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
]);

copy(join(here, 'src', 'folia-xhr.js'), join(assetsDir, 'folia-xhr.js'));
writeFileSync(join(assetsDir, 'bootstrap.html'), buildBootstrap());

// 旧版清单里的 officialBdmsUrl 只服务 bdms.js 重定向；车机协议不加载 bdms，
// 保留 manifest 但去掉该字段，QishuiSignHost 里对它的引用已经不存在了。
writeFileSync(join(assetsDir, 'manifest.json'), JSON.stringify({
    protocol: 'luna-car',
    version: 2,
}, null, 2));

const produced = readdirSync(assetsDir);
console.log('[qishui-bridge] assets ready:', produced.join(', '));
