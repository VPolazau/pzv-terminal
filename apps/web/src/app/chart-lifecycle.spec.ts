import { ChartLifecycle } from './chart-lifecycle';
import { buildMarkers, mergeCandles, type LogicalRange } from './chart-data';
import { base, candle, event, step } from './chart-test-fixtures';

function setup(nativeAnchor = true) {
  let range: LogicalRange | null = null;
  let times: number[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const raf = {
    request: jest.fn((callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    }),
    cancel: jest.fn((id: number) => frames.delete(id)),
  };
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((cb) => cb(0));
  };
  const timeScale = {
    getVisibleLogicalRange: jest.fn(() => range),
    setVisibleLogicalRange: jest.fn((value: LogicalRange) => {
      range = value;
    }),
    fitContent: jest.fn(() => {
      range = { from: 0, to: times.length - 1 };
    }),
    width: jest.fn(() => 900),
  };
  const series = {
    setData: jest.fn((data: { time: number }[]) => {
      const shift = data.findIndex((row) => row.time === times[0]);
      if (range && shift >= 0 && nativeAnchor)
        range = { from: range.from + shift, to: range.to + shift };
      times = data.map((row) => row.time);
    }),
  };
  const markers = { setMarkers: jest.fn() };
  const load = jest.fn(async () => 0);
  const runtime = new ChartLifecycle(
    series,
    timeScale as unknown as ConstructorParameters<typeof ChartLifecycle>[1],
    markers,
    '1h',
    load,
    raf,
  );
  return {
    runtime,
    series,
    markers,
    load,
    timeScale,
    raf,
    frames,
    flush,
    move: (value: LogicalRange) => {
      range = value;
    },
  };
}

