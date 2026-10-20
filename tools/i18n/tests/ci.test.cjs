const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validateTag, validateEvidence } = require('../ci-release.cjs');
const { compareRelease } = require('../ci-upstream.cjs');
test('CI release rejects wrong versions, incomplete or mismatched evidence and modified archives', () => {
  validateTag('zh-CN-v0.9.137-r2', '0.9.137');
  for (const tag of ['zh-CN-v0.9.138-r1', 'v0.9.137', 'zh-CN-v0.9.137-r0', 'zh-CN-v0.9.137-r2\n']) assert.throws(() => validateTag(tag, '0.9.137'));
  const bytes = Buffer.from('verified archive');
  const manifest = { releaseId: 'test', locale: 'zh-CN' };
  const summary = { source: 'commit', started: '2026-10-20T00:00:00Z', completed: '2026-10-20T00:10:00Z', releaseId: 'test', archiveSHA256: crypto.createHash('sha256').update(bytes).digest('hex'), stages: ['source', 'unit', 'upstream', 'integration'].map(name => ({ name, code: 0 })) };
  validateEvidence(summary, manifest, 'commit', bytes);
  assert.throws(() => validateEvidence({ ...summary, completed: null }, manifest, 'commit', bytes), /incomplete/);
  assert.throws(() => validateEvidence(summary, manifest, 'other', bytes), /source mismatch/);
  assert.throws(() => validateEvidence(summary, manifest, 'commit', Buffer.from('tampered')), /checksum mismatch/);
  assert.throws(() => validateEvidence({ ...summary, stages: summary.stages.slice(0, 3) }, manifest, 'commit', bytes), /must pass/);
  assert.throws(() => validateEvidence({ ...summary, stages: summary.stages.map(s => ({ ...s, code: s.name === 'integration' ? 1 : 0 })) }, manifest, 'commit', bytes), /must pass/);
  assert.throws(() => validateEvidence(summary, { ...manifest, releaseId: 'other' }, 'commit', bytes), /releaseId mismatch/);
});
test('CI official Release comparison handles equal, newer, older and invalid responses', () => {
  const release = tag => ({ tag_name: tag, draft: false, prerelease: false, html_url: 'https://github.com/jhuckaby/Cronicle/releases/tag/' + tag });
  assert.equal(compareRelease(release('v0.9.137'), 'v0.9.137').updateAvailable, false);
  assert.equal(compareRelease(release('v0.10.0'), 'v0.9.137').updateAvailable, true);
  assert.equal(compareRelease(release('v1.0.0'), 'v0.9.137').updateAvailable, true);
  assert.throws(() => compareRelease(release('v0.9.99'), 'v0.9.137'), /older/);
  assert.throws(() => compareRelease({ ...release('v0.9.138'), prerelease: true }, 'v0.9.137'), /stable/);
  assert.throws(() => compareRelease({ ...release('v0.9.138'), html_url: 'https://example.test/' }, 'v0.9.137'), /origin/);
  assert.throws(() => compareRelease(release('v0.9.138-rc1'), 'v0.9.137'), /format/);
});
