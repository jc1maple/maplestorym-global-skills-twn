const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/boris-skills.json'), 'utf8'));
const section = html.split('<section class="job-section" data-job="Boris"')[1].split('<!-- job-boris:end -->')[0];
const cards = [...section.matchAll(/<article class="skill-card\b[\s\S]*?<\/article>/g)].map(m => m[0]);

test('波里斯 has its 37 skill-tree cards, grouped by stage, with icons', () => {
  assert.equal(data.skills.length, 37);
  assert.equal(cards.length, 37);
  assert.equal(new Set(data.skills.map(s => s.code)).size, 37);
  const stages = Object.fromEntries([...section.matchAll(/data-stage-group="([^"]+)">\s*<header class="stage-header">\s*<h3>[^<]+<\/h3>\s*<span>(\d+)<\/span>/g)].map(m => [m[1], Number(m[2])]));
  assert.deepEqual(stages, { lv1: 3, lv30: 3, lv60: 2, lv100: 3, hyper: 26 });
  for (const skill of data.skills) {
    assert(skill.name && skill.description, skill.code);
    assert(fs.statSync(path.join(root, skill.icon_file)).size > 100, skill.icon_file);
    assert.equal(cards.filter(c => c.includes(`<h3>${skill.name}</h3>`) && c.includes(` ${skill.code.toLowerCase()} `)).length, 1, skill.code);
  }
  assert(section.includes('技能傷害: 530%'));
  assert(section.includes('物理攻擊力增加: 25%'));
  assert(section.includes('迴避率: 15%'));
  assert(!cards.some(c => /data-core="(?!none)/.test(c)));
  assert(html.includes('<strong>50</strong> 個職業'));
  for (const script of ['update-boris.py', 'update-vcore-enhancement.py', 'update-boss-vcore.py', 'update-skill-text.py']) {
    execFileSync('python', ['scripts/' + script, '--check'], { cwd: root });
  }
});

test('波里斯 can be picked, browsed and used in the skill configurator', { timeout: 90000 }, async () => {
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    await page.waitForSelector('#skill-config-open');
    await page.locator('.job-picker-trigger').click();
    await page.locator('.job-picker-option[data-value="Boris"]').click();
    const own = page.locator('.job-section[data-job="Boris"] .skill-card:visible');
    await own.first().waitFor({ state: 'visible' });
    assert.equal(await own.count(), 37);
    const card = page.locator('.job-section[data-job="Boris"] .skill-card', { has: page.locator('h3', { hasText: /^冰結瞬殺$/ }) });
    await card.scrollIntoViewIfNeeded();
    await card.locator('.skill-title').click();
    await card.locator('.skill-desc').waitFor({ state: 'visible' });
    assert.match(await card.locator('.skill-desc').innerText(), /技能傷害: 530%/);
    assert.equal(await card.locator('.skill-icon img').evaluate(img => img.complete && img.naturalWidth), 32);
    await page.screenshot({ path: process.env.BORIS_SHOT || path.join(require('node:os').tmpdir(), 'boris.png') });
    await page.locator('#skill-config-open').click();
    await page.locator('.sc-search').fill('殘影劍斬');
    assert.equal(await page.locator('.sc-palette-card').filter({ hasText: '殘影劍斬' }).count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
