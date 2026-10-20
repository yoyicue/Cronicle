const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const { labs, localPage, login, route, api, admin, eventFixture, action, canonical, equalBuilds } = require('./helpers.cjs');

async function completed(lab, session, id) {
  let result;
  await expect.poll(async () => {
    result = await api(lab, 'app/get_job_details', { id, need_log: 1 }, session);
    return result.code;
  }, { timeout: 15000 }).toBe(0);
  return result;
}
async function updatedStatus(page, update) {
  await page.evaluate(update => {
    const socket = app.socket;
    window.__updatedJobStatus = false;
    const listener = data => {
      const job = data.active_jobs && data.active_jobs[update.id];
      if (job && job.notify_success === update.notify_success && job.notify_fail === update.notify_fail) {
        window.__updatedJobStatus = true;
        socket.off('status', listener);
      }
    };
    socket.on('status', listener);
  }, update);
  await page.waitForFunction(() => window.__updatedJobStatus);
}

test('I07 I11 I13 I15 I19 real UI create, cancel run, run once, socket updates and raw log download', async ({ browser, browserName }, info) => {
  const traces = [];
  const inlineAttachment = browserName === 'webkit' && process.platform === 'linux';
  if (inlineAttachment) info.annotations.push({ type: 'browser limitation', description: 'Linux WebKit displays text/plain attachments inline: https://github.com/microsoft/playwright/issues/34076' });
  for (const lab of labs()) {
    const session = await admin(lab), id = 'run' + info.project.name;
    const { page, context, errors, socketEvents } = await localPage(browser, lab);
    await login(page);
    await route(page, 'Schedule?sub=new_event');
    await page.fill('#fe_ee_title', '[' + id + '] History');
    await page.selectOption('#fe_ee_cat', 'general');
    await page.selectOption('#fe_ee_target', 'maingrp');
    await page.selectOption('#fe_ee_plugin', 'shellplug');
    await page.fill('#fe_ee_pp_script', '#!/bin/sh\nprintf "History Success Home Run\\n"\nsleep 1\n');
    await page.selectOption('#fe_ee_timing', 'demand');
    const create = await action(page, '$P().do_new_event()', 'app/create_event');
    expect(create.body.id).toBe(id);
    expect(create.body.title).toBe('History');
    expect(create.body.timing).toBe(false);
    await route(page, 'Schedule?sub=edit_event&id=' + id);
    await page.evaluate(() => { config.prompt_before_run = true; });
    let calls = 0;
    page.on('request', r => { if (new URL(r.url()).pathname === '/api/app/run_event') calls++; });
    const runButton = page.locator('[onmouseup*="run_event_from_edit"]:visible');
    await runButton.dispatchEvent('mouseup');
    await expect(page.locator('[onmouseup="app.confirm_click(false)"]:visible')).toBeVisible();
    await page.locator('[onmouseup="app.confirm_click(false)"]:visible').dispatchEvent('mouseup');
    expect(calls).toBe(0);
    const fixedTime = new Date('2026-10-20T03:17:00+08:00');
    // Control the run input without freezing jQuery's animation clock.
    await page.evaluate(epoch => { window.time_now = () => epoch; }, fixedTime.getTime() / 1000);
    await runButton.dispatchEvent('mouseup');
    const run = await action(page, 'app.confirm_click(true)', 'app/run_event');
    await expect(page.locator('#dialog_overlay')).toBeHidden();
    expect(run.body.now).toBe(fixedTime.getTime() / 1000);
    expect(calls).toBe(1);
    expect(run.result.ids).toHaveLength(1);
    const jobId = run.result.ids[0];
    const result = await completed(lab, session, jobId);
    expect(result.job.code).toBe(0);
    expect(result.job.event).toBe(id);
    expect(result.job.params.script).toBe(create.body.params.script);
    await route(page, 'JobDetails?id=' + jobId);
    await expect(page.locator('#page_JobDetails')).toContainText('History');
    const logResponse = await fetch(lab.baseURL + '/api/app/get_job_log?id=' + jobId + '&t=' + result.token);
    const log = await logResponse.text();
    expect(log).toContain('History Success Home Run\n');
    const link = page.locator('a[href*="get_job_log"][href*="download=1"]:visible');
    if (inlineAttachment) {
      // shortcut: Linux WebKit ignores text/plain attachment headers; restore the file assertion when upstream fixes #34076.
      const url = new URL(await link.getAttribute('href'), lab.baseURL).href;
      const pending = page.waitForResponse(response => response.url() === url && response.request().isNavigationRequest());
      await link.click();
      const response = await pending;
      expect(response.status()).toBe(200);
      expect(await response.headerValue('content-disposition')).toBe('attachment; filename=Cronicle-Job-Log-' + jobId + '.txt');
      expect(await response.body()).toEqual(Buffer.from(log));
      await expect(page).toHaveURL(url);
      expect(await page.locator('pre').textContent()).toBe(log);
    }
    else {
      const downloadPromise = page.waitForEvent('download');
      await link.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('Cronicle-Job-Log-' + jobId + '.txt');
      expect(fs.readFileSync(await download.path(), 'utf8')).toBe(log);
    }
    expect(socketEvents.some(event => event.direction === 'sent' && event.name === 'authenticate')).toBe(true);
    expect(socketEvents.some(event => event.direction === 'received' && event.name === 'status')).toBe(true);
    const history = await api(lab, 'app/get_event_history', { id, offset: 0, limit: 20 }, session);
    expect(history.rows.filter(row => row.id === jobId)).toHaveLength(1);
    traces.push([canonical(create.body), canonical(run.body)]);
    expect(errors).toEqual([]);
    await context.close();
  }
  equalBuilds(traces);
});

