import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { binaryResolver } from "./binary-resolver.ts";
import { configManager } from "./config.ts";
import type { DownloadProgress } from "./downloader.ts";
import { gatewayClient } from "./gateway-client.ts";
import { sessionCoordinator } from "./session-coordinator.ts";
import { webDashboard } from "./web-dashboard.ts";

export interface EnsureGatewayOptions {
  onStarting?: () => void;
  onProgress?: (progress: DownloadProgress) => void;
}

class GatewayService {
  private serviceProcess: ChildProcess | null = null;
  private serviceOwnsGateway = false;
  private serviceStart: Promise<{ running: boolean; message: string; spawned: boolean }> | null = null;
  private serviceGeneration = 0;

  hasSpawnedGateway(): boolean {
    return this.serviceOwnsGateway && this.hasSpawnedWeb();
  }

  getSpawnedGatewayPid(): number | undefined {
    return this.hasSpawnedGateway() ? this.serviceProcess?.pid : undefined;
  }

  hasSpawnedWeb(): boolean {
    return this.serviceProcess !== null && this.serviceProcess.pid !== undefined
      && this.serviceProcess.exitCode === null && this.serviceProcess.signalCode === null
      && !this.serviceProcess.killed;
  }

  getSpawnedWebPid(): number | undefined {
    return this.hasSpawnedWeb() ? this.serviceProcess?.pid : undefined;
  }

  /**
   * 确保网关正在运行；由单个 magpie web 进程提供
   */
  async ensureGateway(options?: EnsureGatewayOptions): Promise<{ running: boolean; message: string; spawned: boolean }> {
    return this.ensureService(false, options);
  }

