# 6. 非阻塞后台异步拉起与扩展生命周期解耦

## 状态
已采纳 (Accepted)

## 决策背景与核心痛点
在先前版本中，扩展入口（`src/index.ts`）在监听 Pi 的会话启动事件时注册了异步等待逻辑：`pi.on("session_start", async (_event, ctx) => { await gatewayService.ensureGateway(...) })`。
然而，在 Pi Coding Agent 的底层扩展运行时架构（`dist/core/extensions/runner.js` 及 `agent-session.js`）中：
1. **串行阻塞事件分发**：`runner.emit({ type: "session_start" })` 采用循环串行 `await handler(event, ctx)` 的机制。当任意扩展注册的 `session_start` 回调返回未决 Promise 时，Pi 会卡死在此处等待其 settle；
2. **冷启动与网络延迟叠加**：Magpie 在 Windows 等平台上进行首次冷启动时，涉及解析本地配置、向远端模型供应商（如 Google Cloud Antigravity 等 Provider）同步状态，通常需要耗时 **8.5 ~ 9.0 秒**；若触发流式自动下载，耗时更长；
3. **宿主启动卡顿与后续扩展饥饿**：Pi 必须等 `session_start` 全部派发完成，才会继续执行 MCP 服务连接、资源发现（`resources_discover`）以及命令行交互界面（TUI）的渲染。这导致整个 Pi 启动呈现出“卡死假死”数秒的严重不良体验；
4. **违反统一领域语言**：在项目统一术语表（`GLOSSARY.md`）中，早已明确定义静默自愈机制应“**全程不阻塞 UI 渲染和用户交互**”。现有的同步 await 明显违背了这一核心设计原则。

## 架构决策与选型

经过 Grilling 审讯决策与用户明确授权，我们全面推行**非阻塞后台异步拉起与会话生命周期解耦**：

1. **非阻塞立即交还控制权 (Non-blocking Handover)**：
   - `src/index.ts` 中的 `session_start` 处理器改为同步函数，不再向 Pi 宿主返回未决 Promise；
   - 内部通过非阻塞异步任务（`void handleSessionStart(ctx)`）在后台独立执行 `ensureGateway`；
   - Pi 宿主在微任务周期内立即判定 `session_start` 事件处理结束，毫秒级继续执行后续扩展加载并渲染交互终端，恢复零阻塞体验。

2. **保留后台异步反馈通道 (Asynchronous Toast Feedback)**：
   - 保持原有的生命周期可视化机制：
     - **启动中**：后台异步触发 `ctx.ui.notify("Magpie 正在后台启动中，请稍候... ⏳", "info")`；
     - **下载中**：若触发 GitHub Releases 资产流式拉取，实时推送下载百分比与接收体积；
     - **启动完毕**：网关与 Web 双端就绪后，呈现包含控制台地址与免密 Key 的就绪卡片 🟢；
     - **异常降级**：若超时或启动报错，通过错误气泡温和提醒，绝不抛出未捕获异常破坏宿主。
   - 用户在看到“正在后台启动中”提示的同时，完全可以无缝在终端输入命令或与 Agent 交流。

3. **并发命令快速返回过渡卡片 (Fast In-Progress Transition Card)**：
   - 在 `GatewayService` 与 `MagpieCLI` 中增加 `isStarting(): boolean` 状态谓词；
   - 用户在网关后台冷启动尚未收敛的过渡窗口期（例如前 8 秒），若在终端执行 `/magpie` 命令，指令**不阻塞等待**，亦不因端口尚未监听而误判为“未运行/离线”，而是**立即返回启动中过渡卡片**：
     - 标明 `网关状态: ⏳ 启动中 (Starting - 后台冷启动中，请稍后刷新)`；
     - 告知服务就绪后控制台可用并显示 Pi 托管状态。

## 方案收益与权衡对比
- **零启动阻塞**：Pi 宿主启动恢复原生纯净的毫秒级速度，后续扩展与 MCP 服务并发就绪；
- **交互状态透明**：彻底消除“静默等待时的卡顿焦虑”，后台进度实时感知；
- **状态感知确定**：过渡窗口期敲击 `/magpie` 能获得精确的启动中反馈，杜绝离线误判。
