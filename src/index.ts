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
    handler: (
      event: { sessionDir?: string; reason?: string; targetSessionFile?: string; type?: string },
      ctx: { ui: { notify: (msg: string, level?: "info" | "warning" | "error") => void } }
    ) => void | Promise<void>
  ) => void;
}) {
  // 1. 统一注销与清理逻辑
  const cleanup = () => {
    gatewayService.handleSessionShutdown();
  };

  // Pi 标准扩展会话关闭生命周期钩子
  // 关键防御：在多会话切换 (reason 为 "resume" | "new" | "fork" | "reload") 场景下，
  // 宿主 Pi 进程依然活跃存活，绝不能注销信标或销毁网关！
  // 仅在用户真正退出 Pi 终端时 (reason === "quit") 才触发归零清理。
  pi.on?.("session_shutdown", (event) => {
    if (event?.reason && event.reason !== "quit") {
      return;
    }
    cleanup();
  });

  // 宿主进程级退出保底（注意：不得在 SIGINT/SIGTERM 中主动 process.exit，以免干扰 Pi 自身的信号与终端交互）
  process.once("beforeExit", cleanup);
  process.once("exit", cleanup);
  process.once("SIGHUP", () => {
    cleanup();
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
