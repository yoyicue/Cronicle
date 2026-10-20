const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { pinnedNode } = require('./build.cjs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const prior = path.join(__dirname, 'out/history', stamp);
const oldEvidence = fs.existsSync(path.join(__dirname, 'out')) ? fs.readdirSync(path.join(__dirname, 'out')).filter(file => /^(?:integration\.json|smtp\.json|performance\.json|minute\.json|caddy\.log|layout-.*\.png)$/.test(file)).map(file => 'out/' + file) : [];
for (const file of [...oldEvidence, 'test-results']) {
  const source = path.join(__dirname, file);
  if (!fs.existsSync(source)) continue;
  fs.mkdirSync(prior, { recursive: true });
  fs.renameSync(source, path.join(prior, path.basename(file)));
}
const result = cp.spawnSync(pinnedNode, [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)], { cwd: __dirname, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
