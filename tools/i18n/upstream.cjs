const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { build, pinnedNode } = require('./build.cjs');
const { root } = require('./source.cjs');
const destination = path.join(__dirname, '.work', 'upstream-' + Date.now());
build('official', destination);
const outputDirectory = path.join(__dirname, 'out');
fs.mkdirSync(outputDirectory, { recursive: true });
const output = fs.openSync(path.join(outputDirectory, 'upstream.log'), 'w');
const child = cp.spawn(pinnedNode, [path.join(root, 'node_modules/pixl-unit/unit.js'), 'lib/test.js'], {
  cwd: destination,
  env: { ...process.env, PATH: path.dirname(pinnedNode) + path.delimiter + process.env.PATH, CRONICLE_WebServer__bind_address: '127.0.0.1', CRONICLE_udp_broadcast_port: '0' },
  stdio: ['ignore', output, output]
});
fs.closeSync(output);
child.on('exit', (code, signal) => {
  console.log(fs.readFileSync(path.join(outputDirectory, 'upstream.log'), 'utf8').split('\n').slice(-35).join('\n'));
  fs.writeFileSync(path.join(outputDirectory, 'upstream-result.json'), JSON.stringify({ code, signal, destination, node: cp.execFileSync(pinnedNode, ['--version'], { encoding: 'utf8' }).trim() }, null, 2));
  process.exitCode = code === 0 ? 0 : 1;
});
