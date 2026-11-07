import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Screenshots the real paused runtime at fixed lyric time; no mock glyph or substitute renderer.
const args = process.argv.slice(2);
const arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const base = arg('--url', 'http://127.0.0.1:4317');
const out = path.resolve(arg('--out', '../artifacts/nebbia-mobile-20261107/baseline/skeleton'));
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: arg('--channel', 'msedge'), headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
try {
    for (const viewport of [{ width: 360, height: 640 }, { width: 393, height: 852 }]) {
        for (const scenario of ['complex', 'long', 'single']) {
            for (const stroke of [0.09, 0.04]) {
                const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-TW' });
                const page = await context.newPage();
                const errors = [];
                page.on('pageerror', error => errors.push(String(error.stack ?? error)));
                const url = `${base}/test/manual/nebbiaMobile.html?case=${scenario}&stroke=${stroke}&time=10`;
                await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
                await page.waitForFunction(() => window.__nebbiaFailure || (window.__nebbiaReady && window.__nebbiaFirstFrame && window.__nebbiaProbe.inspect().chars.length > 0), undefined, { timeout: 120000 });
                const failure = await page.evaluate(() => window.__nebbiaFailure);
                if (failure) throw new Error(failure);
                await page.evaluate(async () => {
                    window.__nebbiaProbe.redraw();
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                });
                const diagnostics = await page.evaluate(() => window.__nebbiaProbe.inspect());
                const stem = `${scenario}-${viewport.width}x${viewport.height}-stroke-${stroke}`;
                const image = await page.screenshot({ path: path.join(out, `${stem}.png`) });
                results.push({ ...diagnostics, url, image: `${stem}.png`, sha256: createHash('sha256').update(image).digest('hex'), errors });
                if (scenario === 'complex' && stroke === 0.09) {
                    await page.evaluate(() => window.__nebbiaProbe.togglePanel());
                    await page.locator('#nebbia-settings').waitFor();
                    await page.screenshot({ path: path.join(out, `settings-${viewport.width}x${viewport.height}.png`) });
                    const panelGeometry = await page.locator('#nebbia-settings').evaluate(el => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, sliders: el.querySelectorAll('[role="slider"],input[type="range"]').length }));
                    const slider = page.locator('#nebbia-settings input[type="range"]').first();
                    await slider.fill('0.04');
                    await page.waitForFunction(() => window.__nebbiaTuning.strokeWidth === 0.04);
                    await page.screenshot({ path: path.join(out, `settings-min-${viewport.width}x${viewport.height}.png`) });
                    results.push({ panelGeometry, viewport, touchStrokeValue: await page.evaluate(() => window.__nebbiaTuning.strokeWidth) });
                }
                console.log(`[Nebbia capture] ${stem} glyphs=${diagnostics.chars.length} source=${diagnostics.strokeSource} min=${diagnostics.minCharSize.toFixed(2)}`);
                await context.close();
            }
        }
    }
} finally {
    await fs.writeFile(path.join(out, 'measurements.json'), JSON.stringify({ renderer: 'production NebbiaRuntime', browser: browser.version(), results }, null, 2));
    await browser.close();
}
