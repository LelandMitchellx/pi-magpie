import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { magpieDownloader, type DownloadProgress } from "./downloader.ts";

const execAsync = promisify(exec);

class BinaryResolver {
  private cachedBinaryPath: string | null = null;

  /**
   * 智能解析或自动下载 Magpie 可执行文件
   * 严格遵循 5 级优先级探测天梯：
   * 0. 插件目录自带的 bin/magpie(.exe)
   * 1. 显式环境变量 MAGPIE_PATH
   * 2. 系统全局 PATH 中的 magpie
   * 3. 操作系统常见预设安装目录
   * 4. 自动从 GitHub Releases 流式下载到插件的 bin 目录下！
   */
  async resolveBinaryPath(onProgress?: (progress: DownloadProgress) => void): Promise<string> {
    if (this.cachedBinaryPath && existsSync(this.cachedBinaryPath)) {
      return this.cachedBinaryPath;
    }

    // 0. 插件自身目录下的私有安装副本
    const localInfo = magpieDownloader.getTargetExecutableInfo();
    if (existsSync(localInfo.localPath)) {
      this.cachedBinaryPath = localInfo.localPath;
      return this.cachedBinaryPath;
    }

    // 1. 环境变量显式指定
    if (process.env.MAGPIE_PATH && existsSync(process.env.MAGPIE_PATH)) {
      this.cachedBinaryPath = process.env.MAGPIE_PATH;
      return this.cachedBinaryPath;
    }

    // 2. 系统全局 PATH 探测
    try {
      const probeCmd = process.platform === "win32" ? "where.exe magpie" : "which magpie";
      const { stdout } = await execAsync(probeCmd);
      const firstLine = stdout.trim().split(/\r?\n/)[0]?.trim();
      if (firstLine && existsSync(firstLine)) {
        this.cachedBinaryPath = firstLine;
        return this.cachedBinaryPath;
      }
    } catch {
      // PATH 中未找到，继续探测
    }

    // 3. 常见候选安装路径深度扫描
    const candidatePaths: string[] = [];
    if (process.platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
      candidatePaths.push(
        join(localAppData, "Programs", "magpie.cmd"),
        join(localAppData, "Programs", "magpie-windows-amd64.exe"),
        join(localAppData, "Programs", "magpie", "magpie.exe")
      );
    } else if (process.platform === "darwin") {
      candidatePaths.push(
        "/Applications/Magpie.app/Contents/MacOS/magpie",
        join(homedir(), "Applications/Magpie.app/Contents/MacOS/magpie"),
        join(homedir(), ".local/bin/magpie"),
        "/usr/local/bin/magpie",
        "/opt/homebrew/bin/magpie"
      );
    } else {
      candidatePaths.push(
        join(homedir(), ".local/bin/magpie"),
        "/usr/local/bin/magpie",
        "/usr/bin/magpie"
      );
    }

    for (const candidate of candidatePaths) {
      if (existsSync(candidate)) {
        this.cachedBinaryPath = candidate;
        return this.cachedBinaryPath;
      }
    }

    // 4. 全部未命中：自动从 GitHub Releases 下载到插件目录！
    try {
      const installedPath = await magpieDownloader.downloadAndInstall(onProgress);
      this.cachedBinaryPath = installedPath;
      return this.cachedBinaryPath;
    } catch (downloadErr: unknown) {
      const msg = downloadErr instanceof Error ? downloadErr.message : String(downloadErr);
      throw new Error(
        `系统未找到 Magpie 且自动从 GitHub Releases 下载失败: ${msg}。请手动安装或配置 MAGPIE_PATH。`
      );
    }
  }

  /**
   * 使用 Magpie 原生 CLI 执行更新检查或安装
   * 优先尝试原生 `magpie update`，失败时可由 downloader 兜底
   */
  async runNativeUpdate(): Promise<{ success: boolean; output: string; isLatest: boolean }> {
    const bin = await this.resolveBinaryPath();
    try {
      const { stdout, stderr } = await execAsync(`"${bin}" update`, {
        timeout: 90000,
        env: { ...process.env }
      });
      const combined = `${stdout}\n${stderr}`.trim();
      const isLatest = combined.includes("is the latest") || combined.includes("已经是最新");
      return { success: true, output: combined, isLatest };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: msg, isLatest: false };
    }
  }

  /**
   * 手动强制触发更新/重新下载到插件目录
   */
  async forceInstallPluginBinary(onProgress?: (progress: DownloadProgress) => void): Promise<string> {
    const installedPath = await magpieDownloader.downloadAndInstall(onProgress);
    this.cachedBinaryPath = installedPath;
    return installedPath;
  }
}

export const binaryResolver = new BinaryResolver();
