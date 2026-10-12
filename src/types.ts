export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Selection {
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
}

export interface Modifiers {
  alt: boolean;
  control: boolean;
  meta: boolean;
  shift: boolean;
  capsLock: boolean;
  numLock: boolean;
  altGraph: boolean;
}

export interface EditorState {
  selection: Selection;
  textLength: number;
  revision: number;
  ascii: boolean;
  /** Observed composition session state; absent in older traces. */
  composing?: boolean;
  focused: boolean;
  scroll: { left: number; top: number };
}

/** Observed text replacement, not an inferred cognitive revision. */
export interface TextDelta {
  start: number;
  removed: string;
  inserted: string;
  locationBasis: 'selection' | 'text-difference';
}

export interface EditEvidence {
  inputType: string;
  data: string | null;
  composing: boolean;
  /** Browser isComposing flag, or null for checkpoints; absent in older traces. */
  nativeComposing?: boolean | null;
  /** Observed compositionstart sequence, or null when unavailable/not applicable. */
  compositionStartSequence?: number | null;
  beforeInputSequence: number | null;
  selectionBefore: Selection | null;
  selectionAfter: Selection;
  fromRevision: number;
  toRevision: number;
  delta: TextDelta | null;
  supported: boolean;
  issues: string[];
}

export interface KeyboardEvidence {
  key: string;
  code: string;
  location: number;
  repeat: boolean;
  composing: boolean;
  modifiers: Modifiers;
  downSequence: number | null;
  withinEditor: boolean;
}

export interface MouseEvidence {
  button: number;
  buttons: number;
  clicks: number;
  client: { x: number; y: number };
  page: { x: number; y: number };
  screen: { x: number; y: number };
  editor: { x: number; y: number };
  movement: { x: number; y: number };
  modifiers: Modifiers;
  withinEditor: boolean;
}

export interface PointerEvidence extends MouseEvidence {
  pointerId: number;
  pointerType: string;
  primary: boolean;
  pressure: number;
  tangentialPressure: number;
  width: number;
  height: number;
  tiltX: number;
  tiltY: number;
  twist: number;
}

export interface ClipboardEvidence {
  types: string[];
  text: string | null;
  textSource: 'clipboard-event' | 'selection' | 'unavailable';
  selectedText: string;
  files: { name: string; type: string; size: number; lastModified: number }[];
}

export interface CompositionEvidence {
  data: string;
  selection: Selection;
  /** Null when capture did not observe the start of this composition. */
  startSequence: number | null;
}

export interface Payloads {
  start: { text: string; selection: Selection };
  stop: { text: string; interruptedKeys: string[] };
  pause: { interruptedKeys: string[] };
  resume: { pausedMs: number };
  keydown: KeyboardEvidence;
  keyup: KeyboardEvidence;
  beforeinput: { inputType: string; data: string | null; composing: boolean; selection: Selection };
  input: EditEvidence;
  compositionstart: CompositionEvidence;
  compositionupdate: CompositionEvidence;
  compositionend: CompositionEvidence;
  /** Capture lost a composition boundary; this does not imply a commit/cancel. */
  compositioninterrupted: {
    startSequence: number | null;
    reason: 'pause' | 'stop' | 'blur' | 'hidden' | 'pagehide' | 'restart';
  };
  checkpoint: EditEvidence & { reason: string; text: string };
  mousedown: MouseEvidence;
  mouseup: MouseEvidence;
  mousemove: MouseEvidence;
  mouseenter: MouseEvidence;
  mouseleave: MouseEvidence;
  click: MouseEvidence;
  dblclick: MouseEvidence;
  auxclick: MouseEvidence;
  contextmenu: MouseEvidence;
  pointerdown: PointerEvidence;
  pointerup: PointerEvidence;
  pointermove: PointerEvidence;
  pointercancel: PointerEvidence;
  copy: ClipboardEvidence;
  cut: ClipboardEvidence;
  paste: ClipboardEvidence;
  selection: { previous: Selection; current: Selection; trigger: string };
  wheel: { x: number; y: number; z: number; mode: number; mouse: MouseEvidence };
  scroll: { left: number; top: number };
  focus: { scope: 'editor' | 'window' };
  blur: { scope: 'editor' | 'window'; interruptedKeys: string[] };
  visibility: { state: string; interruptedKeys: string[] };
  online: { online: boolean };
  resize: { width: number; height: number; pixelRatio: number };
  pagehide: { persisted: boolean; interruptedKeys: string[] };
  pageshow: { persisted: boolean };
  marker: { name: string; data: Json };
}

