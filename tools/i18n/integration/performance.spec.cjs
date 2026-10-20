const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { labs, localPage, login, route, eventFixture } = require('./helpers.cjs');
test('N01 N02 warmed rendering budgets and retained heap after 500 real page changes', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'HeapProfiler is a Chromium CDP measurement; layout is tested in every engine.');
  test.setTimeout(180000);
  const results = [];
  for (const lab of labs()) {
    const { page, context, errors } = await localPage(browser, lab);
    await login(page); await route(page, 'Schedule');
    const timings = [];
    for (const count of [3, 100, 1000]) {
      timings.push(await page.evaluate(({ count, template }) => {
        const original = app.schedule;
        app.schedule = Array.from({ length: count }, (_, i) => ({ ...template, id: 'perf' + i, title: 'History ' + String(i).padStart(4, '0'), timing: { hours: [3], minutes: [17] } }));
        const samples = [];
        for (let i = 0; i < 35; i++) {
          const begin = performance.now();
          $P().gosub_events({});
          document.querySelector('#page_Schedule').getBoundingClientRect();
          const elapsed = performance.now() - begin;
          if (i >= 5) samples.push(elapsed);
        }
        app.schedule = original;
        $P().gosub_events({});
        return { count, samples, p95: [...samples].sort((a, b) => a - b)[28] };
      }, { count, template: eventFixture('unused') }));
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
  fs.writeFileSync('out/performance.json', JSON.stringify({ platform: os.platform(), arch: os.arch(), cpus: os.cpus()[0].model, browser: browser.version(), cpuThrottle: 'none', warmup: 5, samples: 30, results }, null, 2));
  for (const result of results.slice(1)) {
    for (let i = 0; i < 3; i++) expect(result.timings[i].p95 - results[0].timings[i].p95).toBeLessThanOrEqual(Math.max(results[0].timings[i].p95 * 0.1, 20));
    expect(result.after - results[0].after).toBeLessThan(8 * 1024 * 1024);
    expect(result.gzip - results[0].gzip).toBeLessThan(64 * 1024);
  }
});
