import { createWriteStream, existsSync, chmodSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import https from "node:https";
import http from "node:http";
import { dirname, join } from "node:path";
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
        const tag = parts[parts.length - 1];
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

    await this.downloadFileWithRedirects(downloadUrl, tempPath, onProgress);

    // 重命名临时文件为正式可执行文件
    const { rename } = await import("node:fs/promises");
    await rename(tempPath, localPath);

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
   * 支持多层 302/301 重定向与断点重试的文件流式下载
   */
  private downloadFileWithRedirects(
    url: string,
    destPath: string,
    onProgress?: (progress: DownloadProgress) => void,
    maxRedirects = 6
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (maxRedirects <= 0) {
        return reject(new Error("Too many redirects while downloading Magpie release."));
      }

      const client = url.startsWith("https") ? https : http;
      const req = client.get(
        url,
        {
          headers: {
            "User-Agent": "pi-magpie-plugin/0.1.0 (https://github.com/yetone/magpie)"
          }
        },
        (res) => {
          // 处理 301 / 302 / 307 / 308 重定向
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, url).toString();
            res.resume();
            return this.downloadFileWithRedirects(redirectUrl, destPath, onProgress, maxRedirects - 1)
              .then(resolve)
              .catch(reject);
          }

          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`Download failed with HTTP status code ${res.statusCode}`));
          }

          const total = parseInt(res.headers["content-length"] || "0", 10);
          let received = 0;
          const fileStream = createWriteStream(destPath);

          res.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (onProgress && total > 0) {
              const percent = Math.min(100, Math.round((received / total) * 100));
              onProgress({ received, total, percent });
            }
          });

          res.pipe(fileStream);

          fileStream.on("finish", () => {
            fileStream.close(() => resolve());
          });

          fileStream.on("error", (err) => {
            fileStream.close(() => reject(err));
          });
        }
      );

      req.on("error", (err) => reject(err));
      req.setTimeout(30000, () => {
        req.destroy(new Error("Connection timed out while downloading Magpie."));
      });
    });
  }
}

export const magpieDownloader = new MagpieDownloader();
