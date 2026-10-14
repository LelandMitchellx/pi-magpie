import { binaryResolver } from "./binary-resolver.ts";
import { configManager } from "./config.ts";
import type { DownloadProgress } from "./downloader.ts";
import { gatewayClient } from "./gateway-client.ts";
import { gatewayService, type EnsureGatewayOptions, type SessionNotifyContext } from "./gateway-service.ts";
import { sessionCoordinator, type ManagedServiceInfo } from "./session-coordinator.ts";
import { webDashboard } from "./web-dashboard.ts";

/**
 * Magpie 门面适配器 (Facade)
 * 聚合底层各独立领域服务 (Config, Resolver, Client, Service, Web, SessionCoordinator)，
 * 保证高层代码调用的简明性与现有测试的向后兼容性。
 */
export class MagpieCLI {
  getGatewayAddress(): string {
    return configManager.getGatewayAddress();
  }

  getAutoStop(): boolean {
    return configManager.getAutoStop();
  }

  setAutoStop(enabled: boolean): void {
    configManager.setAutoStop(enabled);
  }

  hasSpawnedGateway(): boolean {
    return gatewayService.hasSpawnedGateway();
  }

  getSpawnedGatewayPid(): number | undefined {
    return gatewayService.getSpawnedGatewayPid();
  }

  hasSpawnedWeb(): boolean {
    return gatewayService.hasSpawnedWeb();
  }

  getSpawnedWebPid(): number | undefined {
    return gatewayService.getSpawnedWebPid();
  }

  isStarting(): boolean {
    return gatewayService.isStarting();
  }

  async waitForStartup(): Promise<{ running: boolean; message: string; spawned: boolean } | null> {
    return gatewayService.waitForStartup();
  }

  getManagedInfo(): ManagedServiceInfo | null {
    return sessionCoordinator.getManagedService();
  }

  getActiveClientPids(): number[] {
    return sessionCoordinator.pruneAndGetActiveClients();
  }

  registerSession(): void {
    sessionCoordinator.registerClient();
  }

  async handleSessionStart(ctx: SessionNotifyContext): Promise<void> {
    return gatewayService.handleSessionStart(ctx);
  }

  handleSessionShutdown(): void {
    gatewayService.handleSessionShutdown();
  }

  async resolveBinaryPath(onProgress?: (progress: DownloadProgress) => void): Promise<string> {
    return binaryResolver.resolveBinaryPath(onProgress);
  }

  async forceInstallPluginBinary(onProgress?: (progress: DownloadProgress) => void): Promise<string> {
    return binaryResolver.forceInstallPluginBinary(onProgress);
  }

  async isHealthy(): Promise<boolean> {
    return gatewayClient.isHealthy();
  }

  async ensureGateway(options?: EnsureGatewayOptions): Promise<{ running: boolean; message: string; spawned: boolean }> {
    return gatewayService.ensureGateway(options);
  }

  async ensureService(requireWeb: boolean, options?: EnsureGatewayOptions): Promise<{ running: boolean; message: string; spawned: boolean }> {
    return gatewayService.ensureService(requireWeb, options);
  }

  getWebKey(): string | null {
    return webDashboard.getWebKey();
  }

  getWebUrl(): string {
    return webDashboard.getWebUrl();
  }

  async openWeb(): Promise<{ url: string; opened: boolean; message: string }> {
    return webDashboard.openWeb();
  }

  stopGateway(force = false): { stopped: boolean; message: string } {
    return gatewayService.stopGateway(force);
  }

  stopWeb(force = false): { stopped: boolean; message: string } {
    return gatewayService.stopGateway(force);
  }

  async getCurrentPiModel(): Promise<string> {
    return gatewayClient.getCurrentPiModel();
  }
}

export const magpieCLI = new MagpieCLI();
