import { isAscii, textDelta } from './text.js';
import { createJSONLStream, toJSONLBlob } from './compression.js';
import type { ClipboardEvidence, EditEvidence, EventKind, Json, Modifiers, MouseEvidence,
  Payloads, Recorder, Selection, Trace, TraceEvent, TraceHeader, TraceOptions } from './types.js';

const owners = new WeakMap<HTMLTextAreaElement, Recorder>();
const supportedTypes = new Set(['insertText', 'insertLineBreak', 'insertFromPaste', 'insertReplacementText',
  'deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteWordForward',
  'deleteSoftLineBackward', 'deleteSoftLineForward', 'deleteHardLineBackward',
  'deleteHardLineForward', 'deleteEntireSoftLine', 'deleteByCut']);

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function sessionUUID(crypto: Crypto): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // getRandomValues also works on HTTP origins where randomUUID is unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hasEditorFocus(target: HTMLTextAreaElement): boolean {
  let active: Element = target;
  for (;;) {
    // Walk outward from the textarea, including closed and nested shadow roots.
    const root = active.getRootNode() as Document | ShadowRoot;
    if (root.activeElement !== active) return false;
    if (!('host' in root)) return root === target.ownerDocument;
    active = root.host;
  }
}

const sameSelection = (a: Selection, b: Selection) =>
  a.start === b.start && a.end === b.end && a.direction === b.direction;