describe('chart lifecycle without canvas emulation', () => {
  it('fits once; marker, rectangle-independent selection and user ranges never reinstall candles', () => {
    const s = setup();
    const candles = [candle(0), candle(1)];
    s.runtime.setCandles(candles);
    s.flush();
    s.runtime.setMarkers(buildMarkers(candles, [event(0)], [], '1h'));
    s.runtime.select(event(0), 1, true);
    s.flush();
    s.runtime.userMoved();
    s.runtime.visibleRangeChanged({ from: 50, to: 80 });
    s.runtime.setCandles(candles);
    expect(s.series.setData).toHaveBeenCalledTimes(1);
    expect(s.timeScale.fitContent).toHaveBeenCalledTimes(1);
    expect(s.markers.setMarkers).toHaveBeenCalledTimes(1);
    expect(s.load).not.toHaveBeenCalled();
  });
  it('uses the latest pan at commit, with no redundant restore over 3 native prepends', () => {
    const s = setup();
    let candles = Array.from({ length: 800 }, (_, i) => candle(2400 + i));
    s.runtime.setCandles(candles);
    s.flush();
    for (let page = 2; page >= 0; page--) {
      s.move({ from: 10.125, to: 71.375 });
      candles = mergeCandles(
        candles,
        Array.from({ length: 805 }, (_, i) => candle(page * 800 + i)),
      );
      s.runtime.setCandles(candles);
      expect(s.timeScale.getVisibleLogicalRange()).toEqual({
        from: 810.125,
        to: 871.375,
      });
      expect(s.frames.size).toBe(1);
      s.flush();
    }
    expect(s.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
    expect(s.series.setData).toHaveBeenCalledTimes(4);
  });
  it('compensates only once if the native anchor differs, with no viewport writes in RAF', () => {
    const s = setup(false);
    s.runtime.setCandles([candle(2), candle(3)]);
    s.flush();
    s.move({ from: 0.25, to: 1.75 });
    s.runtime.setCandles([candle(0), candle(1), candle(2), candle(3)]);
    expect(s.timeScale.setVisibleLogicalRange).toHaveBeenLastCalledWith({
      from: 2.25,
      to: 3.75,
    });
    s.move({ from: 2.5, to: 4 });
    s.flush();
    expect(s.timeScale.getVisibleLogicalRange()).toEqual({ from: 2.5, to: 4 });
    expect(s.timeScale.setVisibleLogicalRange).toHaveBeenCalledTimes(1);
  });
  it('does nothing for duplicate/empty pages', () => {
    const s = setup();
    const candles = [candle(0)];
    s.runtime.setCandles(candles);
    s.flush();
    s.runtime.setCandles(mergeCandles(candles, [candle(0)]));
    s.runtime.setCandles(mergeCandles(candles, []));
    expect(s.series.setData).toHaveBeenCalledTimes(1);
    expect(s.frames.size).toBe(0);
  });
  it('requires new real input after every page, ignoring controlled changes and pending inputs', async () => {
    const s = setup();
    let complete: (count: number) => void = () => undefined;
    s.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    s.runtime.setCandles([candle(0), candle(1)]);
    s.runtime.userMoved();
    s.runtime.visibleRangeChanged({ from: 0, to: 1 });
    expect(s.load).not.toHaveBeenCalled();
    s.flush();
    s.runtime.visibleRangeChanged({ from: 0, to: 1 });
    expect(s.load).not.toHaveBeenCalled();
    s.runtime.userMoved();
    s.runtime.visibleRangeChanged({ from: 0, to: 1 });
    s.runtime.userMoved();
    s.runtime.visibleRangeChanged({ from: -1, to: 0 });
    expect(s.load).toHaveBeenCalledTimes(1);
    complete(0);
    await Promise.resolve();
    s.runtime.visibleRangeChanged({ from: -1, to: 0 });
    expect(s.load).toHaveBeenCalledTimes(1);
    s.runtime.userMoved();
    s.runtime.visibleRangeChanged({ from: -2, to: -1 });
    expect(s.load).toHaveBeenCalledTimes(2);
    complete(0);
    await Promise.resolve();
  });
  it('waits for installed endpoints and complete target coverage; focuses each click once', () => {
    const s = setup();
    const trade = event(0, { entryTime: base, exitTime: base + 2 * step });
    s.runtime.select(trade, 1, true);
    expect(s.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
    s.runtime.setCandles([candle(0)]);
    s.runtime.select(trade, 1, true);
    expect(s.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
    s.runtime.setCandles([candle(0), candle(1), candle(2)]);
    s.runtime.select(trade, 1, false);
    expect(s.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
    s.runtime.select(trade, 1, true);
    expect(s.timeScale.setVisibleLogicalRange).toHaveBeenCalledTimes(1);
    s.flush();
    s.move({ from: 50, to: 90 });
    s.runtime.select({ ...trade, netPnl: 10 }, 1, true);
    s.runtime.focusIfReady();
    expect(s.timeScale.setVisibleLogicalRange).toHaveBeenCalledTimes(1);
    s.runtime.select(trade, 2, true);
    expect(s.timeScale.setVisibleLogicalRange).toHaveBeenCalledTimes(2);
  });
  it('waits for a positive layout width and cancels the only outstanding frame on dispose', () => {
    const s = setup();
    s.timeScale.width.mockReturnValue(0);
    s.runtime.setCandles([candle(0)]);
    s.runtime.select(event(0), 1, true);
    expect(s.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
    s.timeScale.width.mockReturnValue(900);
    s.runtime.focusIfReady();
    expect(s.timeScale.setVisibleLogicalRange).toHaveBeenCalledTimes(1);
    expect(s.frames.size).toBe(1);
    s.runtime.dispose();
    expect(s.frames.size).toBe(0);
    s.runtime.focusIfReady();
    s.runtime.setMarkers([]);
    s.runtime.setCandles([candle(1)]);
    expect(s.timeScale.setVisibleLogicalRange).toHaveBeenCalledTimes(1);
    expect(s.series.setData).toHaveBeenCalledTimes(1);
    expect(s.markers.setMarkers).not.toHaveBeenCalled();
  });
});
