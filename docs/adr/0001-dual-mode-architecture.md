# 1. 纯粹 Pi 原生扩展架构设计决策 (Pi Extension Architecture)

## 状态
已采纳 (Accepted，已从原双模架构全面简化收敛)

## 决策背景与演进
早期设计曾尝试将插件做成“Pi 扩展 + 独立 Stdio MCP 服务”双模同构。但在实际演进与深度使用中发现：
1. **MCP 维护与依赖负担冗余**：引入了 `@modelcontextprotocol/sdk` 及 JSON-RPC 管道处理，且在多会话协同场景下增加了复杂度；
2. **上下文污染与开销**：为 AI Agent 暴露大量细碎的管理工具（如切换模型、查配额、查账单）不仅浪费上下文窗口（Context Tokens），且容易引发 Agent 误调用；
3. **Web 面板体验更佳**：Magpie 自带成熟的 Web 控制面板（`127.0.0.1:3430`），模型配置、额度明细与用量图表在浏览器中呈现比在 CLI/Tool 中清晰得多。

因此我们做出架构重构决策：**全面退役独立 MCP 服务与 Agent Tools，收敛为极致纯粹的零依赖 Pi 原生扩展 (Zero-Dependency Pi Native Extension)**。

## 架构核心原则
- **入口单一轻量**：仅保留 `src/index.ts` 作为 Pi 原生插件入口；
- **零运行时依赖**：彻底移除 `@modelcontextprotocol/sdk`，依赖列表归零，仅依赖 Node.js 内置核心模块与 Pi 宿主环境；
- **零 Agent Tool 污染**：不向 Agent 暴露任何 tool-calling 工具，保证会话提示词与上下文纯净；
- **极简命令与联合呈现**：仅向用户暴露 `/magpie` 命令，单次执行联合输出网关健康度、Pi 托管集群会话状态与 Web 控制台直接访问地址（`http://localhost:3430`）；
- **全自动多会话生命周期**：保持与 Pi 宿主会话深度联动（首个 Pi 启动静默拉起，多 Pi 协同保活，全退后 Watcher 防抖自动回收）。
