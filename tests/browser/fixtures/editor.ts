import { createTrace, reconstructText, toJSONL } from '../../../src/index.js';
import type { Recorder } from '../../../src/index.js';

declare global {
  interface Window {
    awenTest: {
      recorder: Recorder;
      createTrace: typeof createTrace;
      reconstructText: typeof reconstructText;
      toJSONL: typeof toJSONL;
    };
  }
}

// Test-only bridge. The fixture has no demo imports, UI controls or rendering.
const target = document.querySelector<HTMLTextAreaElement>('#writer')!;
window.awenTest = { recorder: createTrace({ target }), createTrace, reconstructText, toJSONL };
