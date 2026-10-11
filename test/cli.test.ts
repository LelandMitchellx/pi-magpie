import assert from "node:assert/strict";
import test from "node:test";
import { MagpieCLI } from "../src/magpie-cli.ts";
import { MagpieDownloader } from "../src/downloader.ts";

test("MagpieCLI: 默认地址与环境变量覆盖", () => {
  const cli = new MagpieCLI();
  const saved = process.env.MAGPIE_ADDR;

  try {
    delete process.env.MAGPIE_ADDR;
    assert.equal(cli.getGatewayAddress(), "127.0.0.1:8317", "未配置时应当回退到默认网关地址");

    process.env.MAGPIE_ADDR = "127.0.0.1:9999";
    assert.equal(cli.getGatewayAddress(), "127.0.0.1:9999", "配置环境变量时应当读取覆盖值");
  } finally {
    if (saved !== undefined) {
      process.env.MAGPIE_ADDR = saved;
    } else {
      delete process.env.MAGPIE_ADDR;
    }
  }
});

test("MagpieCLI: autoStop 默认值、环境变量与运行时切换", () => {
  const cli = new MagpieCLI();
  const saved = process.env.MAGPIE_AUTO_STOP;

  try {
    delete process.env.MAGPIE_AUTO_STOP;
    assert.equal(cli.getAutoStop(), true, "默认情况下 autoStop 应为 true");

    process.env.MAGPIE_AUTO_STOP = "false";
    assert.equal(cli.getAutoStop(), false, "环境变量为 false 时应禁用 autoStop");

    cli.setAutoStop(true);
    assert.equal(cli.getAutoStop(), true, "通过方法显式设置后应生效");
  } finally {
    if (saved !== undefined) {
      process.env.MAGPIE_AUTO_STOP = saved;
    } else {
      delete process.env.MAGPIE_AUTO_STOP;
    }
  }
});

test("MagpieCLI: Web 控制台免密 URL 与 Key 机制", () => {
  const cli = new MagpieCLI();
  const saved = process.env.MAGPIE_WEB_KEY;

  try {
    // 1. 指定环境变量时，强制覆盖并优先采用该密钥
    process.env.MAGPIE_WEB_KEY = "custom-test-secret-key";
    assert.equal(cli.getWebKey(), "custom-test-secret-key", "应当优先采用环境变量定义的密钥");
    assert.equal(
      cli.getWebUrl(),
      "http://127.0.0.1:3430/?k=custom-test-secret-key",
      "免密直达 URL 应当正确拼接端口与密钥参数"
    );

    // 2. 移除环境变量时，URL 仍遵循格式（包含或不包含密钥）
    delete process.env.MAGPIE_WEB_KEY;
    const url = cli.getWebUrl();
    assert.ok(url.startsWith("http://127.0.0.1:3430/"), "基础 URL 端口应当为 3430");
  } finally {
    if (saved !== undefined) {
      process.env.MAGPIE_WEB_KEY = saved;
    } else {
      delete process.env.MAGPIE_WEB_KEY;
    }
  }
});

test("MagpieDownloader: 跨平台路径计算与 bin 目录自愈", () => {
  const downloader = new MagpieDownloader();
  const info = downloader.getTargetExecutableInfo();
  const binDir = downloader.getPluginBinDir();

  assert.ok(binDir.endsWith("bin"), "应当正确计算 bin 目录绝对路径");
  assert.ok(info.localPath.startsWith(binDir), "目标可执行文件应当位于 bin 目录下");
  if (process.platform === "win32") {
    assert.equal(info.localPath.endsWith("magpie.exe"), true, "Windows 下应当为 magpie.exe");
  } else {
    assert.equal(info.localPath.endsWith("magpie"), true, "Unix 下应当为 magpie");
  }
});
