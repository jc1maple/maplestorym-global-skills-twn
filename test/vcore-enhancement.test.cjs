const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/vcore-enhancement-2460.json'), 'utf8'));
const cards = [...html.matchAll(/<article class="skill-card\b[\s\S]*?<\/article>/g)].map(m => m[0]);
const boost = cards.filter(c => c.includes('data-core="v_boost"'));

test('every 2.460 enhancement-core row has exactly one card with its new index and core number', () => {
  assert.equal(data.existing.length, 497);
  assert.equal(data.new.length, 87);
  assert.equal(boost.length, 584);
  const metas = boost.map(c => c.match(/class="skill-meta">(.*?)</)[1]);
  for (const entry of [...data.existing, ...data.new]) {
    // One legacy row (Cannoneer CannonJump) sits outside the six-core layout and keeps its old meta.
    const prefix = entry.group ? `V 強化核心 ${entry.group} / 職業專屬 / VSkill / ${entry.index} /` : `V 強化核心 / 職業專屬 / VSkill / ${entry.index} /`;
    assert.equal(metas.filter(m => m.startsWith(prefix)).length, 1, entry.vcore_code);
    assert.match(entry.group, /^[1-6]?$/);
  }
  assert.equal(new Set(metas.map(m => m.split(' / ')[3])).size, 584);
  // Card titles follow CoreLanguageName: one skill per row, no sub-name suffix such as "(劍術)".
  const titles = new Map(boost.map(c => [c.match(/class="skill-meta">(.*?)</)[1].split(' / ')[3], c.match(/<h3>(.*?)<\/h3>/)[1]]));
  const unescape = v => v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
  for (const entry of [...data.existing, ...data.new]) assert.equal(unescape(titles.get(entry.index)), entry.name, entry.vcore_code);
  const soul = data.existing.find(e => e.vcore_code === 'VCore_SoulMaster_SolarSlash');
  assert.deepEqual([soul.old_name, soul.name], ['烈日狂斬/月光切割 (劍術)', '烈日狂斬']);
  for (const entry of data.new) {
    assert(entry.name && entry.description_full && entry.summary.startsWith('Enhancement core damage up per level:'), entry.vcore_code);
    if (!entry.has_base_card) assert(fs.statSync(path.join(root, 'icons', entry.core_icon + '.png')).size > 100, entry.core_icon);
  }
  for (const src of new Set(boost.flatMap(c => [...c.matchAll(/<img src="([^"]+)"/g)].map(m => m[1])))) {
    assert(fs.existsSync(path.join(root, src)), src);
  }
  execFileSync('python', ['scripts/update-vcore-enhancement.py', '--check'], { cwd: root });
});

test('each job has cores 1-6 and counters match the cards', () => {
  for (const section of html.split('<section class="job-section"').slice(1)) {
    const job = section.match(/data-job="([^"]+)"/)[1];
    const own = [...section.matchAll(/<article class="skill-card\b[\s\S]*?<\/article>/g)].map(m => m[0]);
    assert.equal(Number(section.match(/<span class="job-count">(\d+) skills<\/span>/)[1]), own.length, job);
    const groups = new Set(own.filter(c => c.includes('data-core="v_boost"')).map(c => c.match(/V 強化核心 (\d) \//)?.[1]).filter(Boolean));
    if (groups.size) assert.deepEqual([...groups].sort(), ['1', '2', '3', '4', '5', '6'], job);
  }
  assert(html.includes(`<strong>${cards.length.toLocaleString('en-US')}</strong> 筆技能`));
});
