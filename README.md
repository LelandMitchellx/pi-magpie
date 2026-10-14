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
- **最后会话归零即刻回收 (Instant Zero-Session Teardown)**：
  - 基于磁盘信标实时计数与自动修剪僵死 PID；
  - 当最后一个活跃的 Pi 会话退出时，就地即刻终止由 Pi 托管的 Magpie 进程树，不留任何孤儿驻留，**平时 0 资源占用**。
- **外部常驻隔离保护**：
  - 若启动前已在外部运行独立的 Magpie（如桌面客户端、系统守护进程或独立终端），插件仅复用不接管，任何 Pi 退出都不会误杀外部服务。
- **受控平滑升级与自愈重启 (Controlled Upgrade & Seamless Restart)**：
  - 支持 `/magpie upgrade` 一键升级，优先原生 CLI，内置下载器兜底，先停后更规避 Windows 文件写入锁；
  - 自动重绑定新 PID 与继承控制台鉴权密钥，确保退出 Pi 时准时销毁，永不沦为孤儿进程；
  - 支持 `/magpie restart` 快速受控重启并自愈接管。
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
在任何 Pi 交互会话中，支持以下受控指令：

* **查看状态与免密面板**：
  ```text
  /magpie
  ```
  扩展将立即输出网关概览通知与子命令操作指引：
  ```text
  网关地址: 127.0.0.1:8317
  网关状态: 🟢 正常运行 (Online)
  控制面板: 🟢 http://127.0.0.1:3430/?k=648c... (浏览器访问即可免密直达管理页面)
  控制台密钥: 🔑 648c08... (已自动拼入免密链接，亦可单独复制)
  网关归属: Pi 托管集群 (本会话启动, 活跃会话: 2 个 [1234, 5678])
  会话联动: 🟢 已开启 (支持多 Pi 共享，所有会话退出时即刻关闭)
  当前会话: PID 1234 (集群活跃 Pi: 2 个)
  当前模型: deepseek-chat
  操作指引: 可使用 /magpie upgrade 受控升级重启，或 /magpie restart 重新拉起
  ```

* **受控平滑升级**：
  ```text
  /magpie upgrade
  ```
  自动释放文件锁、检查并拉取最新版本（优先原生 CLI，内置下载器保底）、重新以受控状态拉起并同步新 PID，维持退出自动回收。

* **受控服务重启**：
  ```text
  /magpie restart
  ```
  遇到网关异常或配置变动时，一键优雅停止并重新拉起接管。

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

- [产品需求文档演进体系 (PRDs)](./docs/prd/README.md)：遵循 Matt 规范的分立演进需求矩阵（0001~0005）。
- [需求规格说明书 (Spec)](./docs/spec.md)：核心技术实现约定与架构细节。
- [统一领域术语表 (Glossary)](./docs/GLOSSARY.md)：团队标准术语。
- [架构决策记录体系 (ADRs)](./docs/adr/README.md)：演进脉络与技术决策矩阵（0001~0007）。
