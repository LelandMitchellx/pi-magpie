# 架构决策记录体系 (Architecture Decision Records, ADRs)

> *"架构不是一成不变的终态，而是一连串经过深思熟虑、权衡取舍的决策历史。"*

本项目严格遵循架构决策记录 (ADR) 规范，用于捕获重要架构变迁、技术选型背后的核心痛点、备选方案权衡及最终结论。通过清晰的 ADR 演进链条，确保团队与 AI Agent 随时理解“为何代码写成现在这样”。

---

## 🧭 架构演进脉络

```text
[初始基石: 原生化与零配置]
 ├── ADR 0001: 纯粹 Pi 原生扩展架构 (退役独立 MCP/Tool，收敛为零依赖原生插件)
 └── ADR 0002: 零配置二进制探测天梯与自动流式下载 (5 级寻址 + GitHub Releases 保底)
         │
[生命周期演进: 从独立守护到即刻自毁]
 ├── ADR 0003: Web 管理面板按需唤起机制 (探索按需拉起与端口复用)
 └── ADR 0004: 多会话生命周期共享与归零即刻销毁 (移除驻留 Watcher，信标归零即刻回收)
         │
[服务模型收敛: 单进程双监听与安全鉴权]
 └── ADR 0005: Gateway 与 Web 单进程收敛、8317 默认端口与随机访问密钥 (单进程双端口，杜绝端口冲突)
         │
[交互解耦: 宿主冷启动静默无感]
 └── ADR 0006: 非阻塞后台异步拉起与扩展生命周期解耦 (session_start 瞬间释放，静默自愈不卡 TUI)
         │
[韧性自愈: 受控更新与平滑接管]
 └── ADR 0007: 受控升级重启与生命周期重绑定机制 (先释放后升级，双引擎保底，PID 重绑定，永不脱管)
```

---

## 📜 架构决策全景矩阵

| 编号 | 决策主题 | 状态 | 关联 PRD | 核心决策与架构权衡 | 核心影响模块 |
| :--- | :--- | :---: | :---: | :--- | :--- |
| [0001](./0001-dual-mode-architecture.md) | **纯粹 Pi 原生扩展架构** | `Accepted` | PRD 0001 | 全面退役冗余的 Stdio MCP 服务与细碎 Agent Tools，纯原生 Node.js 实现，零运行时外部依赖，杜绝上下文污染。 | `src/index.ts`<br>`package.json` |
| [0002](./0002-zero-config-binary-resolution.md) | **零配置探测天梯与流式下载** | `Accepted` | PRD 0002 | 建立 5 级二进制寻址天梯（插件内置 -> 环境变量 -> PATH -> 系统常见预设 -> GitHub 流式下载），原子写入临时文件防损坏。 | `src/binary-resolver.ts`<br>`src/downloader.ts` |
| [0003](./0003-on-demand-web-lifecycle.md) | **Web 管理面板按需唤起** | `Accepted` | PRD 0004 | 探索按需唤起仪表盘机制，避免早期多服务并发占用端口，为后续单进程收敛奠定基础。 | `src/web-dashboard.ts` |
| [0004](./0004-multi-session-lifecycle-watcher.md) | **多会话协同与即刻销毁** | `Updated` | PRD 0003 | 废除驻留后台的独立 Watcher 守护进程；采用文件信标心跳计数，实现多 Pi 共享网关、僵死修剪与最后会话关闭即刻销毁。 | `src/session-coordinator.ts` |
| [0005](./0005-unified-service-process.md) | **Gateway 与 Web 单进程收敛** | `Accepted` | PRD 0001<br>PRD 0004 | 基于 Magpie 原生单进程多端口能力，通过 `magpie web` 一体化启动，网关默认迁至 8317 防冲突，注入动态 CSP 高强度随机密钥。 | `src/gateway-service.ts`<br>`src/web-dashboard.ts` |
| [0006](./0006-non-blocking-background-lifecycle.md) | **非阻塞异步拉起与解耦** | `Accepted` | PRD 0001 | 将宿主 `session_start` 事件处理改为纯异步非阻塞触发，杜绝 Magpie 冷启动或自动下载卡死 Pi TUI 与后续扩展派发。 | `src/index.ts`<br>`gateway-service.ts` |
| [0007](./0007-controlled-upgrade-and-restart-lifecycle.md) | **受控升级与生命周期重绑定** | `Accepted` | PRD 0005 | 规避自更新 PID 裂变导致的脱管孤儿常驻与 Windows 文件锁；通过 `/magpie upgrade` 先释放端口与锁，原生 CLI + 下载器双擎更新，重新拉起并重绑定新 PID，继承 WebKey。 | `src/gateway-service.ts`<br>`src/commands.ts`<br>`src/binary-resolver.ts` |

---

## ✍️ ADR 规范与编写约定

所有新建或修订的 ADR 统一置于 `docs/adr/` 目录下，遵循标准编号格式：`NNNN-title-in-kebab-case.md`。

每个 ADR 文档必须包含以下 6 大核心模块：
1. **标题与编号 (# N. Title)**：明确决策领域；
2. **状态 (Status)**：`Proposed`（提案中） / `Accepted`（已采纳） / `Superseded`（被废弃） / `Updated`（已演进更新）；
3. **决策背景与核心痛点 (Context & Problem Statement)**：清晰说明当时遇到了什么现实问题或缺陷；
4. **架构决策与选型 (Architecture Decision)**：详细阐述技术破局方案与契约；
5. **方案权衡与备选对比 (Trade-offs & Alternatives)**：说明否决了哪些备选方案及其原因；
6. **影响与收益 (Consequences & Benefits)**：正面成效与对现有模块的改动范围。
