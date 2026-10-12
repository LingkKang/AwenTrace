import { createTrace, reconstructText, toJSON, toJSONL, toCSV } from '../../../src/index.js';
import type { Recorder } from '../../../src/index.js';

declare global {
  interface Window {
    awenTest: {
      recorder: Recorder;
      createTrace: typeof createTrace;
      reconstructText: typeof reconstructText;
      toJSONL: typeof toJSONL;
      toJSON: typeof toJSON;
      toCSV: typeof toCSV;
    };
  }
}

// Test-only bridge. The fixture has no demo imports, UI controls or rendering.
const target = document.querySelector<HTMLTextAreaElement>('#writer')!;
window.awenTest = { recorder: createTrace({ target }), createTrace, reconstructText, toJSON, toJSONL, toCSV };
