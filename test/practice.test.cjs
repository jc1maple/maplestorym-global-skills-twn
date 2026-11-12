const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/aran-practice.json'), 'utf8'));

test('practice data: every skill has timings, an icon and (where listed) an existing effect sheet', () => {
  assert.equal(data.skills.length, 20);
  for (const skill of data.skills) {
    assert(fs.existsSync(path.join(root, skill.icon)), skill.icon);
    if (skill.preview) assert(fs.existsSync(path.join(root, skill.preview.src.split('?')[0])), skill.preview.src);
    if (skill.preview) assert.equal(skill.preview.durations.length, skill.preview.frames, skill.id);
  }
});

test('practice ground: move, combo into the auto follow-ups, cooldown, 120 s counter', { timeout: 60000 }, async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/practice.html`, { waitUntil: 'load' });
    await page.waitForSelector('.pr-slot');
    assert.equal(await page.locator('.pr-slot').count(), 10);
    const start = await page.evaluate(() => window.practice.state().player.x);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowRight');
    assert(await page.evaluate(() => window.practice.state().player.x) > start + 80);
    for (let i = 0; i < 3; i += 1) { await page.keyboard.press('KeyQ'); await page.waitForTimeout(420); }
    await page.waitForTimeout(1200);
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(900);
    const state = await page.evaluate(() => { const s = window.practice.state(); return { hits: s.hits, stats: s.stats, cooling: Object.keys(s.cooldown), started: s.startedAt !== null }; });
    assert.equal(state.stats['比耀德 VI・青龍'].hits, 7);
    assert.equal(state.stats['終極比耀德・白虎'].hits, 20);
    assert.equal(state.stats['瑪哈一擊'].hits, 30);
    assert.equal(state.stats['極冰風暴'].hits, 256);
    assert.equal(state.hits, 7 * 3 + 20 + 30 + 256);
    assert.deepEqual(state.cooling, ['tempest']);
    assert.equal(state.started, true);
    assert(Number(await page.locator('#hud-time').textContent()) < 120);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
