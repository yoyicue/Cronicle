const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { hash } = require('./source.cjs');

function regularFiles(directory, prefix = '') {
  return fs.readdirSync(path.join(directory, prefix)).sort().flatMap(name => {
    const relative = prefix + name, full = path.join(directory, relative);
    const stat = fs.lstatSync(full);
    assert(!stat.isSymbolicLink(), 'Package symlink: ' + relative);
    if (stat.isDirectory()) return regularFiles(directory, relative + '/');
    assert(stat.isFile(), 'Not a regular file: ' + relative);
    return [relative];
  });
}
function verify(directory, manifest) {
  assert(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'Package root must be a regular directory');
  assert(['official', 'en', 'zh-CN'].includes(manifest.locale));
  assert.match(manifest.releaseId, /^[a-f0-9]{64}$/);
  assert.match(manifest.upstream, /^[a-f0-9]{40}$/);
  const entry = 'index-' + (manifest.locale === 'zh-CN' ? 'zh' : manifest.locale) + '-' + manifest.releaseId + '.html';
  assert.equal(manifest.entry, entry);
  const prefix = '_ui/releases/' + manifest.releaseId + '/';
  for (const file of Object.keys(manifest.contentHashes)) {
    assert(!file.includes('..') && !file.includes('\\') && !path.isAbsolute(file), 'Unsafe path: ' + file);
    assert(!file.includes('/.'), 'Hidden package file: ' + file);
    assert(file === entry || file === entry + '.gz' || file.startsWith(prefix) && (/^(js|css|fonts|images)\//.test(file.slice(prefix.length)) || file.slice(prefix.length) === 'favicon.ico'), 'Outside static whitelist: ' + file);
    assert(file === entry || file === entry + '.gz' || /\.(?:js|css|map|png|gif|jpg|jpeg|webp|ico|svg|woff2?|ttf|eot|otf)(?:\.gz)?$/.test(file), 'Unexpected static file type: ' + file);
  }
  assert.deepEqual(regularFiles(directory), Object.keys(manifest.contentHashes).sort(), 'Incomplete package or extra files');
  for (const [file, expected] of Object.entries(manifest.contentHashes)) {
    const bytes = fs.readFileSync(path.join(directory, file));
    assert.equal(hash(bytes), expected, 'Content hash mismatch: ' + file);
    if (file.endsWith('.gz')) assert.equal(hash(zlib.gunzipSync(bytes)), manifest.contentHashes[file.slice(0, -3)], 'Stale gzip: ' + file);
    else if (/\.(?:js|css|html|json|map)$/.test(file)) assert(manifest.contentHashes[file + '.gz'], 'Missing gzip: ' + file);
  }
  const html = fs.readFileSync(path.join(directory, entry), 'utf8');
  assert(html.includes('<html lang="' + (manifest.locale === 'zh-CN' ? 'zh-CN' : 'en') + '">'));
  for (const match of html.matchAll(/\b(?:src|href)="([^"#]+)"/g)) {
    if (/^(?:https?:|mailto:)/.test(match[1])) continue; // Existing attribution links.
    if (['/socket.io/socket.io.js', '/api/app/config'].includes(match[1])) continue; // Unchanged same-origin backend endpoints.
    assert(match[1].startsWith('/' + prefix), 'Unversioned entry reference: ' + match[1]);
    assert(manifest.contentHashes[match[1].slice(1)], 'Missing entry resource: ' + match[1]);
  }
  return { files: Object.keys(manifest.contentHashes).length, releaseId: manifest.releaseId };
}
if (require.main === module) console.log(verify(process.argv[2], JSON.parse(fs.readFileSync(process.argv[3]))));
module.exports = { verify, regularFiles };
