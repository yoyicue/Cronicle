const { U } = require('./source.cjs');

// Only these display calls may acquire a pure formatter; the original functions stay intact.
function instrument(source, file, report) {
  const edits = [];
  U.parse(source).walk(new U.TreeWalker(function(node) {
    const parents = [];
    for (let i = 0; this.parent(i); i++) parents.push(this.parent(i));
    const method = parents.find(p => p instanceof U.AST_ObjectKeyVal && p.value instanceof U.AST_Function);
    if (method && method.key === 'get_job_result_banner') return;
    const value = source.slice(node.start.pos, node.end.endpos);
    let replacement;
    if (node instanceof U.AST_Call) {
      const callee = node.expression.print_to_string();
      const target = node.expression instanceof U.AST_Dot && node.expression.expression;
      if (target instanceof U.AST_Call && target.expression.print_to_string() === 'summarize_event_timing' && node.expression.property === 'replace') {
        replacement = 'I18N.timingHTML(' + target.args.map(a => a.print_to_string()).join(',') + ')';
      }
      else if (callee === 'summarize_event_timing') replacement = 'I18N.timing(' + node.args.map(a => a.print_to_string()).join(',') + ')';
      else if (['get_nice_date', 'get_nice_time', 'get_nice_date_time'].includes(callee)) {
        replacement = value.replace(callee, { get_nice_date: 'I18N.date', get_nice_time: 'I18N.time', get_nice_date_time: 'I18N.dateTime' }[callee]);
      }
      else if (['get_text_from_seconds', 'get_text_from_seconds_round_custom', 'get_text_from_seconds_round', 'get_text_from_bytes'].includes(callee)) replacement = 'I18N.duration(' + value + ')';
      else if (callee === 'pluralize') replacement = 'I18N.word(' + value + ')';
      else if (callee === 'render_menu_options' || /\.get_timing_checkbox_set$/.test(callee)) {
        const arg = node.args[callee === 'render_menu_options' ? 0 : 1];
        const helper = arg && ({ _months: 'monthItems', hour_items: 'hourItems', mday_items: 'dayItems' })[arg.print_to_string()];
        if (helper) edits.push({ start: arg.start.pos, end: arg.end.endpos, value: 'I18N.' + helper + '(' + arg.print_to_string() + ')' });
      }
      else if (file.endsWith('Schedule.class.js') && callee.endsWith('.format') && node.args[0] instanceof U.AST_String && node.args[0].value === 'lll z') {
        replacement = 'I18N.momentDate(' + node.expression.expression.print_to_string() + ',"lll z")';
      }
      else if (file.endsWith('Home.class.js') && callee.endsWith('.format') && node.args[0] instanceof U.AST_String && node.args[0].value === 'h:mm A z') replacement = 'I18N.momentTime(' + node.expression.expression.print_to_string() + ',"h:mm A z")';
      else if (file === 'htdocs/js/app.js' && method && method.key === 'setHeaderClock' && callee.endsWith('.format') && node.args[0] instanceof U.AST_String && node.args[0].value === 'z') replacement = 'I18N.zone(' + node.expression.expression.print_to_string() + ',"z")';
    }
    if (node instanceof U.AST_SymbolRef && node.name === 'est_length' && method && method.key === 'get_password_warning' && parents.some(parent => parent instanceof U.AST_Return)) replacement = 'I18N.duration(est_length)';
    if (node instanceof U.AST_Dot && node.property === 'title' && node.expression.print_to_string() === 'param' && method && method.key === 'get_plugin_params_html') replacement = 'I18N.pluginParamTitle(event.plugin,param)';
    if (node instanceof U.AST_Dot && node.property === 'title' && node.expression.print_to_string() === 'priv' && /admin\/(?:Users|APIKeys)\.js$/.test(file)) replacement = 'I18N.privilegeTitle(priv)';
    if (replacement) {
      edits.push({ start: node.start.pos, end: node.end.endpos, value: replacement });
      return true;
    }
  }));
  if (report) report(edits.map(edit => ({ start: edit.start, end: edit.end, original: source.slice(edit.start, edit.end), replacement: edit.value })));
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return source;
}
module.exports = instrument;
