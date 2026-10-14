# pi-magpie 工程实战踩坑与技术复盘 (Retro)

记录在开发与沉淀 `pi-magpie` 扩展过程中踩到的核心技术坑点、根因分析与落地解法。

---

## 1. 独立轻量包的 TypeScript 类型陷阱：`@types/node`
- **踩坑现象**：在源码中引入 `node:child_process`、`node:fs` 或读取 `process.platform` 时，运行 `tsc` 编译产生大量找不到类型的错误。
- **根因剖析**：许多大型项目因为安装了 Webpack、Vite、Jest 等构建或测试工具，这些工具的深层依赖会自动将 `@types/node` 扁平化提升（Hoisting）到顶层，形成了不易察觉的“幽灵依赖（Phantom Dependency）”。但在 `pi-magpie` 这种独立轻量级插件中，没有任何重型依赖，必须显式在 `devDependencies` 中声明 `@types/node`，才能为 `tsc` 提供完整的 Node.js 环境类型声明。
- **工程解法**：显式安装并锁定最新版 `@types/node`，并在 `tsconfig.json` 中规范使用标准模块解析策略，保障在任意全新干净环境下编译的确定性。

---

## 2. GitHub Releases 多跳 302 重定向与流式下载
- **踩坑现象**：下载模块向 `github.com/.../releases/download/...` 发送 GET 请求时，经常只下载到 0 字节的空文件或 HTML 重定向页面。
- **根因剖析**：GitHub 的 Release 资产下载采用重定向架构，最初的请求会返回 HTTP 302/307，跳转至 AWS S3 CDN 的带签名临时地址。如果 Node.js 底层下载流没有处理重定向，就会直接把重定向报文当成下载完成。
- **工程解法**：全面基于 Node.js 原生 `fetch` 与 `Readable.fromWeb` / `stream.pipeline` 重构。利用标准 WHATWG 的 `redirect: "follow"` 自动透明处理 CDN 多跳重定向，配合 `Transform` 流实时计算下载进度，并通过 `.downloading` 临时文件与原子重命名机制保障文件完整性，彻底淘汰陈旧的 `node:https` / `node:http` 回调与手动重定向跟踪。

---

## 3. 跨平台二进制命名规范与 Unix 执行权限
- **踩坑现象**：从 GitHub Releases 自动拉取资产时，不同操作系统的包命名格式各不相同（曾误以为 Linux 为 `magpie-linux-amd64` 导致 404），且在 Linux/macOS 下载完成后直接 `spawn` 会报错 `EACCES`（无执行权限）。
- **根因剖析**：
  - Magpie 官方最新 Releases 统一采用带有 `-cli-` 前缀的资产命名规范：
    * Windows: `magpie-cli-windows-amd64.exe` / `magpie-cli-windows-arm64.exe`；
    * macOS: `magpie-cli-darwin-arm64` / `magpie-cli-darwin-amd64`；
    * Linux: `magpie-cli-linux-amd64` / `magpie-cli-linux-arm64`；
  - 通过 HTTP 流写入的文件在类 Unix 系统中默认只有只读/只写权限（如 0644），缺少可执行位（+x）。
- **工程解法**：基于官方真实发布的资产列表对齐命名映射矩阵，并在 Unix 环境下载完成后，主动调用 `chmodSync(localPath, 0o755)` 补齐可执行权限。

---

## 4. Stdio MCP 运行模式下的 `stdout` 协议帧污染
- **踩坑现象**：当将插件作为独立 MCP Server 挂载到外部客户端时，初始化握手偶发 JSON 解析失败。
- **根因剖析**：标准 MCP 协议在 stdio 模式下，将进程的 `stdout` 作为绝对严格的 JSON-RPC 消息传输通道。如果在 CLI 执行、日志打印或下载进度通知中不小心用了 `console.log` 输出纯文本，这些文本就会混入 `stdout`，导致客户端的反序列化器崩溃。
- **工程解法**：所有非 JSON-RPC 响应的辅助日志、调试输出与警告全部严格重定向到 `stderr`（`process.stderr.write`），确保 `stdout` 只传输合法的 JSON-RPC 报文。

---

## 5. Linux 终端断开与 SIGHUP 会话挂断信号回收
- **踩坑现象**：在 Linux / macOS 上，当用户通过 SSH 连接或直接关闭终端窗口标签页时，Pi 进程被关闭，但后台托管的 Magpie 网关未能及时触发清理，残留在系统后台。
- **根因剖析**：原本仅监听了 `SIGINT` (Ctrl+C) 与 `SIGTERM` 信号。当 SSH 会话意外断开或终端被强制关闭时，系统向首领进程发送的是 `SIGHUP` (Hangup) 信号。若未注册该信号钩子，进程默认退出时不会执行清理流程。
- **工程解法**：在扩展入口补充对 `SIGHUP` 信号的监听并挂接 `handleSessionShutdown()`，确保在 SSH 会话中断或窗口关闭时，依然能够及时注销信标并触发归零即刻销毁。

---

