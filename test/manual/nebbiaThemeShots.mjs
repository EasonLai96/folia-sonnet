// test/manual/nebbiaThemeShots.mjs
// 手动脚本：在 probe 页（?probe=nebbiaQuickSliders）上切日夜和强调色，各截一张面板，证明滑块组的颜色跟着面板主题走。
// 用法：先 `node test/render/preview.mjs --page "/dev-probe.html?probe=nebbiaQuickSliders"` 让 5199 的 dev server 在跑，
// 或自己起 vite；再 `node test/manual/nebbiaThemeShots.mjs --url http://127.0.0.1:5199 --out preview/theme`。
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const read = (name, fallback) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const base = read('url', 'http://127.0.0.1:5199');
const out = path.resolve(read('out', 'preview/theme'));
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
    const page = await browser.newPage({ viewport: { width: 480, height: 1100 } });
    await page.goto(`${base}/dev-probe.html?probe=nebbiaQuickSliders`, { waitUntil: 'load' });
    const panel = page.locator('[data-testid="nebbia-quick-probe"]');
    await panel.waitFor();
    const shot = async (name) => {
        const file = path.join(out, `${name}.png`);
        await panel.screenshot({ path: file });
        console.log(file);
    };
    const click = (toggle) => page.locator(`[data-probe-toggle="${toggle}"]`).click();
    await shot('night-default-accent');
    await click('accent'); await shot('night-accent-orange');
    await click('accent'); await shot('night-accent-blue');
    await click('daylight'); await shot('day-accent-blue');
    await click('accent'); await shot('day-default-accent');
    await click('accent'); await shot('day-accent-orange');
} finally {
    await browser.close();
}
