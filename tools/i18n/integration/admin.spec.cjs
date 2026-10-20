const { test, expect } = require('@playwright/test');
const { labs, localPage, login, route, api, admin, eventFixture, action, canonical, equalBuilds } = require('./helpers.cjs');

test('I21 categories create, edit, cancel delete and delete through the real API', async ({ browser }) => {
  const traces = [];
  for (const lab of labs()) {
    const { page, context, errors } = await localPage(browser, lab);
    await login(page);
    await route(page, 'Admin?sub=new_category');
    await page.fill('#fe_ec_title', 'History');
    await page.fill('#fe_ec_desc', 'Home Success Run');
    const create = await action(page, '$P().do_new_category()', 'app/create_category');
    const id = create.result.id;
    await route(page, 'Admin?sub=edit_category&id=' + id);
    await expect(page.locator('#fe_ec_title')).toHaveValue('History');
    await page.fill('#fe_ec_desc', 'History edited');
    const edit = await action(page, '$P().do_save_category()', 'app/update_category');
    await route(page, 'Admin?sub=edit_category&id=' + id);
    await page.locator('[onmouseup="$P().show_delete_category_dialog()"]:visible').dispatchEvent('mouseup');
    await page.locator('[onmouseup="app.confirm_click(false)"]:visible').dispatchEvent('mouseup');
    expect(await page.evaluate(() => app.page_manager.current_page_id)).toBe('Admin');
    await page.locator('[onmouseup="$P().show_delete_category_dialog()"]:visible').dispatchEvent('mouseup');
    const remove = await action(page, 'app.confirm_click(true)', 'app/delete_category');
    traces.push([canonical(create.body), canonical(edit.body, id), canonical(remove.body, id)]);
    expect(errors).toEqual([]);
    await context.close();
  }
  equalBuilds(traces);
});

test('I22 plugin creation and editing preserve executable paths and user labels', async ({ browser }) => {
  const traces = [];
  for (const lab of labs()) {
    const { page, context, errors } = await localPage(browser, lab);
    await login(page);
    await route(page, 'Admin?sub=new_plugin');
    await page.fill('#fe_ep_title', 'Success');
    await page.fill('#fe_ep_command', '/bin/echo');
    const create = await action(page, '$P().do_new_plugin()', 'app/create_plugin');
    const id = create.result.id;
    await route(page, 'Admin?sub=edit_plugin&id=' + id);
    await expect(page.locator('#fe_ep_title')).toHaveValue('Success');
    await expect(page.locator('#fe_ep_command')).toHaveValue('/bin/echo');
    await page.fill('#fe_ep_title', 'History');
    const edit = await action(page, '$P().do_save_plugin()', 'app/update_plugin');
    await route(page, 'Admin?sub=edit_plugin&id=' + id);
    await page.locator('[onmouseup="$P().show_delete_plugin_dialog()"]:visible').dispatchEvent('mouseup');
    const remove = await action(page, 'app.confirm_click(true)', 'app/delete_plugin');
    traces.push([canonical(create.body), canonical(edit.body, id), canonical(remove.body, id)]);
    expect(errors).toEqual([]);
    await context.close();
  }
  equalBuilds(traces);
});

test('I22 I23 five plugin controls retain JSON values, hidden defaults and custom option text', async ({ browser }, info) => {
  const traces = [];
  for (const lab of labs()) {
    const session = await admin(lab), id = 'controls' + info.project.name;
    const params = [
      { id: 'text', type: 'text', size: 20, title: 'Home', value: 'History' },
      { id: 'source', type: 'textarea', rows: 3, title: 'Run', value: 'Success\nHome' },
      { id: 'check', type: 'checkbox', title: 'History', value: 1 },
      { id: 'choice', type: 'select', title: 'Success', items: ['Success', 'Failure'], value: 'Success' },
      { id: 'secret', type: 'hidden', title: 'Hidden', value: 'KeepExactly' }
    ];
    expect((await api(lab, 'app/create_plugin', { id, title: 'Custom labels', enabled: 1, command: '/bin/echo', params }, session)).code).toBe(0);
    const event = eventFixture('event' + id, { plugin: id, params: { text: 'History', source: 'Success\nHome', check: 1, choice: 'Success', secret: 'KeepExactly' } });
    expect((await api(lab, 'app/create_event', event, session)).code).toBe(0);
    const { page, context, errors } = await localPage(browser, lab);
    await login(page);
    await route(page, 'Schedule?sub=edit_event&id=' + event.id);
    await expect(page.locator('#fe_ee_pp_choice option[value="Success"]')).toHaveText('Success');
    await expect(page.locator('#fe_ee_pp_text')).toHaveValue('History');
    await expect(page.locator('#fe_ee_pp_source')).toHaveValue('Success\nHome');
    await expect(page.locator('#fe_ee_pp_check')).toBeChecked();
    const save = await action(page, '$P().do_save_event()', 'app/update_event');
    expect(save.body.params).toEqual(event.params);
    traces.push(canonical(save.body));
    expect(errors).toEqual([]);
    await context.close();
  }
  equalBuilds(traces);
});

