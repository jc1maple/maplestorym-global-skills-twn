const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/skill-text-updates.json'), 'utf8'));

test('cards whose client text changed carry the 2.460 wording', () => {
  assert.equal(data.cards.length, 10);
  for (const u of data.cards) assert.notEqual(u.old_full, u.new_full);
  const section = job => html.split(`<section class="job-section" data-job="${job}"`)[1].split('<section class="job-section"')[0];
  assert(section('Bishop').includes('復活時無敵時間: 10秒'));
  assert(!section('Bishop').includes('復活時無敵時間: 3秒'));
  assert(section('Paladin').includes('無敵Buff時間: 10秒'));
  assert(section('Lynn').includes('增加重創的打擊次數。'));
  assert(section('Cadena').includes('使用非鏈之藝術系列技能命中4次時'));
  assert(section('FlameWizard').includes('[強化] 技能傷害: 325%'));
  assert(!html.includes('FALSE%'));
  execFileSync('python', ['scripts/update-skill-text.py', '--check'], { cwd: root });
});
