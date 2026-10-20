const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('@playwright/test');
const labs = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../.work/test-labs.json')));
async function localPage(browser, lab, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', ...options });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  const errors = [];
  const externalRequests = [];
  page.on('request', request => { if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname)) externalRequests.push(request.url()); });
  page.on('response', response => { if (response.status() >= 400) errors.push('HTTP ' + response.status() + ': ' + new URL(response.url()).pathname); });
  const socketEvents = [];
  page.on('websocket', socket => {
    const record = direction => frame => {
      const value = String(frame.payload);
      if (!value.startsWith('42')) return;
      try {
        const event = JSON.parse(value.slice(2));
        socketEvents.push({ direction, name: event[0], keys: event[1] && typeof event[1] === 'object' ? Object.keys(event[1]).sort() : [] });
      }
      catch (_) { /* Socket.IO control packets are not business events. */ }
    };
    socket.on('framesent', record('sent'));
    socket.on('framereceived', record('received'));
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(lab.url);
  // The config/login callback renders after the document load event.
  await expect(page.locator('#fe_login_username')).toBeVisible();
  return { page, context, errors, socketEvents, externalRequests };
}
async function login(page, username = 'admin', password = 'admin') {
  await expect(page.locator('#fe_login_username')).toBeVisible();
  const initialField = await page.evaluate(() => app.getPref('username') ? '#fe_login_password' : '#fe_login_username');
  await expect(page.locator(initialField)).toBeFocused();
  await page.locator('#fe_login_username').fill(username);
  await page.locator('#fe_login_password').fill(password);
  const response = page.waitForResponse(r => r.url().endsWith('/user/login') && r.request().method() === 'POST');
  await page.locator('.dialog_buttons .button[onmouseup*="doLogin"]').dispatchEvent('mouseup');
  expect((await (await response).json()).code).toBe(0);
  await page.waitForFunction(() => app.user && app.getPref('session_id') && app.page_manager.current_page_id === 'Home');
  await expect(page.locator('[onmouseup="app.doUserLogout()"]')).toBeVisible();
  await expect(page.locator('#dialog_overlay')).toBeHidden();
}
async function logout(page) {
  await page.locator('[onmouseup="app.doUserLogout()"]').dispatchEvent('mouseup');
  await expect(page.locator('#fe_login_username')).toBeVisible();
  // Original logout clears cached data 150ms after showing Login.
  await page.waitForFunction(() => !app.user && !app.schedule && !app.plugins && !app.servers);
  await expect(page.locator('#dialog_overlay')).toBeHidden();
}
async function route(page, value) {
  await page.evaluate(value => Nav.go(value), value);
  const id = value.split('?')[0];
  await page.waitForFunction(id => app.page_manager.current_page_id === id, id);
  await expect(page.locator('#page_' + id)).not.toHaveClass(/loading/);
  // Original forms focus a field in a timer; typing earlier can go into the previous field in Firefox.
  const params = new URLSearchParams(value.split('?')[1] || '');
  const firstField = {
    'Admin:new_category': '#fe_ec_title', 'Admin:new_plugin': '#fe_ep_title',
    'Admin:new_api_key': '#fe_ak_title', 'Admin:new_user': '#fe_eu_username',
    'Schedule:new_event': '#fe_ee_title'
  }[id + ':' + params.get('sub')];
  if (firstField) await expect(page.locator(firstField)).toBeFocused();
  if (id === 'Login' && params.has('recover')) await expect(page.locator('#fe_pr_username')).toBeFocused();
  if (id === 'Login' && params.has('u') && params.has('h')) await expect(page.locator('#fe_reset_password')).toBeFocused();
}
async function api(lab, endpoint, params = {}, session) {
  const response = await fetch(lab.baseURL + '/api/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, ...(session ? { session_id: session } : {}) }) });
  return response.json();
}
async function admin(lab) {
  const result = await api(lab, 'user/login', { username: 'admin', password: 'admin' });
  expect(result.code).toBe(0);
  return result.session_id;
}
async function action(page, handler, endpoint) {
  const button = page.locator('[onmouseup=' + JSON.stringify(handler) + ']:visible');
  await expect(button).toBeVisible();
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/' + endpoint && response.request().method() === 'POST');
  await button.dispatchEvent('mouseup');
  const response = await pending;
  const result = await response.json();
  expect(result, endpoint).toMatchObject({ code: 0 });
  return { body: response.request().postDataJSON(), result };
}
function canonical(body, id) {
  const value = structuredClone(body);
  if (Object.hasOwn(value, 'session_id')) { expect(value.session_id).toMatch(/^\w+$/); value.session_id = '<session>'; }
  if (id && Object.hasOwn(value, 'id')) { expect(value.id).toBe(id); value.id = '<created-id>'; }
  for (const key of ['created', 'modified']) if (Object.hasOwn(value, key)) {
    expect(value[key]).toBeGreaterThan(1700000000);
    expect(value[key]).toBeLessThan(Date.now() / 1000 + 30);
    value[key] = '<server-time>';
  }
  return value;
}
function equalBuilds(values) {
  expect(values).toHaveLength(3);
  expect(values[1]).toEqual(values[0]);
  expect(values[2]).toEqual(values[0]);
}
function eventFixture(id, overrides = {}) {
  return { id, title: 'History', enabled: 0, category: 'general', target: 'maingrp', plugin: 'shellplug', params: { script: '#!/bin/sh\nprintf "History Success Home Run\\n"\n', annotate: 0, json: 0 }, timing: false, timezone: 'Asia/Shanghai', max_children: 1, timeout: 60, catch_up: 0, queue_max: 1000, ...overrides };
}
module.exports = { labs, localPage, login, logout, route, api, admin, eventFixture, action, canonical, equalBuilds };
