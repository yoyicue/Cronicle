const http = require('node:http');
const zlib = require('node:zlib');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require('@playwright/test');
(async () => {
  const body = 'History Success Home Run\n';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<a href="/download' + url.search + '">Download Log</a>');
    }
    else {
      res.setHeader('Content-Type', url.searchParams.get('mime'));
      res.setHeader('Content-Disposition', 'attachment; filename=job.txt');
      if (url.searchParams.get('gzip') === 'true') { res.setHeader('Content-Encoding', 'gzip'); res.write(zlib.gzipSync(body)); }
      else res.write(body);
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const results = [];
  try {
    for (const type of [chromium, firefox, webkit]) for (const headless of type === webkit ? [true, false] : [true]) {
      const browser = await type.launch({ headless });
      try {
        for (const routed of [false, true]) for (const gzip of [false, true]) for (const mime of ['text/plain; charset=utf-8', 'application/octet-stream']) {
          const context = await browser.newContext({ acceptDownloads: true });
          if (routed) await context.route('**/*', route => route.continue());
          const page = await context.newPage();
          const query = '?' + new URLSearchParams({ gzip, mime });
          const response = await fetch(origin + '/download' + query);
          assert.equal(response.headers.get('content-disposition'), 'attachment; filename=job.txt');
          assert.equal(await response.text(), body);
          await page.goto(origin + '/' + query);
          const pending = page.waitForEvent('download', { timeout: 2000 }).catch(error => { assert.equal(error.name, 'TimeoutError'); return null; });
          await page.locator('a').click();
          const download = await pending;
          const text = download ? fs.readFileSync(await download.path(), 'utf8') : await page.locator('body').innerText();
          assert.equal(text, body);
          const result = { browser: type.name(), version: browser.version(), headless, routed, gzip, mime, outcome: download ? 'download' : 'inline', bytesEqual: true };
          results.push(result); console.log(JSON.stringify(result));
          await context.close();
        }
      }
      finally { await browser.close(); }
    }
  }
  finally { await new Promise(resolve => server.close(resolve)); }
  fs.mkdirSync('tools/i18n/out/diagnosis', { recursive: true });
  fs.writeFileSync('tools/i18n/out/diagnosis/download.json', JSON.stringify({ platform: process.platform, source: process.env.GITHUB_SHA, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
