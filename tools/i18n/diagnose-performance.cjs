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
    const row = [...document.querySelectorAll('#page_Schedule .data_table tr')].find(row => row.cells.length === 8 && row.cells[0].tagName === 'TD');
    window.__diagnosticGeometry = [...row.cells].map(cell => ({ text: cell.innerText, width: cell.offsetWidth, height: cell.offsetHeight }));
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
  for (const [index, result] of phase.results.entries()) {
    assert.equal(result.samples.length, 30);
    result.p95 = Object.fromEntries(['render', 'layout', 'total'].map(key => [key, p95(result.samples.map(s => s[key]))]));
    result.geometry = await pages[index].page.evaluate(() => window.__diagnosticGeometry);
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
    report.fonts = [];
    for (const { page, context, lab } of pages) {
      await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.id = 'diagnostic-font';
        probe.textContent = '运行 编辑 统计 执行历史 每日 暂无 Run Edit Stats History';
        document.body.append(probe);
        probe.getBoundingClientRect();
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#diagnostic-font' });
      report.fonts.push({ locale: lab.locale, ...(await cdp.send('CSS.getPlatformFontsForNode', { nodeId })) });
      await page.evaluate(() => document.querySelector('#diagnostic-font').remove());
      await cdp.detach();
    }
    const chinese = pages.find(({ lab }) => lab.locale === 'zh-CN').page;
    await chinese.evaluate(() => {
      window.__originalI18N = I18N;
      window.__originalHTML = $P().div.html;
    });
    const font = report.fonts.find(r => r.locale === 'zh-CN').fonts.find(font => !font.isCustomFont).familyName;
    for (const variant of ['original-before', 'english-timing', 'original-middle', 'english-actions', 'english-timing-and-actions', 'explicit-fallback-font', 'original-after']) {
      await chinese.evaluate(({ variant, font }) => {
        document.querySelector('#diagnostic-font-style')?.remove();
        if (variant === 'explicit-fallback-font') {
          const style = document.createElement('style');
          style.id = 'diagnostic-font-style';
          style.textContent = '#page_Schedule .data_table { font-family: "Lato", ' + JSON.stringify(font) + ', helvetica, sans-serif }';
          document.head.append(style);
        }
        window.I18N = variant.includes('timing') ? { ...window.__originalI18N, timing: summarize_event_timing } : window.__originalI18N;
        $P().div.html = variant.includes('actions') ? function(value) {
          for (const [zh, en] of [['运行', 'Run'], ['编辑', 'Edit'], ['统计', 'Stats'], ['执行历史', 'History']]) value = value.replaceAll('<b>' + zh + '</b>', '<b>' + en + '</b>');
          return window.__originalHTML.call(this, value);
        } : window.__originalHTML;
      }, { variant, font });
      await sample(pages, variant, false);
    }
    for (const { context, errors } of pages) { assert.deepEqual(errors, []); await context.close(); }
    assert.equal(report.phases.length, 7);
    assert.equal(report.fonts.length, 3);
    report.completed = new Date().toISOString(); save();
  } finally {
    if (browser) await browser.close();
    await stop();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