## 6. Windows 冷启动延迟与网关探测超时误杀 (Gateway Cold-Start Timeout)
- **踩坑现象**：在 Windows 平台上，启动 Pi 或初次运行 `/magpie` 时，频繁报错 `Magpie 启动超时，服务未就绪。`，随后后台拉起的子进程被自动强行终止，导致扩展无法顺利拉起本地网关。
- **根因剖析**：
  1. **冷启动远端凭证握手延迟**：Magpie 在 Windows 首次初始化时，需要解析本地配置并向远端模型供应商（例如 Google Cloud Antigravity 等 Provider）同步凭证与模型路由状态。在网络抖动或冷启动场景下，二进制（`magpie web`）从拉起到同时完成 Gateway（默认 `8317`）与 Web 控制台（默认 `3430`）端口监听通常耗时 **8.5 ~ 9.0 秒**。
  2. **轮询探测窗口过紧**：原 `gatewayService.startService` 仅设置了 `10 次 × 500ms = 5 秒` 的固定探测窗口。由于硬编码超时阈值显著短于 Magpie 冷启动所需耗时，导致探测提前判定失败并调用 `stopGateway(true)` 强行 kill 掉了正在正常初始化的子进程。
  3. **高频 CLI 探活加重系统负载**：原本的 `isHealthy()` 每次轮询都会通过 `execAsync` 执行 `"${bin}" healthcheck`，在 Windows 下反复高频创建子进程，带来显著的 CPU 和进程调度开销，进一步拖慢了服务的就绪速度。
- **工程解法**：
  1. **弹性扩大轮询窗口**：将启动重试次数由 10 次扩充至 30 次（单次 500ms，总时间上限 15 秒），兼顾快速响应（一旦健康立即完成注册并退出循环）与冷启动容错（预留 15 秒足够应对各种远端凭证握手）。
  2. **双层探活与原生 HTTP 快速通道**：在 `GatewayClient.isHealthy` 中优先采用轻量级原生 `fetch` 探测网关端口（耗时 `< 2ms` 且零子进程损耗），仅在异常时降级至 `magpie healthcheck` 命令行探活。
  3. **调优 Web HEAD 握手时限**：将 `isWebResponding` 的单次超时提高至 1000ms，避免 Windows 高负载下握手偶发丢包引发误判。

---

## 7. 宿主扩展生命周期与非侵入式信号治理 (Session Lifecycle & Signal Guard)
- **踩坑现象**：在扩展入口中监听 `SIGINT` (Ctrl+C) 和 `SIGTERM` 时硬调用 `process.exit(0)`，导致宿主 Pi 无法正常拦截中断信号，破坏了终端的交互式确认与会话归档流程。
- **根因剖析**：作为嵌入在 Pi 宿主内部的插件，不应侵入式接管宿主主进程的生命周期终止权。直接调用 `process.exit` 会强行中断宿主正在进行的清理工作与 TUI 恢复。
- **工程解法**：
  1. 接入 Pi 原生提供的 `session_shutdown` 扩展生命周期钩子（`pi.on("session_shutdown", ...)`），执行受控的会话信标注销与归零销毁。
  2. 在 Node.js 进程级事件中保留 `beforeExit`、`exit` 及 `SIGHUP` 监听以清理资源，彻底移除侵入性的 `process.exit(0)` 调用。

---

## 8. Pi 内部会话切换 (Session Switch/Resume) 误杀网关与重启陷阱
- **踩坑现象**：在 Pi 终端内执行 `/session switch`、`/new`、创建分支或重载时，Magpie 网关会被强行杀死，随后在新会话中重新冷启动（耗时数秒），造成严重的会话切换卡顿和网络中断。
- **根因剖析**：
  Pi 的 `session_shutdown` 事件不仅在用户彻底退出终端时触发，在内部切换会话（`reason: "resume"`）、开启新会话（`reason: "new"`）、分叉会话（`reason: "fork"`）以及热重载（`reason: "reload"`）时也会被派发。
  原本的 `session_shutdown` 处理器未检查 `event.reason`，直接执行了 `cleanup()`，导致当前 Pi 进程的 PID 信标被注销并误判“活跃客户端归零”，从而触发 `terminateManagedServiceIfLastClient()` 把仍在宿主内部使用的 Magpie 服务进程强行 kill 掉了。随后新会话触发 `session_start` 时由于探测到网关离线，不得不再次触发 8.5 秒的漫长冷启动。
- **工程解法**：
  在 `index.ts` 的 `session_shutdown` 处理器中增加原因守卫：仅当 `!event || event.reason === "quit"` 时才执行注销与归零销毁；对 `"resume" | "new" | "fork" | "reload"` 等内部切换场景直接放行，确保 Magpie 在会话切换期间零中断常驻。并在 `test/extension.test.ts` 中固化单测防退化。

---

## 9. 启动全生命周期透明化与交互反馈回路 (Startup Lifecycle Visibility & Feedback Loop)
- **踩坑现象**：由于 Windows 平台上 Magpie 冷启动与远端凭证握手通常耗时 8~9 秒，且首次启动还可能伴随流式二进制下载，原本“完全静默”的拉起策略导致开发者在启动 Pi 时陷入长时间的无声等待，缺乏确定性感知，容易误以为扩展卡死或未生效。
- **根因剖析**：早期的 PRD 0001 强调“静默无感”，但在物理冷启动延迟与网络握手客观存在的场景下，“静默”等同于“黑盒吞没”。缺乏启动中间态反馈会严重损害开发者的交互预期与调试信心。
- **工程解法**：
  1. **三态生命周期反馈**：在 `GatewayService` 中抽象 `EnsureGatewayOptions`，在正式拉起子进程前触发 `onStarting` 回调：
     - **启动中**：即刻向 UI 弹出 `Magpie 正在启动中，请稍候... ⏳`，若触发首次安装流式下载，则实时推送下载百分比与体积；
     - **启动完毕**：网关与 Web 双就绪后，呈现包含控制台地址与免密 Key 的就绪卡片 🟢；
     - **启动失败/异常**：明确呈现超时、端口冲突或进程报错，错误级别降级上报 ❌。
  2. **冷启动与活跃复用正交解耦**：针对多会话切换或已有活跃实例的场景（`res.running && !res.spawned`），继续坚守 PRD 0004 的“零干扰”原则，保持完全静默复用，绝不产生任何恼人的冗余弹窗。
