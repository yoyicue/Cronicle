// 验证真实静态处理器的发布竞态，仅在自建临时目录读写文件。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const zlib = require('node:zlib');

const dependencyRoot = path.dirname(require.resolve('pixl-server-web/package.json'));
assert.equal(require(path.join(dependencyRoot, 'package.json')).version, '3.0.6');
const Static = require(path.join(dependencyRoot, 'lib/static.js'));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cronicle-i18n-static-'));
  const previous = Buffer.from('<html>old</html>');
  const current = Buffer.from('<html>new-content-is-longer</html>');
  for (const [name, bytes] of [['previous', previous], ['current', current]]) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'index.html'), bytes);
    fs.writeFileSync(path.join(root, name, 'index.html.gz'), zlib.gzipSync(bytes));
  }
  fs.symlinkSync('previous', path.join(root, 'active'));
  fs.symlinkSync('active/index.html', path.join(root, 'index.html'));
  fs.symlinkSync('active/index.html.gz', path.join(root, 'index.html.gz'));
  fs.writeFileSync(path.join(root, 'index-zh-versioned.html'), current);
  fs.writeFileSync(path.join(root, 'index-zh-versioned.html.gz'), zlib.gzipSync(current));
  return {
    root, previous, current,
    switch() {
      fs.symlinkSync('current', path.join(root, 'pending'));
      fs.renameSync(path.join(root, 'pending'), path.join(root, 'active'));
    },
    close() { fs.rmSync(root, { recursive: true, force: true }); }
  };
}

async function serve(files, url, gzip) {
  const handler = new Static();
  handler.config = { get: key => ({ htdocs_dir: files.root, static_index: 'index.html', static_ttl: 3600 })[key] };
  handler.regexTextContent = /text|html/;
  handler.logDebug = () => {};
  handler.logError = () => {};
  const original = fs.createReadStream;
  // 将入口切换精确安排在 stat 完成后、open 之前，避免概率测试漏掉竞态。
  fs.createReadStream = function(file, options) {
    fs.createReadStream = original;
    files.switch();
    return original(file, options);
  };
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        fs.createReadStream = original;
        reject(new Error('Static handler timed out'));
      }, 5000);
      handler.sendHTTPResponse = (args, status, headers, body) => {
        fs.createReadStream = original;
        clearTimeout(timeout);
        (async () => {
          const chunks = [];
          if (body && body.pipe) for await (const chunk of body) chunks.push(chunk);
          else chunks.push(Buffer.from(body || ''));
          return { status, headers, body: Buffer.concat(chunks) };
        })().then(resolve, reject);
      };
      try {
        handler.sendStaticResponse({
          state: 'reading', response: {},
          request: { url, method: 'GET', headers: gzip ? { 'accept-encoding': 'gzip' } : {} }
        });
      }
      catch (error) { clearTimeout(timeout); reject(error); }
    });
  }
  finally { fs.createReadStream = original; }
}

for (const gzip of [false, true]) {
  test(`可变软链入口在 stat/open 间切换会截断 ${gzip ? 'gzip' : 'HTML'}`, async () => {
    const files = fixture();
    try {
      const response = await serve(files, '/index.html', gzip);
      assert.equal(response.status, '200 OK');
      if (gzip) assert.throws(() => zlib.gunzipSync(response.body));
      else {
        assert.notDeepEqual(response.body, files.previous);
        assert.notDeepEqual(response.body, files.current);
      }
    }
    finally { files.close(); }
  });

  test(`不可变版本入口在同一时刻切换无关软链仍完整返回 ${gzip ? 'gzip' : 'HTML'}`, async () => {
    const files = fixture();
    try {
      const response = await serve(files, '/index-zh-versioned.html', gzip);
      assert.equal(response.status, '200 OK');
      assert.equal(response.headers['Content-Length'], response.body.length);
      if (gzip) assert.equal(response.headers['Content-Encoding'], 'gzip');
      assert.deepEqual(gzip ? zlib.gunzipSync(response.body) : response.body, files.current);
    }
    finally { files.close(); }
  });
}
