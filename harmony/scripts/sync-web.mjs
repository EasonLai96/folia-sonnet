#!/usr/bin/env node
/**
 * 把 folia-sonnet 的前端产物同步进鸿蒙工程的 rawfile，并给 index.html 注入桥接脚本。
 *
 * 用法：
 *   node scripts/sync-web.mjs
 *   node scripts/sync-web.mjs --dist ../dist --prune
 *
 * 每次改了前端、跑完 `npm run build` 之后都要再跑一次，否则打出来的包里还是旧页面。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

// 工程在 folia-sonnet/harmony 下，产物就是仓库根的 dist。
const DIST_DIR = path.resolve(readArg('dist', path.join(projectRoot, '..', 'dist')));
const WEB_DIR = path.join(projectRoot, 'entry', 'src', 'main', 'resources', 'rawfile', 'web');
const BRIDGE_TAG = '<script src="/__folia/bridge.js"></script>';
const prune = args.includes('--prune');

if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error(`[folia] 找不到前端产物：${DIST_DIR}`);
  console.error('[folia] 先在 folia-sonnet 里跑 npm run build，或用 --dist 指定目录。');
  process.exit(1);
}

fs.mkdirSync(WEB_DIR, { recursive: true });

const collect = (dir, base = dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, base, out);
    } else {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out;
};

const sourceFiles = collect(DIST_DIR);
let copied = 0;
let skipped = 0;

for (const rel of sourceFiles) {
  const from = path.join(DIST_DIR, rel);
  const to = path.join(WEB_DIR, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const sourceStat = fs.statSync(from);
  let shouldCopy = true;
  if (fs.existsSync(to)) {
    const targetStat = fs.statSync(to);
    shouldCopy = sourceStat.size !== targetStat.size || sourceStat.mtimeMs > targetStat.mtimeMs;
  }
  if (!shouldCopy) {
    skipped += 1;
    continue;
  }
  fs.copyFileSync(from, to);
  copied += 1;
}

// 删掉产物里已经没有的旧文件。默认不开：这台机器上批量删除偶尔会被安全策略拦下。
let removed = 0;
if (prune) {
  const keep = new Set(sourceFiles);
  for (const rel of collect(WEB_DIR)) {
    if (keep.has(rel)) {
      continue;
    }
    fs.rmSync(path.join(WEB_DIR, rel), { force: true });
    removed += 1;
  }
}

const indexPath = path.join(WEB_DIR, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes('/__folia/bridge.js')) {
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (match) => `${match}\n    ${BRIDGE_TAG}`);
  } else {
    html = `${BRIDGE_TAG}\n${html}`;
  }
  fs.writeFileSync(indexPath, html);
  console.log('[folia] index.html 已注入桥接脚本');
} else {
  console.log('[folia] index.html 里已经有桥接脚本，跳过注入');
}

const manifest = {
  syncedAt: new Date().toISOString(),
  source: DIST_DIR,
  fileCount: sourceFiles.length,
};
fs.writeFileSync(path.join(WEB_DIR, 'folia-sync.json'), JSON.stringify(manifest, null, 2));

console.log(`[folia] 同步完成：新增/更新 ${copied}，未变化 ${skipped}，清理 ${removed}`);
console.log(`[folia] 产物目录：${WEB_DIR}`);
