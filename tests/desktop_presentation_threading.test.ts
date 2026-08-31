import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Source pins for the presentation-gate threading through src/main.ts
// (phase 4 QA F4/F5/F9). main.ts is a coordinator with no unit seam, so the
// decisive threading sites are pinned as source text sliced to the frame()
// body (never whole-file substring matches: proximity is not containment).
// These pins catch DELETION and polarity flips of the exact expressions; the
// live behavior is held by the committed E2E rig
// (scripts/desktop_hidden_skip_probe.mjs), whose presented-frames and
// bucket-sample arms are deterministic on any GPU.

const sourcePath = path.resolve(process.cwd(), 'src/main.ts');
const sourceText = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true);

function frameBody(): string {
  let frame: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'frame') {
      frame = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!frame) throw new Error('src/main.ts frame() was not found');
  return frame.getText(sourceFile);
}

/** The source text of the one `const <name> = ...` declaration, so a pin is
 *  scoped to the declaration itself rather than matched anywhere in the file. */
function declarationText(name: string): string {
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) throw new Error(`src/main.ts ${name} was not found`);
  return found.getText(sourceFile);
}

/** Every call of `<callee>(...)`, each as its own source slice, so an argument
 *  pin cannot be satisfied by text that merely sits near the call. */
function callTexts(callee: string): string[] {
  const calls: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === callee) calls.push(node.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

const flat = (text: string) => text.replace(/\s+/g, ' ');
// Line comments drop before flattening: an inline comment's punctuation would
// otherwise break call-span matching (frame() has no string containing '//').
const stripLineComments = (text: string) =>
  text
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

describe('the presentation gate threading in main.ts frame()', () => {
  const body = flat(stripLineComments(frameBody()));

  it('derives the gate input from BOTH hidden sources and evaluates the gate once', () => {
    // The desktop shell pins the Page Visibility API at 'visible', so the
    // shell push is the only truthful hidden signal there; the OR keeps the
    // web arm working in the same expression.
    expect(body).toContain('gateInput.hidden = document.hidden || desktopPresentationHidden();');
    expect(body.match(/const gate = presentationGate\(gateInput\);/g)).toHaveLength(1);
  });

  it('early-returns a no-tick frame after resetting the accumulator', () => {
    expect(body).toContain('if (!gate.tick) { last = now; acc = 0; return; }');
  });

  it('samples the frame only when rendering, counts the skip otherwise, and sets the sampling switch', () => {
    expect(body).toContain('perf.setFrameSampling(gate.render);');
    expect(body).toContain(
      'if (gate.render) perf.frame(frameDt); else perf.noteHiddenPresentSkip();',
    );
  });

  it('threads the gate drawWorld decision as the present argument of BOTH renderer.sync call sites', () => {
    // One arm per site (joint coverage masks a deleted site): the offline and
    // online branches each carry their own sync call ending in drawWorld, a
    // FRESH gate read taken right before the call (maybeWarmCurrentZone, earlier
    // in the same frame, may have held the world draw for this very frame: the
    // landing frame of a blocking arrival must not draw the destination cold).
    // (?!\)) skips the argument-less mention inside a comment; every real call
    // site passes arguments.
    const syncCalls = body.match(/renderer\.sync\((?!\))[^;]*?\);/g) ?? [];
    const presentThreaded = syncCalls.filter((call) => /,\s*drawWorld,?\s*\)/.test(call));
    expect(syncCalls).toHaveLength(2);
    expect(presentThreaded).toHaveLength(2);
    expect(body.match(/const drawWorld = presentationGate\(gateInput\)\.drawWorld;/g)).toHaveLength(
      2,
    );
    // The gate input is the module's factory (its holdWorldDraw is what the
    // blocking arrival chain receives), never a literal: pinned on the
    // declaration slice, not anywhere in the file.
    expect(flat(stripLineComments(declarationText('gateInput')))).toBe(
      'gateInput = newPresentationGateInput(DESKTOP_APP)',
    );
    // And the hold is handed to the ARRIVAL WARMUP itself. Scoped to that call
    // expression: a whole-file match would pass on the property surviving in
    // some unrelated object literal while the warmup lost it.
    const warmupCalls = callTexts('runBlockingArrivalWarmup');
    expect(warmupCalls).toHaveLength(1);
    expect(flat(stripLineComments(warmupCalls[0]))).toContain(
      'holdWorldDraw: gateInput.holdWorldDraw,',
    );
    // And the hold is a BOOLEAN, so the in-flight-warmup early-out is the one
    // thing keeping a second arrival from racing the first one's release: it
    // would hold the draw again and let the first chain's end free it under a
    // still-covered arrival. Scoped to the declaration, like the pins below.
    expect(flat(stripLineComments(declarationText('maybeWarmCurrentZone')))).toContain(
      'if (zoneWarmup) return;',
    );
  });

  it('drives the HUD non-paint head on hidden frames at BOTH call sites', () => {
    expect(body.match(/} else hud\.update\(false\);/g)).toHaveLength(2);
  });

  it('keeps the stateless paint/render helpers gated and the breath timer ungated (F7)', () => {
    expect(body.match(/if \(gate\.render\) syncGroundAimReticle\(\);/g)).toHaveLength(2);
    expect(body).toContain('if (gate.paint) spectateBadge.update(net.spectating);');
    expect(body).toContain('if (gate.paint) maybeShowImmobileNote(now);');
    expect(
      body.match(
        /if \(gate\.render\) \{ traceStart = perf\.startTrace\(\); try \{ updateClickMoveMarker\(\);/g,
      ),
    ).toHaveLength(2);
    // The breath bar accumulates a client-side timer; gating it would show a
    // restored player more breath than they have. One arm per direction.
    expect(body).toContain('updateBreathBar(frameDt);');
    expect(body).not.toContain('if (gate.paint) updateBreathBar');
    expect(body).not.toContain('if (gate.render) updateBreathBar');
  });

  it('gates perf.tick on render and keeps the liveness breadcrumb unconditional at BOTH sites', () => {
    expect(body.match(/if \(gate\.render\) perf\.tick\(now\);/g)).toHaveLength(2);
    const breadcrumbs = body.match(/entryDiagnostics\.renderedFrame\(now\);/g) ?? [];
    expect(breadcrumbs).toHaveLength(2);
    // Never behind the gate: a client launched minimized is alive, not stuck.
    expect(body).not.toContain('if (gate.render) entryDiagnostics.renderedFrame');
    expect(body).not.toContain('if (gate.paint) entryDiagnostics.renderedFrame');
  });
});

