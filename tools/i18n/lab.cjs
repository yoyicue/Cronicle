const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { build, pinnedNode } = require('./build.cjs');

async function start(locale, port, name = locale, originalHtdocs) {
  if (locale !== 'official' && !originalHtdocs) throw new Error('Localized labs require the official English static root');
  const destination = path.join(__dirname, '.work', 'lab-' + name + '-' + Date.now());
  const manifest = build(locale, destination);
  // Emulate an append-only installation: keep original English roots and new versioned entries.
  if (originalHtdocs) fs.cpSync(originalHtdocs, path.join(destination, 'htdocs'), { recursive: true });
  const configFile = path.join(destination, 'conf/config.json');
  const config = JSON.parse(fs.readFileSync(configFile));
  const hostname = 'cronicle-local-' + name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  Object.assign(config, {
    base_app_url: 'http://127.0.0.1:' + port, hostname, ip: '127.0.0.1',
    secret_key: crypto.randomBytes(32).toString('hex'),
    debug: true, foreground: true, echo: false, color: false, master: true,
    udp_broadcast_port: 0, scheduler_startup_grace: 0,
    smtp_hostname: '127.0.0.1', smtp_port: 4599, track_manual_jobs: true
  });
  Object.assign(config.WebServer, { http_port: port, bind_address: '127.0.0.1', http_bind_address: '127.0.0.1' });
  config.User.use_csrf = false;
  config.User.max_failed_logins_per_hour = 100;
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  const setupFile = path.join(destination, 'conf/setup.json');
  const setup = JSON.parse(fs.readFileSync(setupFile));
  for (const operation of setup.storage) {
    const value = operation[2];
    if (value && typeof value === 'object') {
      if (value.ip === '_IP_') value.ip = '127.0.0.1';
      if (value.username === 'admin' && value.password) value.avatar = '/images/logo-64.png';
    }
  }
  fs.writeFileSync(setupFile, JSON.stringify(setup));
  const env = { ...process.env, HOSTNAME: hostname, PATH: path.dirname(pinnedNode) + path.delimiter + process.env.PATH };
  cp.execFileSync(pinnedNode, ['bin/storage-cli.js', 'setup', '--quiet'], { cwd: destination, env, stdio: 'pipe' });
  const log = fs.openSync(path.join(destination, 'lab-process.log'), 'a');
  const child = cp.spawn(pinnedNode, ['lib/main.js'], { cwd: destination, env, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  const baseURL = config.base_app_url;
  const deadline = Date.now() + 20000;
  while (true) {
    if (child.exitCode !== null) throw new Error('Lab exited: ' + fs.readFileSync(path.join(destination, 'lab-process.log'), 'utf8'));
    try {
      const response = await fetch(baseURL + '/api/app/config');
      const value = await response.text();
      if (response.ok && !value.includes('No master server found')) break;
    }
    catch (error) { if (Date.now() >= deadline) { child.kill(); throw error; } }
    if (Date.now() >= deadline) { child.kill(); throw new Error('Lab did not become master: ' + name); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { name, locale, baseURL, url: baseURL + '/' + manifest.entry, destination, pid: child.pid, manifest, child };
}
async function stop(lab) {
  if (lab.child.exitCode !== null) return;
  lab.child.kill('SIGTERM');
  await new Promise(resolve => lab.child.once('exit', resolve));
}
if (require.main === module) {
  const labs = [];
  const shutdown = async (code = 0) => { await Promise.all(labs.map(stop)); process.exit(code); };
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
  (async () => {
    for (const [locale, port, name] of [['official', 4501, 'A'], ['en', 4502, 'B'], ['zh-CN', 4503, 'C']]) {
      const lab = await start(locale, port, name, labs[0] && path.join(labs[0].destination, 'htdocs'));
      labs.push(lab);
      console.log(JSON.stringify({ name, locale, url: lab.url, destination: lab.destination, pid: lab.pid }));
    }
    fs.writeFileSync(path.join(__dirname, '.work/labs.json'), JSON.stringify(labs.map(({ child, ...lab }) => lab), null, 2));
  })().catch(async error => { console.error(error); await shutdown(1); });
}
module.exports = { start, stop };
