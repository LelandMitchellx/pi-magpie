# pi-magpie 🐬

专为 [Pi Coding Agent](https://pi.dev/) 打造的轻量级、**零运行时依赖**原生扩展插件，提供本地 [Magpie](https://github.com/yetone/magpie) AI 路由网关的静默自愈、多会话协同保活与控制面板直达支持。

---

## ✨ 核心特性

- **零依赖极简架构 (Zero Dependencies)**：
  - `package.json` 中的 `dependencies` 为空，纯原生 Node.js 实现；
  - 装载启动极速，无第三方 SDK 冗余包体。
- **零上下文污染 (Zero Context Overhead)**：
  - 不向 AI Agent 暴露繁杂的管理 Tool，不浪费宝贵的 Context Token；
  - 对话 Prompt 纯粹干净，杜绝 Agent 误调用后台运维命令。
- **开箱即用与静默自愈 (Zero-Config Auto-Heal)**：
  - 在 Pi 会话启动时自动探活，离线时静默在后台拉起统一守护服务；
  - 具备 5 级探测天梯（私有目录 → PATH → 环境变量 → GitHub Releases 保底自动下载）。
- **多终端多会话协同保活 (Multi-Session Autonomous)**：
  - 在多个终端窗口或 tmux pane 中并发打开 `pi` 时，自动通过客户端信标协同共享同一网关；
  - 关闭其中任意一个窗口绝不影响其他活跃窗口的正常对话。
- **独立 Watcher 守护与防抖回收 (Debounced Grace Period)**：
  - 后台派生完全解耦的 Detached Watcher 守护进程，实时探活与修剪僵死会话；
  - 当所有 Pi 窗口全部关闭后，进入 **3.5 秒防抖宽限期**；快速重启不震荡，超时后彻底回收后台进程树，**平时 0 系统资源占用**。
- **外部常驻隔离保护**：
  - 若启动前已在外部运行独立的 `magpie serve`，插件仅复用不接管，任何 Pi 退出都不会误杀外部服务。
- **极简一体化指令 (`/magpie`)**：
  - 告别繁琐子命令，单次执行联合输出：健康状态、网关地址、集群活跃数、当前模型以及 Web 控制台访问超链接。

---

## 🚀 安装与启用

### 方式一：本地源码软链安装 (推荐开发调试)
```bash
git clone https://github.com/yetone/pi-magpie.git
cd pi-magpie
npm install
pi install -e .
```

### 类型检查
```bash
npm run typecheck
```

---

## 💡 使用说明

### 1. 终端斜杠命令 (`/magpie`)
在任何 Pi 交互会话中，直接输入：
```text
/magpie
```
扩展将立即输出网关概览通知：
```text
网关地址: 127.0.0.1:8317
网关状态: 🟢 正常运行 (Online)
控制面板: 🟢 http://127.0.0.1:3430/?k=648c... (浏览器访问即可免密直达管理页面)
控制台密钥: 🔑 648c08... (已自动拼入免密链接，亦可单独复制)
网关归属: Pi 托管集群 (本会话启动, 活跃会话: 2 个 [1234, 5678], Watcher PID: 9101)
会话联动: 🟢 已开启 (支持多 Pi 共享，所有会话退出时自动防抖回收)
当前会话: PID 1234 (集群活跃 Pi: 2 个)
当前模型: deepseek-chat
```

### 2. 访问 Web 控制台
需要配置模型、调整思考级别（Reasoning Effort）或查看各家供应商详细额度与账单时：
在浏览器中打开 **`http://localhost:3430`** 即可进行全可视化操作。

---

## ⚙️ 环境变量与高级配置

| 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `MAGPIE_ADDR` | `127.0.0.1:8317` | 自定义 Magpie 网关监听地址；若需接入历史默认 3425 端口，设为 `127.0.0.1:3425` 即可 |
| `MAGPIE_PATH` | (自动探测) | 显式指定本地 `magpie` 可执行文件绝对路径 |
| `MAGPIE_WEB_KEY` | (随机生成) | 自定义固定 Web 控制台访问密钥；留空则每次启动自动生成并写入信标 |
| `MAGPIE_AUTO_STOP` | `true` | 是否在所有 Pi 退出后自动回收后台进程；设为 `0` 或 `false` 可保持后台常驻 |

---

## 🏛️ 架构与文档索引

- [产品需求文档 (PRD)](./docs/PRD.md)：业务场景、用户旅程与成功指标。
- [需求规格说明书 (Spec)](./docs/spec.md)：核心技术实现约定与架构细节。
- [统一领域术语表 (Glossary)](./docs/GLOSSARY.md)：团队标准术语。
- [架构决策记录 (ADR)](./docs/adr/)：
  - [ADR 0001: 纯粹 Pi 原生扩展架构设计决策](./docs/adr/0001-dual-mode-architecture.md)
  - [ADR 0002: 零配置二进制探测天梯与自动流式下载](./docs/adr/0002-zero-config-binary-resolution.md)
  - [ADR 0003: Web 管理面板按需唤起机制](./docs/adr/0003-on-demand-web-lifecycle.md)
  - [ADR 0004: 多会话生命周期共享与独立 Watcher 守护机制](./docs/adr/0004-multi-session-lifecycle-watcher.md)
