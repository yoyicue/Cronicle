# Cronicle 简体中文静态界面

基线为官方 tag `v0.9.137`，提交 `34fbd63058ac9f121e76527fded7211b366b996d`。本目录在全新隔离目录构建和测试，全部 93 个原有上游文件保持原样。

汉化使用 1285 个明确登记的字符串位置、98 个展示格式化位置和 851 个词条。`sites.json` 按源文件、AST 位置、原文哈希和 HTML 上下文限定翻译范围。`exclusions.json` 登记其他原始字符串的保留理由。上游或依赖发生漂移时构建失败，必须重新审查位置。

构建时仅改登记的文案和展示表达式，展示运行时负责中文时间摘要、日期、数量单位及控件标签。原 cron 解析器、Page ID、option 值、接口与 WebSocket 协议保持。用户标题、脚本、插件输出、日志和服务端诊断保留原文。内置参数只有 ID 和原默认标题均匹配时才翻译显示名。`htdocs/css/i18n-zh-CN.css` 只合入中文入口，避免中文表单标签逐字换行。

## 安装已发布包

已构建版本见 [zh-CN-v0.9.137-r1](https://github.com/yoyicue/Cronicle/releases/tag/zh-CN-v0.9.137-r1)。下载、校验与追加发布步骤见 [INSTALL](INSTALL.md)。以下命令用于准备源码构建与验证环境。

## 安装开发依赖

在本仓根目录执行。首次安装需要网络，测试期间只连接本机。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/i18n --no-audit --no-fund
tools/i18n/node_modules/node/bin/node tools/i18n/node_modules/@playwright/test/cli.js install chromium firefox webkit
```

工具锁定 Node 22.23.3 和 Playwright 1.64.1，npm 命令使用工具目录安装的 Node，不继承宿主机的 Node 版本。主依赖安装必须使用 `--ignore-scripts`，避免官方 postinstall 注册系统服务。

真实反向代理测试固定 Caddy 2.11.7。macOS arm64 和 Linux x64 可以执行：

```sh
npm --prefix tools/i18n run prepare:caddy
```

下载脚本验证[官方归档](https://github.com/caddyserver/caddy/releases/tag/v2.11.7)的 SHA-512 和二进制 SHA-256，不安装系统服务。其他平台需自行提供验证过的同版 Caddy，并通过 `CADDY_BIN` 指定二进制路径。Linux 浏览器所需系统库按 Playwright 官方安装说明准备。

GitHub Actions 的自动验收、发布预演、正式 tag 发布和官方 Release 定时检测见 [CI 说明](CI.md)。所有工作流仅操作隔离测试与 GitHub 附件，不连接部署节点。

## 完整验证

```sh
npm --prefix tools/i18n run verify
```

其他平台提供 Caddy 时：

```sh
CADDY_BIN=/absolute/path/to/caddy npm --prefix tools/i18n run verify
```

验证依次执行源码门禁、单元与真实静态处理器测试、官方原回归和三浏览器集成。任何一步失败立即返回非零状态，全部通过才生成交付包。浏览器不启用自动重试。

A 为官方英文，B 为接入展示助手的英文，C 为中文。三套实例的目录、合成密钥和主机身份隔离，HTTP、Caddy 和 SMTP 只监听回环，禁用 UDP 发现，作业使用无业务外联的合成脚本。

登录助手兼容用例使用本仓 `fixtures/autofill.js`，以两个保留测试域名和合成存储键验证真实生成表单的自动填充、单次提交以及找回与重置页不提交。浏览器拦截该用例的全部请求。它验证通用表单兼容性，不代表任意外部扩展都已验收，也不依赖其他仓库。

集成使用 4511 至 4516 和 4599 端口，手动预览使用 4501 至 4503。端口冲突时应停止冲突进程或调整隔离环境，不应改为监听所有网卡。退出时停止本轮创建的服务。

```sh
npm --prefix tools/i18n test
npm --prefix tools/i18n run integration -- --project=chromium
tools/i18n/node_modules/node/bin/node tools/i18n/lab.cjs
```

旧报告、失败截图和 trace 移入 `out/history/`。`out/verification.json`、`out/unit.tap`、`out/upstream.log`、`out/integration.json`、`out/performance.json` 和 `out/minute.json` 保存本地证据。HTTP 全包、真实分钟边界与 Chromium CDP 性能检查只执行一次，另外两个浏览器中的这三项明确跳过，界面操作仍在三个引擎执行。

## 单独构建

```sh
tools/i18n/node_modules/node/bin/node tools/i18n/build.cjs zh-CN /tmp/cronicle-zh-new
tools/i18n/node_modules/node/bin/node tools/i18n/verify.cjs /tmp/cronicle-zh-new/ui-package /tmp/cronicle-zh-new/manifest.json
```

目标目录必须不存在。单独构建会执行源码与产物检查，但不会代替完整集成验收。正式交付应使用 `verify` 全绿后生成的归档。

```text
ui-package/
  _ui/releases/<内容哈希>/
    js/ css/ images/ fonts/ favicon.ico
  index-zh-<内容哈希>.html
  index-zh-<内容哈希>.html.gz
manifest.json
```

完整验证输出归档至 `tools/i18n/out/cronicle-zh-CN-<内容哈希>.tar.gz`，manifest 副本为 `out/release-manifest.json`。manifest 记录上游提交、主锁文件、Node、工具及词典输入哈希和全部静态文件哈希。

打包禁用 macOS AppleDouble 元数据并核对归档闭包。校验拒绝缺件、越界路径、软链、额外文件、内容篡改及陈旧 gzip。发布包不含配置、数据目录、环境变量或测试夹具。

原 dist 复制回调存在先于目标写入结束的竞态。`build-driver.cjs` 仅在隔离构建进程内使用 `fs.copyFile` 完成回调，不改上游文件，也不进入运行服务。产物由官方 dist 流程生成，并检查 JS 语法、资源引用、内容哈希和 gzip 解压等价。

## 部署静态包

1. 确认目标为同一上游版本，主锁文件与 manifest 的 `lock` 哈希一致。存在本地前端修改或依赖漂移时停止安装并另行审查。
2. 在 Web 根之外解包并运行上述 `verify.cjs` 校验。使用已验收的同一归档，不在服务器重新构建。
3. 将 `ui-package` 中的版本资源目录和根层入口追加到现有 `htdocs`。先完成资源目录，再发布入口 gzip，最后发布 HTML。拒绝覆盖已有路径，完整保留原英文静态根。
4. 访问同一 origin 下的 `/index-zh-<内容哈希>.html`。保留原根资源供 Worker 与动态加载器使用，后端继续提供 Socket.IO 和 API。
5. 核对直连及网关的 identity、gzip、会话、英文回退、WebSocket 与自然任务连续性。回退使用原英文入口或上一已验收入口。

汉化安装只涉及新增静态文件，无需重启 Cronicle、修改任务或安装任务插件。不要覆盖默认 `index.html`、切换 `current` 软链或删除原有资源。固定 WebServer 的 stat/open 竞态已有定向反例，因此使用不可变版本目录和入口。

## 升级边界

官方新 tag 必须重新登记源码与依赖，执行全部门禁后生成独立版本包。本次本地验证不能代替目标环境验收、长时间观察、多 worker 操作或故障注入；具体已测与未测范围见 [VALIDATION](VALIDATION.md)。
