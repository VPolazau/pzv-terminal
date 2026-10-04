import type { SignalEvent } from './signal-events';
export function selectLatestEvent(events: SignalEvent[]): SignalEvent | null {
  return events.reduce<SignalEvent | null>(
    (latest, event) =>
      !latest ||
      event.timestamp > latest.timestamp ||
      (event.timestamp === latest.timestamp &&
        event.source === 'LIVE' &&
        latest.source !== 'LIVE')
        ? event
        : latest,
    null,
  );
}
