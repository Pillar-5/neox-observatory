import { pino, type Logger as PinoLogger } from 'pino';

/**
 * Structured logger.
 *
 * Pretty transport is only enabled outside production, and only when the
 * transport module is present, so a production container never fails to start
 * because of a missing optional dependency.
 */
export function createLogger(level: 'debug' | 'info' | 'warn' | 'error' = 'info'): PinoLogger {
  const usePretty = process.env.NODE_ENV !== 'production' && process.env.LOG_PRETTY === '1';

  if (usePretty) {
    return pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    });
  }

  return pino({ level });
}

export type Logger = PinoLogger;
