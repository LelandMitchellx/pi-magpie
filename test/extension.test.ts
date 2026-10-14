import assert from "node:assert/strict";
import test from "node:test";
import magpieExtension from "../src/index.ts";
import { gatewayService } from "../src/gateway-service.ts";

test("magpieExtension: session_shutdown 会话切换防重启防护", () => {
  const handlers: Record<string, ((event: any, ctx: any) => void)[]> = {};
  const fakePi = {
    registerCommand: () => {},
    on: (event: string, handler: any) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
    }
  };

  let shutdownCallCount = 0;
  const originalShutdown = gatewayService.handleSessionShutdown;
  gatewayService.handleSessionShutdown = () => {
    shutdownCallCount++;
  };

  try {
    magpieExtension(fakePi);

    const shutdownHandlers = handlers["session_shutdown"];
    assert.ok(shutdownHandlers && shutdownHandlers.length > 0, "应当注册 session_shutdown 监听器");
    const fn = shutdownHandlers[0];

    // 1. 测试 resume 切换会话：不应当触发注销/销毁
    fn({ type: "session_shutdown", reason: "resume" }, { ui: { notify: () => {} } });
    assert.equal(shutdownCallCount, 0, "切换会话 (reason: resume) 绝不应当触发清理");

    // 2. 测试 new 开启新会话：不应当触发注销/销毁
    fn({ type: "session_shutdown", reason: "new" }, { ui: { notify: () => {} } });
    assert.equal(shutdownCallCount, 0, "开启新会话 (reason: new) 绝不应当触发清理");

    // 3. 测试 reload 重载扩展：不应当触发注销/销毁
    fn({ type: "session_shutdown", reason: "reload" }, { ui: { notify: () => {} } });
    assert.equal(shutdownCallCount, 0, "重载扩展 (reason: reload) 绝不应当触发清理");

    // 4. 测试 fork 分支会话：不应当触发注销/销毁
    fn({ type: "session_shutdown", reason: "fork" }, { ui: { notify: () => {} } });
    assert.equal(shutdownCallCount, 0, "分支会话 (reason: fork) 绝不应当触发清理");

    // 5. 测试 quit 真正退出 Pi：应当触发注销/销毁
    fn({ type: "session_shutdown", reason: "quit" }, { ui: { notify: () => {} } });
    assert.equal(shutdownCallCount, 1, "退出 Pi (reason: quit) 应当触发清理");

    // 6. 测试无 reason 的退化调用：应当安全兜底触发清理
    fn({}, { ui: { notify: () => {} } });
    assert.equal(shutdownCallCount, 2, "无 reason 时应当兜底执行清理");
  } finally {
    gatewayService.handleSessionShutdown = originalShutdown;
  }
});
