const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { labs, localPage, login, route } = require('./helpers.cjs');
const { hash } = require('../source.cjs');
function raw(url, encoding) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: { 'Accept-Encoding': encoding } }, res => {
      const chunks = [];
      res.on('data', x => chunks.push(x));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
      res.on('error', reject);
    }).on('error', reject);
  });
}
test('D03 full package bytes and MIME survive identity/gzip through real Caddy and directly', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'HTTP wire check is independent of the browser engine.');
  test.setTimeout(120000);
  for (const lab of labs()) {
    const manifest = lab.manifest;
    for (const file of Object.keys(manifest.contentHashes).filter(file => !file.endsWith('.gz'))) {
      const expected = manifest.contentHashes[file];
      for (const base of [lab.baseURL, lab.gatewayURL]) for (const encoding of ['identity', 'gzip']) {
        const result = await raw(base + '/' + file, encoding);
        expect(result.status, file).toBe(200);
        const decoded = result.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(result.bytes) : result.bytes;
        expect(hash(decoded), base + '/' + file).toBe(expected);
        if (encoding === 'gzip' && manifest.contentHashes[file + '.gz']) expect(result.headers['content-encoding']).toBe('gzip');
        if (file.endsWith('.js')) expect(result.headers['content-type']).toMatch(/javascript/);
        if (file.endsWith('.css')) expect(result.headers['content-type']).toMatch(/css/);
        if (file.endsWith('.html')) expect(result.headers['content-type']).toMatch(/html/);
      }
    }
  }
});
test('D04 D06 I16 Caddy preserves WebSocket authentication and existing English entry', async ({ browser }) => {
  test.setTimeout(90000);
  const original = fs.readFileSync(path.join(labs()[0].destination, 'htdocs/index.html'));
  for (const lab of labs()) {
    expect((await raw(lab.gatewayURL + '/', 'identity')).bytes).toEqual(original);
    const proxied = { ...lab, url: lab.gatewayURL + '/' + lab.manifest.entry };
    const { page, context, errors, socketEvents } = await localPage(browser, proxied);
    await login(page);
    await expect.poll(() => socketEvents.filter(e => e.direction === 'received' && e.name === 'status').length).toBeGreaterThan(0);
    await context.setOffline(true);
    await context.setOffline(false);
    // Disconnect the real transport; its original reconnect handler must authenticate again.
    await page.evaluate(() => app.socket.io.engine.close());
    await expect.poll(() => socketEvents.filter(e => e.direction === 'sent' && e.name === 'authenticate').length, { timeout: 15000 }).toBeGreaterThan(1);
    await route(page, 'Schedule');
    expect(errors).toEqual([]);
    await page.goto(lab.gatewayURL + '/');
    await expect(page.locator('[onmouseup="app.doUserLogout()"]')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await route(page, 'Schedule?sub=new_event');
    await expect(page.locator('#fe_ee_timing option[value="daily"]')).toHaveText('Daily');
    await page.goto(proxied.url);
    await expect(page.locator('[onmouseup="app.doUserLogout()"]')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', lab.locale === 'zh-CN' ? 'zh-CN' : 'en');
    await route(page, 'Schedule?sub=new_event');
    await expect(page.locator('#fe_ee_timing option[value="daily"]')).toHaveText(lab.locale === 'zh-CN' ? '每日' : 'Daily');
    expect(errors).toEqual([]);
    await context.close();
  }
});
