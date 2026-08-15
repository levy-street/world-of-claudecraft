import { describe, expect, it } from 'vitest';
import { presentationStatePayload } from '../electron/presentation_events.cjs';

describe('presentationStatePayload (renderer-facing window hidden-ness)', () => {
  it('passes a real boolean through unchanged', () => {
    expect(presentationStatePayload(true)).toEqual({ hidden: true });
    expect(presentationStatePayload(false)).toEqual({ hidden: false });
  });

  it('coerces every non-boolean to not-hidden rather than letting truthiness through', () => {
    // The renderer parks work on this flag, so a truthy non-boolean reading must
    // never be able to stall a visible window.
    for (const raw of [undefined, null, 0, 1, '', 'true', 'false', {}, []]) {
      expect(presentationStatePayload(raw), `coerced ${JSON.stringify(raw)}`).toEqual({
        hidden: false,
      });
    }
  });

  it('emits exactly the one whitelisted key', () => {
    expect(Object.keys(presentationStatePayload(true))).toEqual(['hidden']);
  });
});
