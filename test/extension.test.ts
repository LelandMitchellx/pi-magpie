import assert from "node:assert/strict";
import test from "node:test";
import magpieExtension from "../src/index.ts";
import { gatewayService } from "../src/gateway-service.ts";
import { createMagpieCommand, getMagpieArgumentCompletions, MAGPIE_SUBCOMMANDS } from "../src/commands.ts";

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

test("magpieExtension: session_start 非阻塞立即交还控制权", () => {
  const handlers: Record<string, ((event: any, ctx: any) => void)[]> = {};
  const fakePi = {
    registerCommand: () => {},
    on: (event: string, handler: any) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
    }
  };

  magpieExtension(fakePi);
  const startHandlers = handlers["session_start"];
  assert.ok(startHandlers && startHandlers.length > 0, "应当注册 session_start 监听器");
  const onSessionStart = startHandlers[0];

  const fakeCtx = {
    ui: {
      notify: () => {}
    }
  };

  // 关键断言：session_start 处理器必须返回 undefined (同步立即完成)，绝不返回未决 Promise 阻断 Pi 宿主启动
  const returnVal = onSessionStart({}, fakeCtx);
  assert.equal(returnVal, undefined, "session_start 处理器必须为同步非阻塞（返回 undefined）");
});

test("gatewayService: handleSessionStart 启动中、启动完成与失败提示", async () => {
  const originalEnsure = gatewayService.ensureGateway;

  try {
    // 1. 成功拉起场景：应触发“正在后台启动中”与“启动完毕”通知
    const notifications: { msg: string; level?: string }[] = [];
    const fakeCtx = {
      ui: {
        notify: (msg: string, level?: "info" | "warning" | "error") => {
          notifications.push({ msg, level });
        }
      }
    };

    gatewayService.ensureGateway = async (options) => {
      options?.onStarting?.();
      return { running: true, message: "启动成功", spawned: true };
    };

    await gatewayService.handleSessionStart(fakeCtx);
    assert.equal(notifications.length, 2, "成功启动时应产生 2 条通知（启动中 + 启动完毕）");
    assert.ok(notifications[0].msg.includes("正在后台启动中"), "第一条通知应为正在后台启动中");
    assert.equal(notifications[0].level, "info");
    assert.ok(notifications[1].msg.includes("启动完毕"), "第二条通知应为启动完毕");
    assert.equal(notifications[1].level, "info");

    // 2. 启动失败场景：应产生“启动失败”通知并标记为 error
    notifications.length = 0;
    gatewayService.ensureGateway = async () => {
      return { running: false, message: "端口已被占用", spawned: false };
    };

    await gatewayService.handleSessionStart(fakeCtx);
    assert.equal(notifications.length, 1, "失败时应产生 1 条通知");
    assert.ok(notifications[0].msg.includes("Magpie 启动失败: 端口已被占用"), "应包含失败原因");
    assert.equal(notifications[0].level, "error");

    // 3. 抛出异常场景：应产生“启动异常”通知并标记为 error
    notifications.length = 0;
    gatewayService.ensureGateway = async () => {
      throw new Error("spawn failed ENOENT");
    };

    await gatewayService.handleSessionStart(fakeCtx);
    assert.equal(notifications.length, 1, "异常时应产生 1 条通知");
    assert.ok(notifications[0].msg.includes("Magpie 启动异常: spawn failed ENOENT"), "应包含异常信息");
    assert.equal(notifications[0].level, "error");

    // 4. 已有服务复用场景 (res.running && !res.spawned)：应保持静默，不弹出启动提示
    notifications.length = 0;
    gatewayService.ensureGateway = async () => {
      return { running: true, message: "已复用活跃服务", spawned: false };
    };

    await gatewayService.handleSessionStart(fakeCtx);
    assert.equal(notifications.length, 0, "复用已有服务时不应触发通知弹窗");
  } finally {
    gatewayService.ensureGateway = originalEnsure;
  }
});

test("magpieCommand: 网关后台启动中提前执行 /magpie 即刻返回启动中过渡卡片", async () => {
  const originalIsStarting = gatewayService.isStarting;

  try {
    // 模拟网关正在后台启动中的状态
    gatewayService.isStarting = () => true;

    const cmd = createMagpieCommand();
    const notifications: { msg: string; level?: string }[] = [];
    const fakeCtx = {
      ui: {
        notify: (msg: string, level?: "info" | "warning" | "error") => {
          notifications.push({ msg, level });
        }
      }
    };

    await cmd.handler("", fakeCtx);
    assert.equal(notifications.length, 1, "应当产生 1 条状态卡片通知");
    assert.ok(notifications[0].msg.includes("⏳ 启动中 (Starting - 后台冷启动中，请稍后刷新)"), "应呈现启动中过渡卡片");
    assert.equal(notifications[0].level, "info");
  } finally {
    gatewayService.isStarting = originalIsStarting;
  }
});

test("magpieCommand: getArgumentCompletions 子命令自动补全与候选推导", () => {
  const cmd = createMagpieCommand();
  assert.equal(typeof cmd.getArgumentCompletions, "function", "createMagpieCommand 必须声明 getArgumentCompletions");

  // 1. 空前缀或空白字符前缀：返回所有可用子命令列表
  const allEmpty = getMagpieArgumentCompletions("");
  assert.ok(Array.isArray(allEmpty), "空前缀应返回数组");
  assert.equal(allEmpty.length, 3, "当前应提供 upgrade, restart, status 3 个子命令");
  assert.deepEqual(
    allEmpty.map((i) => i.value),
    ["upgrade", "restart", "status"],
    "必须包含完整子命令列表"
  );

  const allSpaces = getMagpieArgumentCompletions("   ");
  assert.equal(allSpaces?.length, 3, "空白字符串前缀也应返回完整子命令列表");

  // 2. 字段规范校验：每个候选均需具备 value、label 和描述文本
  for (const item of MAGPIE_SUBCOMMANDS) {
    assert.ok(item.value && item.value.trim().length > 0, "必须具备非空 value");
    assert.ok(item.label && item.label.trim().length > 0, "必须具备非空 label");
    assert.ok(item.description && item.description.trim().length > 0, "必须具备非空 description 帮助说明");
  }

  // 3. 前缀模糊匹配
  const upMatch = getMagpieArgumentCompletions("up");
  assert.deepEqual(upMatch?.map((i) => i.value), ["upgrade"], "'up' 前缀应匹配 upgrade");

  const updateMatch = getMagpieArgumentCompletions("update");
  assert.deepEqual(updateMatch?.map((i) => i.value), ["upgrade"], "'update' 别名前缀应重定向推荐 upgrade");

  const reMatch = getMagpieArgumentCompletions("re");
  assert.deepEqual(reMatch?.map((i) => i.value), ["restart"], "'re' 前缀应匹配 restart");

  const statMatch = getMagpieArgumentCompletions("stat");
  assert.deepEqual(statMatch?.map((i) => i.value), ["status"], "'stat' 前缀应匹配 status");

  // 4. 无匹配项返回 null
  const noneMatch = getMagpieArgumentCompletions("unknown");
  assert.equal(noneMatch, null, "未知前缀应返回 null");

  // 5. 子命令已输入完毕后输入后续参数时返回 null
  const extraArgs = getMagpieArgumentCompletions("upgrade extra");
  assert.equal(extraArgs, null, "已输入完整子命令并接后续参数时应返回 null，避免阻断参数输入");
});
