import { configManager } from "./config.ts";
import { gatewayClient } from "./gateway-client.ts";
import { sessionCoordinator } from "./session-coordinator.ts";
import { webDashboard } from "./web-dashboard.ts";

function formatProcessOwnerText(healthy: boolean) {
  if (!healthy) {
    return "未运行";
  }
  const managed = sessionCoordinator.getManagedService();
  if (managed) {
    const clients = sessionCoordinator.pruneAndGetActiveClients();
    const isThisStarter = managed.startedByPiPid === process.pid;
    const starterText = isThisStarter ? "本会话启动" : `会话 PID ${managed.startedByPiPid} 启动`;
    return `Pi 托管集群 (${starterText}, 活跃会话: ${clients.length} 个 [${clients.join(", ")}])`;
  }
  return "外部常驻服务";
}

async function showMagpieStatusAndWeb(ctx: { ui: { notify: (msg: string, level?: "info" | "warning" | "error") => void } }) {
  try {
    const healthy = await gatewayClient.isHealthy();
    const currentPi = await gatewayClient.getCurrentPiModel();
    const autoStop = configManager.getAutoStop();
    const clients = sessionCoordinator.pruneAndGetActiveClients();
    const webUrl = webDashboard.getWebUrl();
    const webKey = webDashboard.getWebKey();

    const info = [
      `网关地址: ${configManager.getGatewayAddress()}`,
      `网关状态: ${healthy ? "🟢 正常运行 (Online)" : "🔴 未运行 (Offline)"}`,
      `控制面板: ${healthy ? `🟢 ${webUrl}` : `⚪ ${webUrl} (服务未运行)`}`,
      ...(healthy && webKey ? [`控制台密钥: 🔑 ${webKey}`] : []),
      `网关归属: ${formatProcessOwnerText(healthy)}`,
      `会话联动: ${autoStop ? "🟢 已开启 (支持多 Pi 共享，所有会话退出时即刻关闭)" : "⚪ 已关闭 (保持后台常驻)"}`,
      `当前会话: PID ${process.pid} (集群活跃 Pi: ${clients.length} 个)`,
      `当前模型: ${currentPi}`
    ].join("\n");

    ctx.ui.notify(info, healthy ? "info" : "warning");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(`获取 Magpie 状态失败: ${msg}`, "error");
  }
}

/**
 * 创建 /magpie 指令配置对象（由 TypeScript 自动推导结构）
 */
export function createMagpieCommand() {
  return {
    description: "查看 Magpie 网关运行状态与 Web 控制面板地址",
    handler: async (_args: string, ctx: { ui: { notify: (msg: string, level?: "info" | "warning" | "error") => void } }) => {
      await showMagpieStatusAndWeb(ctx);
    }
  };
}
