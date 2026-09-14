const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const original = execFileSync('git', ['show', '4f8ad758565022caa2156dd70ec853f8c9e156a0:index.html'], {cwd:root, maxBuffer:30*1024*1024, encoding:'utf8'});
const cards = text => [...text.matchAll(/<article class="skill-card\b[\s\S]*?<\/article>/g)].map(m=>m[0].replace(/\r\n/g,'\n'));
const old = cards(original);
const current = cards(html);
assert.deepEqual(current.filter(c=>!c.includes('data-stage="stella"')), old, 'Existing cards changed');
assert.equal(current.length-old.length,48);
const data = JSON.parse(fs.readFileSync(path.join(root,'data/stella-skills.json'),'utf8'));
assert.equal(data.skills.length,5);
assert.equal(data.job_mapping.Xenon.skill_code,'Skill_Thief_StarFang_01');
for(const skill of data.skills) {
  assert.deepEqual(skill.levels.map(r=>Number(r.Code.split('_').at(-1))),Array.from({length:30},(_,i)=>i+1));
  assert(skill.description_full.includes('技能等級30'));
  assert(skill.description_full.includes('無論其技能特效是否存在'));
  assert(fs.statSync(path.join(root,skill.icon_file)).size>100);
}
console.log('Static checks: 5 skills, 150 levels, 48 jobs; all 5,793 existing cards unchanged.');

async function browserChecks() {
  const {chromium} = require('playwright');
  const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'});
  try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*', route => {
    const u=new URL(route.request().url());
    return u.hostname==='127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto(process.env.STELLA_TEST_URL || 'http://127.0.0.1:8766/',{waitUntil:'load'});
  await page.waitForSelector('#skill-config-open');
  const checks=[['SoulMaster','天上的守護者'],['Lara','群星的秩序'],['WindBreaker','天上的和音'],['Xenon','星之獠牙'],['Buccaneer','利維坦的詠唱']];
  await page.locator('#q').fill('星辰代碼');
  for(const [job,name] of checks) {
    await page.locator('.job-picker-trigger').click();
    await page.locator(`.job-picker-option[data-value="${job}"]`).click();
    const card=page.locator(`.job-section[data-job="${job}"] .skill-card[data-stage="stella"]`);
    await card.waitFor({state:'visible'});
    assert.equal(await card.locator('h3').innerText(),name);
    await card.locator('.skill-title').click();
    await card.locator('.skill-desc').waitFor({state:'visible'});
    assert((await card.locator('.skill-desc').innerText()).includes('395%'));
    assert(await card.locator('img').evaluate(i=>i.complete&&i.naturalWidth===32));
  }
  await page.screenshot({path:process.env.STELLA_SCREENSHOT || path.join(root,'stella-desktop.png'),fullPage:false});
  await page.locator('#skill-config-open').click();
  await page.locator('.sc-search').fill('利維坦');
  await page.locator('.sc-palette-card').filter({hasText:'利維坦的詠唱'}).click();
  assert.equal(await page.locator('.sc-slot.is-target').count(),0);
  assert((await page.locator('.sc-palette').innerText()).includes('395%'));
  await page.locator('.sc-mobile-board .sc-slot').first().click();
  assert.equal(await page.locator('.sc-slot.is-target').count(),1);
  await page.locator('.sc-palette-card').filter({hasText:'利維坦的詠唱'}).click();
  assert.equal(await page.locator('.sc-mobile-board .sc-slot').first().locator('img[src="icons/VarB_102_5000_0.png"]').count(),1);
  await page.locator('.sc-tab[data-mode="pc"]').click();
  assert((await page.locator('.sc-workspace img[src="icons/VarB_102_5000_0.png"]').count())>=1);
  await page.locator('.sc-close').click();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:process.env.STELLA_MOBILE_SCREENSHOT || path.join(root,'stella-mobile.png'),fullPage:false});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  assert.deepEqual(errors,[]);
  console.log('Browser checks: five classes, icons, search, descriptions, click-to-inspect, assignment and PC mapping; desktop + mobile passed.');
  } finally { await browser.close(); }
}
browserChecks().catch(e=>{console.error(e);process.exitCode=1;});
