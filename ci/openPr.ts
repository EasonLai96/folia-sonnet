// ci/openPr.ts
// 一键提 PR：本地门禁 → 推当前分支 → 建发往 dev 的 PR → 打印接下来要盯什么。
// 用法：npm run pr -- "fix: 一句话标题" [--watch] [--skip-ci] [--base dev]
//
// 写给不熟 GitHub 的同学：除了改代码和写提交信息，其余步骤都由这里代劳。
// 它不替你合并 PR，也不替你要 review。

import { spawnSync } from 'node:child_process';

const USAGE = `用法：npm run pr -- "标题" [选项]

  --base <分支>   目标分支，默认 dev
  --watch         建完 PR 直接盯 CI 到出结果
  --skip-ci       跳过本地门禁（不建议，CI 会照样拦）

完整例子：
  git switch -c fix/login-timeout origin/dev
  git add -A && git commit -m "fix: 登录超时后不再卡住"
  npm run pr -- "fix: 登录超时后不再卡住"
`;

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(arg => arg.startsWith('--')));
const optionValue = (name: string, fallback: string): string => {
    const index = argv.indexOf(name);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const title = argv.find((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--base');

if (flags.has('--help') || flags.has('-h') || argv.length === 0) {
    console.log(USAGE);
    process.exit(argv.length === 0 ? 1 : 0);
}
if (!title) {
    console.error('缺少标题。\n\n' + USAGE);
    process.exit(1);
}
// 收窄成 string：main() 里不能再带着 undefined 的类型。
const prTitle: string = title;

const base = optionValue('--base', 'dev');
const watch = flags.has('--watch');
const skipCi = flags.has('--skip-ci');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command: string, args: string[], capture = false): string {
    const result = spawnSync(command, args, {
        stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
        encoding: 'utf8',
    });
    if (result.error || result.status !== 0) {
        console.error(`\n[pr] 这一步失败了：${command} ${args.join(' ')}`);
        process.exit(result.status ?? 1);
    }
    return (result.stdout ?? '').trim();
}

function main(): void {
    run('gh', ['--version'], true);
    run('gh', ['auth', 'status'], true);

    const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], true);
    if (branch === 'main' || branch === 'dev') {
        console.error(`[pr] 不能直接往 ${branch} 提 PR。先切分支：git switch -c fix/你的改动 origin/dev`);
        process.exit(1);
    }
    if (run('git', ['status', '--porcelain'], true)) {
        console.error('[pr] 还有没提交的改动。先 git add -A && git commit -m "..."，再跑一次。');
        process.exit(1);
    }

    console.log(`\n[pr] 分支 ${branch} → 目标 ${base}\n`);
    if (skipCi) {
        console.warn('[pr] 已跳过本地门禁。规则要求 PR 前必须本地跑通，CI 会照样检查。\n');
    } else {
        console.log('[pr] 1/3 本地门禁（与 CI 同一套）');
        run(npm, ['run', 'ci:local']);
    }

    console.log('\n[pr] 2/3 推分支');
    run('git', ['push', '-u', 'origin', 'HEAD']);

    console.log('\n[pr] 3/3 建 PR');
    const body = [
        '## 改了什么',
        '（一句话说明改了什么、为什么）',
        '',
        '## 检查',
        `- [${skipCi ? ' ' : 'x'}] 本地 \`npm run ci:local\``,
        '- [ ] 远端 CI 全绿',
        '- [ ] 已拿到 review（至少 AI review）',
    ].join('\n');
    const url = run('gh', ['pr', 'create', '--base', base, '--title', prTitle, '--body', body], true);
    console.log(url);

    console.log('\n[pr] 接下来必须做：\n  gh pr checks <编号> --watch     # 等到全绿\n  gh pr review <编号> --comment  # 至少一条 AI review，然后才能合');
    if (watch) run('gh', ['pr', 'checks', url, '--watch', '--interval', '30']);
}

main();
