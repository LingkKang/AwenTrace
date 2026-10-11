import type { Selection } from '../types.js';

export interface AnalysisRange {
  /** Session-relative elapsed milliseconds; both interval endpoints must be inside. */
  startMs: number;
  endMs: number;
}

export interface PauseAnalysisOptions {
  /** Inclusive minimum interval duration. Default: 2000 ms; must be finite and > 0. */
  thresholdMs?: number;
  /** Defaults to the entire captured timeline. Intervals are never clipped. */
  range?: AnalysisRange;
  /** Exclude intervals touching hidden pages or pagehide/pageshow gaps. Default: true. */
  excludeHidden?: boolean;
  /** Exclude intervals touching an observed window blur. Default: true. */
  excludeWindowBlur?: boolean;
  /** Default: false, so reading feedback elsewhere on the page can remain in scope. */
  excludeEditorBlur?: boolean;
}

export interface ResolvedPauseAnalysisOptions {
  thresholdMs: number;
  range: AnalysisRange;
  excludeHidden: boolean;
  excludeWindowBlur: boolean;
  excludeEditorBlur: boolean;
}

/** An interval between consecutive text-changing input events, in event order. */
export interface PauseInterval {
  startEventId: string;
  endEventId: string;
  startSequence: number;
  endSequence: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  /** Revision after the preceding edit and before the following edit, respectively. */
  startRevision: number;
  endRevision: number;
  selectionAfterPrevious: Selection;
  /** Null when the recorder had no reliable beforeinput evidence. */
  selectionBeforeNext: Selection | null;
}

export type PauseExclusionReason = 'recording-paused' | 'page-hidden' | 'window-blurred'
  | 'editor-blurred' | 'unobserved-change' | 'unsupported-input';

export interface ExcludedPauseInterval extends PauseInterval {
  reasons: PauseExclusionReason[];
}

export interface PauseSummary {
  count: number;
  totalDurationMs: number;
  meanDurationMs: number | null;
  medianDurationMs: number | null;
  minDurationMs: number | null;
  maxDurationMs: number | null;
  /** All eligible inter-edit intervals, including those below the pause threshold. */
  eligibleIntervalCount: number;
  eligibleDurationMs: number;
  /** totalDurationMs / eligibleDurationMs; null when the denominator is zero. */
  pauseRatio: number | null;
  excludedIntervalCount: number;
  excludedDurationMs: number;
}

export interface PauseAnalysis {
  algorithm: 'awentrace/pause-analysis';
  algorithmVersion: '1';
  basis: 'text-change';
  sessionId: string;
  traceSchema: string;
  recorderVersion: string;
  sourceEventCount: number;
  sourceStopped: boolean;
  options: ResolvedPauseAnalysisOptions;
  pauses: PauseInterval[];
  /** All excluded in-range intervals, regardless of the threshold, for auditing. */
  excludedIntervals: ExcludedPauseInterval[];
  summary: PauseSummary;
}
