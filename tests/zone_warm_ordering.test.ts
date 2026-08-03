// The zone-warm ordering invariant inside main.ts's frame().
//
// maybeWarmCurrentZone() decides between the blocking loading screen and a
// silent background stream, and it reads TWO things that must agree: the
// player's position and whether a scene is covering the jump. They only agree
// once the frame has applied its events. A synchronous world command is what
// pulls them apart: the ferry fare answers through world.answerSceneChoice()
// straight off the dialog click, which teleports the entity to the far harbor
// immediately while the 'scene' start op it queues waits for the next drain.
// Called at the top of frame(), the check therefore saw the destination with
// sceneActive still false, read the 500+ yard displacement as an uncovered
// teleport, and raised the blocking loading screen in the middle of the
// authored voyage (the first mainland -> Gullhaven crossing, the only one
// where the destination is not already resident).
//
// This is a coordinator ordering fact, so it is pinned the way this repo pins
// the other ones (hud_update_drive.test.ts): parse the real source and assert
// the call order, rather than trying to unit-test a 5000 line frame loop.
// Call EXPRESSIONS are collected through the AST, never by text search: the
// explanation left at the old call site names the function too, and a text
// scan matches that comment and passes over any ordering at all.
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const MAIN = new URL('../src/main.ts', import.meta.url).pathname;

/** The `frame(now)` render-loop body node in main.ts, with its source file. */
function frameBody(): { body: ts.Block; sf: ts.SourceFile } {
  const source = readFileSync(MAIN, 'utf8');
  const sf = ts.createSourceFile(MAIN, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let body: ts.Block | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'frame' &&
      node.body !== undefined &&
      // the render loop, not some other frame(): it re-arms itself
      node.body.getText(sf).includes('requestAnimationFrame(frame)')
    ) {
      body = node.body;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (body === null) throw new Error('main.ts no longer declares the frame(now) render loop');
  return { body, sf };
}

/** Start offsets of every call to `name` evaluated inside frame(), in order. */
function callOffsets(name: string): number[] {
  const { body } = frameBody();
  const found: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const text = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : null;
      if (text === name) found.push(node.getStart());
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found.sort((a, b) => a - b);
}

describe('zone warm ordering in frame()', () => {
  it('never samples the zone-warm decision before the frame applies its events', () => {
    const warm = callOffsets('maybeWarmCurrentZone');
    expect(warm.length, 'frame() no longer calls maybeWarmCurrentZone()').toBeGreaterThan(0);

    // The two points at which this frame's scene ops become visible to the
    // director: the online mirror drain and the offline sim tick.
    const onlineDrain = callOffsets('drainMirroredSceneInput');
    const offlineTick = callOffsets('tick').concat(callOffsets('drainEvents'));
    expect(onlineDrain.length, 'frame() no longer drains mirrored scene input').toBeGreaterThan(0);

    const simTick = frameBody().body.getText().indexOf('offlineSim.tick()');
    expect(simTick, 'frame() no longer ticks the offline sim').toBeGreaterThan(-1);
    expect(offlineTick.length, 'frame() evaluates no tick call at all').toBeGreaterThan(0);

    // EVERY call must sit after the online drain, so neither host can read a
    // position the scene director has not caught up with yet.
    for (const at of warm) {
      expect(
        at,
        `a maybeWarmCurrentZone() call at offset ${at} precedes the online scene drain`,
      ).toBeGreaterThan(onlineDrain[0]);
    }
  });

  it('warms both hosts: the offline branch returns early, so each needs its own call', () => {
    // The offline arm ends in `return`, so a single shared call downstream
    // would silently stop warming offline play (the mode this bug shipped in).
    expect(
      callOffsets('maybeWarmCurrentZone').length,
      'both the offline and online arms must warm the current zone',
    ).toBe(2);
  });
});
