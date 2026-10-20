const test = require('node:test');
const assert = require('node:assert/strict');
const { check, assertTextOnly } = require('../check.cjs');

test('S01-S04 all source positions, word coverage and protected executable structures pass', () => {
  const result = check();
  assert(result.sites > 1200 && result.entries > 800 && result.protectedFiles > 30);
});
test('S08 changing a route, option value, parser or API argument fails equivalence', () => {
  for (const [before, after] of [
    ['var p={ID:"History"};', 'var p={ID:"历史"};'],
    ['var x=[["daily","Daily"]];', 'var x=[["每日","Daily"]];'],
    ['run({now:123});', 'run({now:124});'],
    ['var t=["3am"];', 'var t=["上午3点"];'],
    ['if(ok)run();', 'if(ok)run();run();']
  ]) assert.throws(() => assertTextOnly(before, after, 'mutation.js', []));
});
