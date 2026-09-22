const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const selectPattern = /<select id="job"[^>]*>[\s\S]*?<\/select>/;
const select = html.match(selectPattern)[0];
const classLabels = { Warrior: '戰士', Mage: '法師', Bowman: '弓箭手', Thief: '盜賊', Pirate: '海盜' };
const labels = [...Object.values(classLabels), '其他'];
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/stella-skills.json'), 'utf8'));
const options = text => [...text.matchAll(/<option value="([^"]*)"[^>]*>([^<]+)<\/option>/g)].map(m => ({ value: m[1], name: m[2] }));

test('all jobs appear once under the existing Global/TWN class mapping', () => {
  const groups = [...select.matchAll(/<optgroup label="([^"]+)">([\s\S]*?)<\/optgroup>/g)];
  assert.deepEqual(groups.map(g => g[1]), labels);
  assert.deepEqual(groups.map(g => options(g[2]).length), [12, 12, 8, 8, 8, 1]);
  for (const [ , label, body] of groups) {
    for (const option of options(body)) {
      if (option.value === 'GenesisWeapon') assert.equal(label, '其他');
      else assert.equal(label, classLabels[data.job_mapping[option.value].core_page.replace('ConstellaCore_', '')]);
    }
  }
  const rows = options(select);
  assert.equal(rows.length, 50);
  assert.equal(new Set(rows.map(r => r.value)).size, 50);
  assert.equal(rows[0].value, '');
  const sections = [...html.matchAll(/<section class="job-section" data-job="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(rows.map(r => r.value).filter(Boolean).sort(), sections.sort());
  assert.match(select, /<option value="SoulMaster" selected>/);
});

test('skill content and all existing option names/values remain unchanged', () => {
  // Pinned published baseline; keeps this regression useful after committing.
  const before = execFileSync('git', ['show', '943b010:index.html'], { cwd: root, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  const normalize = s => s.replace(/\r\n/g, '\n').replace(selectPattern, '<select id="job"></select>')
    .replace(/(modern(?:-ui\.js|\.css))\?v=[^"\s]+/g, '$1?v=VERSION');
  assert.equal(normalize(html), normalize(before));
  assert.deepEqual(options(select).sort((a, b) => a.value.localeCompare(b.value)),
    options(before.match(selectPattern)[0]).sort((a, b) => a.value.localeCompare(b.value)));
});

async function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !['GET', 'HEAD'].includes(req.method) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end(); return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

test('grouped picker: mouse, keyboard, preset badges, native fallback and mobile', { timeout: 120000 }, async () => {
  const { server, url } = await serve();
  let browser;
  const output = process.env.JOB_PICKER_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'maple-job-picker-'));
  fs.mkdirSync(output, { recursive: true });
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.pathname === '/visitor-logger-config.js') {
        return route.fulfill({ contentType: 'text/javascript', body: `window.MSM_SKILL_CONFIG_ENDPOINT=${JSON.stringify(url + 'test-api')};` });
      }
      if (requestUrl.origin === new URL(url).origin && requestUrl.pathname === '/test-api/skill-defaults/index') {
        return route.fulfill({ json: { ok: true, results: [{ job_code: 'Cannoneer' }] } });
      }
      if (requestUrl.pathname.startsWith('/test-api/')) return route.fulfill({ json: { ok: true, results: [] } });
      return requestUrl.origin === new URL(url).origin ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url, { waitUntil: 'load' });
    const trigger = page.locator('.job-picker-trigger');
    const option = value => page.locator(`.job-picker-option[data-value="${value}"]`);
    await trigger.waitFor();
    assert.equal(await page.locator('#job').inputValue(), 'SoulMaster');
    await trigger.click();
    assert.deepEqual(await page.locator('.job-picker-group-label > span:first-child').allTextContents(), labels);
    assert.equal(await page.getByRole('group', { name: '戰士', exact: true }).getByRole('option').count(), 12);
    assert.equal(await page.getByRole('option').count(), 50);
    await page.screenshot({ path: path.join(output, 'desktop-warrior.png') });
    await option('Erel').click();
    await trigger.press('ArrowDown'); // opens on Erel, last warrior
    await trigger.press('ArrowDown'); // crosses the heading to first mage
    const active = await trigger.getAttribute('aria-activedescendant');
    assert.equal(await page.locator('#' + active).getAttribute('data-value'), 'FlameWizard');
    await trigger.press('Enter');
    assert.equal(await page.locator('#job').inputValue(), 'FlameWizard');
    await page.locator('.job-section[data-job="FlameWizard"]').waitFor({ state: 'visible' });
    await trigger.click();
    await trigger.press('ArrowUp');
    await trigger.press('Enter');
    assert.equal(await page.locator('#job').inputValue(), 'Erel');
    await trigger.click();
    await trigger.press('Home');
    await trigger.press('Enter');
    assert.equal(await page.locator('#job').inputValue(), '');
    await page.waitForFunction(() => [...document.querySelectorAll('.job-section')].filter(s => !s.hidden).length === 49);
    await trigger.click();
    await trigger.press('End');
    await trigger.press('Enter');
    assert.equal(await page.locator('#job').inputValue(), 'GenesisWeapon');
    for (const code of ['SoulMaster', 'Lara', 'Kain', 'Xenon', 'Cannoneer']) {
      await trigger.click();
      await option(code).click();
      assert.equal(await page.locator('#job').inputValue(), code);
      await page.locator(`.job-section[data-job="${code}"]`).waitFor({ state: 'visible' });
    }
    await page.locator('.job-field.has-published-default').waitFor();
    assert.equal(await page.locator('.job-picker-current-badge').isVisible(), true);
    await trigger.click();
    assert.match(await option('Cannoneer').getAttribute('class'), /is-published/);
    await page.screenshot({ path: path.join(output, 'desktop-pirate.png') });
    await trigger.press('Escape');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.click();
    await option('SoulMaster').click();
    await trigger.click();
    const bounds = await page.locator('.job-picker-menu').boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    assert(bounds.y + bounds.height <= 845);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(output, 'mobile-warrior.png') });
    await option('Cannoneer').click();
    assert.equal(await page.locator('#job').inputValue(), 'Cannoneer');
    await page.locator('#skill-config-open').click();
    await page.locator('.sc-shell:not([hidden])').waitFor();
    assert((await page.locator('.sc-shell').innerText()).includes('重砲指揮官'));
    assert.deepEqual(errors, []);
    await context.close();
    const fallback = await browser.newContext({ javaScriptEnabled: false });
    await fallback.route('**/*', r => new URL(r.request().url()).origin === new URL(url).origin ? r.continue() : r.abort());
    const nativePage = await fallback.newPage();
    await nativePage.goto(url);
    assert.equal(await nativePage.locator('#job').isVisible(), true);
    assert.equal(await nativePage.locator('#job optgroup').count(), 6);
    assert.equal(await nativePage.locator('#job').inputValue(), 'SoulMaster');
    await fallback.close();
    console.log(`Screenshots: ${output}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
