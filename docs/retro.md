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
- **工程解法**：在 `downloader.ts` 中实现了递归跟随重定向机制（支持最高 6 跳），流式直写目标路径，并通过 `.downloading` 临时文件名防重入，确保下载完成并通过大小校验后再重命名为正式文件。

---

## 3. 跨平台二进制命名规范与 Unix 执行权限
- **踩坑现象**：从 GitHub Releases 自动拉取资产时，不同操作系统的包命名格式各不相同，且在 Linux/macOS 下载完成后直接 `spawn` 会报错 `EACCES`（无执行权限）。
- **根因剖析**：
  - Windows 发布包名为 `magpie-windows-amd64.exe`，可执行文件带扩展名；
  - macOS 发布包名为 `magpie-cli-darwin-arm64` / `magpie-cli-darwin-amd64`；
  - Linux 发布包名为 `magpie-linux-amd64`；
  - 通过 HTTP 流写入的文件在类 Unix 系统中默认只有只读/只写权限（如 0644），缺少可执行位（+x）。
- **工程解法**：编写平台与架构匹配矩阵映射正确的 Asset 名称，并在 Unix 环境下载完成后，主动调用 `chmodSync(localPath, 0o755)` 补齐可执行权限。

---

## 4. Stdio MCP 运行模式下的 `stdout` 协议帧污染
- **踩坑现象**：当将插件作为独立 MCP Server 挂载到外部客户端时，初始化握手偶发 JSON 解析失败。
- **根因剖析**：标准 MCP 协议在 stdio 模式下，将进程的 `stdout` 作为绝对严格的 JSON-RPC 消息传输通道。如果在 CLI 执行、日志打印或下载进度通知中不小心用了 `console.log` 输出纯文本，这些文本就会混入 `stdout`，导致客户端的反序列化器崩溃。
- **工程解法**：所有非 JSON-RPC 响应的辅助日志、调试输出与警告全部严格重定向到 `stderr`（`process.stderr.write`），确保 `stdout` 只传输合法的 JSON-RPC 报文。
