import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

class ConfigManager {
  private autoStopOverride: boolean | undefined;
  readonly defaultWebPort = 3430;
  readonly defaultGatewayAddress = "127.0.0.1:8317";

  /**
   * 获取网关监听地址（优先环境变量 MAGPIE_ADDR，缺省 127.0.0.1:8317）
   */
  getGatewayAddress(): string {
    return process.env.MAGPIE_ADDR?.trim() || this.defaultGatewayAddress;
  }

  /**
   * 获取用户配置目录与配置文件路径 (~/.pi/agent/magpie-config.json)
   */
  getConfigFilePath(): string {
    const dir = join(homedir(), ".pi", "agent");
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        // 忽略无法创建目录
      }
    }
    return join(dir, "magpie-config.json");
  }

  /**
   * 读取是否开启生命周期跟随（退出时自动关闭本会话拉起的网关）
   */
  getAutoStop(): boolean {
    if (this.autoStopOverride !== undefined) {
      return this.autoStopOverride;
    }
    if (process.env.MAGPIE_AUTO_STOP !== undefined) {
      const val = process.env.MAGPIE_AUTO_STOP.trim().toLowerCase();
      if (val === "false" || val === "0" || val === "off" || val === "no") {
        return false;
      }
      return true;
    }
    try {
      const p = this.getConfigFilePath();
      if (existsSync(p)) {
        const raw = readFileSync(p, "utf-8");
        const data = JSON.parse(raw) as { autoStop?: boolean };
        if (typeof data.autoStop === "boolean") {
          return data.autoStop;
        }
      }
    } catch {
      // 忽略读取错误
    }
    return true; // 默认自动跟随宿主生命周期
  }

  /**
   * 保存生命周期跟随配置
   */
  setAutoStop(enabled: boolean): void {
    try {
      const p = this.getConfigFilePath();
      let data: Record<string, unknown> = {};
      if (existsSync(p)) {
        try {
          data = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
        } catch {
          data = {};
        }
      }
      data.autoStop = enabled;
      writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
      this.autoStopOverride = enabled;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`保存 magpie-config.json 失败: ${msg}`);
    }
  }
}

export const configManager = new ConfigManager();
