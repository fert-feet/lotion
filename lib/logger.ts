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

function formatLog(entry: LogEntry): string {
  const prefix = `[${entry.ts}] ${entry.level.toUpperCase()} [${entry.module}]`;
  const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
  return `${prefix} ${entry.message}${dataStr}`;
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

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
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
};

export type Logger = ReturnType<typeof createLogger>;
