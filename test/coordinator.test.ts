import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SessionCoordinator } from "../src/session-coordinator.ts";

const testDir = join(process.cwd(), ".test-coordinator-env");

function cleanupEnv() {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

test("SessionCoordinator: 客户端信标注册与注销", async (t) => {
  cleanupEnv();
  t.after(cleanupEnv);

  const coord = new SessionCoordinator(testDir);
  coord.registerClient(process.pid);

  let clients = coord.pruneAndGetActiveClients();
  assert.ok(clients.includes(process.pid), "当前进程 PID 应当在注册列表中");

  coord.unregisterClient(process.pid);
  clients = coord.pruneAndGetActiveClients();
  assert.ok(!clients.includes(process.pid), "注销后当前进程 PID 应当不在列表中");
});

test("SessionCoordinator: 僵死 PID 自动检测与修剪", async (t) => {
  cleanupEnv();
  t.after(cleanupEnv);

  const coord = new SessionCoordinator(testDir);
  const deadPid = 99999999;
  writeFileSync(join(testDir, "magpie-clients", `${deadPid}.json`), JSON.stringify({ pid: deadPid }));

  const clients = coord.pruneAndGetActiveClients();
  assert.ok(!clients.includes(deadPid), "僵死 PID 不应当出现在活跃列表中");
  assert.ok(!existsSync(join(testDir, "magpie-clients", `${deadPid}.json`)), "僵死 PID 的信标文件应被物理删除");
});

test("SessionCoordinator: 托管服务元数据持久化", async (t) => {
  cleanupEnv();
  t.after(cleanupEnv);

  const coord = new SessionCoordinator(testDir);
  const info = {
    magpiePid: process.pid,
    startedByPiPid: process.pid,
    createdAt: new Date().toISOString()
  };

  coord.setManagedService(info);
  const fetched = coord.getManagedService();
  assert.equal(fetched?.magpiePid, process.pid);
  assert.equal(fetched?.startedByPiPid, process.pid);

  coord.clearManagedService();
  assert.equal(coord.getManagedService(), null);
});

test("SessionCoordinator: 多会话协同与最后会话退出即刻销毁", async (t) => {
  cleanupEnv();
  t.after(cleanupEnv);

  const coord = new SessionCoordinator(testDir);

  // 1. 启动模拟的目标网关进程
  const dummyMagpie = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
    detached: true,
    stdio: "ignore"
  });
  dummyMagpie.unref();
  const magpiePid = dummyMagpie.pid;
  assert.ok(magpiePid, "应当成功获取模拟网关 PID");

  // 2. 启动两个模拟的 Pi 客户端进程
  const dummyClientA = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
    detached: true,
    stdio: "ignore"
  });
  dummyClientA.unref();
  const clientPidA = dummyClientA.pid;

  const dummyClientB = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
    detached: true,
    stdio: "ignore"
  });
  dummyClientB.unref();
  const clientPidB = dummyClientB.pid;

  assert.ok(clientPidA && clientPidB, "应当成功获取两个模拟客户端 PID");

  coord.registerClient(clientPidA);
  coord.registerClient(clientPidB);

  coord.setManagedService({
    magpiePid,
    startedByPiPid: clientPidA,
    createdAt: new Date().toISOString()
  });

  // 3. Client A 退出
  coord.killProcessTree(clientPidA);
  const killedByA = coord.terminateManagedServiceIfLastClient(clientPidA);
  assert.equal(killedByA, false, "Client B 仍在运行，Client A 退出时不应当杀死网关");
  assert.ok(coord.isPidAlive(magpiePid), "Client B 仍活跃，网关应当存活");

  // 4. Client B 退出 (最后一个客户端)
  coord.killProcessTree(clientPidB);
  const killedByB = coord.terminateManagedServiceIfLastClient(clientPidB);
  assert.equal(killedByB, true, "最后一个客户端退出，应当立即触发终止");

  // 5. 验证网关已被即刻销毁，元数据已清理
  const aliveAfter = coord.isPidAlive(magpiePid);
  assert.equal(aliveAfter, false, "最后一个客户端退出后，网关进程应当被即刻杀灭");
  assert.equal(coord.getManagedService(), null, "托管元数据应当已被清理");
});
