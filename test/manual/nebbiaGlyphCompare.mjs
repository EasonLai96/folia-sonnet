// test/manual/nebbiaGlyphCompare.mjs
// 手动脚本：同一个场景、同一个时间点，分别用「笔顺数据」和「跟随字体」各截一张真实 NebbiaRuntime 的画面，并打印每种来源排出几个字形。
// 先 `node test/manual/nebbiaServe.mjs --strokes native --port 4319`，再 `node test/manual/nebbiaGlyphCompare.mjs --url http://127.0.0.1:4319 --out preview/glyph`。
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (key, fallback) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback);
const base = arg('--url', 'http://127.0.0.1:4319');
const out = path.resolve(arg('--out', 'preview/glyph'));
await fs.mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: arg('--channel', 'msedge'), headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
    for (const scenario of ['complex', 'single']) {
        for (const glyph of ['strokes', 'font']) {
            const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-TW' });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(String(error.stack ?? error)));
            await page.goto(`${base}/test/manual/nebbiaMobile.html?case=${scenario}&stroke=0.06&time=10&glyph=${glyph}`, { waitUntil: 'networkidle', timeout: 120000 });
            await page.waitForFunction(() => window.__nebbiaFailure || (window.__nebbiaReady && window.__nebbiaFirstFrame), undefined, { timeout: 120000 });
            const failure = await page.evaluate(() => window.__nebbiaFailure);
            if (failure) throw new Error(failure);
            await page.waitForTimeout(1500);
            await page.evaluate(async () => {
                window.__nebbiaProbe.redraw();
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            });
            const info = await page.evaluate(() => {
                const probe = window.__nebbiaProbe.inspect();
                return { source: probe.strokeSource, glyphs: probe.chars.length, strokes: probe.chars.map(c => c.strokes) };
            });
            await page.screenshot({ path: path.join(out, `${scenario}-${glyph}.png`) });
            console.log(`${scenario} glyph=${glyph} -> rendered glyphs=${info.glyphs} strokeSource=${info.source} strokesPerChar=[${info.strokes.join(',')}] errors=${errors.length}`);
            await context.close();
        }
    }
} finally {
    await browser.close();
}
