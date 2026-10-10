import type { Selection, TextDelta, Trace } from './types.js';

export const isAscii = (text: string): boolean => /^[\x00-\x7f]*$/.test(text);

/** Prefer the observed selection to disambiguate edits inside repeated text. */
export function textDelta(before: string, after: string, selection: Selection | null,
  afterSelection: Selection, inputType: string): TextDelta | null {
  if (before === after) return null;
  if (selection) {
    let start = selection.start;
    let end = selection.end;
    if (start === end && inputType.startsWith('delete')) {
      if (inputType.endsWith('Backward')) start = afterSelection.start;
      else if (inputType.endsWith('Forward')) end += before.length - after.length;
    }
    const insertedLength = after.length - before.length + end - start;
    if (start >= 0 && end >= start && end <= before.length && insertedLength >= 0 &&
      before.slice(0, start) === after.slice(0, start) &&
      before.slice(end) === after.slice(start + insertedLength)) {
      return { start, removed: before.slice(start, end),
        inserted: after.slice(start, start + insertedLength), locationBasis: 'selection' };
    }
  }
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--; endAfter--;
  }
  return { start, removed: before.slice(start, endBefore), inserted: after.slice(start, endAfter),
    locationBasis: 'text-difference' };
}

export function applyDelta(text: string, delta: TextDelta): string {
  if (!Number.isInteger(delta.start) || delta.start < 0 || delta.start > text.length ||
    text.slice(delta.start, delta.start + delta.removed.length) !== delta.removed) {
    throw new Error('Invalid text delta: position or removed text does not match');
  }
  return text.slice(0, delta.start) + delta.inserted + text.slice(delta.start + delta.removed.length);
}

/** Validates ordering and the version chain. Throws on gaps or inconsistent edits. */
export function reconstructText(trace: Trace): string {
  if (trace.header.schema !== 'awentrace/0.1') throw new Error('Unsupported trace schema');
  let text = trace.header.initialText;
  let revision = 0;
  let sequence = 0;
  for (const event of trace.events) {
    if (event.sessionId !== trace.header.sessionId || event.sequence !== ++sequence) {
      throw new Error('Trace sequence or session mismatch');
    }
    if (event.kind === 'input' || event.kind === 'checkpoint') {
      const edit = event.payload;
      if (edit.fromRevision !== revision || edit.toRevision !== revision + (edit.delta ? 1 : 0)) {
        throw new Error('Trace revision mismatch');
      }
      if (edit.delta) text = applyDelta(text, edit.delta);
      revision = edit.toRevision;
      if (event.kind === 'checkpoint' && event.payload.text !== text) throw new Error('Checkpoint mismatch');
    }
    if (event.kind === 'stop' && event.payload.text !== text) throw new Error('Stop text mismatch');
  }
  if (text !== trace.finalText) throw new Error('Final text mismatch');
  return text;
}
