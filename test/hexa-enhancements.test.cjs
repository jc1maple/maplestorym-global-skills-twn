const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/hexa-enhancements.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function total(code, level, effect) {
  return data.cores.find(c => c.code === code).rules.filter(r => r.effect === effect && level >= r.minLevel)
    .reduce((sum, r) => sum + r.value * (r.perLevel ? level - r.minLevel + 1 : 1) / r.divide, 0);
}

test('205 unique cores retain all translated rule families and exact milestone arithmetic', () => {
  assert.equal(data.cores.length, 205);
  assert.equal(new Set(data.cores.map(c => c.code)).size, 205);
  assert.equal((html.match(/data-hexa-core=/g) || []).length, 205);
  assert.equal((html.match(/HEXA core enhance type:/g) || []).length, 0);
  assert.deepEqual(data.coverage.missingTranslations, []);
  for (const suffix of ['AdrenalineSurge', 'BrandishMaha', 'FinalBeyonder', 'BlizzardTempest']) {
    assert.deepEqual([1, 2, 9, 10, 19, 20, 29, 30].map(l => total('Enhance_Aran_' + suffix, l, 'DamageUp')), [11, 12, 19, 25, 34, 40, 49, 60]);
  }
  assert.equal(total('Enhance_Bishop_Benediction', 30, 'DamageAddPermill'), 12);
  assert.equal(total('Enhance_Paladin_DivineEcho', 30, 'BonusDamagePermill'), 10);
  for (const core of data.cores) {
    for (const r of core.rules) {
      assert(!r.description.includes('MISSING'));
      assert.match(r.applied, /\{2\}/);
      assert(r.divide > 0);
    }
  }
  execFileSync('python', ['scripts/update-hexa-enhancements.py', '--check'], { cwd: root });
});

test('HEXA tables remain inside cards, work by mouse and keyboard on desktop/mobile', { timeout: 90000 }, async () => {
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
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
    await page.goto(url);
    await page.locator('#job').selectOption('Aran', { force: true });
    const panel = page.locator('[data-hexa-core="Enhance_Aran_BrandishMaha"]');
    const card = page.locator('.skill-card').filter({ has: panel });
    assert.equal(await panel.isVisible(), false);
    await card.locator('.skill-title').click();
    assert.equal(await panel.isVisible(), true);
    assert.match(await panel.innerText(), /每升 1 級：最終傷害增加\s*1%/);
    assert.match(await panel.innerText(), /Lv\.30 累計[\s\S]*最終傷害增加60%/);
    const details = panel.locator('details');
    await details.locator('summary').click();
    assert.equal(await details.getAttribute('open'), '');
    assert.equal(await panel.locator('tbody tr').count(), 30);
    assert.match(await panel.locator('tbody tr').nth(9).innerText(), /10\s+最終傷害增加6%\s+最終傷害增加25%/);
    await details.locator('summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await details.getAttribute('open'), null);
    assert.equal(await panel.isVisible(), true);
    await page.keyboard.press('Space');
    assert.equal(await details.getAttribute('open'), '');
    assert.equal(await panel.isVisible(), true);
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'maple-hexa-'));
    await card.screenshot({ path: path.join(output, 'desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await card.scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(await card.evaluate(el => el.clientHeight < 600));
    await card.screenshot({ path: path.join(output, 'mobile.png') });
    assert.deepEqual(errors, []);
    console.log('HEXA screenshots:', output);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
