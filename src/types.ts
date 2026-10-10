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

export interface Payloads {
  start: { text: string; selection: Selection };
  stop: { text: string; interruptedKeys: string[] };
  keydown: KeyboardEvidence;
  keyup: KeyboardEvidence;
  beforeinput: { inputType: string; data: string | null; composing: boolean; selection: Selection };
  input: EditEvidence;
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
  recorderVersion: '0.1.0';
  sessionId: string;
  startedAt: string;
  performanceTimeOrigin: number;
  startPerformanceMs: number;
  positionUnit: 'utf16-code-unit';
  scope: 'textarea';
  supportedInput: 'ascii';
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

export interface TraceOptions {
  target: HTMLTextAreaElement;
  sessionId?: string;
  metadata?: Json;
  /** True by default. No movement throttling is applied. */
  capturePointerMoves?: boolean;
  onEvent?: (event: TraceEvent) => void;
  onError?: (error: unknown) => void;
}

export interface Recorder {
  readonly sessionId: string;
  readonly stopped: boolean;
  readonly eventCount: number;
  getTrace(): Trace;
  subscribe(listener: (event: TraceEvent) => void): () => void;
  mark(name: string, data?: Json): void;
  /** Call after programmatic value changes; also runs at observable boundaries. */
  sync(reason?: string): void;
  /** Idempotent; removes all listeners and records the final text. */
  stop(): Trace;
}
