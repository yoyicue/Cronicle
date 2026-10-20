const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { root, files, read, hash, translate } = require('./source.cjs');
const instrument = require('./display.cjs');
const registry = require('./sites.json');
const dictionary = require('../../htdocs/js/i18n/zh-CN.json');
const pinnedNode = path.join(__dirname, 'node_modules/node/bin/node');

function validateSources() {
  for (const [file, expected] of Object.entries(registry.sourceHashes)) if (hash(read(file)) !== expected) throw new Error('Source drift: ' + file);
}
function walk(directory, prefix = '') {
  return fs.readdirSync(directory).sort().flatMap(name => {
    const relative = path.join(prefix, name), full = path.join(directory, name);
    const stat = fs.statSync(full);
    return stat.isDirectory() ? walk(full, relative) : [relative];
  });
}
function build(locale, destination) {
  if (process.version !== 'v22.23.3') throw new Error('Use tools/i18n/node_modules/node/bin/node v22.23.3');
  if (!['official', 'en', 'zh-CN'].includes(locale)) throw new Error('Unsupported locale: ' + locale);
  validateSources();
  require('./check.cjs').check();
  destination = path.resolve(destination);
  if (fs.existsSync(destination)) throw new Error('Build destination must be new: ' + destination);
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ['lib', 'bin', 'sample_conf', 'htdocs', 'package.json', 'package-lock.json']) fs.cpSync(path.join(root, name), path.join(destination, name), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(destination, 'node_modules'));
  // Materialize the common JS before the official symlink step, without touching installed dependencies.
  fs.cpSync(path.join(root, 'node_modules/pixl-webapp/js'), path.join(destination, 'htdocs/js/common'), { recursive: true });
  if (locale !== 'official') {
    for (const file of files) {
      const target = path.join(destination, file.replace('vendor/pixl-webapp/js/', 'htdocs/js/common/'));
      let output = translate(read(file), file, registry.sites, dictionary, locale);
      if (file.endsWith('.js')) output = instrument(output, file);
      else {
        output = output.replace('<html lang="en">', '<html lang="' + (locale === 'zh-CN' ? 'zh-CN' : 'en') + '">');
        if (locale === 'zh-CN') output = output.replace('<!-- BUILD: COMBINE_STYLE_END -->', '<link rel="stylesheet" href="css/i18n-zh-CN.css">\n\t<!-- BUILD: COMBINE_STYLE_END -->');
        output = output.replace('<!-- BUILD: COMBINE_SCRIPT_START -->', '<!-- BUILD: COMBINE_SCRIPT_START -->\n\t<script src="js/i18n/generated.js"></script>');
      }
      fs.writeFileSync(target, output);
    }
    fs.writeFileSync(path.join(destination, 'htdocs/js/i18n/generated.js'), fs.readFileSync(path.join(root, 'htdocs/js/i18n/runtime.js'), 'utf8') + '\nvar I18N = createCronicleI18N(' + JSON.stringify(locale) + ',' + JSON.stringify(dictionary) + ');\n');
  }
  const output = cp.execFileSync(pinnedNode, [path.join(__dirname, 'build-driver.cjs'), destination], { cwd: destination, stdio: 'pipe' });
  const htdocs = path.join(destination, 'htdocs');
  if (!fs.existsSync(path.join(htdocs, 'js/_combo.js'))) throw new Error('Official build did not produce its JS bundle: ' + output);
  cp.execFileSync(pinnedNode, ['--check', path.join(htdocs, 'js/_combo.js')]);
  // Static output only: explicit file roots exclude source config and generated secrets.
  const assetPaths = ['favicon.ico', ...['js', 'css', 'images', 'fonts'].flatMap(dir => fs.existsSync(path.join(htdocs, dir)) ? walk(path.join(htdocs, dir)).filter(f => !f.endsWith('.gz') && !f.startsWith('i18n/')).map(file => path.join(dir, file)) : [])];
  const assetHashes = Object.fromEntries(assetPaths.map(file => [file, hash(fs.readFileSync(path.join(htdocs, file)))]));
  const releaseId = hash(locale + registry.upstream + JSON.stringify(assetHashes) + hash(fs.readFileSync(path.join(htdocs, 'index.html'))) + registry.upstream);
  const packaged = path.join(destination, 'ui-package');
  const assetRoot = path.join(packaged, '_ui/releases', releaseId);
  fs.mkdirSync(assetRoot, { recursive: true });
  fs.copyFileSync(path.join(htdocs, 'favicon.ico'), path.join(assetRoot, 'favicon.ico'));
  for (const dir of ['js', 'css', 'images', 'fonts']) {
    const source = path.join(htdocs, dir);
    if (!fs.existsSync(source)) continue;
    for (const file of walk(source)) {
      if (file.endsWith('.gz') || file.startsWith('i18n/')) continue;
      const target = path.join(assetRoot, dir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const content = fs.readFileSync(path.join(source, file));
      fs.writeFileSync(target, content);
      if (/\.(?:js|css|html|json|map)$/.test(file)) fs.writeFileSync(target + '.gz', zlib.gzipSync(content, { level: 9 }));
    }
  }
  let entry = fs.readFileSync(path.join(htdocs, 'index.html'), 'utf8');
  entry = entry.replace(/\b(src|href)="((?:js|css|images|fonts)\/[^"?]+)"/g, (all, attr, file) => attr + '="/_ui/releases/' + releaseId + '/' + file + '"');
  entry = entry.replace('href="/favicon.ico"', 'href="/_ui/releases/' + releaseId + '/favicon.ico"');
  const entryName = 'index-' + (locale === 'zh-CN' ? 'zh' : locale) + '-' + releaseId + '.html';
  fs.writeFileSync(path.join(packaged, entryName), entry);
  fs.writeFileSync(path.join(packaged, entryName + '.gz'), zlib.gzipSync(entry, { level: 9 }));
  // Generated package files are regular files. Existing roots remain available for unchanged dynamic loaders.
  fs.cpSync(packaged, htdocs, { recursive: true });
  const contentHashes = Object.fromEntries(walk(packaged).map(file => [file, hash(fs.readFileSync(path.join(packaged, file)))]));
  for (const file of Object.keys(contentHashes).filter(f => f.endsWith('.gz'))) {
    if (hash(zlib.gunzipSync(fs.readFileSync(path.join(packaged, file)))) !== contentHashes[file.slice(0, -3)]) throw new Error('Invalid gzip: ' + file);
  }
  const inputs = Object.fromEntries(['source.cjs', 'display.cjs', 'display-sites.json', 'build.cjs', 'build-driver.cjs', 'check.cjs', 'verify.cjs', 'sites.json', 'exclusions.json', 'package-lock.json'].map(file => [file, hash(fs.readFileSync(path.join(__dirname, file)))]));
  for (const file of ['runtime.js', 'zh-CN.json']) inputs[file] = hash(fs.readFileSync(path.join(root, 'htdocs/js/i18n', file)));
  inputs['i18n-zh-CN.css'] = hash(fs.readFileSync(path.join(root, 'htdocs/css/i18n-zh-CN.css')));
  const manifest = { upstream: registry.upstream, lock: hash(fs.readFileSync(path.join(root, 'package-lock.json'))), node: process.version, locale, releaseId, entry: entryName, siteCount: registry.sites.length, inputs, contentHashes };
  require('./verify.cjs').verify(packaged, manifest);
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { destination, ...manifest };
}
function pack(artifact, target) {
  require('./verify.cjs').verify(path.join(artifact.destination, 'ui-package'), artifact);
  cp.execFileSync('tar', ['-czf', target, '-C', artifact.destination, 'ui-package', 'manifest.json'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const files = cp.execFileSync('tar', ['-tzf', target], { encoding: 'utf8' }).trim().split('\n').filter(file => !file.endsWith('/')).sort();
  assert.deepEqual(files, ['manifest.json', ...Object.keys(artifact.contentHashes).map(file => 'ui-package/' + file)].sort(), 'Archive contains extra or missing files');
  return hash(fs.readFileSync(target));
}
if (require.main === module) {
  const locale = process.argv[2] || 'zh-CN';
  const destination = process.argv[3] || path.join(__dirname, '.work', locale + '-' + Date.now());
  console.log(JSON.stringify(build(locale, destination), null, 2));
}
module.exports = { build, pack, walk, validateSources, pinnedNode };
