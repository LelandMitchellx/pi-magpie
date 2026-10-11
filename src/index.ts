import { createMagpieCommand } from "./commands.ts";
import { gatewayService } from "./gateway-service.ts";
import { webDashboard } from "./web-dashboard.ts";

/**
 * Pi 原生扩展装配入口
 * 参数与返回值由 TypeScript 上下文自动推导，无需声明冗余类型接口
 */
export default function magpieExtension(pi: {
  registerCommand: (name: string, command: ReturnType<typeof createMagpieCommand>) => void;
  on?: (
    event: string,
    handler: (event: { sessionDir?: string }, ctx: { ui: { notify: (msg: string, level?: "info" | "warning" | "error") => void } }) => void | Promise<void>
  ) => void;
}) {
  // 1. 注册宿主退出信号钩子 (会话即刻注销与归零销毁)
  const cleanup = () => {
    gatewayService.handleSessionShutdown();
  };

  process.once("beforeExit", cleanup);
  process.once("exit", cleanup);
  process.once("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  // 2. 注册极简 Slash 命令 /magpie
  pi.registerCommand("magpie", createMagpieCommand());

  // 3. 监听会话启动事件 (静默拉起/保活并登记会话信标)
  pi.on?.("session_start", async (_event, ctx) => {
      try {
        const res = await gatewayService.ensureGateway();
        if (res.spawned) {
          const webUrl = webDashboard.getWebUrl();
          const webKey = webDashboard.getWebKey();
          const notifyMsg = webKey
            ? `Magpie Gateway 与 Web 面板已就绪 🟢\n控制台: ${webUrl}\n密钥: ${webKey}`
            : `Magpie Gateway 与 Web 面板已就绪 🟢 (${webUrl})`;
          ctx.ui.notify(notifyMsg, "info");
        } else if (!res.running) {
          ctx.ui.notify(
            "Magpie 未就绪，输入 /magpie 查看状态或通过 magpie serve 手动拉起",
            "warning"
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Magpie 自动保活探测异常: ${msg}`, "error");
      }
    });
}
