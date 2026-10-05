// The blade-contact presentation hold is wired end to end (2026-09-28): the renderer's damage
// arm starts the swing, records the swing's contact for the event and holds the target-side
// effects until it; the hud stages the number and plays the impact sound at that contact; the
// renderer ticks the hold every frame. The pieces are unit-tested in contact_queue.test.ts,
// attack_swing_core.test.ts, fct_painter.test.ts and woc_motion.test.ts; this pins the joins.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

// Pins read the code with its full-line comments removed, so a commented-out line or the
// sentence describing a line can never stand in for it.
const renderer = codeWithoutLineComments(readFileSync('src/render/renderer.ts', 'utf8'));
const hud = codeWithoutLineComments(readFileSync('src/ui/hud.ts', 'utf8'));

/** `source` from `from` up to (not including) `to`, both anchors required. */
function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  expect(start, `anchor not found: ${from}`).toBeGreaterThan(-1);
  const end = source.indexOf(to, start + from.length);
  expect(end, `end anchor not found: ${to}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

const count = (source: string, text: string): number => source.split(text).length - 1;

describe('melee contact wiring', () => {
  it('the damage arm records the swing contact and holds the impact until it', () => {
    expect(renderer).toContain(
      "const contact = swings ? this.triggerAttack(ev.sourceId, attackId, false, 'melee') : 0;",
    );
    expect(renderer).toContain(
      'this.contactQueue.note(ev, contact, ev.targetId, performance.now());',
    );
    expect(renderer).toContain('presentMeleeContact(this.meleeContactHost, ev, warrior)');
    expect(renderer).toContain('this.contactQueue.after(contact, performance.now(), () =>');
  });

  it('triggerAttack returns the contact the visual reported', () => {
    expect(renderer).toContain('else return visual.playAttack(abilityId, gestureOnly, kind);');
  });

  it('the renderer ticks the hold once per frame, before the entity pass reads it', () => {
    // The tick runs the due effects AND stamps the clock a death hold is read against
    // (ContactQueue.holdsDeath defaults to it): without it no hold would ever pass.
    expect(count(renderer, 'this.contactQueue.tick(')).toBe(1);
    const frame = between(renderer, '  sync(\n', '\n  }\n');
    const clock = frame.indexOf('const totalStart = performance.now();');
    const tick = frame.indexOf('this.contactQueue.tick(totalStart);');
    const read = frame.indexOf('this.contactQueue.holdsDeath(e.id)');
    // the frame clock the rest of the frame is timed from, then the tick, then the read
    expect(clock).toBeGreaterThan(-1);
    expect(tick).toBeGreaterThan(clock);
    expect(read).toBeGreaterThan(tick);
  });

  it('the hud stages the number and the impact sound at the contact', () => {
    expect(hud).toContain('contactDelaySec: (s) => this.renderer.contactDelayFor(s)');
    // its own method and itself, never a closure: this line runs for EVERY sim event, and all
    // but a held melee hit play at once (ContactQueue.atContact)
    expect(count(hud, 'this.renderer.atContact(')).toBe(1);
    const call = between(hud, 'this.renderer.atContact(', ';');
    expect(call).toBe('this.renderer.atContact(ev, this.playEventSfx, this)');
    expect(call).not.toContain('=>');
    expect(call).not.toContain('function');
    expect(call).not.toContain('.bind(');
  });

  it('the renderer hands the method and its receiver on to the queue, unwrapped', () => {
    // (driven for real, receiver and event included, in tests/woc_hunter_aim_release.test.ts)
    const method = between(renderer, '  atContact<E extends object, S>(', '\n  }\n');
    expect(method).toContain('this.contactQueue.atContact(ev, performance.now(), fn, self);');
    // the one arrow in it is the `fn` parameter's own type: nothing is wrapped on the way
    expect(count(method, '=>')).toBe(1);
    expect(method).toContain('fn: (this: S, ev: E) => void');
  });

  it('the hud holds an absorbed text with the number of the strike it reports', () => {
    const site = between(hud, 'if ((ev.absorbed ?? 0) > 0) {', "ev.kind === 'miss' ||");
    // spawned WITH its strike (FctPainter.spawn's third argument)...
    expect(count(site, 'this.fctPainter.spawn(')).toBe(1);
    expect(site).toMatch(/now,\s+ev,\s+\);/);
    // ...and before either shape of that strike is staged, which then shares the one beat
    const absorbAt = hud.indexOf('if ((ev.absorbed ?? 0) > 0) {');
    const numberStaged = hud.indexOf('const hitShape = this.fctPainter.stagedShape(ev, now, {');
    const wordStaged = hud.indexOf('const shape = this.fctPainter.stagedShape(ev, now, {');
    expect(numberStaged).toBeGreaterThan(absorbAt);
    expect(wordStaged).toBeGreaterThan(absorbAt);
  });
});

// A kill's collapse waits for the blade that dealt it, and the mount under a seated rider
// and the wings on a paladin wait with it: the renderer asks the queue once per body per
// frame and all three read that one answer (contact_queue.ts collapsed / heldUntilCollapse;
// the mount and wing modules are driven through a held kill in tests/mount_lifecycle.test.ts
// and tests/paladin_avenging_wrath_visual.test.ts).
describe('one death hold per body, read by the pose, the mount and the wings', () => {
  it('asks the queue once per body, against the frame clock the queue was ticked with', () => {
    expect(renderer).toContain(
      'const deathHeld = isVisuallyDead(e) && !e.ghost && this.contactQueue.holdsDeath(e.id);',
    );
    expect(count(renderer, 'contactQueue.holdsDeath(')).toBe(1);
    // the queue's own clock: the renderer keeps no second copy of the frame start for it
    expect(renderer).not.toContain('lastSyncStart');
  });

  it('the death pose reads the hold', () => {
    expect(renderer).toContain(
      'const visuallyDead = collapsed(isVisuallyDead(e) && !e.ghost, deathHeld);',
    );
    expect(renderer).toContain('st.dead = visuallyDead;');
  });

  it("the mount reads the hold, through the key the rider's last frame presented", () => {
    // the sim clears Entity.mountKey on the death tick, so a held body presents the last one,
    // and only a body that was SEATED on its mount the frame before (v.mountLift, written
    // further down this pass): a mount hidden under a form, or still linking, is not summoned
    // for the hold
    expect(renderer).toContain(
      'const mountKey = heldUntilCollapse(deathHeld && v.mountLift > 0, e.mountKey, v.lastMountKey);',
    );
    const heldRead = renderer.indexOf('const mountKey = heldUntilCollapse(');
    const liftWrite = renderer.indexOf(
      'v.mountLift = mountPresented && mountSpec ? mountSpec.seat : 0;',
    );
    expect(heldRead).toBeGreaterThan(-1);
    expect(liftWrite).toBeGreaterThan(heldRead);
    expect(count(renderer, 'v.mountLift = ')).toBe(1);
    expect(renderer).toContain(
      "const mountSpec = e.kind === 'player' ? mountVisualSpecFor(mountKey, e.mountSkinId) : null;",
    );
    expect(renderer).toContain(
      "const mountShown = !!mountSpec && requestedForm === 'base' && !collapsed(e.dead, deathHeld);",
    );
    // every other read of the ride in the entity pass follows the PRESENTED key: the stowed
    // weapon, the look the audio and the presentation key on, and the transition FX, whose
    // lastMountKey record is what the next held frame presents
    expect(renderer).toContain(
      "const stowed = weaponStowedOverlay(e.weaponStowed, swimming, mountKey !== '');",
    );
    expect(renderer).toContain('const mountLook = mountPresentationKey(mountKey, e.mountSkinId);');
    const transition = between(
      renderer,
      'v.wasMountCasting = syncMountTransitionFx(v, {',
      '\n        });\n',
    );
    expect(transition).toContain('\n          mountKey,\n');
    expect(transition).toContain(
      'mountLook: mountPresentationKey(e.mountCastKey || mountKey, e.mountSkinId),',
    );
    expect(transition).not.toContain('e.mountKey');
    // the live key is read exactly once in the pass: where the presented one is derived
    const pass = between(renderer, 'const deathHeld =', 'updateMountPresentation(v, {');
    expect(count(pass, 'e.mountKey')).toBe(1);
  });

  it('the wings read the hold, against the wings the body showed the frame before', () => {
    expect(renderer).toContain(
      'heldUntilCollapse(deathHeld, !e.dead && hasPaladinWings, !!v.paladinAvengingWrathVisual),',
    );
    // the one place the wing flag is handed on
    expect(count(renderer, 'hasPaladinWings,')).toBe(1);
  });

  it('nothing else in the entity pass reads the hold', () => {
    // One definition and four reads: the pose, the mount (its key and whether it shows) and
    // the wings. Health, nameplate content, target frames, cast bars and the combat log are
    // read off the entity elsewhere and never see this local.
    expect(count(renderer, 'deathHeld')).toBe(5);
    expect(count(renderer, 'heldUntilCollapse(')).toBe(2);
    expect(count(renderer, 'collapsed(')).toBe(2);
    // the nameplate pass decides its own death from the entity
    expect(renderer).toContain('const dead = !!e.dead;');
  });
});
