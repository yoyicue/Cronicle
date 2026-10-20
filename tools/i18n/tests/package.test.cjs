const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { build, pack } = require('../build.cjs');
const { verify } = require('../verify.cjs');

test('S05-S08 D01 D04 D05 immutable packages reproduce and reject invalid paths, symlinks, partial files and stale gzip', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cronicle-package-'));
  try {
    const first = build('zh-CN', path.join(temp, 'first'));
    const second = build('zh-CN', path.join(temp, 'second'));
    assert.equal(first.releaseId, second.releaseId);
    assert.deepEqual(first.contentHashes, second.contentHashes);
    const dir = path.join(first.destination, 'ui-package');
    assert(verify(dir, first).files > 100);
    const unsafe = structuredClone(first);
    unsafe.contentHashes['../conf/config.json'] = 'bad';
    assert.throws(() => verify(dir, unsafe), /Unsafe path/);
    const hidden = structuredClone(first);
    hidden.contentHashes['_ui/releases/' + first.releaseId + '/js/.env'] = 'bad';
    assert.throws(() => verify(dir, hidden), /Hidden package file/);
    const entry = path.join(dir, first.entry), original = fs.readFileSync(entry);
    fs.writeFileSync(entry, 'interrupted upload');
    assert.throws(() => verify(dir, first), /Content hash mismatch/);
    fs.writeFileSync(entry, original);
    const gzip = fs.readFileSync(entry + '.gz');
    fs.writeFileSync(entry + '.gz', 'stale');
    assert.throws(() => verify(dir, first), /Content hash mismatch/);
    fs.writeFileSync(entry + '.gz', gzip);
    fs.renameSync(entry, entry + '.pending');
    assert.throws(() => verify(dir, first), /Incomplete package/);
    fs.renameSync(entry + '.pending', entry);
    fs.unlinkSync(entry);
    fs.symlinkSync(path.join(second.destination, 'ui-package', second.entry), entry);
    assert.throws(() => verify(dir, first), /symlink/);
    fs.unlinkSync(entry); fs.writeFileSync(entry, original);
    // Copying a new immutable subtree never replaces the official entry or old package.
    const target = path.join(temp, 'htdocs'); fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'index.html'), 'original');
    fs.cpSync(dir, target, { recursive: true, errorOnExist: true, force: false });
    assert.equal(fs.readFileSync(path.join(target, 'index.html'), 'utf8'), 'original');
    assert.deepEqual(fs.readFileSync(path.join(target, first.entry)), original);
    assert.throws(() => build('zh-CN', first.destination), /must be new/);
    assert(verify(dir, first));
    if (process.platform === 'darwin') cp.execFileSync('xattr', ['-w', 'com.cronicle.i18n', 'fixture', entry]);
    assert.match(pack(first, path.join(temp, 'release.tar.gz')), /^[a-f0-9]{64}$/);
  }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
