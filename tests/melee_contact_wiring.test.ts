// The blade-contact presentation hold is wired end to end (2026-09-28): the renderer's damage
// arm starts the swing, records the swing's contact for the event and holds the target-side
// effects until it; the hud stages the number and plays the impact sound at that contact; the
// renderer ticks the hold every frame. The pieces are unit-tested in contact_queue.test.ts,
// attack_swing_core.test.ts, fct_painter.test.ts and woc_motion.test.ts; this pins the joins.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const renderer = readFileSync('src/render/renderer.ts', 'utf8');
const hud = readFileSync('src/ui/hud.ts', 'utf8');

describe('melee contact wiring', () => {
  it('the damage arm records the swing contact and holds the impact until it', () => {
    expect(renderer).toContain(
      "const contact = swings ? this.triggerAttack(ev.sourceId, attackId, false, 'melee') : 0;",
    );
    expect(renderer).toContain(
      'this.contactQueue.note(ev, contact, ev.targetId, performance.now());',
    );
    // a kill's collapse waits for the blade
    expect(renderer).toContain('!this.contactQueue.holdsDeath(e.id, this.lastSyncStart)');
    expect(renderer).toContain('presentMeleeContact(this.meleeContactHost, ev, warrior)');
    expect(renderer).toContain('this.contactQueue.after(contact, performance.now(), () =>');
  });

  it('triggerAttack returns the contact the visual reported', () => {
    expect(renderer).toContain('else return visual.playAttack(abilityId, gestureOnly, kind);');
  });

  it('the renderer ticks the hold once per frame', () => {
    expect(renderer).toContain('this.contactQueue.tick(totalStart);');
  });

  it('the hud stages the number and the impact sound at the contact', () => {
    expect(hud).toContain('contactDelaySec: (s) => this.renderer.contactDelayFor(s)');
    expect(hud).toContain('this.renderer.atContact(ev, () => this.playEventSfx(ev));');
  });
});
