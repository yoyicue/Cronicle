const { test, expect } = require('@playwright/test');
const { labs, localPage, login, route, api, admin, eventFixture, canonical } = require('./helpers.cjs');

test('I01 I03 login, session resume and logout preserve the original controls', async ({ browser }) => {
  for (const lab of labs()) {
    const { page, context, errors } = await localPage(browser, lab);
    const ids = await page.locator('#page_Login input').evaluateAll(nodes => nodes.map(n => [n.id, n.name, n.type]));
    expect(ids).toContainEqual(['fe_login_username', 'username', 'text']);
    expect(ids).toContainEqual(['fe_login_password', 'password', 'password']);
    await login(page);
    await page.reload();
    await expect(page.locator('[onmouseup="app.doUserLogout()"]')).toBeVisible();
    await page.locator('[onmouseup="app.doUserLogout()"]').dispatchEvent('mouseup');
    await expect(page.locator('#fe_login_username')).toBeVisible();
    expect(await page.evaluate(() => app.getPref('session_id'))).toBe('');
    expect(errors).toEqual([]);
    await context.close();
  }
});

test('T02 T07 upcoming times and the header show 24-hour time and IANA zones without changing epochs', async ({ browser }, info) => {
  const epoch = new Date('2026-10-20T03:17:00+08:00').getTime() / 1000;
  for (const lab of labs()) {
    const id = 'displaytime' + info.project.name, session = await admin(lab);
    expect((await api(lab, 'app/create_event', eventFixture(id), session)).code).toBe(0);
    const { page, context, errors } = await localPage(browser, lab);
    await login(page);
    const result = await page.evaluate(({ id, epoch }) => {
      const home = $P();
      home.worker.terminate();
      home.render_upcoming_events({ data: [{ id, epoch }] });
      app.setHeaderClock(epoch);
      return { text: $('#d_home_upcoming_events').text(), clock: $('#d_tab_time > span').text(), data: home.upcoming_events, timing: app.schedule.find(row => row.id === id).timing };
    }, { id, epoch });
    expect(result.data).toEqual([{ id, epoch }]);
    expect(result.timing).toBe(false);
    if (lab.locale === 'zh-CN') {
      expect(result.text).toContain('03:17 +08:00 [Asia/Shanghai]');
      expect(result.clock).toContain('03:17:00 +08:00 [Asia/Shanghai]');
    }
    else expect(result.text).toContain('3:17 AM CST');
    expect(errors).toEqual([]);
    await context.close();
  }
});

test('I05 seven pages and admin routes load without an ASSERT or JavaScript error', async ({ browser }) => {
  for (const lab of labs()) {
    const { page, context, errors } = await localPage(browser, lab);
    await login(page);
    for (const anchor of ['Home', 'Schedule', 'Schedule?sub=new_event', 'History', 'MyAccount', 'Admin?sub=activity', 'Admin?sub=users', 'Admin?sub=categories', 'Admin?sub=plugins', 'Admin?sub=servers', 'Admin?sub=api_keys']) {
      await route(page, anchor);
      expect(await page.locator('#page_' + anchor.split('?')[0]).innerText()).not.toContain('ASSERT');
    }
    await page.reload();
    await expect(page.locator('#page_Admin')).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  }
});

test('I07 T11 translated schedule controls retain their exact option values', async ({ browser }) => {
  const signatures = [];
  for (const lab of labs()) {
    const { page, context, errors } = await localPage(browser, lab);
    await login(page);
    await route(page, 'Schedule?sub=new_event');
    await page.selectOption('#fe_ee_plugin', 'shellplug');
    await expect(page.locator('#fe_ee_pp_script')).toBeVisible();
    await page.selectOption('#fe_ee_timing', 'daily');
    signatures.push(await page.locator('#fe_ee_timing option').evaluateAll(nodes => nodes.map(n => n.value)));
    if (lab.locale === 'zh-CN') {
      await expect(page.locator('#fe_ee_timing option[value="daily"]')).toHaveText('每日');
      await expect(page.locator('#page_Schedule')).toContainText('脚本内容');
      await expect(page.locator('#d_ee_timing_summary')).toContainText('Asia/Shanghai');
    }
    expect(await page.locator('#fe_ee_plugin').inputValue()).toBe('shellplug');
    expect(errors).toEqual([]);
    await context.close();
  }
  expect(signatures[1]).toEqual(signatures[0]);
  expect(signatures[2]).toEqual(signatures[0]);
});

test('I08 I23 I30 no-edit save preserves user data and plugin values across all three builds', async ({ browser }, info) => {
  const requests = [];
  for (const lab of labs()) {
    const session = await admin(lab);
    const id = 'save' + info.project.name;
    expect((await api(lab, 'app/create_event', eventFixture(id), session)).code).toBe(0);
    const { page, context, errors } = await localPage(browser, lab);
    await login(page);
    await route(page, 'Schedule?sub=edit_event&id=' + id);
    await expect(page.locator('#fe_ee_title')).toHaveValue('History');
    await expect(page.locator('#fe_ee_pp_script')).toHaveValue(eventFixture(id).params.script);
    const button = page.locator('[onmouseup="$P().do_save_event()"]:visible');
    await expect(button).toBeVisible();
    const responsePromise = page.waitForResponse(r => r.url().endsWith('/app/update_event') && r.request().method() === 'POST');
    await button.dispatchEvent('mouseup');
    const response = await responsePromise;
    expect((await response.json()).code).toBe(0);
    const body = response.request().postDataJSON();
    expect(body.session_id).toBeTruthy();
    const original = (await api(lab, 'app/get_event', { id }, session)).event;
    expect(original.title).toBe('History');
    expect(original.params).toEqual(eventFixture(id).params);
    requests.push(canonical(body));
    expect(errors).toEqual([]);
    await context.close();
  }
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[2]).toEqual(requests[0]);
});
