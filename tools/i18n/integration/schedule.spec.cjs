const { test, expect } = require('@playwright/test');
const { labs, localPage, login, route, api, admin, eventFixture, action, canonical, equalBuilds } = require('./helpers.cjs');
async function set(page, id, value) {
  await page.locator('#' + id).evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); }, value);
}
test('I07 I09 T03 T11 every timing mode and advanced options preserve real create requests', async ({ browser }, info) => {
  test.setTimeout(90000);
  const traces = [];
  for (const lab of labs()) {
    const { page, context, errors } = await localPage(browser, lab);
    await login(page);
    await page.evaluate(() => { window.time_now = () => 1792437420; });
    const requests = [];
    for (const mode of ['demand', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'custom']) {
      await route(page, 'Schedule?sub=new_event');
      await page.fill('#fe_ee_title', '[mode' + mode + info.project.name + '] Home History Success Run 每日');
      await page.selectOption('#fe_ee_cat', 'general');
      await page.selectOption('#fe_ee_target', 'maingrp');
      await page.selectOption('#fe_ee_plugin', 'shellplug');
      await page.fill('#fe_ee_pp_script', eventFixture('x').params.script);
      await page.selectOption('#fe_ee_timing', mode);
      await page.uncheck('#fe_ee_enabled');
      await set(page, 'fe_ee_timeout', '7');
      await set(page, 'fe_ee_timeout_units', '60');
      await set(page, 'fe_ee_retries', '2');
      await set(page, 'fe_ee_retry_delay', '17');
      await set(page, 'fe_ee_retry_delay_units', '1');
      await set(page, 'fe_ee_notify_fail', 'local@invalid.test');
      await set(page, 'fe_ee_notes', 'Home History Success Run 每日');
      const created = await action(page, '$P().do_new_event()', 'app/create_event');
      expect(created.body.timeout).toBe(420);
      expect(created.body.retry_delay).toBe(17);
      expect(created.body.notes).toBe('Home History Success Run 每日');
      expect(created.body.enabled).toBe(0);
      expect(created.body.params.script).toBe(eventFixture('x').params.script);
      requests.push(canonical(created.body));
      await page.waitForFunction(() => !location.hash.includes('sub='));
    }
    traces.push(requests);
    expect(errors).toEqual([]);
    await context.close();
  }
  equalBuilds(traces);
});
test('I12 I14 T02 T10 cron import and modifier date picker submit original numeric epochs', async ({ browser }, info) => {
  const traces = [];
  for (const lab of labs()) {
    const session = await admin(lab), id = 'picker' + info.project.name;
    expect((await api(lab, 'app/create_event', eventFixture(id, { enabled: 1 }), session)).code).toBe(0);
    const { page, context, errors } = await localPage(browser, lab);
    await login(page);
    await route(page, 'Schedule?sub=edit_event&id=' + id);
    await page.locator('[onmouseup="$P().show_crontab_import_dialog()"]:visible').dispatchEvent('mouseup');
    await page.fill('#fe_ee_crontab', '17 3 * * *');
    await page.locator('[onmouseup="app.confirm_click(true)"]:visible').dispatchEvent('mouseup');
    await expect(page.locator('#dialog_overlay')).toBeHidden();
    const save = await action(page, '$P().do_save_event()', 'app/update_event');
    expect(save.body.timing).toEqual({ minutes: [17], hours: [3] });
    const runs = [];
    for (const modifier of ['shiftKey', 'ctrlKey', 'altKey']) {
      await page.locator('[onmouseup*="run_event_from_edit"]:visible').dispatchEvent('mouseup', { [modifier]: true });
      for (const [field, value] of Object.entries({ year: '2026', month: '10', day: '20', hour: '3', minute: '17' })) await page.selectOption('#fe_dt_' + field, value);
      if (lab.locale === 'zh-CN') await expect(page.locator('#fe_dt_hour option[value="3"]')).toHaveText('03:00');
      const run = await action(page, 'app.confirm_click(true)', 'app/run_event');
      expect(run.body.now).toBe(new Date('2026-10-20T03:17:00+08:00').getTime() / 1000);
      runs.push(canonical(run.body));
      await expect(page.locator('#dialog_overlay')).toBeHidden();
      // Wait for this real short job before starting the next modifier case.
      await expect.poll(async () => (await api(lab, 'app/get_job_details', { id: run.result.ids[0] }, session)).code).toBe(0);
    }
    traces.push([canonical(save.body), runs]);
    expect(errors).toEqual([]);
    await context.close();
  }
  equalBuilds(traces);
});
test('I10 I13 event enable and delete cancellation do not add or replay requests', async ({ browser }, info) => {
  const traces = [];
  for (const lab of labs()) {
    const session = await admin(lab), id = 'delete' + info.project.name;
    await api(lab, 'app/create_event', eventFixture(id), session);
    const { page, context, errors } = await localPage(browser, lab);
    await login(page); await route(page, 'Schedule?sub=edit_event&id=' + id);
    await page.check('#fe_ee_enabled');
    await page.check('#fe_ee_catch_up');
    const save = await action(page, '$P().do_save_event()', 'app/update_event');
    expect(save.body).toMatchObject({ enabled: 1, catch_up: 1 });
    let deletes = 0;
    page.on('request', r => { if (r.url().endsWith('/app/delete_event')) deletes++; });
    const remove = page.locator('[onmouseup="$P().delete_event(\'edit\')"]:visible');
    await remove.dispatchEvent('mouseup');
    await page.locator('[onmouseup="app.confirm_click(false)"]:visible').dispatchEvent('mouseup');
    expect(deletes).toBe(0);
    expect((await api(lab, 'app/get_event', { id }, session)).code).toBe(0);
    await expect(page.locator('#dialog_overlay')).toBeHidden();
    await remove.dispatchEvent('mouseup');
    const deletion = await action(page, 'app.confirm_click(true)', 'app/delete_event');
    expect(deletes).toBe(1);
    expect((await api(lab, 'app/get_event', { id }, session)).code).not.toBe(0);
    traces.push([canonical(save.body), canonical(deletion.body)]);
    expect(errors).toEqual([]);
    await context.close();
  }
  equalBuilds(traces);
});
