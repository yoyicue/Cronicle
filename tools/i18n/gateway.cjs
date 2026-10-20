const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
module.exports = async function gateway(labs) {
  const binary = process.env.CADDY_BIN || path.join(__dirname, '.work/caddy');
  const version = cp.execFileSync(binary, ['version'], { encoding: 'utf8' });
  if (!version.startsWith('v2.11.7 ')) throw new Error('Expected Caddy v2.11.7: ' + version);
  const config = path.join(__dirname, '.work/Caddyfile');
  fs.writeFileSync(config, '{\n admin off\n auto_https off\n}\n' + labs.map((lab, i) => 'http://127.0.0.1:' + (4514 + i) + ' {\n reverse_proxy 127.0.0.1:' + new URL(lab.baseURL).port + '\n}').join('\n'));
  const log = fs.openSync(path.join(__dirname, 'out/caddy.log'), 'w');
  const child = cp.spawn(binary, ['run', '--config', config, '--adapter', 'caddyfile'], { stdio: ['ignore', log, log], env: { ...process.env, XDG_DATA_HOME: path.join(__dirname, '.work/caddy-data'), XDG_CONFIG_HOME: path.join(__dirname, '.work/caddy-config') } });
  fs.closeSync(log);
  try {
    const deadline = Date.now() + 10000;
    for (let i = 0; i < labs.length; i++) {
      labs[i].gatewayURL = 'http://127.0.0.1:' + (4514 + i);
      while (true) {
        if (child.exitCode !== null) throw new Error('Caddy exited');
        try { if ((await fetch(labs[i].gatewayURL + '/' + labs[i].manifest.entry)).ok) break; } catch (_) {}
        if (Date.now() > deadline) throw new Error('Caddy did not listen');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }
  catch (error) { child.kill(); throw error; }
  return async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); } };
};
