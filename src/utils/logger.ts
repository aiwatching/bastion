export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function formatMessage(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const base = `${timestamp} [${level.toUpperCase()}] [${component}] ${message}`;
  if (data && Object.keys(data).length > 0) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(component: string): Logger {
  return {
    debug(message: string, data?: Record<string, unknown>) {
      if (shouldLog('debug')) {
        process.stderr.write(formatMessage('debug', component, message, data) + '\n');
      }
    },
    info(message: string, data?: Record<string, unknown>) {
      if (shouldLog('info')) {
        process.stderr.write(formatMessage('info', component, message, data) + '\n');
      }
    },
    warn(message: string, data?: Record<string, unknown>) {
      if (shouldLog('warn')) {
        process.stderr.write(formatMessage('warn', component, message, data) + '\n');
      }
    },
    error(message: string, data?: Record<string, unknown>) {
      if (shouldLog('error')) {
        process.stderr.write(formatMessage('error', component, message, data) + '\n');
      }
    },
  };
}
