# AGENTS.md

AI Agent 在 `pi-magpie` 代码库中作业时的核心上下文指南。

## 项目定位与架构全景

`pi-magpie` 是专为 [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) 打造的轻量级、零运行时依赖的原生扩展插件，负责将本地 [Magpie](https://github.com/yetone/magpie) AI 路由网关与 Web 控制台无缝桥接到 Pi 交互环境中。

- **扩展入口 (Registration)**：
  - `src/index.ts`：Pi 原生扩展唯一入口，仅负责注册装配：挂载 `/magpie` 命令、`session_start` 保活与退出信号钩子。
- **核心领域层 (Domain Modules)**：
  - `src/commands.ts`：交互命令领域，处理 `/magpie` Slash 指令与运行状态卡片格式化呈现，分发 `upgrade`、`update` 与 `restart` 子命令。
  - `src/gateway-service.ts`：服务生命周期领域，负责后台进程拉起、单例防并发竞争、双重探活、受托关闭、受控平滑升级与句柄重绑定。
  - `src/web-dashboard.ts`：Web 控制面板领域，管理高强度密钥生成、带参免密直达链接拼接与浏览器唤起。
  - `src/gateway-client.ts`：命令探活领域，封装 `healthcheck` 与模型/配额 CLI 查询。
  - `src/binary-resolver.ts`：二进制寻址领域，执行 5 级探测天梯解析并支持原生 CLI 升级与自动下载兜底。
  - `src/config.ts`：配置管理领域，负责网关地址、`autoStop` 配置读写持久化与环境变量覆盖。
  - `src/downloader.ts`：流式下载领域，GitHub Releases 资产自动拉取、解压与原子落盘。
  - `src/session-coordinator.ts`：会话协同领域，管理 `magpie-clients/` 信标、修剪僵死 PID 与归零即刻销毁。
  - `src/magpie-cli.ts`：门面适配器 (Facade)，聚合各底层领域服务并提供平滑向后兼容接口。

## 交互设计原则 (CLI & Tools)

- **零上下文污染 (Zero Tool Context Overhead)**：不向 AI Agent 暴露冗余的管理 Tool，彻底保持 Prompt 与上下文纯净。
- **极简 Slash 指令**：仅保留 `/magpie` 指令作为统一入口，无参数执行后联合输出当前网关运行状态、集群活跃会话及 Web 控制面板超链接（`http://localhost:3430`）；支持 `/magpie upgrade` 受控闭环平滑升级，以及 `/magpie restart` 快速安全重启。

## 规范文档与架构指南索引 (Context Pointers)

- [统一领域术语表](./docs/GLOSSARY.md)：团队与 Agent 共同遵循的领域语言规范。
- [产品需求演进体系 (PRDs)](./docs/prd/README.md)：遵循 Matt 规范的分立演进需求矩阵（0001~0005）。
- [技术规格说明书](./docs/spec.md)：底层架构设计与模块技术契约。
- [架构决策记录体系 (ADRs)](./docs/adr/README.md)：演进脉络与技术决策矩阵（0001~0007）。
- [工程实战复盘与踩坑记录](./docs/retro.md)：技术细节与跨平台踩坑经验。

## 二进制探测天梯规则

在 `MagpieCLI.resolveBinaryPath` 中严格执行以下 5 级优先级：
1. **插件内置目录**：`pi-magpie/bin/magpie.exe`（Unix 上为 `magpie`）。
2. **显式环境变量**：`process.env.MAGPIE_PATH`。
3. **系统全局 PATH**：Windows 下探测 `where.exe magpie`，Unix 下探测 `which magpie`。
4. **操作系统常见预设安装目录**：例如 `%LOCALAPPDATA%\Programs`。
5. **保底自动下载**：流式下载 GitHub Releases 资产并直接落盘至插件内置 `bin/`。

## 核心开发与编码约定

- **禁止未处理的异步异常 (Zero Unhandled Rejections)**：子进程拉起与探活必须全程 try/catch，网关保活绝不能阻断或延缓 Pi 宿主启动。
- **零外部运行时依赖**：`package.json` 中的 `dependencies` 保持为空，纯原生 Node.js 实现。
- **原子性落盘**：流式下载必须先写入 `.downloading` 临时文件，下载并通过校验后再执行重命名。
- **协议规范导入**：统一使用 Node 协议导入标准模块（如 `node:child_process`, `node:fs` 等）。
- **严格类型守卫**：严禁出现 `any`，catch 块统一声明为 `unknown` 并通过 `err instanceof Error` 进行收窄。

## 快速验证命令

- 构建验证：`npm run typecheck`
- 插件测试：`pi install -e .`
