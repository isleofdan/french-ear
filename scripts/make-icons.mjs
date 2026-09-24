// Draws public/icons/icon-192.png and icon-512.png from icon.svg.
//   node scripts/make-icons.mjs
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath: exe });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(dir, `icon-${size}.png`), omitBackground: false });
  await page.close();
}
await browser.close();
console.log('icons written');
