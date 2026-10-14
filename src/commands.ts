import { configManager } from "./config.ts";
import { gatewayClient } from "./gateway-client.ts";
import { gatewayService } from "./gateway-service.ts";
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
    // 关键非阻塞交互：若网关仍在后台启动中，立即返回过渡态卡片，不阻塞且不误报离线
    if (gatewayService.isStarting()) {
      const autoStop = configManager.getAutoStop();
      const clients = sessionCoordinator.pruneAndGetActiveClients();
      const webUrl = webDashboard.getWebUrl();

      const info = [
        `网关地址: ${configManager.getGatewayAddress()}`,
        `网关状态: ⏳ 启动中 (Starting - 后台冷启动中，请稍后刷新)`,
        `控制面板: ⏳ ${webUrl} (服务就绪后可用)`,
        `网关归属: Pi 托管 (正在拉起后台服务进程)`,
        `会话联动: ${autoStop ? "🟢 已开启 (支持多 Pi 共享，所有会话退出时即刻关闭)" : "⚪ 已关闭 (保持后台常驻)"}`,
        `当前会话: PID ${process.pid} (集群活跃 Pi: ${clients.length} 个)`
      ].join("\n");

      ctx.ui.notify(info, "info");
      return;
    }

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
      `当前模型: ${currentPi}`,
      `操作指引: 可使用 /magpie upgrade 受控升级重启，或 /magpie restart 重新拉起`
    ].join("\n");

    ctx.ui.notify(info, healthy ? "info" : "warning");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(`获取 Magpie 状态失败: ${msg}`, "error");
  }
}

async function handleMagpieUpgrade(ctx: { ui: { notify: (msg: string, level?: "info" | "warning" | "error") => void } }) {
  const res = await gatewayService.upgradeAndRestart(ctx);
  ctx.ui.notify(res.message, res.success ? "info" : "error");
}

async function handleMagpieRestart(ctx: { ui: { notify: (msg: string, level?: "info" | "warning" | "error") => void } }) {
  const res = await gatewayService.restartService(ctx);
  ctx.ui.notify(res.message, res.success ? "info" : "error");
}

export interface MagpieSubcommandCompletion {
  value: string;
  label: string;
  description: string;
}

export const MAGPIE_SUBCOMMANDS: readonly MagpieSubcommandCompletion[] = [
  { value: "upgrade", label: "upgrade", description: "受控平滑升级 Magpie 二进制并重启服务" },
  { value: "restart", label: "restart", description: "重启 Magpie 网关服务" },
  { value: "status", label: "status", description: "查看 Magpie 网关状态与 Web 控制面板" }
];

export function getMagpieArgumentCompletions(prefix: string): MagpieSubcommandCompletion[] | null {
  const trimmed = (prefix || "").trimStart();
  const [sub, ...rest] = trimmed.split(/\s+/);

  // 若已输入完成第一级子命令并在输入更多参数（当前无二级参数），返回 null
  if (rest.length > 0) {
    return null;
  }

  const query = (sub || "").toLowerCase();
  const filtered = MAGPIE_SUBCOMMANDS.filter((item) =>
    item.value.startsWith(query) || (item.value === "upgrade" && "update".startsWith(query))
  );

  return filtered.length > 0 ? filtered : null;
}

/**
 * 创建 /magpie 指令配置对象（由 TypeScript 自动推导结构）
 */
export function createMagpieCommand() {
  return {
    description: "查看 Magpie 网关状态或受控升级重启 (/magpie [upgrade|restart|status])",
    getArgumentCompletions: getMagpieArgumentCompletions,
    handler: async (args: string, ctx: { ui: { notify: (msg: string, level?: "info" | "warning" | "error") => void } }) => {
      const sub = (args || "").trim().toLowerCase();
      if (sub === "upgrade" || sub === "update") {
        await handleMagpieUpgrade(ctx);
      } else if (sub === "restart") {
        await handleMagpieRestart(ctx);
      } else {
        await showMagpieStatusAndWeb(ctx);
      }
    }
  };
}
