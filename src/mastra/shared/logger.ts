/* eslint-disable no-console */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevel(): LogLevel {
  const level = process.env.LOG_LEVEL as LogLevel | undefined;
  return level && level in LEVEL_WEIGHT ? level : 'info';
}

function isEnabled(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[currentLevel()];
}

export const logger = {
  debug(...args: unknown[]): void {
    if (isEnabled('debug')) console.debug('[debug]', ...args);
  },
  info(...args: unknown[]): void {
    if (isEnabled('info')) console.info('[info]', ...args);
  },
  warn(...args: unknown[]): void {
    if (isEnabled('warn')) console.warn('[warn]', ...args);
  },
  error(...args: unknown[]): void {
    if (isEnabled('error')) console.error('[error]', ...args);
  },
  /** Prints without level prefix or filtering (startup banners, status reports). */
  raw(message: string): void {
    console.log(message);
  },
};
