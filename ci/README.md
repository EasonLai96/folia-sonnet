# ci

新 CI 的落地目录：检查逻辑都写在这里，`.github/workflows/` 只留薄入口调它。

## 现在有什么

- `checkVersionPolicy.ts`：版本约束检查，`npm run check:versions`。CI 的 `version-policy` job 和 `test/unit/versionPolicy.test.ts` 跑的是同一份实现。
  查的是：平台依赖钉死且与 `deploy/docker/<平台>-api/package.json` 同版本；`.nvmrc`、`engines.node` 与各 workflow 的 `node-version` 一致；版本号满足 `android/app/build.gradle` 的 versionCode 推导；锁文件版本和 `package.json` 同步。

## 为什么入口还在 .github/workflows

GitHub 只运行 `.github/workflows/*.yml`，子目录不读。所以那里只能放入口：

- `ci.yml`：调本目录的检查，加上 typecheck、单测、`vite build` 冒烟。
- `android-release.yml`：APK/AAB 出包，`v*` 标签或手动 `workflow_dispatch` 触发。

其余 workflow（`electron-release`、`canary-pre-release`、`nightly-pre-release`、`release-candidate`、`docker-*`、`triage-*`、`codemap-sync`、`linux-arm64-package-check`、`sync-server-docker-publish`）是沿用上游的旧流程，之后逐个替换或删除；换掉时直接删文件，不要往这里搬。

## 加一个检查

1. 本目录写脚本。Node 24 能直接跑 TypeScript（`node ci/xxx.ts`），不装依赖，所以能在没有 `npm ci` 的 job 里跑。
2. `package.json` 加一条 `npm run` script。
3. `ci.yml` 里加一个 step；需要 `node_modules` 的检查放进带 `npm ci` 缓存的 job。
4. 逻辑里能单独测的部分，在 `test/unit/` 补一条用例（参考 `versionPolicy.test.ts`）。
