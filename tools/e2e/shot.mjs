// 빠른 캡처: node tools/e2e/shot.mjs <url> <out.png> [width] [height] [demo]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PKG || 'playwright');
const [url, out, w = '1366', h = '768', demo = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
if (demo) await page.addInitScript(() => { try { sessionStorage.setItem('ai-office.demo-session', '1'); } catch {} });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: out, fullPage: false });
console.log(logs.filter(l => !l.includes('[debug]')).join('\n'));
await browser.close();
