const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const U = require('../../node_modules/uglify-js');

const root = path.resolve(__dirname, '../..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const files = [
  'htdocs/index-dev.html', 'htdocs/js/app.js',
  ...fs.readdirSync(path.join(root, 'htdocs/js/pages')).filter(f => f.endsWith('.js')).map(f => 'htdocs/js/pages/' + f),
  ...fs.readdirSync(path.join(root, 'htdocs/js/pages/admin')).filter(f => f.endsWith('.js')).map(f => 'htdocs/js/pages/admin/' + f),
  ...['base', 'page', 'dialog'].map(f => 'vendor/pixl-webapp/js/' + f + '.js')
];
function read(file) {
  return fs.readFileSync(path.join(root, file.replace('vendor/', 'node_modules/')), 'utf8');
}
function stringNodes(source) {
  const nodes = [];
  U.parse(source).walk(new U.TreeWalker(function(node) {
    if (node instanceof U.AST_String) {
      const ancestors = [];
      for (let i = 0; this.parent(i); i++) ancestors.push(this.parent(i));
      nodes.push({ node, ancestors });
    }
  }));
  return nodes;
}
function escapeHTML(text) {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function translate(source, file, sites, dictionary, locale) {
  const edits = [];
  for (const site of sites.filter(s => s.file === file)) {
    const raw = source.slice(site.start, site.end);
    if (hash(raw) !== site.hash) throw new Error('Source drift: ' + site.id);
    if (locale === 'en') continue;
    let value = site.original;
    for (const part of [...site.parts].sort((a, b) => b.start - a.start)) {
      const entry = dictionary[part.key];
      const english = value.slice(part.start, part.end);
      if (!entry || entry.en !== english || !entry.zh) throw new Error('Missing translation: ' + site.id + ':' + english);
      const translated = part.context === 'text' ? entry.zh : escapeHTML(entry.zh);
      value = value.slice(0, part.start) + translated + value.slice(part.end);
    }
    edits.push({ start: site.start, end: site.end, value: file.endsWith('.html') ? value : JSON.stringify(value) });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return source;
}
module.exports = { root, files, hash, read, stringNodes, escapeHTML, translate, U };
