const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('shell edits are applied and idempotent', () => {
  assert.match(html, /<link rel="stylesheet" href="refinements\.css\?v=\d+">/);
  assert.match(html, /<script src="refinements\.js\?v=\d+" defer><\/script>/);
  assert.match(html, /<span class="data-version"[^>]*><strong>2\.460<\/strong> 資料版本<\/span>/);
  assert(html.includes('scopes.has(card.dataset.scope) || Boolean(term);'));
  execFileSync('python', ['scripts/update-shell.py', '--check'], { cwd: root });
});

test('skills come first: compact showcase, readable meta, grouped Lv.200, search across scopes', { timeout: 120000 }, async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const errors = [];
    const open = async (viewport, mobile) => {
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('#skill-config-open');
      return page;
    };

    const desktop = await open({ width: 1440, height: 900 }, false);
    const section = '.job-section[data-job="SoulMaster"]';
    // The first skill card is visible without scrolling.
    const firstCard = await desktop.locator(`${section} .skill-card:visible`).first().boundingBox();
    assert(firstCard.y + 40 < 900, `first card at ${firstCard.y}`);
    // Meta is readable, raw value kept for tooling.
    const meta = desktop.locator(`${section} .skill-card[data-stage="lv1"] .skill-meta`).first();
    assert.equal(await meta.textContent(), '一轉・主動・Lv.3 開放・最高 10 級');
    assert.equal(await meta.getAttribute('data-raw-meta'), '技能樹 / 職業專屬 / First / Active / Open Lv 3 / MaxLv 10');
    assert.equal(await desktop.locator('.skill-meta').evaluateAll(nodes => nodes.filter(n => /VSkill|HexaCoreSkill|Open Lv|MaxLv/.test(n.textContent)).length), 0);
    // Lv.200 is grouped; enhancement cards carry their core number and follow it.
    const heads = await desktop.locator(`${section} .stage-section[data-stage-group="lv200"] .skill-subhead:visible`).evaluateAll(nodes => nodes.map(n => n.firstChild.textContent));
    assert.deepEqual(heads, ['技能核心', '強化核心', '共用核心']);
    const numbers = await desktop.locator(`${section} .skill-card[data-core="v_boost"]:visible`).evaluateAll(cards => cards
      .map(c => ({ n: Number(c.querySelector('.skill-icon').dataset.coreNumber), y: c.getBoundingClientRect().top, x: c.getBoundingClientRect().left }))
      .sort((a, b) => a.y - b.y || a.x - b.x).map(c => c.n));
    assert.equal(numbers.length, 11);
    assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
    assert.deepEqual([...new Set(numbers)], [1, 2, 3, 4, 5, 6]);
    // The sticky toolbar sits flush under the header.
    await desktop.mouse.wheel(0, 1400);
    await desktop.waitForTimeout(300);
    const gap = await desktop.evaluate(() => document.querySelector('.content-toolbar').getBoundingClientRect().top - document.querySelector('header.page-header').getBoundingClientRect().bottom);
    assert(gap >= 0 && gap <= 4, `toolbar gap ${gap}`);
    // A text search finds common cores although the default scope filter hides them; sub-heads follow the filter.
    await desktop.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await desktop.locator(`${section} .skill-card:visible`, { has: desktop.locator('h3', { hasText: /^太陽之冠$/ }) }).count(), 0);
    await desktop.locator('#q').fill('太陽之冠');
    await desktop.locator(`${section} .skill-card:visible`, { has: desktop.locator('h3', { hasText: /^太陽之冠$/ }) }).waitFor();
    assert.equal(await desktop.locator(`${section} .skill-card:visible`).count(), 1);
    assert.deepEqual(await desktop.locator(`${section} .skill-subhead:visible`).evaluateAll(nodes => nodes.map(n => n.firstChild.textContent)), ['共用核心']);
    await desktop.close();

    const phone = await open({ width: 390, height: 844 }, true);
    assert.equal(await phone.evaluate(() => document.body.classList.contains('view-list')), true);
    const phoneCard = await phone.locator(`${section} .skill-card:visible`).first().boundingBox();
    assert(phoneCard.y < 844, `first card at ${phoneCard.y}`);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await phone.close();
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
