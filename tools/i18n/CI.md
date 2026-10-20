# GitHub Actions

本 fork 使用三条工作流，统一使用 GitHub 托管的 Ubuntu 24.04 x64。它们不连接部署节点，不需要 SSH、业务密钥或部署凭证。

## 自动验收

[i18n verification](https://github.com/yoyicue/Cronicle/actions/workflows/i18n-verify.yml) 在向 zh-CN 推送、提交以 zh-CN 为目标的 PR 或手动运行时执行完整验证。浅克隆无法检查官方原文件，因此 checkout 获取完整历史和 tag。

工作流锁定 Node 22.23.3、Playwright 1.64.1 和 Caddy 2.11.7，依赖按两个 lockfile 安装。主仓 npm ci 使用 --ignore-scripts，避免注册系统服务。Caddy 下载必须通过固定归档 SHA-512 和二进制 SHA-256 校验。GitHub Action 自身固定到完整提交 SHA。

执行入口仍为 npm --prefix tools/i18n run verify：源码门禁、单元与静态处理器、官方原回归、A/B/C 三浏览器集成，全部通过才输出静态归档。三浏览器串行执行，共享本轮隔离夹具，不启用自动重试，不放宽已有性能预算。浏览器阶段收集全部用例结果，单项失败不再跳过其余用例；任何失败仍阻止归档与发布。

渲染性能先对 A/B/C 全部预热，再按六轮、每组五个样本轮换采集，每组在三个位置各出现两次，保留每种规模 30 个原始样本与采样顺序。p95 仍要求增量不超过基线的 10% 或 20 毫秒中较大者，堆内存与 gzip 预算保持。共享 runner 曾在 macOS 上触发顺序分段测量的预算失败，因此不能只靠切换系统或重跑解释通过；轮换采样后的每次结果仍须实际满足原预算。

首轮 Linux 的性能失败不能证明 runner 算力不足。此前切换 macOS 也出现预算失败。[Linux 同机诊断](https://github.com/yoyicue/Cronicle/actions/runs/39355406325)使用 4 核 EPYC 和约 16GB 内存，三个相同官方页面的 p95 最大差异约 4.7%。10 次渲染的中文布局累计耗时比官方增加约 311 毫秒，主要差异在浏览器布局。追踪开启的两组中文 p95 增量为 36.3 和 39.7 毫秒，超过各自 32.62 和 31.56 毫秒预算；追踪关闭的两组增量为 24.5 和 27.3 毫秒，落在各自 33.68 和 31.54 毫秒预算内。这些是诊断对照，不能代替完整验收。

性能用例等待字体就绪并单独关闭 Playwright trace，避免把截图、DOM 快照等追踪开销计入应用性能。原始样本、采样顺序、运行平台和 trace 设置保存在 performance.json；功能用例仍保留失败 trace。字体和中文文案仍有实际布局成本，完整运行必须满足原预算，失败不能通过重跑挑绿或改用更快的平台放行。

每次运行保留 i18n-verification artifact 14 天，包含选定的测试报告、日志、截图、失败 trace、manifest 和通过验证的静态归档。不会上传 .work 中的实例目录、生成配置和会话。检查失败时先下载报告，不用重跑覆盖失败证据。

## 版本发布

[i18n release](https://github.com/yoyicue/Cronicle/actions/workflows/i18n-release.yml) 支持两种触发：

1. 推送 zh-CN-v0.9.137-r2 这样的正式 tag，完整验收后自动发布。
2. 在 Actions 页选择 Run workflow，选择源码 ref，填写 tag。publish 默认 false，只验收并生成 i18n-release artifact。预演允许使用尚未创建的候选 tag。勾选 publish 才正式发布，实际 tag 必须存在且指向所选源码提交。

tag 中的上游版本必须等于 package.json 的版本。工作流从 jhuckaby/Cronicle 拉取官方 v0.9.137 这样的原始 tag，必须解析为 sites.json 登记的确切上游提交，且为当前提交的祖先。中文 tag 已存在时必须指向同一本次测试提交，避免测试分支代码却发布旧 tag。

发布复用同一次完整验证输出的归档，不再构建。归档 SHA-256、manifest、静态内容和 gzip 再次核对后，生成六个附件：安装 tar.gz、manifest.json、SHA256SUMS、INSTALL.md、VALIDATION.md、LICENSE.md。安装和验收说明记录本次源码、上游版本、归档哈希和 Actions 运行链接，不复用首版 r1 的历史报告。预演和正式发布都先回下载 Actions artifact，逐字节比较并检查 SHA256SUMS，确保交接给上传 job 的材料完整。

正式上传在独立 job 中进行，只有该 job 获得 contents:write。它不检出或运行仓库代码，只接收同一次验收的 artifact。发布前再次确认远端 tag 指向测试提交，创建草稿，下载全部附件逐字节比较，通过后转为正式 Release。已存在的 Release 不会被覆盖；若留下草稿，核对失败原因后人工处理，再重跑。发布流程不删除 tag 或既有 Release。

推荐先预演，再创建新的中文 tag。已经发布的 zh-CN-v0.9.137-r1 保持原样，不用重新推送它测试发布流程。维护者推送 tag 或手动触发即可，无需个人访问令牌。

## 官方 Release 检测

[Official Release watch](https://github.com/yoyicue/Cronicle/actions/workflows/i18n-upstream.yml) 每天 UTC 01:23，即北京时间 09:23，查询 jhuckaby/Cronicle 的最新稳定 Release，并与当前声明适配的上游版本比较。GitHub 定时任务可能延迟，也可以手动运行。

同版本时成功，新版本时失败并在运行摘要中显示新版本链接，同时保存 upstream-release artifact 30 天。API 失败、异常格式、版本倒退都会明确失败，不能记为已经对齐。检测不更新源码、tag 或服务，不创建 Issue，不自动合并或部署。需要收到邮件时，在个人 GitHub 通知设置中启用 Actions 失败通知。

发现新版本后，按 README 中的适配流程审查源码和依赖差异、登记翻译位置、完整验收并发布新的中文 tag。定时工作流只在默认分支执行，长时间无仓库活动可能被 GitHub 停用，需要从 Actions 页重新启用。

## 权限和验收边界

普通 PR 使用 pull_request 事件和只读 GITHUB_TOKEN，不使用 pull_request_target。fork PR 的首次运行可能需要仓库维护者按 GitHub 规则批准。没有配置服务器凭证，工作流只启动当前 runner 上的合成测试实例。

测试报告只说明该次 runner、源码和归档的结果。目标环境的权限、网关、静态发布、任务连续性、48 小时观察、真实多 worker 和故障注入仍需独立验收。共享 runner 的性能结果保留原始数据，预算失败会阻止发布。
