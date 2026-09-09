// The shared 2D-context assertion (src/ui/canvas_context.ts), which shipped in
// 710520772c with no suite of its own, in the very commit whose message says a
// new module gets its own paired test. The function is five lines and the whole
// of its behavior is the throw: every one of the eleven call sites it replaced
// runs against an attached canvas that always has a context, so nothing in the
// tree ever exercised either arm on purpose.
//
// Plain Node environment, per the tests/CLAUDE.md two-branch rule: the module is
// host-agnostic (it reaches no browser global, it only calls a method on the
// element handed to it), so a hand-rolled fake canvas models the entire contract
// and a DOM env would prove less, not more, by hiding the null arm behind a real
// implementation that never returns null.
import { describe, expect, it } from 'vitest';
import { require2dContext } from '../src/ui/canvas_context';

/** A canvas that answers `ctx` to any getContext, and records what was asked
 *  for, which is the module's whole surface. */
function fakeCanvas(ctx: CanvasRenderingContext2D | null): {
  canvas: HTMLCanvasElement;
  asked: string[];
} {
  const asked: string[] = [];
  const canvas = {
    getContext(contextId: string) {
      asked.push(contextId);
      return ctx;
    },
  } as unknown as HTMLCanvasElement;
  return { canvas, asked };
}

describe('require2dContext', () => {
  it('hands back the host context itself, having asked for 2d and nothing else', () => {
    // Identity, not shape: the caller draws on the context the host owns, so a
    // wrapper or a copy would be a different object with a different backing
    // surface.
    const ctx = { fillRect: () => {} } as unknown as CanvasRenderingContext2D;
    const { canvas, asked } = fakeCanvas(ctx);
    expect(require2dContext(canvas)).toBe(ctx);
    expect(asked, 'the context id requested').toEqual(['2d']);
  });

  it('THROWS on a host with no 2D context instead of handing back a null', () => {
    // The reason the module exists: the eleven call sites it replaced each
    // carried a non-null bang, which hands the caller an object that is
    // actually null and fails somewhere else entirely, one frame later.
    const { canvas, asked } = fakeCanvas(null);
    expect(() => require2dContext(canvas)).toThrow('2D canvas context unavailable');
    expect(asked, 'the throw must come from a real read, not from a guard above it').toEqual([
      '2d',
    ]);
  });
});
