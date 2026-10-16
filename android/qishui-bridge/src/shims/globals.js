// android/qishui-bridge/src/shims/globals.js
//
// esbuild inject：把打包产物里的全局符号替换成这里的实现。
//
//   Buffer            → shims/buffer.js（协议层只用 concat / byteLength）
//   __foliaProcessEnv → esbuild 的 --define:process.env=__foliaProcessEnv 用它
//                       替换 process.env（桌面端由 qishuiApiBridge.cjs 注入环境变量，
//                       安卓在打包期写死；值是 localStorage 键的一部分，见 fs.js）。

import Buffer from './buffer.js';

const __foliaProcessEnv = {
    QISHUI_COOKIE_FILE: '/folia/qishui-cookie.txt',
    QISHUI_TOKEN_FILE: '/folia/qishui-token.txt',
    QISHUI_QR_CONFIG_FILE: '/folia/qishui-qr-login.json',
    QISHUI_OAUTH_CONFIG_FILE: '/folia/qishui-oauth.json',
};

export { Buffer, __foliaProcessEnv };
