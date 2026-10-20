const { test, expect } = require('@playwright/test');
const { labs, localPage, login, route, api, admin, canonical, equalBuilds, eventFixture } = require('./helpers.cjs');

test('I06 I29 I30 I31 routes, controls, storage keys, network writes and escaping match official English', async ({ browser }, info) => {
  const traces = [];
  for (const lab of labs()) {
    const session = await admin(lab), id = 'invariant' + info.project.name;
    await api(lab, 'app/create_event', eventFixture(id), session);
    const { page, context, errors, externalRequests } = await localPage(browser, lab);
    await login(page);
    const writes = [];
    page.on('request', request => {
      if (request.method() === 'POST' && /\/api\//.test(request.url())) writes.push({ url: new URL(request.url()).pathname, body: canonical(request.postDataJSON()) });
    });
    const controls = [];
    for (const anchor of ['Schedule', 'Schedule?sub=edit_event&id=' + id, 'MyAccount', 'Admin?sub=users', 'Admin?sub=new_api_key']) {
      await route(page, anchor);
      if (anchor.includes('edit_event')) {
        const cursor = await page.evaluate(() => { const field = $('#fe_ee_rc_time'), epoch = field.data('epoch'); return { epoch, value: field.val(), expected: $P().rc_get_short_date_time(epoch) }; });
        expect(Number.isFinite(cursor.epoch)).toBe(true);
        expect(cursor.value).toBe(cursor.expected);
      }
      controls.push(await page.locator('#page_' + anchor.split('?')[0] + ' input, #page_' + anchor.split('?')[0] + ' select').evaluateAll(nodes => nodes.map(node => ({ tag: node.tagName, id: node.id, name: node.name, type: node.type, value: node.type === 'password' || node.id === 'fe_ak_key' ? '<generated>' : node.value, options: node.tagName === 'SELECT' ? [...node.options].map(x => x.value) : null, change: node.getAttribute('onchange') }))));
    }
    await route(page, 'Schedule?keywords=History');
    expect(await page.evaluate(id => $P().events.some(x => x.id === id), id)).toBe(true);
    await page.selectOption('#fe_sch_enabled', '-1');
    await page.waitForFunction(() => Number($P().args.enabled) === -1);
    expect(await page.evaluate(() => $P().events.every(x => !x.enabled))).toBe(true);
    const storage = await page.evaluate(() => ({ local: Object.keys(localStorage).sort(), session: Object.keys(sessionStorage).sort() }));
    expect(writes.every(x => !/create|update|delete|run|abort/.test(x.url))).toBe(true);
    const bad = await api(lab, 'app/update_event', { id, notes: '<img src=x onerror="window.bad=1">' }, session);
    expect(bad.code).not.toBe(0);
    expect(bad.description).toContain('HTML metacharacters');
    expect(await page.evaluate(() => window.bad)).toBeUndefined();
    for (const group of controls) for (const control of group) {
      if (control.options) control.options = control.options.map(value => value === 'cronicle-local-' + lab.name.toLowerCase() ? '<local-server>' : value);
      // This readonly text is a localized view of the separately verified numeric epoch.
      if (control.id === 'fe_ee_rc_time') control.value = '<displayed-cursor>';
    }
    traces.push({ controls, storage, writes, bad, externalRequests });
    expect(errors).toEqual([]);
    await context.close();
  }
  equalBuilds(traces);
});

test('N03 three viewports, browser text zoom and keyboard keep original controls reachable', async ({ browser }, info) => {
  for (const lab of labs()) for (const width of [1280, 1440, 1920]) {
    const { page, context, errors } = await localPage(browser, lab, { viewport: { width, height: 900 } });
    await page.locator('#fe_login_username').focus();
    await page.keyboard.type('admin');
    await page.keyboard.press('Tab');
    await expect(page.locator('#fe_login_password')).toBeFocused();
    await page.keyboard.type('admin');
    const success = page.waitForResponse(r => r.url().endsWith('/user/login') && r.request().method() === 'POST');
    await page.keyboard.press('Enter');
    expect((await (await success).json()).code).toBe(0);
    await expect(page.locator('[onmouseup="app.doUserLogout()"]')).toBeVisible();
    await expect(page.locator('#dialog_overlay')).toBeHidden();
    await route(page, 'Schedule?sub=new_event');
    // CSS zoom is the same layout scaling mechanism in all three engines.
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    if (lab.locale === 'zh-CN') {
      const lines = await page.locator('#page_Schedule td.table_label:visible').evaluateAll(nodes => nodes.filter(node => !node.children.length && node.textContent.trim()).map(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        const rects = [...range.getClientRects()];
        return { label: node.textContent, verticalSpan: Math.max(...rects.map(rect => rect.top)) - Math.min(...rects.map(rect => rect.top)), glyphHeight: Math.min(...rects.map(rect => rect.height)) };
      }));
      expect(lines.length).toBeGreaterThan(10);
      expect(lines.filter(line => line.verticalSpan >= line.glyphHeight / 2)).toEqual([]);
    }
    const create = page.locator('[onmouseup="$P().do_new_event()"]:visible');
    await create.scrollIntoViewIfNeeded();
    const box = await create.boundingBox();
    expect(box.width).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    const hit = await create.evaluate(node => { const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return hit === node || node.contains(hit); });
    expect(hit).toBe(true);
    await page.screenshot({ path: 'out/layout-' + info.project.name + '-' + lab.name + '-' + width + '.png', fullPage: true });
    expect(errors).toEqual([]);
    await context.close();
  }
});
