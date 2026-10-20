const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { pinnedNode, build, pack } = require('./build.cjs');
const directory = path.join(__dirname, 'out'); fs.mkdirSync(directory, { recursive: true });
const stages = [
  ['source', ['check.cjs']],
  ['unit', ['--test', ...fs.readdirSync(path.join(__dirname, 'tests')).filter(f => f.endsWith('.test.cjs')).map(f => 'tests/' + f)]],
  ['upstream', ['upstream.cjs']],
  ['integration', ['run-integration.cjs']]
];
const summary = { started: new Date().toISOString(), source: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim(), node: process.version, platform: process.platform, arch: process.arch, stages: [] };
for (const [name, args] of stages) {
  const begin = Date.now();
  const result = cp.spawnSync(pinnedNode, args, { cwd: __dirname, stdio: name === 'unit' ? ['ignore', 'pipe', 'pipe'] : 'inherit', env: process.env });
  if (name === 'unit') {
    fs.writeFileSync(path.join(directory, 'unit.tap'), result.stdout || '');
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  }
  summary.stages.push({ name, code: result.status, durationMs: Date.now() - begin });
  fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(summary, null, 2));
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = 1; break; }
}
if (!process.exitCode) {
  const artifact = build('zh-CN', path.join(__dirname, '.work/release-' + Date.now()));
  summary.completed = new Date().toISOString();
  summary.artifact = artifact.destination;
  summary.releaseId = artifact.releaseId;
  const archive = path.join(directory, 'cronicle-zh-CN-' + artifact.releaseId + '.tar.gz');
  summary.archive = archive;
  summary.archiveSHA256 = pack(artifact, archive);
  fs.copyFileSync(path.join(artifact.destination, 'manifest.json'), path.join(directory, 'release-manifest.json'));
  fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(summary, null, 2));
  console.log('Verified static package: ' + path.join(artifact.destination, 'ui-package'));
}
