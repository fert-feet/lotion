import { describe, expect, it, vi, afterEach } from "vitest";
import { logger } from "@/lib/logger";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const originalLogLevel = process.env.LOG_LEVEL;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalLogLevel;
});

describe("logger 级别过滤", () => {
  it("默认级别 info：info 输出、debug 被过滤", () => {
    delete process.env.LOG_LEVEL;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.agent.info("普通信息");
    logger.agent.debug("调试信息");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(" INFO [agent] 普通信息"));
  });

  it("LOG_LEVEL=warn 时 info 被过滤，warn 输出", () => {
    process.env.LOG_LEVEL = "warn";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.tools.info("不该输出");
    logger.tools.warn("警告信息");
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(" WARN [tools] 警告信息"));
  });

  it("LOG_LEVEL=error 时仅 error 输出且走 console.error", () => {
    process.env.LOG_LEVEL = "error";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.api.info("不该输出");
    logger.api.error("严重错误", { code: 500 });
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(' ERROR [api] 严重错误 {"code":500}')
    );
  });

  it("日志格式：时间戳 + 级别 + 模块 + 消息 + 数据", () => {
    delete process.env.LOG_LEVEL;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.db.info("写库完成", { rows: 3 });
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toMatch(/^\[.*\] INFO \[db\] 写库完成 \{"rows":3\}$/);
  });
});
