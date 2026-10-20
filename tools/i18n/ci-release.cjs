const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const git = (...args) => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function validateTag(tag, version) {
  assert(typeof tag === 'string' && tag === tag.trim(), 'Invalid release tag');
  assert.match(tag, /^zh-CN-v\d+\.\d+\.\d+-r[1-9]\d*$/, 'Invalid release tag');
  assert(tag.startsWith('zh-CN-v' + version + '-r'), 'Release tag version differs from package.json');
}
function preflight(tag, publish = false) {
  const { version } = require('../../package.json');
  const { upstream } = require('./sites.json');
  validateTag(tag, version);
  const source = git('rev-parse', 'HEAD');
  assert.equal(git('rev-parse', 'refs/tags/v' + version + '^{commit}'), upstream, 'Official tag differs from pinned upstream');
  git('merge-base', '--is-ancestor', upstream, source);
  const exists = cp.spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/tags/' + tag], { cwd: root });
  assert([0, 1].includes(exists.status), 'Cannot inspect release tag');
  if (exists.status === 0) assert.equal(git('rev-parse', 'refs/tags/' + tag + '^{commit}'), source, 'Release tag must point to the tested source');
  else assert(!publish, 'Publishing requires an existing tag');
  return { tag, version, upstream, source };
}
function validateEvidence(summary, manifest, source, archiveBytes) {
  assert.equal(summary.source, source, 'Verification source mismatch');
  assert(summary.completed && Date.parse(summary.completed) >= Date.parse(summary.started), 'Verification is incomplete');
  assert.deepEqual(summary.stages.map(s => [s.name, s.code]), [['source', 0], ['unit', 0], ['upstream', 0], ['integration', 0]], 'All verification stages must pass');
  assert.equal(summary.releaseId, manifest.releaseId, 'Verification releaseId mismatch');
  assert.equal(summary.archiveSHA256, hash(archiveBytes), 'Verified archive checksum mismatch');
  assert.equal(manifest.locale, 'zh-CN');
}
function prepare(tag) {
  const info = preflight(tag, process.env.PUBLISH_RELEASE === 'true');
  const out = path.join(__dirname, 'out');
  const summary = JSON.parse(fs.readFileSync(path.join(out, 'verification.json')));
  const manifestBytes = fs.readFileSync(path.join(out, 'release-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const archive = path.join(out, 'cronicle-zh-CN-' + manifest.releaseId + '.tar.gz');
  assert.equal(path.resolve(summary.archive), archive, 'Unexpected verified archive path');
  const bytes = fs.readFileSync(archive);
  validateEvidence(summary, manifest, info.source, bytes);
  assert.equal(manifest.upstream, info.upstream);
  assert.equal(manifest.lock, hash(fs.readFileSync(path.join(root, 'package-lock.json'))));
  const destination = path.join(out, 'release');
  assert(!fs.existsSync(destination), 'Release directory must be new');
  const assets = path.join(destination, 'assets'); fs.mkdirSync(assets, { recursive: true });
  const unpacked = fs.mkdtempSync(path.join(out, 'release-check-'));
  try {
    const listed = cp.execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n').filter(f => !f.endsWith('/')).sort();
    assert.deepEqual(listed, ['manifest.json', ...Object.keys(manifest.contentHashes).map(f => 'ui-package/' + f)].sort(), 'Archive closure mismatch');
    cp.execFileSync('tar', ['-xzf', archive, '-C', unpacked]);
    assert.deepEqual(fs.readFileSync(path.join(unpacked, 'manifest.json')), manifestBytes, 'Archive manifest mismatch');
    require('./verify.cjs').verify(path.join(unpacked, 'ui-package'), manifest);
  } finally { fs.rmSync(unpacked, { recursive: true, force: true }); }
  const archiveName = 'cronicle-' + tag + '.tar.gz';
  fs.copyFileSync(archive, path.join(assets, archiveName));
  fs.writeFileSync(path.join(assets, 'manifest.json'), manifestBytes);
  fs.copyFileSync(path.join(root, 'LICENSE.md'), path.join(assets, 'LICENSE.md'));
  const run = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? process.env.GITHUB_SERVER_URL + '/' + process.env.GITHUB_REPOSITORY + '/actions/runs/' + process.env.GITHUB_RUN_ID : 'local verification';
  fs.writeFileSync(path.join(assets, 'INSTALL.md'), `# ${tag} 安装说明

仅适配官方 v${info.version}，上游提交 ${info.upstream}。汉化源码提交 ${info.source}。

下载全部六个附件到同一空目录。Linux 执行 \`sha256sum -c SHA256SUMS\`，macOS 执行 \`shasum -a 256 -c SHA256SUMS\`，五项全部通过后再继续。归档 SHA-256：${summary.archiveSHA256}。

在 Web 根之外解包：

\`\`\`sh
mkdir unpacked
tar -xzf ${archiveName} -C unpacked
cmp manifest.json unpacked/manifest.json
\`\`\`

确认目标为官方 v${info.version}，目标 package-lock.json 的 SHA-256 为 ${manifest.lock}。存在前端或依赖本地改动时先审查。完整校验器及依赖准备见该 tag 的 tools/i18n/README.md：

\`\`\`sh
tools/i18n/node_modules/node/bin/node tools/i18n/verify.cjs /absolute/path/unpacked/ui-package /absolute/path/unpacked/manifest.json
\`\`\`

通过既有部署流程追加 unpacked/ui-package 内容到现有 htdocs。先完整校验并排他原子发布 _ui/releases/${manifest.releaseId}/，再排他发布 ${manifest.entry}.gz，最后发布 ${manifest.entry}。同名路径已存在时停止核对，拒绝覆盖。完整保留原静态根、Worker 和动态加载资源，不覆盖默认 index.html，不使用 current 软链。

在同一 origin 下访问 /${manifest.entry}，核对 identity、gzip、网关、会话、Socket.IO 与自然任务连续性。回退访问原英文入口或上一已验收入口。无需重启 Cronicle、修改任务、配置或安装插件。文件权限沿用既有运维流程，保留 LICENSE.md。

测试和适用边界见 VALIDATION.md。发布包不代表目标环境已经验收。
`);
  fs.writeFileSync(path.join(assets, 'VALIDATION.md'), `# ${tag} 验收记录

源码：${info.source}。官方基线：v${info.version} / ${info.upstream}。

完整验证：${run}。开始 ${summary.started}，完成 ${summary.completed}。

运行环境：${summary.platform} ${summary.arch}，Node ${summary.node}。源码门禁、单元与静态处理器、官方回归和 A/B/C 三浏览器集成全部通过，浏览器无自动重试。真实分钟任务、HTTP 全包与 CDP 性能检查在 Chromium 执行，Firefox 和 WebKit 对这三项明确去重，其余界面用例在三个引擎执行。
${summary.platform === 'linux' ? '\nLinux WebKit 将 text/plain 附件直接显示，见 https://github.com/microsoft/playwright/issues/34076 。本次点击原下载链接，逐组核对官方相同行为、附件头、响应字节和显示日志；Chromium 与 Firefox 校验实际下载文件及文件名。此项不代表 Safari 原生下载已经验收。\n' : ''}

本次运行的 i18n-verification artifact 保存 verification.json、unit.tap、upstream.log、integration.json、performance.json、minute.json 及失败诊断。文件内记录实际数量、性能预算和运行环境，不能用历史报告替代。

静态 releaseId：${manifest.releaseId}。归档 SHA-256：${summary.archiveSHA256}。归档和独立 manifest 经过回下载前的内容与 gzip 校验；正式发布还会下载全部附件逐字节比对。

本次 CI 未部署 staging 或生产，未完成目标环境验收、48 小时观察、真实多 worker 或发布故障注入。安装包仅适配其声明的官方版本。
`);
  const names = fs.readdirSync(assets).sort();
  assert.equal(names.length, 5);
  fs.writeFileSync(path.join(assets, 'SHA256SUMS'), names.map(name => hash(fs.readFileSync(path.join(assets, name))) + '  ' + name + '\n').join(''));
  fs.writeFileSync(path.join(destination, 'release.json'), JSON.stringify({ ...info, releaseId: manifest.releaseId, archiveSHA256: summary.archiveSHA256, run }, null, 2) + '\n');
  fs.writeFileSync(path.join(destination, 'RELEASE_NOTES.md'), `基于官方 v${info.version} 的简体中文静态界面。\n\n完整验收与产物来源：${run}\n\n上游提交：${info.upstream}\n\n汉化源码：${info.source}\n\n下载六个附件，先校验 SHA256SUMS，再按 INSTALL.md 追加静态资源。无需重启调度器，目标环境仍需独立验收。\n`);
  return info;
}
if (require.main === module) {
  try {
    const tag = process.env.RELEASE_TAG;
    console.log(JSON.stringify(process.argv[2] === 'preflight' ? preflight(tag, process.env.PUBLISH_RELEASE === 'true') : prepare(tag), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { validateTag, validateEvidence, preflight, prepare };
