// A single in-flight task, including manual triggers and shutdown.
export class SequentialLoop {
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = true;

  constructor(
    private readonly task: () => Promise<void>,
    private readonly intervalMs: number,
    private readonly onError: (error: unknown) => void,
  ) {}

  runOnce(): Promise<void> {
    if (this.running) return this.running;
    this.running = Promise.resolve()
      .then(this.task)
      .catch(this.onError)
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.schedule();
  }

  private async schedule(): Promise<void> {
    const start = performance.now();
    await this.runOnce();
    if (!this.stopped) {
      this.timer = setTimeout(
        () => void this.schedule(),
        Math.max(0, this.intervalMs - (performance.now() - start)),
      );
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}
