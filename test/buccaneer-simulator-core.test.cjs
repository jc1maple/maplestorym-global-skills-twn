'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../buccaneer-simulator-core.js');

function center() { return core.simulate({ preset: 'center' }); }
let optimizerCache;
function optimizer() { return optimizerCache || (optimizerCache = core.simulate({ preset: 'optimizer' })); }

test('center model reproduces the audited 21,744 hit calibration', () => {
  const result = center();
  assert.equal(result.summary.totalHits, 21744);
  assert.ok(result.audit.some(item => item.title === '中心模型對帳成功'));
});

test('center skill ledger matches fixed, trigger, and calibrated sources', () => {
  const s = center().summary.bySkill;
  assert.deepEqual({
    origin: s.origin.hits + s.neptune.hits,
    charge: [s.charge.uses, s.charge.hits],
    howling: s.howling.hits,
    lordDeep: s.lordDeep.hits,
    filler: [s.filler.uses, s.filler.hits],
    nautilus: s.nautilus.hits,
    meltdown: s.meltdown.hits,
    serpent: s.serpent.hits,
    spider: s.spider.hits
  }, {
    origin: 5740,
    charge: [29, 2668],
    howling: 1740,
    lordDeep: 1920,
    filler: [130, 2200],
    nautilus: 3000,
    meltdown: 1500,
    serpent: 2700,
    spider: 276
  });
});

test('strict window contains only hit timestamps below 120,000ms', () => {
  const result = center();
  assert.ok(result.hits.every(hit => hit.timeMs >= 0 && hit.timeMs < 120000));
  assert.equal(result.hits.reduce((sum, hit) => sum + hit.hits, 0), result.summary.totalHits);
});

test('foreground lane never overlaps and uses extracted action locks', () => {
  const actions = center().actions.filter(action => action.type === 'foreground').sort((a, b) => a.startMs - b.startMs);
  for (let index = 1; index < actions.length; index += 1) assert.ok(actions[index].startMs >= actions[index - 1].endMs);
  assert.equal(actions.find(action => action.skillId === 'origin').endMs - actions.find(action => action.skillId === 'origin').startMs, 4320);
  assert.ok(actions.filter(action => action.skillId === 'filler').every(action => action.endMs - action.startMs === 570));
  assert.ok(actions.filter(action => action.skillId === 'charge').every(action => action.endMs - action.startMs === 300));
});

test('full starting charges are spent without recharge overflow', () => {
  const charge = center().summary.charge;
  assert.deepEqual(charge, { start: 6, generated: 23, spent: 29, overflow: 0, end: 0, uses: 29 });
});

test('starting empty removes exactly six 92-hit charge uses', () => {
  const result = core.simulate({ preset: 'center', startingCharges: 0 });
  assert.equal(result.summary.charge.spent, 23);
  assert.equal(result.summary.totalHits, 21744 - 6 * 92);
});

test('disabling Spider removes exactly 276 hits', () => {
  const result = core.simulate({ preset: 'center', precastSpider: false });
  assert.equal(result.summary.totalHits, 21744 - 276);
});

test('preset boundaries remain deterministic and ordered', () => {
  const conservative = core.simulate({ preset: 'conservative' });
  const client = core.simulate({ preset: 'client' });
  assert.equal(conservative.summary.totalHits, 20373);
  assert.equal(client.summary.totalHits, 23258);
  assert.ok(conservative.summary.totalHits < center().summary.totalHits);
  assert.ok(client.summary.totalHits > center().summary.totalHits);
  assert.equal(client.summary.bySkill.filler.uses, 172);
});

test('same inputs produce the same exported event ledger', () => {
  const first = core.exportResult(center());
  const second = core.exportResult(center());
  delete first.generatedAt;
  delete second.generatedAt;
  assert.deepEqual(first, second);
});

test('unresolved server-cadence contribution stays explicit', () => {
  const result = center();
  assert.equal(result.summary.calibratedHits, 7200);
  assert.ok(result.audit.some(item => item.title === '背景傷害仍含校正項'));
});

test('optimizer explores legal orderings instead of replaying the fixed center priority', () => {
  const result = optimizer();
  assert.equal(result.summary.search.algorithm, 'Beam Search');
  assert.equal(result.summary.search.beamWidth, 420);
  assert.ok(result.summary.search.exploredStates > 100000);
  assert.equal(result.summary.search.provenOptimal, false);
  assert.ok(result.summary.totalHits > center().summary.totalHits);
  assert.notEqual(result.actions.find(action => action.type === 'foreground')?.skillId, 'charge');
});

test('optimizer keeps required burst actions, all three balls, and a legal foreground lane', () => {
  const result = optimizer();
  const foreground = result.actions.filter(action => action.type === 'foreground').sort((a, b) => a.startMs - b.startMs);
  assert.equal(foreground.filter(action => action.skillId === 'origin').length, 1);
  assert.equal(foreground.filter(action => action.skillId === 'howling').length, 1);
  assert.equal(foreground.filter(action => action.skillId === 'meltdown').length, 4);
  assert.ok(foreground.some(action => action.skillId === 'nautilus'));
  for (let index = 1; index < foreground.length; index += 1) assert.ok(foreground[index].startMs >= foreground[index - 1].endMs);
  assert.ok(result.hits.every(hit => hit.timeMs >= 0 && hit.timeMs < 120000));
});

test('optimizer state machine spends all available charge without overflow', () => {
  assert.deepEqual(optimizer().summary.charge, { start: 6, generated: 23, spent: 29, overflow: 0, end: 0, uses: 29 });
});

test('optimizer output is deterministic and exposes unresolved cadence assumptions', () => {
  const first = optimizer();
  const second = core.simulate({ preset: 'optimizer' });
  assert.equal(first.summary.totalHits, second.summary.totalHits);
  assert.deepEqual(
    first.actions.filter(action => action.type === 'foreground').map(({ skillId, startMs, endMs, units }) => ({ skillId, startMs, endMs, units })),
    second.actions.filter(action => action.type === 'foreground').map(({ skillId, startMs, endMs, units }) => ({ skillId, startMs, endMs, units }))
  );
  assert.ok(first.assumptions.some(line => line.includes('Server cadence')));
});
