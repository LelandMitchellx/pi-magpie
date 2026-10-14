import { createWriteStream, existsSync, chmodSync } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DownloadProgress {
  received: number;
  total: number;
  percent: number;
}

export class MagpieDownloader {
  private readonly defaultFallbackTag = "v0.1.1197";

  /**
   * 获取插件内部本地安装目录
   */
  getPluginBinDir(): string {
    return join(__dirname, "..", "bin");
  }

  /**
   * 获取当前系统预期的可执行文件名称与本地目标路径
   */
  getTargetExecutableInfo(): { assetName: string; localPath: string } {
    const platform = process.platform;
    const arch = process.arch;

    let assetName = "";
    let localFileName = "";

    if (platform === "win32") {
      assetName = arch === "arm64" ? "magpie-cli-windows-arm64.exe" : "magpie-cli-windows-amd64.exe";
      localFileName = "magpie.exe";
    } else if (platform === "darwin") {
      assetName = arch === "arm64" ? "magpie-cli-darwin-arm64" : "magpie-cli-darwin-amd64";
      localFileName = "magpie";
    } else {
      assetName = arch === "arm64" ? "magpie-cli-linux-arm64" : "magpie-cli-linux-amd64";
      localFileName = "magpie";
    }

    const localPath = join(this.getPluginBinDir(), localFileName);
    return { assetName, localPath };
  }

  /**
   * 检查插件目录下是否已经自动安装好
   */
  isLocallyInstalled(): boolean {
    const { localPath } = this.getTargetExecutableInfo();
    return existsSync(localPath);
  }

  /**
   * 获取 GitHub Releases 最新 Tag
   */
  async getLatestTag(): Promise<string> {
    try {
      const res = await fetch("https://github.com/yetone/magpie/releases/latest", {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(5000)
      });
      const location = res.headers.get("location");
      if (location) {
        const parts = location.split("/");
        const tag = parts.at(-1);
        if (tag) return tag;
      }
    } catch (err: unknown) {
      void err;
    }
    return this.defaultFallbackTag;
  }

  /**
   * 自动下载并安装到插件的 bin 目录
   */
  async downloadAndInstall(
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<string> {
    const { assetName, localPath } = this.getTargetExecutableInfo();
    const binDir = this.getPluginBinDir();
    await mkdir(binDir, { recursive: true });

    const tag = await this.getLatestTag();
    const downloadUrl = `https://github.com/yetone/magpie/releases/download/${tag}/${assetName}`;

    const tempPath = `${localPath}.downloading`;

    try {
      await this.downloadFileWithFetch(downloadUrl, tempPath, onProgress);
      // 重命名临时文件为正式可执行文件
      await rename(tempPath, localPath);
    } catch (err: unknown) {
      if (existsSync(tempPath)) {
        await unlink(tempPath).catch(() => {});
      }
      throw err;
    }

    // 在 Unix 系统上赋予可执行权限
    if (process.platform !== "win32") {
      try {
        chmodSync(localPath, 0o755);
      } catch (chmodErr: unknown) {
        void chmodErr;
      }
    }

    return localPath;
  }

  /**
   * 基于原生 fetch 与 Stream Pipeline 的流式文件下载（原生自动重定向，支持进度监听）
   */
  private async downloadFileWithFetch(
    url: string,
    destPath: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "pi-magpie-plugin/0.1.0 (https://github.com/yetone/magpie)"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(60000)
      });

      if (!res.ok) {
        throw new Error(`Download failed with HTTP status code ${res.status}`);
      }

      if (!res.body) {
        throw new Error("Download response body is empty");
      }

      const contentLength = res.headers.get("content-length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let received = 0;

      const progressTracker = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length;
          if (onProgress && total > 0) {
            const percent = Math.min(100, Math.round((received / total) * 100));
            onProgress({ received, total, percent });
          }
          callback(null, chunk);
        }
      });

      const fileStream = createWriteStream(destPath);
      const webStream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);

      await pipeline(webStream, progressTracker, fileStream);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Magpie 自动下载失败: ${msg}`, { cause: err });
    }
  }
}

export const magpieDownloader = new MagpieDownloader();
