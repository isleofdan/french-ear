// Makes the picture fixtures for the screenshot path: phone screenshots of a
// transcript panel, drawn here (synthetic: no real screenshot from the YouTube
// app was to hand when they were first made), the way the YouTube app on
// Dan's phone shows it (seen 25 Sep): a dark panel, each entry one row, the
// time on the left and the French text beside it, wrapping under itself.
// Also a picture with no transcript in it. Real screenshots sit beside these;
// test/fixtures/pictures/README.md says which is which. Written to test/fixtures/pictures/; the answers a model
// would give for each are in answers.json beside them.
//   node scripts/make-picture-fixtures.mjs
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'test', 'fixtures', 'pictures');
mkdirSync(dir, { recursive: true });
const answers = JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8'));

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const panel = (entries, { cutTop = null, cutBottom = null } = {}) => `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; background: #0f0f0f; color: #f1f1f1; font: 15px Roboto, Arial, sans-serif; width: 412px; height: 915px; overflow: hidden; }
  .bar { height: 24px; font-size: 12px; padding: 4px 16px; display: flex; justify-content: space-between; color: #ddd; }
  .video { height: 232px; background: linear-gradient(135deg, #3a2f28, #6b5a4a); }
  .head { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid #333; font-size: 18px; font-weight: 600; }
  .head span { font-size: 22px; font-weight: 400; }
  .entry { padding: 10px 16px; display: flex; gap: 14px; align-items: flex-start; }
  .t { flex: none; min-width: 34px; background: #272727; border-radius: 4px; padding: 2px 6px; font-size: 12px; font-weight: 600; text-align: center; }
  .x { font-size: 15px; line-height: 1.35; }
  .cut { color: #f1f1f1; opacity: .9; }
</style>
<div class="bar"><span>10:42</span><span>▾ ▴ 83%</span></div>
<div class="video"></div>
<div class="head">Transcript <span>⋮ ✕</span></div>
${cutTop ? `<div class="entry cut" style="margin-top:-30px"><div class="x">${esc(cutTop)}</div></div>` : ''}
${entries.map(([t, x]) => `<div class="entry"><div class="t">${t}</div><div class="x">${esc(x)}</div></div>`).join('\n')}
${cutBottom ? `<div class="entry cut"><div class="t">${cutBottom}</div></div>` : ''}`;

const lines = (name) => answers[name].answer.lines.filter((l) => l.text).map((l) => [l.time, l.text]);

const pages = {
  'shot-1.png': panel(lines('shot-1.png')),
  'shot-2.png': panel(lines('shot-2.png'), { cutTop: 'nouvel épisode d’iz French.', cutBottom: '1:50' }),
  'shot-accents.png': panel(lines('shot-accents.png')),
  'no-transcript.png': `<!doctype html><meta charset="utf-8"><style>body{margin:0;width:412px;height:915px;background:linear-gradient(#f7b267,#f25f5c 60%,#247ba0);font:22px Arial;color:#fff}
    p{margin:0;padding:40px 24px}</style><p>10:42</p><p style="font-size:40px;padding-top:300px">Coucher de soleil<br><small style="font-size:18px">Photo, 14 juillet</small></p>`,
};

// A photo of a TV paused on a subtitle: a dark frame, a picture behind, the
// subtitle in white at the bottom, a little skewed as a phone held by hand.
const tv = (subtitle) => `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; width: 800px; height: 600px; background: #1b1916; display: flex; align-items: center; justify-content: center; }
  .tv { width: 700px; height: 400px; background: #050505; border-radius: 10px; padding: 14px; transform: rotate(-2deg); box-shadow: 0 0 0 6px #2a2622; }
  .screen { position: relative; width: 100%; height: 100%; background: linear-gradient(160deg, #394b59, #2b2a33 55%, #54443a); overflow: hidden; }
  .who { position: absolute; left: 180px; top: 70px; width: 150px; height: 230px; border-radius: 75px 75px 20px 20px; background: #6d5a4d; }
  .sub { position: absolute; left: 0; right: 0; bottom: 34px; text-align: center; font: 600 26px Arial, sans-serif; color: #fff; text-shadow: 0 0 4px #000, 0 0 2px #000; }
</style><div class="tv"><div class="screen"><div class="who"></div>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}</div></div>`;
const tvPages = {
  'tv-english.png': tv(answers['tv-english.png'].answer.text),
  'tv-french.png': tv(answers['tv-french.png'].answer.text),
  'tv-none.png': tv(''),
};

const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
for (const [name, html] of Object.entries(pages)) {
  await page.setContent(html);
  await page.screenshot({ path: join(dir, name) });
  console.log(`wrote ${name}`);
}
const wide = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
for (const [name, html] of Object.entries(tvPages)) {
  await wide.setContent(html);
  await wide.screenshot({ path: join(dir, name), type: name.endsWith('.jpg') ? 'jpeg' : 'png' });
  console.log(`wrote ${name}`);
}
await browser.close();
