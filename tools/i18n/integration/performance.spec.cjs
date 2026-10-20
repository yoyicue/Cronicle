const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { labs, localPage, login, route, eventFixture } = require('./helpers.cjs');
// Trace capture changes layout timings; functional tests still retain failure traces.
test.use({ trace: 'off' });
test('N01 N02 warmed rendering budgets and retained heap after 500 real page changes', async ({ browser, browserName, trace }) => {
  test.skip(browserName !== 'chromium', 'HeapProfiler is a Chromium CDP measurement; layout is tested in every engine.');
  test.setTimeout(180000);
  const results = [], pages = [], counts = [3, 100, 1000];
  const measure = (page, count, iterations) => page.evaluate(({ count, iterations, template }) => {
    const original = app.schedule;
    app.schedule = Array.from({ length: count }, (_, i) => ({ ...template, id: 'perf' + i, title: 'History ' + String(i).padStart(4, '0'), timing: { hours: [3], minutes: [17] } }));
    const samples = [];
    for (let i = 0; i < iterations; i++) {
      const begin = performance.now();
      $P().gosub_events({});
      document.querySelector('#page_Schedule').getBoundingClientRect();
      samples.push(performance.now() - begin);
    }
    app.schedule = original;
    $P().gosub_events({});
    return samples;
  }, { count, iterations, template: eventFixture('unused') });
  for (const lab of labs()) {
    const session = await localPage(browser, lab);
    await login(session.page); await route(session.page, 'Schedule');
    await session.page.evaluate(() => document.fonts.ready);
    pages.push({ lab, ...session, timings: counts.map(count => ({ count, samples: [] })) });
  }
  expect(pages.map(item => item.lab.locale)).toEqual(['official', 'en', 'zh-CN']);
  for (const { page } of pages) for (const count of counts) await measure(page, count, 5);
  const order = [];
  // Rotate identical blocks so A/B/C each occupy every position twice, instead of comparing different time windows.
  for (let round = 0; round < 6; round++) {
    for (let offset = 0; offset < pages.length; offset++) {
      const current = pages[(round + offset) % pages.length];
      order.push(current.lab.locale);
      for (const timing of current.timings) timing.samples.push(...await measure(current.page, timing.count, 5));
    }
  }
  for (const { lab, page, context, errors, timings } of pages) {
    for (const timing of timings) {
      expect(timing.samples).toHaveLength(30);
      timing.p95 = [...timing.samples].sort((a, b) => a - b)[28];
    }
    const cdp = await context.newCDPSession(page);
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize; };
    const cycle = n => page.evaluate(async n => {
      for (let i = 0; i < n; i++) {
        Nav.go(i % 2 ? 'Home' : 'Schedule');
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      return document.querySelectorAll('*').length;
    }, n);
    await cycle(20);
    const before = await heap();
    await cycle(300);
    const middle = await heap();
    const nodes = await cycle(200);
    const after = await heap();
    expect(after - middle).toBeLessThan(2 * 1024 * 1024);
    results.push({ locale: lab.locale, timings, before, middle, after, growth: after - before, nodes, gzip: fs.statSync(path.join(lab.destination, 'ui-package/_ui/releases', lab.manifest.releaseId, 'js/_combo.js.gz')).size });
    expect(errors).toEqual([]);
    await context.close();
  }
  fs.writeFileSync('out/performance.json', JSON.stringify({ platform: os.platform(), arch: os.arch(), cpus: os.cpus()[0].model, browser: browser.version(), trace, cpuThrottle: 'none', warmup: 5, samples: 30, sampling: 'six counterbalanced blocks of five', order, results }, null, 2));
  for (const result of results.slice(1)) {
    for (let i = 0; i < 3; i++) expect(result.timings[i].p95 - results[0].timings[i].p95).toBeLessThanOrEqual(Math.max(results[0].timings[i].p95 * 0.1, 20));
    expect(result.after - results[0].after).toBeLessThan(8 * 1024 * 1024);
    expect(result.gzip - results[0].gzip).toBeLessThan(64 * 1024);
  }
});
