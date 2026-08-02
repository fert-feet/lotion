import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

const logLevels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_DIR = resolve(process.cwd(), "logs");

function formatLog(entry: LogEntry): string {
  const prefix = `[${entry.ts}] ${entry.level.toUpperCase()} [${entry.module}]`;
  const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
  return `${prefix} ${entry.message}${dataStr}`;
}

function getHourKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}`;
}

/**
 * 写入文件（每个模块按小时分文件: logs/agent-2026-07-25T09.log）
 * 追加写入，跨小时自动换文件
 */
function writeToFile(module: string, line: string) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const filename = `${module}-${getHourKey()}.log`;
    appendFileSync(resolve(LOG_DIR, filename), line + "\n", "utf-8");
  } catch {
    // 文件写入失败不阻塞业务
  }
}

function createLogger(module: string) {
  const log = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
    const minLevel = (process.env.LOG_LEVEL || "info") as LogLevel;
    if (logLevels[level] < logLevels[minLevel]) return;

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      module,
      message,
      data,
    };

    const line = formatLog(entry);

    // 控制台
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }

    // 文件（每次写入时自动按小时分文件）
    writeToFile(module, line);
  };

  return {
    debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
    info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
    error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
  };
}

export const logger = {
  agent: createLogger("agent"),
  tools: createLogger("tools"),
  api: createLogger("api"),
  db: createLogger("db"),
  compress: createLogger("compress"),
};

export type Logger = ReturnType<typeof createLogger>;
