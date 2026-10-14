import { exec } from "node:child_process";
import { promisify } from "node:util";
import { binaryResolver } from "./binary-resolver.ts";
import { configManager } from "./config.ts";

const execAsync = promisify(exec);

class GatewayClient {
  /**
   * 执行指定子命令并返回 stdout
   */
  async runCommand(subcmd: string): Promise<string> {
    const bin = await binaryResolver.resolveBinaryPath();
    const cmdStr = `"${bin}" ${subcmd}`;
    const { stdout } = await execAsync(cmdStr, {
      env: { ...process.env, MAGPIE_ADDR: configManager.getGatewayAddress() }
    });
    return stdout;
  }

  /**
   * 检查 magpie 网关健康状态（优先高频轻量 HTTP 探测，失败时降级 CLI 探活）
   */
  async isHealthy(): Promise<boolean> {
    const addr = configManager.getGatewayAddress();
    try {
      const res = await fetch(`http://${addr}/`, {
        method: "GET",
        signal: AbortSignal.timeout(800)
      });
      if (res.status === 200) {
        return true;
      }
    } catch {
      // HTTP 探测失败，降级执行 CLI healthcheck 保底
    }

    try {
      await this.runCommand("healthcheck");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取当前 Pi 使用的模型信息
   */
  async getCurrentPiModel(): Promise<string> {
    const stdout = await this.runCommand("pi");
    return stdout.trim();
  }
}

export const gatewayClient = new GatewayClient();
