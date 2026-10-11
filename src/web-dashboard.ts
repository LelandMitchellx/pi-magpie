import { exec } from "node:child_process";
import { promisify } from "node:util";
import { configManager } from "./config.ts";
import { sessionCoordinator } from "./session-coordinator.ts";

const execAsync = promisify(exec);

class WebDashboard {
  private activeWebKey: string | null = null;

  setWebKey(key: string): void {
    this.activeWebKey = key;
  }

  clearWebKey(): void {
    this.activeWebKey = null;
  }

  /**
   * 获取当前有效受托管的 Web 访问密钥
   * 优先级：环境变量 MAGPIE_WEB_KEY -> 实例活跃密钥 -> 托管元数据中的密钥
   */
  getWebKey(): string | null {
    if (process.env.MAGPIE_WEB_KEY?.trim()) {
      return process.env.MAGPIE_WEB_KEY.trim();
    }
    if (this.activeWebKey) return this.activeWebKey;
    const managed = sessionCoordinator.getManagedService();
    return managed?.webKey || null;
  }

  /**
   * 获取 Web 面板访问完整 URL（若存在密钥自动拼装免密登录参数 ?k=...）
   */
  getWebUrl(): string {
    const baseUrl = `http://127.0.0.1:${configManager.defaultWebPort}/`;
    const key = this.getWebKey();
    return key ? `${baseUrl}?k=${key}` : baseUrl;
  }

  /**
   * 打开默认系统浏览器访问指定 URL
   */
  async openBrowser(url: string): Promise<void> {
    if (process.platform === "win32") {
      await execAsync(`start "" "${url}"`);
    } else if (process.platform === "darwin") {
      await execAsync(`open "${url}"`);
    } else {
      await execAsync(`xdg-open "${url}"`);
    }
  }

  /**
   * 打开管理页面
   */
  async openWeb(): Promise<{ url: string; opened: boolean; message: string }> {
    const url = this.getWebUrl();
    try {
      await this.openBrowser(url);
      return { url, opened: true, message: `已在浏览器打开 Web 控制面板: ${url}` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { url, opened: false, message: `打开浏览器失败: ${msg}` };
    }
  }
}

export const webDashboard = new WebDashboard();
