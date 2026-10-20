# Cronicle 简体中文界面

本仓是 [jhuckaby/Cronicle](https://github.com/jhuckaby/Cronicle) 的汉化 fork。官方源码和历史保留，`zh-CN` 分支仅增加词典、展示层接入、构建工具与测试。调度器、API、Worker、任务参数和主依赖锁文件保持官方原样。

当前支持官方 tag `v0.9.137`，提交 `34fbd63058ac9f121e76527fded7211b366b996d`。汉化包与这个版本配对，不能直接用于其他版本。

- [构建、验证与安装说明](tools/i18n/README.md)
- [验收结果及已知边界](tools/i18n/VALIDATION.md)
- [自动验收、版本发布与上游检测](tools/i18n/CI.md)
- [官方英文文档](README.md)

## 下载已构建版本

首个发布为 [zh-CN-v0.9.137-r1](https://github.com/yoyicue/Cronicle/releases/tag/zh-CN-v0.9.137-r1)，仅适配官方 `v0.9.137`。下载六个附件并校验 `SHA256SUMS`，按照[安装说明](tools/i18n/INSTALL.md)追加静态资源。使用发布包无需重新构建，也无需重启调度器。

## 从源码构建与验证

```sh
git clone --branch zh-CN https://github.com/yoyicue/Cronicle.git
cd Cronicle
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix tools/i18n --no-audit --no-fund
```

本地测试使用 Node 22.23.3、Playwright 1.64.1 和 Caddy 2.11.7。后两步的浏览器与 Caddy 准备方式见安装说明。全部验证通过后输出独立的中文静态包，安装到同版本 Cronicle 的现有静态目录，不需要安装新的任务插件。

## 版本维护

`upstream` 指向官方，`origin` 指向本 fork。`master` 保留官方同步线，`zh-CN` 维护汉化。官方 tag 保留原名，汉化发布 tag 使用 `zh-CN-v0.9.137-r1` 这样的名称，并记录上游提交与产物哈希。

跟进新 tag 时先审查官方差异，再更新翻译位置清单和原文哈希，执行官方回归、A/B/C 三组对照和三浏览器集成。源码漂移会阻止构建，通过验收后才发布对应版本。不要用 GitHub 的 Sync fork 直接向汉化分支合入官方 master，适配以指定 tag 为基线。同步源码不会自动升级运行中的 Cronicle。

首次发布产物以本分支的本地验收为依据。目标环境的静态资源、网关、权限与既有任务连续性仍需单独验收，详见验收边界。

## 许可

保留官方 [MIT 许可证](LICENSE.md)。本分支新增的汉化代码同样采用 MIT 许可证。
