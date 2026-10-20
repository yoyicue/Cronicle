const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
(async () => {
  // shortcut: this workstation uses macOS arm64; other platforms supply a verified CADDY_BIN.
  assert(process.platform === 'darwin' && process.arch === 'arm64', 'Supply CADDY_BIN for this platform');
  const url = 'https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_mac_arm64.tar.gz';
  const expected = '68f592df8f0ec058fbdb9b137b64e9a0aa792d28c06e1e3b9ec12d0e7fb371683a54e73ef6d8e6d0dd70dc6b941a5b5d5b73faedd3f89de119ad2eb78bdc668e';
  const directory = path.join(__dirname, '.work'); fs.mkdirSync(directory, { recursive: true });
  const archive = path.join(directory, 'caddy-2.11.7.tar.gz');
  if (!fs.existsSync(archive)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    assert(response.ok, 'Caddy download failed: ' + response.status);
    fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  }
  assert.equal(crypto.createHash('sha512').update(fs.readFileSync(archive)).digest('hex'), expected, 'Caddy archive checksum mismatch');
  cp.execFileSync('tar', ['-xzf', archive, '-C', directory, 'caddy']);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, 'caddy'))).digest('hex'), '0d746e47f39d9706883b3633bf419feb25973e6caaa8eabbf5b44421d59e3973');
  console.log(cp.execFileSync(path.join(directory, 'caddy'), ['version'], { encoding: 'utf8' }).trim());
})().catch(error => { console.error(error.message); process.exitCode = 1; });