test('I24 group dialog changes labels while regexp and eligibility values stay original', async ({ browser }) => {
  const traces = [];
  for (const lab of labs()) {
    const { page, context, errors } = await localPage(browser, lab);
    await login(page);
    await route(page, 'Admin?sub=servers');
    await page.locator('[onmouseup="$P().edit_group(-1)"]').dispatchEvent('mouseup');
    await page.fill('#fe_eg_title', 'History');
    await page.fill('#fe_eg_regexp', '^localhost$');
    await page.selectOption('#fe_eg_master', '0');
    const create = await action(page, 'app.confirm_click(true)', 'app/create_server_group');
    expect(create.body).toMatchObject({ title: 'History', regexp: '^localhost$', master: 0 });
    await expect.poll(() => page.evaluate(() => app.server_groups.some(row => row.title === 'History'))).toBe(true);
    const group = await page.evaluate(() => app.server_groups.find(row => row.title === 'History'));
    expect(group).toBeTruthy();
    const index = await page.evaluate(id => $P().server_groups.findIndex(item => item.id === id), group.id);
    await page.locator('[onmouseup="$P().edit_group(' + index + ')"]').first().dispatchEvent('mouseup');
    await page.fill('#fe_eg_title', 'Home');
    const update = await action(page, 'app.confirm_click(true)', 'app/update_server_group');
    await expect.poll(() => page.evaluate(id => app.server_groups.find(row => row.id === id).title, group.id)).toBe('Home');
    await route(page, 'Admin?sub=servers');
    const deleteIndex = await page.evaluate(id => $P().server_groups.findIndex(row => row.id === id), group.id);
    await page.locator('[onmouseup="$P().delete_group(' + deleteIndex + ')"]').dispatchEvent('mouseup');
    const remove = await action(page, 'app.confirm_click(true)', 'app/delete_server_group');
    traces.push([canonical(create.body), canonical(update.body, group.id), canonical(remove.body, group.id)]);
    expect(errors).toEqual([]);
    await context.close();
  }
  equalBuilds(traces);
});

test('I26 API key forms preserve keys and privilege identifiers', async ({ browser }, info) => {
  const traces = [];
  for (const lab of labs()) {
    const { page, context, errors } = await localPage(browser, lab);
    await login(page);
    await route(page, 'Admin?sub=new_api_key');
    await page.fill('#fe_ak_key', 'localkey' + info.project.name);
    await page.fill('#fe_ak_title', 'History');
    await page.fill('#fe_ak_desc', 'Success Run Home');
    await page.check('#fe_ak_priv_run_events');
    const create = await action(page, '$P().do_new_api_key()', 'app/create_api_key');
    const id = create.result.id;
    expect(create.body.key).toBe('localkey' + info.project.name);
    expect(create.body.privileges.run_events).toBe(1);
    await route(page, 'Admin?sub=edit_api_key&id=' + id);
    await expect(page.locator('#fe_ak_key')).toHaveValue('localkey' + info.project.name);
    const update = await action(page, '$P().do_save_api_key()', 'app/update_api_key');
    await page.locator('[onmouseup="$P().show_delete_api_key_dialog()"]:visible').dispatchEvent('mouseup');
    const remove = await action(page, 'app.confirm_click(true)', 'app/delete_api_key');
    traces.push([canonical(create.body), canonical(update.body, id), canonical(remove.body, id)]);
    expect(errors).toEqual([]);
    await context.close();
  }
  equalBuilds(traces);
});