describe('the perf reporter shellHidden wiring (phase 4 QA F9)', () => {
  it('passes the presentation latch to the one startPerfReporter call, next to desktopShell', () => {
    // This exact property line was re-added BY HAND during the v0.36.0 base
    // merge (upstream rebuilt the world reveal around it); deleting it
    // typechecks clean because the option is optional, so pin it inside the
    // call slice rather than trusting the merge again.
    const calls = [...sourceText.matchAll(/startPerfReporter\(\{[\s\S]*?\}\);/g)].map((m) =>
      flat(m[0]),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('desktopShell: DESKTOP_APP,');
    expect(calls[0]).toContain('shellHidden: desktopPresentationHidden,');
  });
});

describe('the shell integration boot ordering (phase 4 QA F5)', () => {
  it('subscribes to the presentation push at module top level, before did-finish-load can fire', () => {
    // The shell's only unprompted initial push rides did-finish-load, and the
    // channel has no replay: a subscription moved behind a dynamic import or
    // a top-level await would silently lose a launch-minimized hidden=true
    // (the 15 s main-side re-derive backstop then bounds the loss, but the
    // ordering is the primary guarantee). Pin the top-level statement.
    expect(sourceText).toContain('\nif (DESKTOP_APP) initDesktopShellIntegration();');
    // And it must not be awaited or deferred: the statement above is a plain
    // synchronous top-level call, so a regression here means the literal
    // changed shape and this pin names the contract it must keep.
    expect(sourceText).not.toContain('await initDesktopShellIntegration');
    expect(sourceText).not.toMatch(/import\(['"]\.\/game\/desktop_shell_integration['"]\)/);
  });
});

describe('the hidden-shell zone-warm pause (phase 8 GPU lane audit, lane 1)', () => {
  // maybeWarmCurrentZone is the one recurring background GPU producer that
  // runs outside gate.render (it sits after the gate.tick early-out, so a
  // hidden shell re-evaluates it every frame), and it kicks the heaviest
  // work in the lane set (zone prepare: PMREM, texture uploads, terrain
  // chunk builds ride it transitively). The freeze SEMANTICS (no baseline
  // consumption, rift edge preserved, accumulated reveal displacement) are
  // behavior-tested in tests/zone_warm_tracker.test.ts; these pins hold the
  // composition: the latch threaded as the tracker's hidden argument, and
  // the no-answer early-out except for a newly observed dungeon entry.
  it('threads the presentation latch into the tracker and preserves dungeon entry alignment', () => {
    const body = flat(stripLineComments(declarationText('maybeWarmCurrentZone')));
    expect(body).toContain(
      'const warm = warmTracker(player.pos.x, player.pos.z, desktopPresentationHidden());',
    );
    expect(body).toContain('if (!warm && !dungeonEntryChanged) return;');
    expect(body).toContain("const cameraArrival = dungeonEntryChanged ? 'dungeon' :");
    // Polarity: neither the latch nor the bail may pick up a stray negation.
    expect(body).not.toContain('!desktopPresentationHidden()');
    expect(body).not.toContain('if (warm) return;');
    expect(body).not.toContain('if (!warm) return;');
    // The tracker call is the FIRST statement after the player read, so no
    // warm work precedes the hidden decision.
    expect(body.indexOf('const warm = warmTracker(')).toBeLessThan(body.indexOf('zoneWarmup'));
  });

  it('builds the tracker once, on the real rift predicate', () => {
    expect(sourceText).toContain('const warmTracker = createZoneWarmTracker(isRiftPos);');
    expect([...sourceText.matchAll(/createZoneWarmTracker\(/g)]).toHaveLength(1);
  });
});

describe('the renderer governor hold on hidden frames (phase 4 QA F6)', () => {
  // The one behavioral seam upstream of this call is frame telemetry, which
  // runs BEFORE the guard and so cannot observe it; presentedFrames() sits
  // downstream but only in E2E territory. Pin the statement itself: a hidden
  // frame carries no rendering signal, so feeding its wall-clock dt to the
  // governor reads hidden time as free headroom and ratchets quality up for
  // the first frame back on screen.
  const rendererText = stripLineComments(
    fs.readFileSync(path.resolve(process.cwd(), 'src/render/renderer.ts'), 'utf8'),
  );

  it('drives the adaptive-resolution governor from exactly one guarded call site', () => {
    const body = flat(rendererText);
    expect(body.match(/this\.updateAdaptiveResolution\(/g)).toHaveLength(1);
    // The full containing statement, sliced back to the previous statement or
    // brace boundary, so guard deletion, a polarity flip to !present, and a
    // second unguarded call site each fail here.
    const statements = (body.match(/[^;{}]*this\.updateAdaptiveResolution\([^;]*;/g) ?? []).map(
      (statement) => statement.trim(),
    );
    expect(statements).toEqual(['if (present) this.updateAdaptiveResolution(dt);']);
  });
});
