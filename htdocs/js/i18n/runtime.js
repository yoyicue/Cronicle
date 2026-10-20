// Pure display helpers. Existing parsers, dates, scheduler data and API values stay intact.
function createCronicleI18N(locale, dictionary) {
  'use strict';
  var chinese = locale === 'zh-CN';
  var own = Object.prototype.hasOwnProperty;
  function placeholders(text) {
    return (text.match(/\{[a-zA-Z][\w]*\}/g) || []).sort().join('|');
  }
  function text(key, fallback, params) {
    var template = fallback;
    if (chinese && own.call(dictionary, key)) {
      var entry = dictionary[key];
      if (entry.en === fallback && typeof entry.zh === 'string' && placeholders(entry.zh) === placeholders(fallback)) template = entry.zh;
    }
    return template.replace(/\{([a-zA-Z][\w]*)\}/g, function(marker, name) {
      return params && own.call(params, name) ? String(params[name]) : marker;
    });
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function html(key, fallback, params) { return escapeHTML(text(key, fallback, params)); }
  var words = {};
  Object.keys(dictionary).forEach(function(key) { words[dictionary[key].en] = dictionary[key].zh; });
  function word(value) {
    if (!chinese) return value;
    var types = { event: '计划任务', events: '计划任务', job: '执行实例', jobs: '执行实例', 'active job': '运行中实例', 'active jobs': '运行中实例', 'pending event': '待执行任务', 'pending events': '待执行任务', 'completed job': '已完成实例', 'completed jobs': '已完成实例', category: '分类', categories: '分类', plugin: '插件', plugins: '插件', user: '用户', users: '用户', server: '服务器', servers: '服务器', key: '密钥', keys: '密钥', group: '服务器组', groups: '服务器组', item: '条目', items: '条目' };
    var normalized = String(value).toLowerCase();
    return own.call(types, normalized) ? types[normalized] : value;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function timing(value, timezone) {
    var original = summarize_event_timing(value, timezone);
    if (!chinese) return original;
    if (!value) return '按需执行';
    var limits = { years: [1, 9999], months: [1, 12], days: [1, 31], weekdays: [0, 6], hours: [0, 23], minutes: [0, 59] };
    var keys = Object.keys(limits);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k], values = value[key];
      if (values && (!Array.isArray(values) || values.some(function(n) { return typeof n !== 'number' || n % 1 || n < limits[key][0] || n > limits[key][1]; }))) return original;
    }
    var groups = [], weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    if (value.years && value.years.length) groups.push(value.years.join('、') + '年');
    if (value.months && value.months.length) groups.push(value.months.join('、') + '月');
    if (value.days && value.days.length) groups.push('每月的' + value.days.join('、') + '日');
    if (value.weekdays && value.weekdays.length) groups.push('每周' + value.weekdays.map(function(n) { return weekdays[n]; }).join('、'));
    var hours = value.hours || [], minutes = value.minutes || [];
    if (hours.length === 1 && minutes.length === 1) {
      groups.push((groups.length ? '' : '每日 ') + pad(hours[0]) + ':' + pad(minutes[0]));
    }
    else {
      if (hours.length) groups.push('小时：' + hours.map(pad).join('、'));
      if (!minutes.length) groups.push('每分钟');
      else {
        var interval = detect_num_interval(minutes, 60);
        if (interval) groups.push('每 ' + interval + ' 分钟，从第 ' + pad(minutes[0]) + ' 分钟开始');
        else groups.push((hours.length ? '分钟：' : '每小时的第 ') + minutes.map(pad).join('、') + (hours.length ? '' : ' 分钟'));
      }
    }
    return groups.join('，且 ') + ' [' + (timezone || app.tz) + ']';
  }
  function timingHTML(value, timezone) {
    var original = summarize_event_timing(value, timezone);
    if (!chinese) return original.replace(/(every\s+minute)/i, '<span style="color:red">$1</span>');
    var rendered = escapeHTML(timing(value, timezone));
    return /(every\s+minute)/i.test(original) ? rendered.replace('每分钟', '<span style="color:red">每分钟</span>') : rendered;
  }
  function formatDate(epoch, kind, seconds, abbreviated) {
    var original = kind === 'date' ? get_nice_date(epoch, abbreviated) : kind === 'time' ? get_nice_time(epoch, seconds) : get_nice_date_time(epoch, seconds, abbreviated);
    if (!chinese) return original;
    var args = get_date_args(epoch);
    if (!Number.isFinite(args.year)) return original;
    var date = args.year + '-' + pad(args.mon) + '-' + pad(args.mday);
    var time = pad(args.hour) + ':' + pad(args.min) + (seconds ? ':' + pad(args.sec) : '');
    return kind === 'date' ? date : kind === 'time' ? time : date + ' ' + time;
  }
  function duration(value) {
    if (!chinese) return value;
    var units = { second: '秒', seconds: '秒', sec: '秒', secs: '秒', minute: '分钟', minutes: '分钟', min: '分钟', mins: '分钟', hour: '小时', hours: '小时', hr: '小时', hrs: '小时', day: '天', days: '天', month: '个月', months: '个月', year: '年', years: '年', century: '世纪', centuries: '世纪', byte: '字节', bytes: '字节' };
    return value.replace(/^in about /, '约 ').replace(/^instantly$/, '立即').replace(/\b(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|months?|years?|centur(?:y|ies)|bytes?)\b/g, function(unit) { return units[unit]; });
  }
  function items(source, kind) {
    if (!chinese) return source;
    return source.map(function(item) {
      var copy = item.slice();
      copy[1] = kind === 'hour' ? pad(item[0]) + ':00' : item[0] + (kind === 'month' ? '月' : '日');
      return copy;
    });
  }
  function pluginParamTitle(plugin, param) {
    if (!chinese) return param.title;
    var defaults = {
      shellplug: { script: 'Script Source', annotate: 'Add Date/Time Stamps to Log', json: 'Interpret JSON in Output' },
      urlplug: { method: 'Method', url: 'URL', headers: 'Request Headers', data: 'POST Data', timeout: 'Timeout (Seconds)', idle_timeout: 'Idle Timeout (Seconds)', connect_timeout: 'Connect Timeout (Seconds)', follow: 'Follow Redirects', ssl_cert_bypass: 'SSL Cert Bypass', success_match: 'Success Match', error_match: 'Error Match' },
      testplug: { duration: 'Test Duration (seconds)', progress: 'Report Progress', burn: 'Burn Memory/CPU', action: 'Simulate Action' }
    };
    var expected = own.call(defaults, plugin) && defaults[plugin][param.id];
    return expected && expected === param.title && own.call(words, expected) ? words[expected] : param.title;
  }
  function privilegeTitle(privilege) {
    var defaults = { admin: 'Administrator', create_events: 'Create Events', edit_events: 'Edit Events', delete_events: 'Delete Events', run_events: 'Run Events', abort_events: 'Abort Events', state_update: 'Toggle Scheduler' };
    return chinese && own.call(defaults, privilege.id) && defaults[privilege.id] === privilege.title && own.call(words, privilege.title) ? words[privilege.title] : privilege.title;
  }
  return Object.freeze({
    text: text, html: html, word: word, timing: timing, timingHTML: timingHTML, duration: duration,
    date: function(epoch, abbreviated) { return formatDate(epoch, 'date', false, abbreviated); },
    time: function(epoch, seconds) { return formatDate(epoch, 'time', seconds); },
    dateTime: function(epoch, seconds, abbreviated) { return formatDate(epoch, 'dateTime', seconds, abbreviated); },
    momentDate: function(value, fallback) { return chinese ? value.format('YYYY-MM-DD HH:mm Z') + ' [' + value.tz() + ']' : value.format(fallback); },
    momentTime: function(value, fallback) { return chinese ? value.format('HH:mm Z') + ' [' + value.tz() + ']' : value.format(fallback); },
    zone: function(value, fallback) { return chinese ? value.format('Z') + ' [' + value.tz() + ']' : value.format(fallback); },
    monthItems: function(value) { return items(value, 'month'); },
    hourItems: function(value) { return items(value, 'hour'); },
    dayItems: function(value) { return items(value, 'day'); },
    pluginParamTitle: pluginParamTitle, privilegeTitle: privilegeTitle
  });
}
if (typeof module === 'object' && module.exports) module.exports = createCronicleI18N;
