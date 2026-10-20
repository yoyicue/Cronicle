const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { root, files, hash, read, stringNodes, translate, U } = require('./source.cjs');
const registry = require('./sites.json');
const dictionary = require('../../htdocs/js/i18n/zh-CN.json');
const exclusions = require('./exclusions.json');
const displaySites = require('./display-sites.json');
const instrument = require('./display.cjs');

function assertTextOnly(before, after, file, sites = registry.sites) {
  const original = U.parse(before), result = U.parse(after);
  const left = [], right = [];
  original.walk(new U.TreeWalker(n => { if (n instanceof U.AST_String) left.push(n); }));
  result.walk(new U.TreeWalker(n => { if (n instanceof U.AST_String) right.push(n); }));
  assert.equal(right.length, left.length, file + ': string count changed');
  const allowed = new Set(sites.filter(s => s.file === file).map(s => s.start));
  for (let i = 0; i < left.length; i++) {
    if (!allowed.has(left[i].start.pos)) assert.equal(right[i].value, left[i].value, file + ': protected value changed');
    right[i].value = left[i].value;
  }
  assert.equal(result.print_to_string(), original.print_to_string(), file + ': executable structure changed');
}
function check() {
  const keySet = new Set(), locationSet = new Set();
  assert.deepEqual(Object.keys(registry.sourceHashes).sort(), [...files].sort(), 'Source whitelist changed');
  for (const site of registry.sites) assert(files.includes(site.file), 'Unregistered source: ' + site.file);
  for (const site of displaySites) assert(files.includes(site.file), 'Unregistered formatter source: ' + site.file);
  for (const item of exclusions) assert(files.includes(item.file) || item.id.startsWith('htdocs/index-dev.html:'), 'Unregistered exclusion: ' + item.id);
  const ast = U.parse('(' + fs.readFileSync(path.join(root, 'htdocs/js/i18n/zh-CN.json'), 'utf8') + ')');
  ast.walk(new U.TreeWalker(n => {
    if (n instanceof U.AST_Object) {
      const keys = n.properties.map(p => p.key);
      assert.equal(new Set(keys).size, keys.length, 'Duplicate dictionary key');
    }
  }));
  for (const [file, expected] of Object.entries(registry.sourceHashes)) {
    assert.equal(hash(read(file)), expected, 'Source drift: ' + file);
    if (!file.startsWith('vendor/')) assert.equal(expected, hash(cp.execFileSync('git', ['show', registry.upstream + ':' + file], { cwd: root })), 'Upstream source changed: ' + file);
    const sites = registry.sites.filter(s => s.file === file);
    const source = read(file);
    let previous = -1;
    for (const site of [...sites].sort((a, b) => a.start - b.start)) {
      assert(Number.isInteger(site.start) && Number.isInteger(site.end) && site.start >= previous && site.start < site.end && site.end <= source.length, 'Overlapping source span: ' + site.id);
      previous = site.end;
    }
    for (const site of sites) {
      assert(!locationSet.has(site.id), 'Duplicate site: ' + site.id);
      locationSet.add(site.id);
      assert.equal(hash(source.slice(site.start, site.end)), site.hash, 'Site drift: ' + site.id);
      let end = -1;
      for (const part of [...site.parts].sort((a, b) => a.start - b.start)) {
        assert(Number.isInteger(part.start) && Number.isInteger(part.end) && part.start >= end && part.start < part.end && part.end <= site.original.length, 'Invalid text span: ' + site.id);
        end = part.end;
        const entry = dictionary[part.key];
        assert(entry && entry.zh, 'Missing word: ' + part.key);
        assert.equal(entry.en, site.original.slice(part.start, part.end));
        assert(['text', 'html', 'attribute'].includes(part.context));
        keySet.add(part.key);
      }
    }
    if (file.endsWith('.js')) {
      const nodes = new Map(stringNodes(source).map(({ node }) => [node.start.pos, node]));
      const omitted = exclusions.filter(x => x.file === file);
      assert.equal(new Set(omitted.map(x => x.start)).size, omitted.length, 'Duplicate exclusion: ' + file);
      for (const item of omitted) {
        assert(nodes.has(item.start) && !sites.some(site => site.start === item.start), 'Invalid exclusion: ' + item.id);
        assert.equal(hash(source.slice(item.start, item.end)), item.hash, 'Exclusion drift: ' + item.id);
        assert.equal(nodes.get(item.start).value, item.original);
        assert(item.reason, 'Missing exclusion reason: ' + item.id);
      }
      assert.equal(nodes.size, sites.length + omitted.length, 'Unreviewed literal: ' + file);
      for (const site of sites) assert.equal(nodes.get(site.start).value, site.original, 'Not a string literal: ' + site.id);
      assertTextOnly(source, translate(source, file, sites, dictionary, 'zh-CN'), file);
      let expected;
      instrument(source, file, edits => { expected = edits; });
      assert.deepEqual(expected.map(x => ({ file, ...x })), displaySites.filter(x => x.file === file), 'Display formatter drift: ' + file);
      // Restoring each registered formatter expression must recover the exact translated AST.
      const translated = translate(source, file, sites, dictionary, 'zh-CN');
      let actual;
      const rendered = instrument(translated, file, edits => { actual = edits; });
      assert.equal(actual.length, expected.length);
      for (let i = 0; i < expected.length; i++) {
        assert.equal(U.parse(actual[i].original).print_to_string(), U.parse(expected[i].original).print_to_string(), 'Formatter input changed: ' + file);
        assert.equal(U.parse(actual[i].replacement).print_to_string(), U.parse(expected[i].replacement).print_to_string(), 'Formatter replacement changed: ' + file);
      }
      let restored = rendered;
      for (const edit of [...actual].sort((a, b) => a.start - b.start)) {
        const start = edit.start;
        assert.equal(restored.slice(start, start + edit.replacement.length), edit.replacement);
        restored = restored.slice(0, start) + edit.original + restored.slice(start + edit.replacement.length);
        // Restoring in ascending order leaves subsequent original offsets unchanged.
      }
      assert.equal(U.parse(restored).print_to_string(), U.parse(translated).print_to_string(), 'Formatter changed protected AST: ' + file);
    }
    assert.equal(translate(source, file, sites, dictionary, 'en'), source, 'English must be byte-identical before display helpers');
  }
  for (const [key, entry] of Object.entries(dictionary)) {
    assert(keySet.has(key) || entry.dynamic, 'Unused word: ' + key);
    assert(typeof entry.en === 'string' && typeof entry.zh === 'string' && entry.zh.length);
    assert(!/<\/?[a-z][^>]*>/i.test(entry.zh), 'HTML in dictionary: ' + key);
    const markers = text => (text.match(/\{\w+\}/g) || []).sort();
    assert.deepEqual(markers(entry.en), markers(entry.zh), 'Placeholder mismatch: ' + key);
  }
  const protectedFiles = cp.execFileSync('git', ['ls-tree', '-r', '--name-only', registry.upstream], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  for (const file of protectedFiles) assert.equal(hash(fs.readFileSync(path.join(root, file))), hash(cp.execFileSync('git', ['show', registry.upstream + ':' + file], { cwd: root })), 'Protected source changed: ' + file);
  return { sites: registry.sites.length, entries: Object.keys(dictionary).length, protectedFiles: protectedFiles.length };
}
if (require.main === module) console.log(JSON.stringify(check(), null, 2));
module.exports = { check, assertTextOnly };
