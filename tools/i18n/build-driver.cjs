const fs = require('node:fs');
const path = require('node:path');
const destination = process.argv[2];
const tools = require(path.join(destination, 'bin/build-tools.js'));
// Upstream fires its copy callback on read-end, before the output file is complete.
tools.copyFile = function(source, target, callback) {
  if (target.endsWith('/')) target += path.basename(source);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFile(source, target, callback);
};
process.argv = [process.execPath, path.join(destination, 'bin/build.js'), 'dist'];
require(path.join(destination, 'bin/build.js'));
