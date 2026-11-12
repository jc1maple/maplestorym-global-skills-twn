const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/boss-vcore-skills.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cards = [...html.matchAll(/<article class="skill-card\b[\s\S]*?<\/article>/g)].map(m => m[0]);

test('太陽之冠 is exported with 30 levels and sits after 鏡之蜘蛛 in all 48 jobs', () => {
  const skill = data.skills.find(s => s.vcore_code === 'VCore_BossSkill_CrestoftheSolar');
  assert.equal(skill.name, '太陽之冠');
  assert.equal(skill.vcore_index, '1229');
  assert.deepEqual(skill.levels.map(l => Number(l.code.split('_').at(-1))), Array.from({ length: 30 }, (_, i) => i + 1));
  assert.match(skill.levels[0].description_full, /冷卻時間: 180秒[\s\S]*技能傷害: 205%/);
  for (const line of ['冷卻時間: 120秒', '目標人數: 15', '打擊次數: 150', '技能傷害: 350%', '[火焰紋樣] 打擊次數: 100', '[火焰紋樣] 技能傷害: 340%', '[火焰紋樣] 最大攻擊次數: 6', '套用追加無視防禦率: 15%']) {
    assert(skill.description_full.includes(line), line);
  }
  assert(fs.statSync(path.join(root, skill.icon_file)).size > 100);
  const p = skill.preview;
  const sheet = fs.readFileSync(path.join(root, p.preview));
  assert.equal(require('node:crypto').createHash('sha256').update(sheet).digest('hex').slice(0, 12), p.asset_hash);
  assert.deepEqual([sheet.readUInt32BE(16), sheet.readUInt32BE(20)], [p.sheet_columns * p.frame_width, p.sheet_rows * p.frame_height]);
  assert.equal(p.durations_ms.length, p.frame_count);
  assert(p.source_prefabs.every(s => s.includes('/vskill_boss/crestofthesolar_sd/')));
  assert(html.includes(`data-preview-src="${p.preview}?v=${p.asset_hash}"`));
  const solar = cards.filter(c => c.includes('vcore_bossskill_crestofthesolar'));
  assert.equal(solar.length, 48);
  assert.equal(new Set(solar).size, 1);
  let after = 0;
  cards.forEach((c, i) => { if (c.includes('vcore_bossskill_spiderinmirror') && cards[i + 1].includes('vcore_bossskill_crestofthesolar')) after += 1; });
  assert.equal(after, 48);
  for (const section of html.split('<section class="job-section"').slice(1)) {
    const count = Number(section.match(/<span class="job-count">(\d+) skills<\/span>/)[1]);
    assert.equal(count, (section.match(/<article class="skill-card\b/g) || []).length);
  }
  execFileSync('python', ['scripts/update-boss-vcore.py', '--check'], { cwd: root });
});

test('太陽之冠 card is searchable, expandable and shows its icon', { timeout: 90000 }, async () => {
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#skill-config-open');
    // Common (全職業共通) skills are hidden until the scope filter includes them, same as 鏡之蜘蛛.
    await page.evaluate(() => { const all = document.getElementById('scope-all'); all.checked = true; all.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.locator('#q').fill('太陽之冠');
    for (const job of ['SoulMaster', 'Aran', 'Lara']) {
      await page.locator('.job-picker-trigger').click();
      await page.locator(`.job-picker-option[data-value="${job}"]`).click();
      const card = page.locator(`.job-section[data-job="${job}"] .skill-card`, { has: page.locator('h3', { hasText: /^太陽之冠$/ }) });
      await card.waitFor({ state: 'visible' });
      assert.equal(await card.count(), 1);
      await card.locator('.skill-title').click();
      await card.locator('.skill-desc').waitFor({ state: 'visible' });
      assert.match(await card.locator('.skill-desc').innerText(), /技能傷害: 350%/);
      assert.equal(await card.locator('.skill-icon img').evaluate(img => img.complete && img.naturalWidth), 32);
      if (job === 'SoulMaster') await page.screenshot({ path: process.env.BOSS_VCORE_SHOT || path.join(require('node:os').tmpdir(), 'boss-vcore-card.png') });
    }
    await page.locator('#skill-config-open').click();
    await page.locator('.sc-search').fill('太陽之冠');
    assert.equal(await page.locator('.sc-palette-card').filter({ hasText: '太陽之冠' }).count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
