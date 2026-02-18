export interface LoggerOptions {
  verbose: boolean;
  json: boolean;
}

export interface Logger {
  info(msg: string): void;
  debug(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  time(label: string): void;
  timeEnd(label: string): number;
  getTimings(): Record<string, number>;
}

export function createLogger(opts: LoggerOptions): Logger {
  const timers = new Map<string, number>();
  const completed = new Map<string, number>();

  return {
    info(msg: string): void {
      if (opts.json) return;
      process.stdout.write(msg + "\n");
    },

    debug(msg: string): void {
      if (!opts.verbose || opts.json) return;
      process.stderr.write(msg + "\n");
    },

    warn(msg: string): void {
      process.stderr.write(msg + "\n");
    },

    error(msg: string): void {
      process.stderr.write(msg + "\n");
    },

    time(label: string): void {
      timers.set(label, performance.now());
    },

    timeEnd(label: string): number {
      const start = timers.get(label);
      if (start === undefined) return 0;
      const elapsed = performance.now() - start;
      timers.delete(label);
      completed.set(label, elapsed);

      if (opts.verbose && !opts.json) {
        process.stderr.write(`${label}: ${elapsed.toFixed(1)}ms\n`);
      }

      return elapsed;
    },

    getTimings(): Record<string, number> {
      return Object.fromEntries(completed);
    },
  };
}
