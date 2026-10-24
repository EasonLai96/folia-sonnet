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

## 提 PR：不熟 GitHub 就照着抄

```text
git switch -c fix/登录超时 origin/dev                  # 1. 从 dev 切一个分支，别再往 main/dev 上写
# ...改代码...
git add -A && git commit -m "fix: 登录超时后不再卡住"    # 2. 提交
npm run pr -- "fix: 登录超时后不再卡住"                  # 3. 本地门禁 → 推分支 → 建 PR（一条命令）
gh pr checks <PR号> --watch                             # 4. 盯 CI，绿了再去要 review
```

`npm run pr` 会做这些事，做不了就当场说清楚原因：

- 拒绝在 `main` / `dev` 上直接提 PR；
- 拒绝还有没提交的改动；
- 先跑 `npm run ci:local`（加 `--skip-ci` 可跳过，但 CI 照样拦你）；
- `git push -u origin` 当前分支，再 `gh pr create --base dev`；
- 最后打印「盯 CI」和「要 review」的命令。

没装 `gh`（GitHub 命令行）时：`winget install GitHub.cli`（macOS `brew install gh`），然后 `gh auth login` 按提示走一遍。

**Windows 上的已知失败**：`npm run ci:local` 里 `test/unit/mod-system/modSignature.test.ts` 有一条用例要在临时目录建符号链接，没开「开发者模式」或不是管理员时会被 EPERM 拒。不是你改出来的；其余通过就能开 PR，这一项以 Linux 的 CI 为准。

**合并前必须有 review**（至少一次 AI review，必须发在 GitHub 的 PR 上）：`gh pr review <PR号> --comment --body-file review.md`。只在聊天里说「看过了」不算。

## 加一个检查

1. 本目录写脚本。Node 24 能直接跑 TypeScript（`node ci/xxx.ts`），不装依赖，所以能在没有 `npm ci` 的 job 里跑。
2. `package.json` 加一条 `npm run` script。
3. `ci.yml` 里加一个 step；需要 `node_modules` 的检查放进带 `npm ci` 缓存的 job。
4. 逻辑里能单独测的部分，在 `test/unit/` 补一条用例（参考 `versionPolicy.test.ts`）。
