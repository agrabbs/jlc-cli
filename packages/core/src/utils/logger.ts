/**
 * Consistent logging utility for AI-EDA packages
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  level: LogLevel;
  prefix?: string;
  timestamps?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: LogLevel;
  private prefix: string;
  private timestamps: boolean;

  constructor(options: Partial<LoggerOptions> = {}) {
    this.level = options.level ?? 'info';
    this.prefix = options.prefix ?? '';
    this.timestamps = options.timestamps ?? false;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const parts: string[] = [];

    if (this.timestamps) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    parts.push(`[${level.toUpperCase()}]`);

    if (this.prefix) {
      parts.push(`[${this.prefix}]`);
    }

    parts.push(message);

    return parts.join(' ');
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.error(this.formatMessage('debug', message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.error(this.formatMessage('info', message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.error(this.formatMessage('warn', message), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), ...args);
    }
  }

  /**
   * Log security-related events (file operations, network requests, etc.)
   */
  security(event: string, details: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      const formatted = this.formatMessage('SECURITY', event);
      console.error(formatted, JSON.stringify(details, null, 2));
    }
  }

  /**
   * Log an error with full context preservation
   * Extracts error message, stack trace, and additional context
   */
  errorWithContext(message: string, error: unknown, context?: Record<string, unknown>): void {
    if (!this.shouldLog('error')) return;

    const errorInfo: Record<string, unknown> = {
      message,
      timestamp: new Date().toISOString(),
    };

    // Extract error details
    if (error instanceof Error) {
      errorInfo.errorMessage = error.message;
      errorInfo.errorName = error.name;
      if (error.stack) {
        errorInfo.stack = error.stack;
      }
      // Preserve any additional error properties
      Object.keys(error).forEach(key => {
        if (!['message', 'name', 'stack'].includes(key)) {
          errorInfo[key] = (error as any)[key];
        }
      });
    } else if (typeof error === 'string') {
      errorInfo.errorMessage = error;
    } else {
      errorInfo.error = error;
    }

    // Add context if provided
    if (context) {
      errorInfo.context = context;
    }

    console.error(this.formatMessage('error', message));
    console.error(JSON.stringify(errorInfo, null, 2));
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  child(prefix: string): Logger {
    return new Logger({
      level: this.level,
      prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix,
      timestamps: this.timestamps,
    });
  }
}

// Default logger instance
export const logger = new Logger({ prefix: 'ai-eda' });

// Create package-specific loggers
export function createLogger(packageName: string): Logger {
  return logger.child(packageName);
}

/**
 * Custom error class that preserves error context
 */
export class ContextError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ContextError';
    
    // Preserve stack trace
    if (cause instanceof Error && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      context: this.context,
      cause: this.cause instanceof Error ? {
        name: this.cause.name,
        message: this.cause.message,
      } : this.cause,
      stack: this.stack,
    };
  }
}

/**
 * Wrap a function with error handling and logging
 * @param fn Function to wrap
 * @param logger Logger instance
 * @param context Context description
 * @returns Wrapped function that logs errors
 */
export function withErrorHandling<T extends (...args: any[]) => any>(
  fn: T,
  logger: Logger,
  context: string
): T {
  return ((...args: Parameters<T>): ReturnType<T> => {
    try {
      const result = fn(...args);
      
      // Handle async functions
      if (result instanceof Promise) {
        return result.catch((error: unknown) => {
          logger.errorWithContext(`${context} failed`, error, { args });
          throw new ContextError(`${context} failed`, error, { args });
        }) as ReturnType<T>;
      }
      
      return result;
    } catch (error) {
      logger.errorWithContext(`${context} failed`, error, { args });
      throw new ContextError(`${context} failed`, error, { args });
    }
  }) as T;
}
