const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
function compareRelease(release, baseline) {
  assert(release && release.draft === false && release.prerelease === false, 'Expected a stable official Release');
  assert.match(release.tag_name, /^v\d+\.\d+\.\d+$/, 'Unexpected official tag format');
  assert.match(baseline, /^v\d+\.\d+\.\d+$/);
  assert.equal(release.html_url, 'https://github.com/jhuckaby/Cronicle/releases/tag/' + release.tag_name, 'Unexpected Release origin');
  const a = release.tag_name.slice(1).split('.').map(Number), b = baseline.slice(1).split('.').map(Number);
  const difference = a.map((n, i) => n - b[i]).find(n => n !== 0) || 0;
  assert(difference >= 0, 'Official latest Release is older than the pinned baseline; inspect manually');
  return { baseline, latest: release.tag_name, updateAvailable: difference > 0, url: release.html_url, publishedAt: release.published_at };
}
async function main() {
  const response = await fetch('https://api.github.com/repos/jhuckaby/Cronicle/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(process.env.GH_TOKEN ? { Authorization: 'Bearer ' + process.env.GH_TOKEN } : {}) },
    signal: AbortSignal.timeout(30000)
  });
  assert(response.ok, 'Official Release lookup failed: HTTP ' + response.status);
  const result = compareRelease(await response.json(), 'v' + require('../../package.json').version);
  result.upstream = require('./sites.json').upstream;
  result.checkedAt = new Date().toISOString();
  const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'upstream-release.json'), JSON.stringify(result, null, 2) + '\n');
  const summary = `## 官方 Release 检测\n\n当前适配：${result.baseline}\n\n官方最新：[${result.latest}](${result.url})\n\n${result.updateAvailable ? '发现新版本，需要审查差异并重新完成适配和验收。' : '当前适配已对齐官方最新稳定 Release。'}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  if (result.updateAvailable) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { compareRelease };
