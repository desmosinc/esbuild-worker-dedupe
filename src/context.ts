import { assert } from "./assert";

export class Context {
  private timers: Record<
    string,
    { inProgress?: { start: number }; times: number[] } | undefined
  > = {};
  constructor(private options: { logLevel: "silent" | "verbose" }) {}

  shouldLog() {
    return this.options.logLevel !== "silent";
  }

  time(s: string) {
    let timer = this.timers[s];
    if (!timer) {
      this.timers[s] = timer = { times: [] };
    }
    assert(!timer.inProgress, "Timer " + s + " is already in progress");
    timer.inProgress = { start: Date.now() };
  }

  timeEnd(s: string) {
    const timer = this.timers[s];
    assert(timer?.inProgress, "Timer " + s + " is not in progress");
    timer.times.push(Date.now() - timer.inProgress.start);
    timer.inProgress = undefined;
  }

  clearTimers() {
    this.timers = {};
  }

  getTimers() {
    const out: Record<string, number[]> = {};
    for (const key in this.timers) {
      out[key] = this.timers[key]?.times.slice() || [];
    }
    return out;
  }

  log(...args: unknown[]) {
    // eslint-disable-next-line no-console
    if (this.shouldLog()) console.log(...args);
  }
}
