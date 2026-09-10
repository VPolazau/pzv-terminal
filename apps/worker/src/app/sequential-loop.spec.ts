import { SequentialLoop } from './sequential-loop';

describe('SequentialLoop', () => {
  afterEach(() => jest.useRealTimers());
  it('shares a running cycle and never overlaps, even when it takes longer than the interval', async () => {
    jest.useFakeTimers();
    let resolve!: () => void;
    const task = jest.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const loop = new SequentialLoop(task, 1000, jest.fn());
    loop.start();
    await jest.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1);
    const first = loop.runOnce();
    const second = loop.runOnce();
    expect(first).toBe(second);
    const stopped = loop.stop();
    resolve();
    await stopped;
    await jest.advanceTimersByTimeAsync(10000);
    expect(task).toHaveBeenCalledTimes(1);
  });
  it('continues after an error and cancels the scheduled timer on stop', async () => {
    jest.useFakeTimers();
    const onError = jest.fn();
    const task = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue(undefined);
    const loop = new SequentialLoop(task, 1000, onError);
    loop.start();
    await jest.advanceTimersByTimeAsync(1100);
    expect(task).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    await loop.stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(2);
  });
});
