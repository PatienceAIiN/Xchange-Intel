import { ConsoleLogger } from '@nestjs/common';

interface LogLine { t: string; level: string; ctx: string; msg: string; }

/** Module-level ring buffer of recent log lines (for the /process live page). */
class LogBuffer {
  private buf: LogLine[] = [];
  private max = 3000;
  push(level: string, ctx: string, msg: string) {
    this.buf.push({ t: new Date().toISOString(), level, ctx, msg: String(msg).slice(0, 500) });
    if (this.buf.length > this.max) this.buf.splice(0, this.buf.length - this.max);
  }
  /** newest-first page */
  page(page = 0, size = 50) {
    const arr = [...this.buf].reverse();
    const start = page * size;
    return { total: arr.length, page, size, lines: arr.slice(start, start + size) };
  }
}
export const logBuffer = new LogBuffer();

/** Logger that mirrors Nest logs into the ring buffer (plus normal console output). */
export class AppLogger extends ConsoleLogger {
  log(message: any, ctx?: string) { logBuffer.push('log', ctx || this.context || '', message); super.log(message, ctx as any); }
  warn(message: any, ctx?: string) { logBuffer.push('warn', ctx || this.context || '', message); super.warn(message, ctx as any); }
  error(message: any, stack?: string, ctx?: string) { logBuffer.push('error', ctx || this.context || '', message); super.error(message, stack as any, ctx as any); }
}
