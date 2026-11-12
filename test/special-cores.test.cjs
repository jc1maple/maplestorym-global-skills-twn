const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/special-cores-2460.json'), 'utf8'));
const cards = html.split('<article class="skill-card').slice(1).map(c => c.split('</article>')[0]);

test('only the five 2.460 special cores remain, once per job', () => {
  assert.deepEqual(data.cards.map(c => c.name), ['輪的經驗', '破壞防具', 'BOSS殺手', '一擊必殺', '承受']);
  assert.equal(data.retired_vcore_codes.length, 32);
  const special = cards.filter(c => c.includes('data-core="v_special"'));
  assert.equal(special.length, 5 * 48);
  for (const entry of data.cards) {
    assert.equal(special.filter(c => c.includes(`<h3>${entry.name}</h3>`) && c.includes(`/ VSkill / ${entry.index} /`)).length, 48, entry.name);
    assert(fs.statSync(path.join(root, entry.icon_file)).size > 100);
  }
  for (const code of data.retired_vcore_codes) assert(!html.includes(` ${code.toLowerCase()} `), code);
  assert(html.includes('攻擊時15秒期間，無視防禦率增加25%。(重新發動冷卻時間30秒)'));
  assert(!html.includes('攻擊50次時'));
  assert(html.includes(`<strong>${cards.length.toLocaleString('en-US')}</strong> 筆技能`));
  execFileSync('python', ['scripts/update-special-cores.py', '--check'], { cwd: root });
});