/** Capture only the supplied textarea and session-level page lifecycle signals. */
export function createTrace(options: TraceOptions): Recorder {
  const target = options.target;
  const gzip = options.gzip ?? true;
  if (!target || target.tagName !== 'TEXTAREA') throw new TypeError('AwenTrace requires a textarea');
  const doc = target.ownerDocument;
  const win = doc.defaultView;
  if (!win) throw new Error('The textarea must belong to a browser window');
  if (owners.has(target)) throw new Error('This textarea already has an active AwenTrace recorder');
  const perf = win.performance;
  const started = perf.now();
  const sessionId = options.sessionId ?? sessionUUID(win.crypto);
  if (!sessionId.trim()) throw new Error('sessionId must not be empty');
  const selection = (): Selection => ({ start: target.selectionStart, end: target.selectionEnd,
    direction: target.selectionDirection });
  const viewport = () => ({ width: win.innerWidth, height: win.innerHeight, pixelRatio: win.devicePixelRatio });
  const header: TraceHeader = freeze({ schema: 'awentrace/0.1', recorderVersion: '0.2.0', sessionId,
    startedAt: new Date().toISOString(), performanceTimeOrigin: perf.timeOrigin,
    startPerformanceMs: started, positionUnit: 'utf16-code-unit', scope: 'textarea', supportedInput: 'unicode',
    metadata: JSON.parse(JSON.stringify(options.metadata ?? null)) as Json,
    environment: { userAgent: win.navigator.userAgent, language: win.navigator.language,
      languages: [...win.navigator.languages], platform: win.navigator.platform,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, viewport: viewport(),
      screen: { width: win.screen.width, height: win.screen.height, colorDepth: win.screen.colorDepth },
      visibility: doc.visibilityState, online: win.navigator.onLine, maxTouchPoints: win.navigator.maxTouchPoints },
    editor: { id: target.id, name: target.name, spellcheck: target.spellcheck,
      readOnly: target.readOnly, disabled: target.disabled },
    initialText: target.value, initialSelection: selection(), capturePointerMoves: options.capturePointerMoves ?? false });
  const events: TraceEvent[] = [];
  const listeners = new Set<(event: TraceEvent) => void>();
  const notifications: TraceEvent[] = [];
  let delivering = false;
  if (options.onEvent) listeners.add(options.onEvent);
  const removers: (() => void)[] = [];
  const pressed = new Map<string, number>();
  const pointers = new Set<number>();
  const mouseButtons = new Set<number>();
  let revision = 0;
  let text = target.value;
  let lastSelection = selection();
  let stopped = false;
  let paused = false;
  let pausedAt = 0;
  let stopping = false;
  let pending: { sequence: number; text: string; selection: Selection; inputType: string; native: InputEvent } | null = null;
  let pendingTimer: number | undefined;
  let composition: { startSequence: number | null } | null = null;
  let compositionTail: { startSequence: number | null } | null = null;
  let compositionTimer: number | undefined;

  const reportError = (error: unknown) => {
    try { if (options.onError) options.onError(error); else win.console.error('AwenTrace subscriber error', error); }
    catch { /* A host error handler must not interrupt input capture. */ }
  };
  function emit<K extends EventKind>(kind: K, payload: Payloads[K], native?: Event, deferDelivery = false): number {
    if (stopped || (paused && native)) return events.length;
    const sequence = events.length + 1;
    const event = freeze({ id: `${sessionId}:${sequence}`, sessionId, sequence, kind, payload,
      elapsedMs: perf.now() - started, wallTime: new Date().toISOString(),
      domTimeStamp: native?.timeStamp ?? null, trusted: native?.isTrusted ?? null,
      defaultPrevented: native?.defaultPrevented ?? null,
      state: { selection: selection(), textLength: target.value.length, revision, ascii: isAscii(target.value),
        composing: composition !== null,
        focused: hasEditorFocus(target), scroll: { left: target.scrollLeft, top: target.scrollTop } },
    }) as TraceEvent;
    events.push(event);
    // Stop callbacks must observe the same completed trace as the caller.
    if (kind === 'stop') stopped = true;
    notifications.push(event);
    // A subscriber may add a marker. Every subscriber must still see the original
    // event before that marker, matching the trace's sequence order.
    if (!delivering && !deferDelivery) {
      delivering = true;
      try {
        while (notifications.length) {
          const next = notifications.shift()!;
          for (const listener of [...listeners]) {
            try { listener(next); } catch (error) { reportError(error); }
          }
        }
      } finally { delivering = false; if (stopped) listeners.clear(); }
    }
    return sequence;
  }

  function listen<T extends Event>(surface: EventTarget, type: string, handler: (event: T) => void) {
    const fn = (event: Event) => { if (!stopped && !paused) handler(event as T); };
    surface.addEventListener(type, fn, { capture: true, passive: true });
    removers.push(() => surface.removeEventListener(type, fn, true));
  }
  const within = (event: Event) => event.composedPath().includes(target);
  const modifiers = (event: KeyboardEvent | MouseEvent): Modifiers => ({ alt: event.altKey,
    control: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey,
    capsLock: event.getModifierState('CapsLock'), numLock: event.getModifierState('NumLock'),
    altGraph: event.getModifierState('AltGraph') });
  const interruptKeys = () => { const keys = [...pressed.keys()]; pressed.clear(); return keys; };

  const clearCompositionTail = () => {
    win.clearTimeout(compositionTimer);
    compositionTail = null;
  };
  function interruptComposition(reason: Payloads['compositioninterrupted']['reason'], deferDelivery = false) {
    clearCompositionTail();
    const interrupted = composition;
    composition = null;
    if (interrupted) emit('compositioninterrupted', { startSequence: interrupted.startSequence, reason }, undefined, deferDelivery);
  }

  function select(trigger: string, native?: Event) {
    if (stopped || paused) return;
    const current = selection();
    if (sameSelection(current, lastSelection)) return;
    const previous = lastSelection;
    lastSelection = current;
    emit('selection', { previous, current, trigger }, native);
  }

  function editEvidence(inputType: string, data: string | null, nativeComposing: boolean | null,
    observed: typeof pending): EditEvidence {
    const composing = nativeComposing === true || composition !== null || /composition/i.test(inputType);
    const compositionStartSequence = (composition ?? compositionTail)?.startSequence ?? null;
    const current = selection();
    const selectionBefore = observed?.selection ?? null;
    const delta = textDelta(text, target.value, selectionBefore, current, inputType);
    const issues: string[] = [];
    if (!observed) issues.push('beforeinput-not-observed');
    if (!supportedTypes.has(inputType)) issues.push('unsupported-input-type');
    if (composing) issues.push('composition-out-of-scope');
    if (compositionTail) issues.push('composition-boundary');
    if (delta?.locationBasis === 'text-difference') issues.push('edit-location-inferred');
    const fromRevision = revision;
    if (delta) revision++;
    text = target.value;
    return { inputType, data, composing, nativeComposing, compositionStartSequence,
      beforeInputSequence: observed?.sequence ?? null,
      selectionBefore, selectionAfter: current, fromRevision, toRevision: revision, delta,
      supported: supportedTypes.has(inputType) && !composing && !compositionTail, issues };
  }

  function sync(reason = 'host-request') {
    if (stopped || paused) return;
    if (target.value !== text) {
      pending = null;
      const evidence = editEvidence('external', null, null, null);
      emit('checkpoint', { ...evidence, reason, text });
    }
    select('sync');
  }

  const trace = (): Trace => structuredClone({ header, events, finalText: text, stopped });
  const recorder: Recorder = {
    sessionId,
    gzip,
    get stopped() { return stopped; },
    get paused() { return paused; },
    pause() {
      if (stopped || stopping || paused) return;
      sync('pause');
      if (stopped || stopping || paused) return;
      paused = true;
      pausedAt = perf.now();
      win.clearTimeout(pendingTimer);
      pending = null;
      pointers.clear();
      mouseButtons.clear();
      // Record both boundaries before callbacks can resume or stop the session.
      interruptComposition('pause', true);
      emit('pause', { interruptedKeys: interruptKeys() });
    },
    resume() {
      if (stopped || stopping || !paused) return;
      const pausedMs = perf.now() - pausedAt;
      paused = false;
      emit('resume', { pausedMs });
      sync('resume');
    },
    get eventCount() { return events.length; },
    getTrace() { sync('export'); return trace(); },
    async exportJSONL() { return toJSONLBlob(recorder.getTrace(), { gzip }); },
    streamJSONL() {
      sync('export');
      return createJSONLStream({
        header, eventAt: index => events[index], complete: () => stopped,
        footer: () => ({ finalText: text, stopped }),
        subscribe(wake) {
          if (stopped) return () => {};
          listeners.add(wake);
          return () => { listeners.delete(wake); };
        },
      }, gzip);
    },
    subscribe(listener) {
      if (stopped || stopping) throw new Error('Recorder has stopped');
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    mark(name, data = null) {
      if (stopped || stopping) throw new Error('Recorder has stopped');
      if (!name.trim()) throw new Error('Marker name must not be empty');
      sync('marker');
      emit('marker', { name, data: JSON.parse(JSON.stringify(data)) as Json });
    },
    sync,
    stop() {
      if (!stopped && !stopping) {
        stopping = true;
        paused = false;
        sync('stop');
        interruptComposition('stop');
        win.clearTimeout(pendingTimer);
        pending = null;
        for (const remove of removers) remove();
        owners.delete(target);
        emit('stop', { text, interruptedKeys: interruptKeys() });
      }
      return trace();
    },
  };
  owners.set(target, recorder);

  listen<CompositionEvent>(target, 'compositionstart', event => {
    sync('compositionstart');
    interruptComposition('restart');
    if (stopped || paused) return;
    pending = null;
    composition = { startSequence: events.length + 1 };
    emit('compositionstart', { data: event.data, selection: selection(), startSequence: composition.startSequence }, event);
  });
  listen<CompositionEvent>(target, 'compositionupdate', event => {
    // Update events can precede the DOM mutation. Only input/checkpoints own edits.
    composition ??= { startSequence: null };
    emit('compositionupdate', { data: event.data, selection: selection(), startSequence: composition.startSequence }, event);
  });
  listen<CompositionEvent>(target, 'compositionend', event => {
    clearCompositionTail();
    const ended = composition ?? { startSequence: null };
    composition = null;
    compositionTail = ended;
    // Some browsers deliver the final input after compositionend. Keep the
    // boundary for this task and reconcile only if no input reported the edit.
    compositionTimer = win.setTimeout(() => {
      if (compositionTail !== ended) return;
      sync('compositionend');
      if (compositionTail === ended) clearCompositionTail();
    }, 0);
    emit('compositionend', { data: event.data, selection: selection(), startSequence: ended.startSequence }, event);
  });

  listen<KeyboardEvent>(target, 'keydown', event => {
    sync('keydown');
    if (!event.isComposing && !composition) clearCompositionTail();
    const keyId = `${event.code || event.key}:${event.location}`;
    const first = pressed.get(keyId) ?? events.length + 1;
    pressed.set(keyId, first);
    emit('keydown', { key: event.key, code: event.code, location: event.location, repeat: event.repeat,
      composing: event.isComposing, modifiers: modifiers(event), downSequence: first, withinEditor: true }, event);
  });
  listen<KeyboardEvent>(doc, 'keyup', event => {
    const keyId = `${event.code || event.key}:${event.location}`;
    if (!within(event) && !pressed.has(keyId)) return;
    sync('keyup');
    const first = pressed.get(keyId) ?? null;
    pressed.delete(keyId);
    emit('keyup', { key: event.key, code: event.code, location: event.location, repeat: event.repeat,
      composing: event.isComposing, modifiers: modifiers(event), downSequence: first, withinEditor: within(event) }, event);
    select('keyup', event);
  });
  listen<InputEvent>(target, 'beforeinput', event => {
    sync('beforeinput');
    const before = selection();
    const sequence = emit('beforeinput', { inputType: event.inputType, data: event.data ?? null,
      composing: event.isComposing ?? false, selection: before }, event);
    pending = { sequence, text, selection: before, inputType: event.inputType, native: event };
    // A cancelled beforeinput must never be paired with a later, unrelated input.
    win.clearTimeout(pendingTimer);
    pendingTimer = win.setTimeout(() => { pending = null; }, 0);
  });
  listen<InputEvent>(target, 'input', event => {
    const observed = pending && !pending.native.defaultPrevented && pending.text === text &&
      pending.inputType === event.inputType ? pending : null;
    const evidence = editEvidence(event.inputType || 'unknown', event.data ?? null, event.isComposing ?? false, observed);
    pending = null;
    emit('input', evidence, event);
    select('input', event);
  });
  listen(target, 'select', event => select('select', event));
  listen(target, 'selectionchange', event => select('selectionchange', event));
  listen(doc, 'selectionchange', event => {
    if (hasEditorFocus(target)) select('document-selectionchange', event);
  });

  const mouse = (event: MouseEvent): MouseEvidence => {
    const bounds = target.getBoundingClientRect();
    return { button: event.button, buttons: event.buttons, clicks: event.detail,
      client: { x: event.clientX, y: event.clientY }, page: { x: event.pageX, y: event.pageY },
      screen: { x: event.screenX, y: event.screenY },
      editor: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      movement: { x: event.movementX, y: event.movementY }, modifiers: modifiers(event), withinEditor: within(event) };
  };
  for (const kind of ['mousedown', 'mouseup', 'mousemove', 'mouseenter', 'mouseleave',
    'click', 'dblclick', 'auxclick', 'contextmenu'] as const) {
    if (kind === 'mousemove' && !header.capturePointerMoves) continue;
    const surface = kind === 'mouseup' || kind === 'mousemove' ? doc : target;
    listen<MouseEvent>(surface, kind, event => {
      if (!within(event) && !mouseButtons.size) return;
      sync(kind);
      if (kind === 'mousedown') mouseButtons.add(event.button);
      emit(kind, mouse(event), event);
      if (kind === 'mouseup') mouseButtons.delete(event.button);
      // Default mouse selection changes run after the capture listener.
      queueMicrotask(() => { if (!stopped && !paused) select(kind); });
    });
  }
  for (const kind of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel'] as const) {
    if (kind === 'pointermove' && !header.capturePointerMoves) continue;
    listen<PointerEvent>(kind === 'pointerdown' ? target : doc, kind, event => {
      if (!within(event) && !pointers.has(event.pointerId)) return;
      sync(kind);
      if (kind === 'pointerdown') pointers.add(event.pointerId);
      emit(kind, { ...mouse(event), pointerId: event.pointerId, pointerType: event.pointerType,
        primary: event.isPrimary, pressure: event.pressure, tangentialPressure: event.tangentialPressure,
        width: event.width, height: event.height, tiltX: event.tiltX, tiltY: event.tiltY, twist: event.twist }, event);
      if (kind === 'pointerup' || kind === 'pointercancel') pointers.delete(event.pointerId);
    });
  }
  for (const kind of ['copy', 'cut', 'paste'] as const) {
    listen<ClipboardEvent>(target, kind, event => {
      sync(kind);
      const range = selection();
      const selectedText = target.value.slice(range.start, range.end);
      const data = event.clipboardData;
      const types = data ? [...data.types] : [];
      const hasText = types.includes('text/plain');
      const payload: ClipboardEvidence = { types,
        text: kind === 'paste' ? (hasText && data ? data.getData('text/plain') : null) : selectedText,
        textSource: kind === 'paste' ? (hasText ? 'clipboard-event' : 'unavailable') : 'selection',
        selectedText, files: data ? [...data.files].map(file => ({ name: file.name, type: file.type,
          size: file.size, lastModified: file.lastModified })) : [] };
      emit(kind, payload, event);
    });
  }
  listen<WheelEvent>(target, 'wheel', event => emit('wheel', { x: event.deltaX, y: event.deltaY,
    z: event.deltaZ, mode: event.deltaMode, mouse: mouse(event) }, event));
  listen(target, 'scroll', event => emit('scroll', { left: target.scrollLeft, top: target.scrollTop }, event));
  for (const [surface, scope] of [[target, 'editor'], [win, 'window']] as const) {
    listen(surface, 'focus', event => {
      if (event.target !== surface) return;
      sync('focus'); emit('focus', { scope }, event);
    });
    listen(surface, 'blur', event => {
      if (event.target !== surface) return;
      sync('blur'); pending = null; pointers.clear(); mouseButtons.clear();
      interruptComposition('blur');
      emit('blur', { scope, interruptedKeys: interruptKeys() }, event);
    });
  }
  listen(doc, 'visibilitychange', event => {
    sync('visibility');
    const keys = doc.visibilityState === 'hidden' ? interruptKeys() : [];
    if (doc.visibilityState === 'hidden') {
      pointers.clear(); mouseButtons.clear(); interruptComposition('hidden');
    }
    emit('visibility', { state: doc.visibilityState, interruptedKeys: keys }, event);
  });
  for (const type of ['online', 'offline']) listen(win, type, event => emit('online', { online: win.navigator.onLine }, event));
  listen(win, 'resize', event => emit('resize', viewport(), event));
  listen<PageTransitionEvent>(win, 'pagehide', event => {
    sync('pagehide'); interruptComposition('pagehide');
    emit('pagehide', { persisted: event.persisted, interruptedKeys: interruptKeys() }, event);
    pointers.clear(); mouseButtons.clear();
  });
  listen<PageTransitionEvent>(win, 'pageshow', event => { sync('pageshow'); emit('pageshow', { persisted: event.persisted }, event); });
  emit('start', { text, selection: lastSelection });
  return recorder;
}
