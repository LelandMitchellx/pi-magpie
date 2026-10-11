import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ManagedServiceInfo {
  magpiePid: number;
  startedByPiPid: number;
  webKey?: string;
  createdAt: string;
}

export interface ClientSessionInfo {
  pid: number;
  registeredAt: string;
}

export class SessionCoordinator {
  private baseDir: string;
  private clientsDir: string;
  private managedFilePath: string;

  constructor(customBaseDir?: string) {
    this.baseDir = customBaseDir || join(homedir(), ".pi", "agent");
    this.clientsDir = join(this.baseDir, "magpie-clients");
    this.managedFilePath = join(this.baseDir, "magpie-managed.json");
    this.ensureDirs();
  }

  private ensureDirs(): void {
    if (!existsSync(this.baseDir)) {
      try {
        mkdirSync(this.baseDir, { recursive: true });
      } catch {
        // ignore
      }
    }
    if (!existsSync(this.clientsDir)) {
      try {
        mkdirSync(this.clientsDir, { recursive: true });
      } catch {
        // ignore
      }
    }
  }

  /**
   * 检查指定 PID 是否仍然存活（跨平台）
   */
  isPidAlive(pid: number): boolean {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      return code === "EPERM";
    }
  }

  /**
   * 跨平台终止指定 PID 进程树
   */
  killProcessTree(pid: number): boolean {
    if (!pid || pid <= 0) return false;
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true
        });
      } else {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          process.kill(pid, "SIGTERM");
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查是否启用了会话自动退出（默认 true，若用户配置 autoStop: false 则返回 false）
   */
  isAutoStopEnabled(): boolean {
    try {
      const configFilePath = join(this.baseDir, "magpie-config.json");
      if (existsSync(configFilePath)) {
        const cfg = JSON.parse(readFileSync(configFilePath, "utf8"));
        if (cfg && cfg.autoStop === false) return false;
      }
    } catch {
      // ignore
    }
    return true;
  }

  /**
   * 注册当前 Pi 会话
   */
  registerClient(pid = process.pid): void {
    this.ensureDirs();
    const filePath = join(this.clientsDir, `${pid}.json`);
    const info: ClientSessionInfo = {
      pid,
      registeredAt: new Date().toISOString()
    };
    try {
      writeFileSync(filePath, JSON.stringify(info, null, 2), "utf-8");
    } catch {
      // ignore
    }
  }

  /**
   * 注销指定或当前 Pi 会话
   */
  unregisterClient(pid = process.pid): void {
    const filePath = join(this.clientsDir, `${pid}.json`);
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {
      // ignore
    }
  }

  /**
   * 扫描客户端目录，剔除僵死客户端，返回当前存活的客户端 PID 列表
   */
  pruneAndGetActiveClients(): number[] {
    this.ensureDirs();
    const activePids: number[] = [];
    try {
      const files = readdirSync(this.clientsDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const pid = parseInt(file.replace(".json", ""), 10);
        if (!pid || isNaN(pid)) continue;

        if (this.isPidAlive(pid)) {
          activePids.push(pid);
        } else {
          // 剔除已退出的僵死 PID 记录
          try {
            unlinkSync(join(this.clientsDir, file));
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
    return activePids;
  }

  /**
   * 读取受托管服务元数据（如果存在且有效）
   */
  getManagedService(): ManagedServiceInfo | null {
    try {
      if (!existsSync(this.managedFilePath)) return null;
      const raw = readFileSync(this.managedFilePath, "utf-8");
      const info = JSON.parse(raw) as ManagedServiceInfo;
      if (info && info.magpiePid && this.isPidAlive(info.magpiePid)) {
        return info;
      }
      // 如果记载的 Magpie 进程已经不存在，清理无效元数据
      this.clearManagedService();
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 写入受托管服务元数据
   */
  setManagedService(info: ManagedServiceInfo): void {
    this.ensureDirs();
    try {
      writeFileSync(this.managedFilePath, JSON.stringify(info, null, 2), "utf-8");
    } catch {
      // ignore
    }
  }

  /**
   * 清除受托管服务元数据
   */
  clearManagedService(): void {
    try {
      if (existsSync(this.managedFilePath)) {
        unlinkSync(this.managedFilePath);
      }
    } catch {
      // ignore
    }
  }

  /**
   * 当一个 Pi 会话注销时调用。
   * 如果存活的 Pi 客户端归零，且当前服务由 Pi 托管，立即终止 Magpie 进程树并清理元数据。
   */
  terminateManagedServiceIfLastClient(pid = process.pid): boolean {
    this.unregisterClient(pid);
    const activeClients = this.pruneAndGetActiveClients();

    if (activeClients.length === 0) {
      if (!this.isAutoStopEnabled()) {
        this.clearManagedService();
        return false;
      }

      const managed = this.getManagedService();
      if (managed && managed.magpiePid) {
        this.killProcessTree(managed.magpiePid);
        this.clearManagedService();
        return true;
      }
    }

    return false;
  }
}

export const sessionCoordinator = new SessionCoordinator();