  async isWebResponding(): Promise<boolean> {
    try {
      await fetch(`http://127.0.0.1:${configManager.defaultWebPort}/`, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(1000)
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 确保服务运行并按需拉起（带防并发锁）
   */
  async ensureService(requireWeb: boolean, options?: EnsureGatewayOptions): Promise<{ running: boolean; message: string; spawned: boolean }> {
    const generation = this.serviceGeneration;
    while (this.serviceStart) {
      await this.serviceStart;
    }
    if (generation !== this.serviceGeneration) {
      return { running: false, message: "Magpie 启动已取消。", spawned: false };
    }
    this.serviceStart = this.startService(requireWeb, generation, options);
    try {
      return await this.serviceStart;
    } finally {
      this.serviceStart = null;
    }
  }

  private async startService(
    requireWeb: boolean,
    generation: number,
    options?: EnsureGatewayOptions
  ): Promise<{ running: boolean; message: string; spawned: boolean }> {
    try {
      // 1. 检查网关是否已处于在线状态
      const gatewayOnline = await gatewayClient.isHealthy();
      if (gatewayOnline) {
        const managed = sessionCoordinator.getManagedService();
        if (managed) {
          sessionCoordinator.registerClient();
          if (managed.webKey) {
            webDashboard.setWebKey(managed.webKey);
          }
          return { running: true, message: "已复用活跃的 Pi 托管 Magpie 网关。", spawned: false };
        }
        if (!requireWeb) {
          return { running: true, message: "Magpie gateway is already online.", spawned: false };
        }
      }

      if (await this.isWebResponding()) {
        const managed = sessionCoordinator.getManagedService();
        if (managed) {
          sessionCoordinator.registerClient();
          if (managed.webKey) {
            webDashboard.setWebKey(managed.webKey);
          }
        }
        return {
          running: gatewayOnline || requireWeb,
          message: gatewayOnline ? "Magpie Gateway 与 Web 已运行。" : "Web 端口已被占用，网关未就绪；不会接管或另启进程。",
          spawned: false
        };
      }

      if (this.hasSpawnedWeb()) {
        return { running: false, message: "本会话 Magpie 进程仍在运行，但服务未就绪。", spawned: false };
      }

      options?.onStarting?.();

      const bin = await binaryResolver.resolveBinaryPath(options?.onProgress);
      if (generation !== this.serviceGeneration) {
        return { running: false, message: "Magpie 启动已取消。", spawned: false };
      }
      const key = process.env.MAGPIE_WEB_KEY?.trim() || randomBytes(32).toString("hex");
      const child = spawn(bin, ["web", "--addr", `127.0.0.1:${configManager.defaultWebPort}`, "--no-open"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(bin),
        env: { ...process.env, MAGPIE_ADDR: configManager.getGatewayAddress(), MAGPIE_WEB_KEY: key }
      });
      this.serviceProcess = child;
      this.serviceOwnsGateway = true;
      webDashboard.setWebKey(key);

      let launchError: string | undefined;
      child.once("error", (err: Error) => {
        launchError = err.message;
        this.clearService(child);
      });
      child.once("exit", () => this.clearService(child));
      child.unref();

      // 弹性探测窗口：每次 500ms，最多探测 30 次（最长 15 秒）
      // 在 Windows 或冷启动网络请求 (如 Google Antigravity) 场景下，Magpie 启动通常需 4~9 秒
      const maxRetries = 30;
      for (let i = 0; i < maxRetries; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (this.serviceProcess !== child) {
          return { running: false, message: `Magpie 启动失败或已停止${launchError ? `: ${launchError}` : "。"}`, spawned: false };
        }
        const [gatewayReady, webReady] = await Promise.all([gatewayClient.isHealthy(), this.isWebResponding()]);
        if (gatewayReady && webReady && this.serviceProcess === child && child.pid) {
          sessionCoordinator.setManagedService({
            magpiePid: child.pid,
            startedByPiPid: process.pid,
            createdAt: new Date().toISOString(),
            webKey: key
          });
          sessionCoordinator.registerClient();
          return { running: true, message: `Magpie Gateway 与 Web 服务已启动 (PID: ${child.pid})。`, spawned: true };
        }
      }

      this.stopGateway(true);
      return { running: false, message: "Magpie 启动超时，服务未就绪。", spawned: false };
    } catch (err: unknown) {
      this.stopGateway(true);
      const msg = err instanceof Error ? err.message : String(err);
      return { running: false, message: `启动 Magpie 失败: ${msg}`, spawned: false };
    }
  }

  private clearService(child: ChildProcess): void {
    if (this.serviceProcess === child) {
      this.serviceProcess = null;
      this.serviceOwnsGateway = false;
      this.serviceGeneration++;
      webDashboard.clearWebKey();
    }
  }

  /**
   * 停止网关
   */
  stopGateway(force = false): { stopped: boolean; message: string } {
    this.serviceGeneration++;
    const child = this.serviceProcess;
    const managed = sessionCoordinator.getManagedService();
    const hasSpawned = this.hasSpawnedWeb();
    const isStarter = managed?.startedByPiPid === process.pid;

    if (!force && !hasSpawned && !isStarter) {
      return { stopped: false, message: "当前 Magpie 服务不是由当前 Pi 会话拉起，未执行停止。" };
    }

    const targetPid = child?.pid || managed?.magpiePid;
    if (!targetPid) {
      return { stopped: false, message: "未检测到由 Pi 托管的 Magpie 进程。" };
    }

    try {
      sessionCoordinator.killProcessTree(targetPid);
      sessionCoordinator.clearManagedService();
      if (child) {
        this.clearService(child);
      }
      return { stopped: true, message: `Magpie 服务已停止，Web 与自有网关同时关闭 (PID: ${targetPid})。` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { stopped: false, message: `终止 Magpie 服务失败: ${msg}` };
    }
  }

  /**
   * 会话退出清理逻辑：注销当前 Pi，若活跃会话归零则立刻终止托管网关
   */
  handleSessionShutdown(): void {
    if (this.serviceProcess) {
      this.clearService(this.serviceProcess);
    }
    sessionCoordinator.terminateManagedServiceIfLastClient();
  }
}

export const gatewayService = new GatewayService();
