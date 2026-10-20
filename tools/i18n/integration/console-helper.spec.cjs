const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { labs, localPage, route } = require('./helpers.cjs');
test('I04 bundled autofill fixture uses each origin credential once on actual generated login DOM', async ({ browser }) => {
  test.setTimeout(90000);
  const file = path.resolve(__dirname, '../fixtures/autofill.js');
  const script = fs.readFileSync(file, 'utf8');
  const origins = [...script.matchAll(/"(http:\/\/[^"\s]+:7305)": \["([^"]+)", "([^"]+)"\]/g)].map(x => ({ origin: x[1], userKey: x[2], passKey: x[3] }));
  expect(origins).toHaveLength(2);
  for (const lab of labs()) {
    const source = await localPage(browser, lab);
    await expect(source.page.locator('#fe_login_username')).toBeVisible();
    const forms = [{ hash: '', html: await source.page.locator('#page_Login').innerHTML() }];
    if (lab.locale === 'zh-CN') for (const hash of ['Login?recover=1', 'Login?u=local&h=synthetic']) {
      await route(source.page, hash);
      await expect(source.page.locator(hash.includes('recover=') ? '#fe_pr_username' : '#fe_reset_username')).toBeVisible();
      forms.push({ hash, html: await source.page.locator('#page_Login').innerHTML() });
    }
    await source.context.close();
    for (const origin of origins) for (const form of forms) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      // Every request is fulfilled locally, including the reserved test origins.
      await context.route('**/*', request => request.fulfill({ contentType: 'text/html', body: '<html><body>' + form.html + '</body></html>' }));
      const page = await context.newPage();
      await page.addInitScript(({ origins, current }) => {
        window.submissions = []; window.requestedKeys = [];
        const values = {};
        origins.forEach((item, i) => { values[item.userKey] = 'local-user-' + i; values[item.passKey] = 'local-pass-' + i; });
        window.chrome = { storage: { local: { get: async keys => { window.requestedKeys = keys; return values; } } } };
        window.$P = () => ({ doLogin() { window.submissions.push([document.querySelector('#fe_login_username').value, document.querySelector('#fe_login_password').value]); } });
      }, { origins, current: origin });
      await page.goto(origin.origin + '/local-chinese.html#' + form.hash);
      await page.addScriptTag({ content: script });
      if (!form.hash) await expect.poll(() => page.evaluate(() => submissions.length)).toBe(1);
      await page.waitForTimeout(600);
      const result = await page.evaluate(() => ({ submissions, requestedKeys }));
      expect(result.requestedKeys).toEqual([origin.userKey, origin.passKey]);
      expect(result.submissions).toEqual(form.hash ? [] : [['local-user-' + origins.indexOf(origin), 'local-pass-' + origins.indexOf(origin)]]);
      await context.close();
    }
  }
});