export type EventKind = keyof Payloads;
export interface EventBase {
  id: string;
  sessionId: string;
  sequence: number;
  /** Milliseconds since recorder creation, measured with performance.now(). */
  elapsedMs: number;
  wallTime: string;
  /** Unmodified DOM Event.timeStamp; null for library-generated events. */
  domTimeStamp: number | null;
  trusted: boolean | null;
  defaultPrevented: boolean | null;
  state: EditorState;
}
export type TraceEvent<K extends EventKind = EventKind> = {
  [P in K]: EventBase & { kind: P; payload: Payloads[P] }
}[K];

export interface TraceHeader {
  schema: 'awentrace/0.1';
  recorderVersion: '0.2.0';
  sessionId: string;
  startedAt: string;
  performanceTimeOrigin: number;
  startPerformanceMs: number;
  positionUnit: 'utf16-code-unit';
  scope: 'textarea';
  /** Older recorders emitted ascii; current capture accepts Unicode text. */
  supportedInput: 'ascii' | 'unicode';
  metadata: Json;
  environment: {
    userAgent: string;
    language: string;
    languages: string[];
    platform: string;
    timezone: string;
    viewport: { width: number; height: number; pixelRatio: number };
    screen: { width: number; height: number; colorDepth: number };
    visibility: string;
    online: boolean;
    maxTouchPoints: number;
  };
  editor: { id: string; name: string; spellcheck: boolean; readOnly: boolean; disabled: boolean };
  initialText: string;
  initialSelection: Selection;
  capturePointerMoves: boolean;
}

export interface Trace {
  header: TraceHeader;
  events: TraceEvent[];
  finalText: string;
  stopped: boolean;
}

export interface JSONLExportOptions {
  /** Use native CompressionStream('gzip'). Defaults to true. */
  gzip?: boolean;
}

export interface TraceOptions extends JSONLExportOptions {
  target: HTMLTextAreaElement;
  sessionId?: string;
  metadata?: Json;
  /** False by default. Set true to capture mouse/pointer movement without throttling. */
  capturePointerMoves?: boolean;
  onEvent?: (event: TraceEvent) => void;
  onError?: (error: unknown) => void;
}

export interface Recorder {
  readonly sessionId: string;
  /** Compression setting for exportJSONL() and streamJSONL(). */
  readonly gzip: boolean;
  readonly stopped: boolean;
  readonly paused: boolean;
  readonly eventCount: number;
  /** Suspend native event capture without ending this session. */
  pause(): void;
  /** Resume capture; any unobserved text change becomes a checkpoint. */
  resume(): void;
  getTrace(): Trace;
  /** Export a detached snapshot as .jsonl.gz (default) or plain .jsonl. */
  exportJSONL(): Promise<Blob>;
  /** Replay existing events and stream future ones; stop() emits the footer and closes. */
  streamJSONL(): ReadableStream<Uint8Array<ArrayBuffer>>;
  subscribe(listener: (event: TraceEvent) => void): () => void;
  mark(name: string, data?: Json): void;
  /** Call after programmatic value changes; also runs at observable boundaries. */
  sync(reason?: string): void;
  /** Idempotent; removes all listeners and records the final text. */
  stop(): Trace;
}
