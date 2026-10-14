import { createMagpieCommand } from "./commands.ts";
import { gatewayService } from "./gateway-service.ts";

/**
 * Pi 原生扩展装配入口
 * 仅负责注册装配：挂载 /magpie 命令、session_start 保活与退出信号钩子
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

  // 3. 监听会话启动事件 (后台非阻塞并发拉起，确保 Pi 宿主极速启动与后续扩展加载)
  pi.on?.("session_start", (_event, ctx) => {
    // 关键架构解耦：采用非阻塞后台异步任务执行拉起，绝不向 Pi 宿主返回未决 Promise
    void gatewayService.handleSessionStart(ctx);
  });
}
