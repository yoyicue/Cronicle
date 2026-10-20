const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const { labs, localPage, login, route, eventFixture } = require('./integration/helpers.cjs');

process.chdir(__dirname);
const output = path.join(__dirname, 'out/diagnosis');
fs.mkdirSync(output, { recursive: true });
const report = {
  source: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  platform: os.platform(), arch: os.arch(), cpus: os.cpus(), memory: os.totalmem(),
  phases: [], profiles: []
};
const save = () => fs.writeFileSync(path.join(output, 'performance.json'), JSON.stringify(report, null, 2));
const p95 = samples => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];
assert.equal(p95(Array.from({ length: 30 }, (_, i) => i)), 28);

async function measure(page, iterations) {
  return page.evaluate(({ iterations, template }) => {
    const original = app.schedule;
    app.schedule = Array.from({ length: 1000 }, (_, i) => ({ ...template, id: 'perf' + i, title: 'History ' + String(i).padStart(4, '0'), timing: { hours: [3], minutes: [17] } }));
    const samples = [];
    for (let i = 0; i < iterations; i++) {
      const begin = performance.now();
      $P().gosub_events({});
      const rendered = performance.now();
      document.querySelector('#page_Schedule').getBoundingClientRect();
      const done = performance.now();
      samples.push({ render: rendered - begin, layout: done - rendered, total: done - begin });
    }
    app.schedule = original;
    $P().gosub_events({});
    return samples;
  }, { iterations, template: eventFixture('unused') });
}

async function openPages(browser, definitions) {
  const pages = [];
  for (const lab of definitions) {
    const session = await localPage(browser, lab);
    await login(session.page);
    await route(session.page, 'Schedule');
    await session.page.evaluate(() => document.fonts.ready);
    pages.push({ ...session, lab });
  }
  return pages;
}

async function sample(pages, name, traced) {
  const phase = { name, traced, loadBefore: os.loadavg(), results: pages.map(({ lab }) => ({ locale: lab.locale, samples: [] })), order: [] };
  if (traced) for (const { context } of pages) await context.tracing.start({ screenshots: true, snapshots: true });
  for (const { page } of pages) await measure(page, 5);
  for (let round = 0; round < 6; round++) {
    for (let offset = 0; offset < pages.length; offset++) {
      const index = (round + offset) % pages.length;
      phase.order.push(pages[index].lab.locale);
      phase.results[index].samples.push(...await measure(pages[index].page, 5));
    }
  }
  if (traced) for (const { context } of pages) await context.tracing.stop();
  for (const result of phase.results) {
    assert.equal(result.samples.length, 30);
    result.p95 = Object.fromEntries(['render', 'layout', 'total'].map(key => [key, p95(result.samples.map(s => s[key]))]));
  }
  phase.loadAfter = os.loadavg();
  report.phases.push(phase); save();
  console.log(JSON.stringify({ phase: name, results: phase.results.map(({ locale, p95 }) => ({ locale, p95 })) }));
}

(async () => {
  const stop = await require('./global-setup.cjs')();
  let browser;
  try {
    browser = await chromium.launch();
    report.browser = browser.version();
    const pages = await openPages(browser, labs());
    // Reverse the trace comparison to expose time/order effects instead of selecting one favourable run.
    for (const [name, traced] of [['untraced-before', false], ['traced-first', true], ['traced-second', true], ['untraced-after', false]]) await sample(pages, name, traced);
    for (const { page, context, lab, errors } of pages) {
      assert.deepEqual(errors, []);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
      const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
      const samples = await measure(page, 10);
      const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
      const { profile } = await cdp.send('Profiler.stop');
      fs.writeFileSync(path.join(output, lab.locale + '.cpuprofile'), JSON.stringify(profile));
      const metrics = Object.fromEntries(['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration', 'LayoutCount', 'RecalcStyleCount'].map(key => [key, after[key] - before[key]]));
      report.profiles.push({ locale: lab.locale, metrics, samples }); save();
      await context.close();
    }
    const controls = await openPages(browser, ['control-A', 'control-B', 'control-C'].map(locale => ({ ...labs()[0], locale })));
    await sample(controls, 'identical-official-control', false);
    for (const { context, errors } of controls) { assert.deepEqual(errors, []); await context.close(); }
    assert.equal(report.phases.length, 5);
    assert.equal(report.profiles.length, 3);
    report.completed = new Date().toISOString(); save();
  } finally {
    if (browser) await browser.close();
    await stop();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
