const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root } = require('../source.cjs');
const dictionary = require('../../../htdocs/js/i18n/zh-CN.json');

function context(locale = 'zh-CN', words = dictionary) {
  const ctx = { app: { tz: 'Asia/Shanghai', extend(value) { Object.assign(this, value); } }, moment: require('../../../node_modules/moment-timezone') };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const file of ['md5', 'xml', 'tools', 'datetime']) vm.runInContext(fs.readFileSync(path.join(root, 'node_modules/pixl-webapp/js', file + '.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'htdocs/js/app.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'htdocs/js/i18n/runtime.js'), 'utf8'), ctx);
  ctx.i18n = ctx.createCronicleI18N(locale, words);
  return ctx;
}
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

test('U01 languages and unknown keys fall back to English', () => {
  for (const locale of ['en', 'zh-CN', 'unknown']) {
    const { i18n } = context(locale, { greeting: { en: 'Hello', zh: '你好' } });
    assert.equal(i18n.text('greeting', 'Hello'), locale === 'zh-CN' ? '你好' : 'Hello');
    assert.equal(i18n.text('missing', 'Missing'), 'Missing');
  }
});
test('U02 mismatched placeholders fall back without dropping fields', () => {
  const { i18n } = context('zh-CN', { bad: { en: 'Hello {name}', zh: '你好 {other}' } });
  assert.equal(i18n.text('bad', 'Hello {name}', { name: 'Run' }), 'Hello Run');
  assert.equal(i18n.text('bad', 'Hello {name}', {}), 'Hello {name}');
});
test('U03 zero, false, empty strings, Unicode and newlines survive', () => {
  const { i18n } = context();
  assert.equal(i18n.text('missing', '{a}/{b}/{c}/{d}', { a: 0, b: false, c: '', d: '中文\n换行' }), '0/false//中文\n换行');
});
test('U04 inserted braces and replacement metacharacters are never reinterpreted', () => {
  const { i18n } = context();
  assert.equal(i18n.text('missing', '{a}/{b}', { a: '{b}$&\\', b: 'End' }), '{b}$&\\/End');
});
test('U05 formatters do not mutate frozen data', () => {
  const ctx = context(), timing = freeze({ months: [12, 1], days: [31, 1], weekdays: [0, 1], hours: [3], minutes: [17] });
  const before = JSON.stringify(timing);
  assert.match(ctx.i18n.timing(timing), /03:17/);
  assert.equal(JSON.stringify(timing), before);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.i18n.monthItems(freeze([[1, 'January']])))), [[1, '1月']]);
});
test('U06 no DOM, storage, timers or network is required by pure helpers', () => {
  const { i18n } = context();
  for (let n = 0; n < 1000; n++) assert.equal(i18n.word('active jobs'), '运行中实例');
});
test('U07 escaping is context-specific and inherited keys are ignored', () => {
  const { i18n } = context('zh-CN', Object.create({ inherited: { en: 'Safe', zh: 'Unsafe' } }));
  const input = '<img src=x onerror="alert(1)">&\'';
  assert.equal(i18n.text('inherited', 'Safe'), 'Safe');
  assert.equal(i18n.text('none', '{title}', { title: input }), input);
  assert.equal(i18n.html('none', '{title}', { title: input }), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
});
test('U08 independent keys and customized plugin labels retain their meaning', () => {
  const { i18n } = context('zh-CN', { a: { en: 'Run', zh: '运行' }, b: { en: 'Run', zh: '执行记录' }, c: { en: 'Script Source', zh: '脚本内容' } });
  assert.equal(i18n.text('a', 'Run'), '运行');
  assert.equal(i18n.text('b', 'Run'), '执行记录');
  assert.equal(i18n.pluginParamTitle('shellplug', { id: 'script', title: 'Script Source' }), '脚本内容');
  assert.equal(i18n.pluginParamTitle('shellplug', { id: 'script', title: 'My Source' }), 'My Source');
  assert.equal(i18n.pluginParamTitle('custom', { id: 'script', title: 'Script Source' }), 'Script Source');
});
test('T01 false, null, empty timing and empty limits stay distinct', () => {
  const { i18n } = context();
  for (const input of [false, null]) assert.equal(i18n.timing(input), '按需执行');
  for (const input of [{}, { minutes: [] }]) assert.match(i18n.timing(input), /每分钟/);
});
test('T02 24-hour times include the original 03:17 regression', () => {
  const { i18n } = context();
  for (const [hour, minute] of [[3, 17], [3, 47], [0, 0], [12, 0], [23, 59]]) assert.match(i18n.timing({ hours: [hour], minutes: [minute] }), new RegExp(String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')));
});
test('T03 every timing dimension remains visible', () => {
  const { i18n } = context();
  const output = i18n.timing({ years: [2028], months: [2], days: [29], weekdays: [2], hours: [3], minutes: [17] });
  for (const value of ['2028年', '2月', '29日', '周二', '03:17']) assert(output.includes(value), value);
});
test('T04 weekday numbers retain Sunday zero', () => {
  const { i18n } = context();
  assert.match(i18n.timing({ weekdays: [0] }), /周日/);
  assert.match(i18n.timing({ weekdays: [1] }), /周一/);
});
test('T05 day and weekday constraints are joined by intersection', () => {
  const { i18n } = context();
  assert.match(i18n.timing({ days: [1], weekdays: [1] }), /每月的1日，且 每周一/);
});
test('T06 minute intervals retain offset and irregular values', () => {
  const { i18n } = context();
  assert.match(i18n.timing({ minutes: Array.from({ length: 12 }, (_, i) => i * 5 + 2) }), /每 5 分钟，从第 02/);
  assert.match(i18n.timing({ minutes: [1, 17, 33] }), /01、17、33/);
  assert.match(i18n.timing({ minutes: Array.from({ length: 60 }, (_, i) => i) }), /每 1 分钟/);
});
test('T07 IANA timezone identity survives', () => {
  const { i18n } = context();
  for (const zone of ['Asia/Shanghai', 'UTC', 'Asia/Kolkata', 'America/New_York']) assert(i18n.timing({}, zone).endsWith('[' + zone + ']'));
});
test('T08 DST formatting retains underlying epoch and explicit offset', () => {
  const ctx = context();
  for (const epoch of [1636263000, 1636266600, 1615703400, 1615707000]) {
    const original = ctx.moment.tz(epoch * 1000, 'America/New_York');
    assert.equal(ctx.i18n.momentDate(original, 'lll z'), original.format('YYYY-MM-DD HH:mm Z') + ' [America/New_York]');
    assert.equal(ctx.i18n.momentTime(original, 'h:mm A z'), original.format('HH:mm Z') + ' [America/New_York]');
    assert.equal(ctx.i18n.zone(original, 'z'), original.format('Z') + ' [America/New_York]');
    assert.equal(original.unix(), epoch);
  }
});
test('T09 high-frequency warning matches the original English predicate', () => {
  const ctx = context();
  for (const timing of [false, {}, { hours: [3] }, { minutes: [0] }, { minutes: [] }, { minutes: Array.from({ length: 60 }, (_, i) => i) }]) assert.equal(ctx.i18n.timingHTML(timing).includes('color:red'), /(every\s+minute)/i.test(ctx.summarize_event_timing(timing)));
});
test('T10 cron parsing, aliases and hash seed remain original', () => {
  const ctx = context();
  for (const cron of ['* * * * *', '17 3 * * *', '47 3 * * SUN', '0 0 29 FEB *', '@weekly', 'h * * * *']) {
    const before = JSON.stringify(ctx.parse_crontab(cron, 'seed'));
    ctx.i18n.timing(ctx.parse_crontab(cron, 'seed'));
    assert.equal(JSON.stringify(ctx.parse_crontab(cron, 'seed')), before);
  }
  assert.throws(() => ctx.parse_crontab('h/5 * * * *', 'seed'), /Invalid crontab format/);
});
test('T11 translated option labels retain numeric values and do not modify globals', () => {
  const ctx = context(), before = JSON.stringify(ctx._months);
  const options = ctx.render_menu_options(ctx.i18n.monthItems(ctx._months), 2, false);
  assert.match(options, /value="2" selected="selected">2月/);
  assert.equal(JSON.stringify(ctx._months), before);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.i18n.hourItems([[3, '3AM']]))), [[3, '03:00']]);
});
test('original English date, unit and summary formatters remain byte-equivalent', () => {
  const ctx = context('en');
  assert.equal(ctx.i18n.timing({ hours: [3], minutes: [17] }), ctx.summarize_event_timing({ hours: [3], minutes: [17] }));
  for (const epoch of [1, 1454797620, 1792432200]) {
    assert.equal(ctx.i18n.date(epoch, true), ctx.get_nice_date(epoch, true));
    assert.equal(ctx.i18n.time(epoch, true), ctx.get_nice_time(epoch, true));
    assert.equal(ctx.i18n.dateTime(epoch, true, true), ctx.get_nice_date_time(epoch, true, true));
  }
  assert.equal(ctx.i18n.duration('1 hour 15 minutes'), '1 hour 15 minutes');
  const value = ctx.moment.tz(1792437420000, 'Asia/Shanghai');
  assert.equal(ctx.i18n.momentTime(value, 'h:mm A z'), value.format('h:mm A z'));
  assert.equal(ctx.i18n.zone(value, 'z'), value.format('z'));
});
test('password strength durations translate only their display copy', () => {
  const { i18n } = context();
  assert.equal(i18n.duration('in about 2 centuries'), '约 2 世纪');
  assert.equal(i18n.duration('instantly'), '立即');
});
module.exports = { context };