test('I17 failed jobs retain original plugin diagnostics', async ({ browser }, info) => {
  const results = [];
  for (const lab of labs()) {
    const session = await admin(lab), id = 'failure' + info.project.name;
    expect((await api(lab, 'app/create_event', eventFixture(id, { enabled: 1, params: { script: '#!/bin/sh\nprintf "History Failure\\n"\nexit 3\n', annotate: 0, json: 0 } }), session)).code).toBe(0);
    const { page, context, errors } = await localPage(browser, lab);
    await login(page);
    await route(page, 'Schedule?sub=edit_event&id=' + id);
    await page.evaluate(() => { config.prompt_before_run = false; });
    const run = await action(page, '$P().run_event_from_edit(event)', 'app/run_event');
    const result = await completed(lab, session, run.result.ids[0]);
    expect(result.job.code).toBe(3);
    await route(page, 'JobDetails?id=' + result.job.id);
    await expect(page.locator('#page_JobDetails')).toContainText(result.job.description);
    results.push({ code: result.job.code, description: result.job.description, params: result.job.params });
    expect(errors).toEqual([]);
    await context.close();
  }
  equalBuilds(results);
});

test('I18 I20 active jobs can be watched and aborted without touching their scripts', async ({ browser }, info) => {
  test.setTimeout(90000);
  const results = [];
  for (const lab of labs()) {
    const session = await admin(lab), id = 'abort' + info.project.name;
    expect((await api(lab, 'app/create_event', eventFixture(id, { enabled: 1, params: { script: '#!/bin/sh\nprintf "History Still Running\\n"\nsleep 20\n', annotate: 0, json: 0 } }), session)).code).toBe(0);
    const run = await api(lab, 'app/run_event', { id }, session);
    expect(run.code).toBe(0);
    const jobId = run.ids[0];
    const { page, context, errors } = await localPage(browser, lab);
    await login(page);
    await route(page, 'JobDetails?id=' + jobId);
    const watch = await action(page, '$P().toggle_watch()', 'app/update_job');
    expect(watch.body).toMatchObject({ id: jobId });
    expect(watch.body.notify_success).toContain('admin@cronicle.com');
    // A queued pre-update status frame can overwrite the optimistic local job before the next toggle.
    await updatedStatus(page, watch.body);
    const unwatch = await action(page, '$P().toggle_watch()', 'app/update_job');
    expect(unwatch.body.notify_success).not.toContain('admin@cronicle.com');
    await updatedStatus(page, unwatch.body);
    await expect(page.locator('[onmouseup="$P().abort_job()"]:visible')).toBeVisible();
    await page.locator('[onmouseup="$P().abort_job()"]:visible').evaluate(button => {
      window.__abortSource = JSON.parse(JSON.stringify($P().find_job($P().args.id)));
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const abort = await action(page, 'app.confirm_click(true)', 'app/abort_job');
    expect(abort.body.id).toBe(jobId);
    expect(abort.body).toEqual({ ...await page.evaluate(() => window.__abortSource), session_id: abort.body.session_id });
    const result = await completed(lab, session, jobId);
    expect(result.job.code).not.toBe(0);
    expect(result.job.params.script).toContain('History Still Running');
    const body = canonical(abort.body, jobId);
    // Runtime identities belong to each isolated server, and must match its real job.
    for (const key of ['hostname', 'log_file', 'pid', 'time_start', 'now']) {
      expect(body[key]).toEqual(result.job[key]);
      delete body[key];
    }
    for (const key of ['cpu', 'mem']) {
      expect(body[key].current).toBeGreaterThanOrEqual(0);
      delete body[key];
    }
    expect(body.progress).toBeGreaterThanOrEqual(0);
    expect(body.progress).toBeLessThanOrEqual(1);
    delete body.progress;
    // Original async log stat may first appear in a later status frame.
    if (Object.hasOwn(body, 'log_file_size')) {
      expect(Number.isSafeInteger(body.log_file_size)).toBe(true);
      expect(body.log_file_size).toBeGreaterThan(0);
      expect(body.log_file_size).toBeLessThanOrEqual(result.job.log_file_size);
      delete body.log_file_size;
    }
    results.push({ body, code: result.job.code, description: result.job.description });
    expect(errors).toEqual([]);
    await context.close();
  }
  equalBuilds(results);
});

test('I20 completed job rerun and log deletion preserve original job values and confirmation behavior', async ({ browser }, info) => {
  const traces = [];
  for (const lab of labs()) {
    const session = await admin(lab), id = 'rerun' + info.project.name;
    await api(lab, 'app/create_event', eventFixture(id, { enabled: 1 }), session);
    const first = await api(lab, 'app/run_event', { id }, session);
    const original = await completed(lab, session, first.ids[0]);
    const { page, context, errors } = await localPage(browser, lab);
    await login(page); await route(page, 'JobDetails?id=' + first.ids[0]);
    const rerun = await action(page, '$P().run_again()', 'app/run_event');
    expect(rerun.body.now).toBe(original.job.now);
    expect(rerun.body.params).toEqual(original.job.params);
    // The original UI redirects asynchronously after rerun; let it finish before returning to the old job.
    await page.waitForFunction(id => $P().args.id === id && !$P().jump_live_job_id, rerun.result.ids[0]);
    await completed(lab, session, rerun.result.ids[0]);
    await route(page, 'JobDetails?id=' + first.ids[0]);
    await page.waitForFunction(id => $P().job && $P().job.id === id, first.ids[0]);
    const snapshot = await page.evaluate(() => JSON.parse(JSON.stringify($P().job)));
    let calls = 0;
    page.on('request', r => { if (r.url().endsWith('/app/delete_job')) calls++; });
    await page.locator('[onmouseup="$P().delete_job()"]:visible').dispatchEvent('mouseup');
    await page.locator('[onmouseup="app.confirm_click(false)"]:visible').dispatchEvent('mouseup');
    expect(calls).toBe(0);
    await expect(page.locator('#dialog_overlay')).toBeHidden();
    await page.locator('[onmouseup="$P().delete_job()"]:visible').dispatchEvent('mouseup');
    const remove = await action(page, 'app.confirm_click(true)', 'app/delete_job');
    expect(calls).toBe(1);
    expect(remove.body).toEqual({ ...snapshot, session_id: remove.body.session_id });
    expect((await api(lab, 'app/get_job_details', { id: first.ids[0] }, session)).code).not.toBe(0);
    const body = canonical(rerun.body);
    body.now = '<original-job-epoch>';
    traces.push({ body, removed: remove.result });
    expect(errors).toEqual([]);
    await context.close();
  }
  equalBuilds(traces);
});
