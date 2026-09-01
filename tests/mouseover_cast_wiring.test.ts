// The mouseover-cast SEAM end to end, for the target-of-target frame:
// mouseenter publishes a resolver -> Hud parks it on `hoveredCastUnit` ->
// castSlot reads it back through `mouseoverCastTarget` and redirects the press.
//
// tests/mouseover_cast_core.test.ts covers the rule and
// tests/totarget_frame_controller.test.ts covers the frame's own routes, but
// neither proves the two HALVES meet (PR review caught exactly that gap: the
// composition was only ever exercised for the party rows). So this file drives
// the real controller into the real core through a stand-in consumer shaped like
// Hud's, and then PINS hud.ts's own wiring to source, because a stand-in that
// drifts from the coordinator would prove nothing.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { type MouseoverCastAbility, mouseoverCastTarget } from '../src/ui/mouseover_cast_core';
import { installTargetOfTargetControls } from '../src/ui/totarget_frame_controller';
import { FakeDocument } from './helpers/fake_dom';

const HEAL: MouseoverCastAbility = { requiresTarget: true, targetType: 'friendly' };
const NUKE: MouseoverCastAbility = { requiresTarget: true, targetType: 'enemy' };

/** The two lines Hud actually owns, in one place: the field the controller's
 *  onHover parks a resolver on, and the castSlot read that consumes it. Kept in
 *  lockstep with hud.ts by the source pins at the bottom of this file. */
class StandInHud {
  hoveredCastUnit: (() => number | null) | null = null;
  mouseoverCast = true;
  /** Ids the client still knows about. */
  entities = new Set<number>([42, 9]);

  /** castSlot's friendly-ability arm: the id it would cast on, or null to cast
   *  normally at the current target. */
  pressed(ability: MouseoverCastAbility): number | null {
    return mouseoverCastTarget(this.hoveredCastUnit?.() ?? null, {
      enabled: this.mouseoverCast,
      ability,
      exists: (id) => this.entities.has(id),
    });
  }
}

let doc: FakeDocument;
let frame: ReturnType<FakeDocument['createElement']>;
let hud: StandInHud;
let subject: number | null;
let unlocked: boolean;

beforeEach(() => {
  doc = new FakeDocument();
  frame = doc.createElement('div');
  hud = new StandInHud();
  subject = 42;
  unlocked = false;
  installTargetOfTargetControls(frame as unknown as HTMLElement, {
    subjectId: () => subject,
    onTarget: () => {},
    onMenu: () => {},
    onHover: (resolve) => {
      hud.hoveredCastUnit = resolve;
    },
    isInterfaceUnlocked: () => unlocked,
    isMobileLayout: () => false,
  });
});

const enter = () => frame.dispatchEvent(new Event('mouseenter'));
const leave = () => frame.dispatchEvent(new Event('mouseleave'));

describe('target-of-target mouseover cast, controller through core', () => {
  it('redirects a friendly press onto the frame while the cursor is over it', () => {
    expect(hud.pressed(HEAL)).toBeNull(); // nothing hovered yet
    enter();
    expect(hud.pressed(HEAL)).toBe(42);
  });

  it('stops redirecting once the cursor leaves', () => {
    enter();
    leave();
    expect(hud.hoveredCastUnit).toBeNull();
    expect(hud.pressed(HEAL)).toBeNull();
  });

  it('follows a tot SWAP under a still cursor (the reason onHover passes a resolver)', () => {
    // The whole point of publishing a resolver instead of an id: the target's
    // target changes without the cursor moving, so no mouseenter fires and a
    // latched id would land the heal on whoever used to be on the frame.
    enter();
    subject = 9;
    expect(hud.pressed(HEAL)).toBe(9);
  });

  it('falls back to a normal cast when the frame empties under a still cursor', () => {
    enter();
    subject = null;
    expect(hud.pressed(HEAL)).toBeNull();
  });

  it('never redirects an offensive press off the current target', () => {
    enter();
    expect(hud.pressed(NUKE)).toBeNull();
  });

  it('respects the mouseoverCast option through the whole chain', () => {
    enter();
    hud.mouseoverCast = false;
    expect(hud.pressed(HEAL)).toBeNull();
  });

  it('goes inert while the interface editor owns the frame', () => {
    enter();
    unlocked = true;
    expect(hud.pressed(HEAL)).toBeNull();
  });

  it('falls back when the hovered unit left the client roster', () => {
    enter();
    hud.entities.delete(42);
    expect(hud.pressed(HEAL)).toBeNull();
  });
});

// The stand-in above is only evidence while it matches the coordinator. These
// pin the two hud.ts lines it stands in for, so moving either one fails here
// instead of silently making the composition test fictional.
describe('hud.ts really wires the seam the test above stands in for', () => {
  const hud_ts = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8').replace(
    /\s+/g,
    ' ',
  );

  it('parks the target-of-target controller resolver on hoveredCastUnit', () => {
    expect(hud_ts).toContain('installTargetOfTargetControls(this.totFrameEl, {');
    expect(hud_ts).toContain('onHover: (resolve) => { this.hoveredCastUnit = resolve; }');
  });

  it('feeds that field back into mouseoverCastTarget on the cast path', () => {
    expect(hud_ts).toContain('mouseoverCastTarget(this.hoveredCastUnit?.() ?? null, {');
    // The option gate and the staleness probe travel with it, which is what makes
    // the stand-in's `enabled` / `exists` the same two inputs the real call passes.
    expect(hud_ts).toContain("enabled: this.optionsHooks?.settings.get('mouseoverCast') ?? true");
    expect(hud_ts).toContain('exists: (id) => this.sim.entities.has(id)');
  });

  it('keeps the party rows on the SAME field, so one seam serves both frames', () => {
    expect(hud_ts).toContain('onHover: (pid) => { this.hoveredCastUnit = pid === null');
  });
});
