import { reconstructText } from '../text.js';
import type { Trace } from '../types.js';

/** Validate without sorting, repairing, or mutating the source evidence. */
export function validateTimeline(trace: Trace): number {
  reconstructText(trace);
  const ids = new Set<string>();
  let lastMs = 0;
  for (const event of trace.events) {
    if (typeof event.id !== 'string' || !event.id || ids.has(event.id)) {
      throw new Error('Analysis requires unique, nonempty event IDs');
    }
    if (!Number.isFinite(event.elapsedMs) || event.elapsedMs < lastMs) {
      throw new Error('Analysis requires finite, nonnegative, nondecreasing elapsedMs');
    }
    ids.add(event.id);
    lastMs = event.elapsedMs;
  }
  return lastMs;
}
