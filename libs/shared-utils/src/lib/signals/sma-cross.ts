import type { SmaCrossSignal } from "@pzv-terminal/shared-types";
import { smaAt } from "../indicators/sma-at";

export function smaCrossAt(params: {
  closes: number[];
  fast: number;
  slow: number;
  index: number;
}): {
  signal: SmaCrossSignal;
  now: { fast: number | null; slow: number | null };
  prev: { fast: number | null; slow: number | null };
} {
  const { closes, fast, slow, index } = params;

  const nowFast = smaAt(closes, fast, index);
  const nowSlow = smaAt(closes, slow, index);
  const prevFast = smaAt(closes, fast, index - 1);
  const prevSlow = smaAt(closes, slow, index - 1);

  let signal: SmaCrossSignal = "none";

  if (
    nowFast !== null &&
    nowSlow !== null &&
    prevFast !== null &&
    prevSlow !== null
  ) {
    if (prevFast <= prevSlow && nowFast > nowSlow) signal = "bull_cross";
    else if (prevFast >= prevSlow && nowFast < nowSlow) signal = "bear_cross";
  }

  return {
    signal,
    now: { fast: nowFast, slow: nowSlow },
    prev: { fast: prevFast, slow: prevSlow },
  };
}
