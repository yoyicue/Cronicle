# Cronicle zh-CN-v0.9.137-r2 安装说明

本包仅适配官方 `v0.9.137`，上游提交 `34fbd63058ac9f121e76527fded7211b366b996d`。确切汉化源码提交见该版本附件 `INSTALL.md` 与 `VALIDATION.md`。归档只含独立中文静态资源和 manifest，目标应已有同版本 Cronicle。

## 下载与校验

从 [Release 页面](https://github.com/yoyicue/Cronicle/releases/tag/zh-CN-v0.9.137-r2)下载六个附件到同一空目录：`cronicle-zh-CN-v0.9.137-r2.tar.gz`、`manifest.json`、`SHA256SUMS`、`INSTALL.md`、`VALIDATION.md`、`LICENSE.md`。GitHub 自动提供的 Source code 归档用于开发，静态安装包为上述 tar.gz。

Linux 校验：

```sh
sha256sum -c SHA256SUMS
```

macOS 校验：

```sh
shasum -a 256 -c SHA256SUMS
```

五项都应显示 OK。校验失败时停止。实际归档 SHA-256 记录在该版本的 `SHA256SUMS`、`INSTALL.md` 与 `VALIDATION.md` 中，须使用同一 Release 的附件。

在 Web 根之外解包并比对 manifest：

```sh
mkdir cronicle-zh-r2
tar -xzf cronicle-zh-CN-v0.9.137-r2.tar.gz -C cronicle-zh-r2
cmp manifest.json cronicle-zh-r2/manifest.json
```

项目校验器可在已按[开发说明](https://github.com/yoyicue/Cronicle/blob/zh-CN-v0.9.137-r2/tools/i18n/README.md)准备依赖的构建机上进一步检查所有路径、文件和 gzip。在源码根目录执行，并将绝对路径替换为本次解包位置：

```sh
tools/i18n/node_modules/node/bin/node tools/i18n/verify.cjs /absolute/path/cronicle-zh-r2/ui-package /absolute/path/cronicle-zh-r2/manifest.json
```

## 核对目标

确认已安装官方 `v0.9.137`。目标 `package-lock.json` 的 SHA-256 应为 `0f92930ccc958d1676edeee8eb13542b377a7ae3a8cb875d1121ef5818e136c7`。目标前端或依赖有本地修改时，先完成差异审查。配置和真实数据继续使用现有实例。

## 追加发布

由现有部署流程将解包后 `ui-package` 的内容追加到现有 `htdocs`：

1. 完整发布 `_ui/releases/0fde17e5df8461136abcf18b8804ee721638f72a5f99ab02e4bf68b92eb876a1/` 目录，使用临时目录校验后排他原子发布，已有同名路径时停止核对。
2. 追加根层 `index-zh-0fde17e5df8461136abcf18b8804ee721638f72a5f99ab02e4bf68b92eb876a1.html.gz`，完成后再追加 `index-zh-0fde17e5df8461136abcf18b8804ee721638f72a5f99ab02e4bf68b92eb876a1.html`。每个入口使用临时文件和排他发布方式，拒绝覆盖已有路径。
3. 原静态根与资源完整保留，供原 Worker、动态加载器、API 和 Socket.IO 使用。默认 `index.html` 保持安装前状态。
4. 在同一 origin 下访问 `/index-zh-0fde17e5df8461136abcf18b8804ee721638f72a5f99ab02e4bf68b92eb876a1.html`。入口不要放进子目录，也不要用 current 软链切换版本。
5. 核对直连及网关的 identity、gzip、会话、Socket.IO、原入口回退与自然任务连续性。

安装只追加静态文件，无需重启 Cronicle、修改任务、替换配置或安装任务插件。回退访问安装前入口或上一已验收版本。静态目录发布与权限应沿用目标环境的既有运维流程。

## 验收范围

本包已通过源码门禁、30 项单元与静态检查、官方 63 项测试与 485 个断言、三浏览器 69 项检查，6 项按设计不重复执行，0 失败。完整报告见同目录 `VALIDATION.md`。

发布流程在 Ubuntu 24.04 x64 执行完整验收并校验附件。Linux WebKit 的 text/plain 附件限制见该版本 VALIDATION.md；Chromium 和 Firefox 校验实际下载文件，WebKit 核对官方相同行为、附件头与日志字节。目标环境部署、48 小时观察、真实多 worker 和发布故障注入仍需独立验收。

保留同目录 `LICENSE.md`，上游与新增汉化采用 MIT 许可证。
