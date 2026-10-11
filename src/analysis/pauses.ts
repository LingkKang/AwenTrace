import type { Trace, TraceEvent } from '../types.js';
import type { ExcludedPauseInterval, PauseAnalysis, PauseAnalysisOptions,
  PauseExclusionReason, PauseInterval, ResolvedPauseAnalysisOptions } from './types.js';
import { validateTimeline } from './timeline.js';

function resolveOptions(options: PauseAnalysisOptions, lastMs: number): ResolvedPauseAnalysisOptions {
  const thresholdMs = options.thresholdMs ?? 2000;
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
    throw new RangeError('thresholdMs must be finite and greater than zero');
  }
  const range = options.range ? { ...options.range } : { startMs: 0, endMs: lastMs };
  if (!Number.isFinite(range.startMs) || !Number.isFinite(range.endMs) ||
      range.startMs < 0 || range.endMs < range.startMs) {
    throw new RangeError('range must have finite bounds with 0 <= startMs <= endMs');
  }
  for (const key of ['excludeHidden', 'excludeWindowBlur', 'excludeEditorBlur'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') {
      throw new TypeError(`${key} must be a boolean`);
    }
  }
  return { thresholdMs, range, excludeHidden: options.excludeHidden ?? true,
    excludeWindowBlur: options.excludeWindowBlur ?? true, excludeEditorBlur: options.excludeEditorBlur ?? false };
}

/**
 * Pure, offline inter-edit pause analysis. Paste, cut and deletion count as edits;
 * key/selection/marker events do not reset the interval. No DOM or wall clock is used.
 * Initial/trailing inactivity is censored and never counted as a complete pause.
 */
export function analyzePauses(trace: Trace, options: PauseAnalysisOptions = {}): PauseAnalysis {
  const resolved = resolveOptions(options, validateTimeline(trace));
  const pauses: PauseInterval[] = [];
  const excludedIntervals: ExcludedPauseInterval[] = [];
  let previous: TraceEvent<'input'> | null = null;
  const reasons = new Set<PauseExclusionReason>();
  let recordingPaused = false;
  let hidden = trace.header.environment.visibility !== 'visible';
  let pageAway = false;
  let windowBlurred = false;
  let eligibleIntervalCount = 0;
  let eligibleDurationMs = 0;

  const addEnvironmentReasons = (event: TraceEvent) => {
    if (recordingPaused) reasons.add('recording-paused');
    if (resolved.excludeHidden && (hidden || pageAway)) reasons.add('page-hidden');
    if (resolved.excludeWindowBlur && windowBlurred) reasons.add('window-blurred');
    if (resolved.excludeEditorBlur && !event.state.focused) reasons.add('editor-blurred');
  };

  for (const event of trace.events) {
    // Preserve evidence on both sides of a transition. We never stitch separate
    // active fragments together or call an interrupted gap a shorter pause.
    addEnvironmentReasons(event);
    switch (event.kind) {
      case 'pause': recordingPaused = true; break;
      case 'resume': recordingPaused = false; break;
      case 'visibility': hidden = event.payload.state !== 'visible'; break;
      case 'pagehide': pageAway = true; break;
      case 'pageshow': pageAway = false; break;
      case 'blur': if (event.payload.scope === 'window') windowBlurred = true; break;
      case 'focus': if (event.payload.scope === 'window') windowBlurred = false; break;
      case 'checkpoint':
        if (event.payload.delta) reasons.add('unobserved-change');
        break;
    }
    addEnvironmentReasons(event);
    if (event.kind !== 'input') continue;
    if (!event.payload.supported) reasons.add('unsupported-input');
    if (!event.payload.delta) continue;

    if (previous && previous.elapsedMs >= resolved.range.startMs && event.elapsedMs <= resolved.range.endMs) {
      const interval: PauseInterval = {
        startEventId: previous.id, endEventId: event.id,
        startSequence: previous.sequence, endSequence: event.sequence,
        startMs: previous.elapsedMs, endMs: event.elapsedMs,
        durationMs: event.elapsedMs - previous.elapsedMs,
        startRevision: previous.payload.toRevision, endRevision: event.payload.fromRevision,
        selectionAfterPrevious: { ...previous.payload.selectionAfter },
        selectionBeforeNext: event.payload.selectionBefore ? { ...event.payload.selectionBefore } : null,
      };
      if (reasons.size) excludedIntervals.push({ ...interval, reasons: [...reasons].sort() });
      else {
        eligibleIntervalCount++;
        eligibleDurationMs += interval.durationMs;
        if (interval.durationMs >= resolved.thresholdMs) pauses.push(interval);
      }
    }
    previous = event;
    reasons.clear();
    // An unsupported edit invalidates both adjacent intervals, but does not
    // erase the surrounding supported evidence or join across the bad event.
    if (!event.payload.supported) reasons.add('unsupported-input');
    addEnvironmentReasons(event);
  }

  const durations = pauses.map(pause => pause.durationMs).sort((a, b) => a - b);
  const count = durations.length;
  const totalDurationMs = durations.reduce((sum, duration) => sum + duration, 0);
  const middle = Math.floor(count / 2);
  const medianDurationMs = count ? (count % 2 ? durations[middle]! :
    durations[middle - 1]! + (durations[middle]! - durations[middle - 1]!) / 2) : null;
  return {
    algorithm: 'awentrace/pause-analysis', algorithmVersion: '1', basis: 'text-change',
    sessionId: trace.header.sessionId, traceSchema: trace.header.schema,
    recorderVersion: trace.header.recorderVersion, sourceEventCount: trace.events.length,
    sourceStopped: trace.stopped, options: resolved, pauses, excludedIntervals,
    summary: { count, totalDurationMs, meanDurationMs: count ? totalDurationMs / count : null,
      medianDurationMs, minDurationMs: durations[0] ?? null, maxDurationMs: durations[count - 1] ?? null,
      eligibleIntervalCount, eligibleDurationMs,
      pauseRatio: eligibleDurationMs > 0 ? totalDurationMs / eligibleDurationMs : null,
      excludedIntervalCount: excludedIntervals.length,
      excludedDurationMs: excludedIntervals.reduce((sum, interval) => sum + interval.durationMs, 0) },
  };
}
