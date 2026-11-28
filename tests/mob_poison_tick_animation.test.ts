// A mob's own on-hit poison (MobTemplate.stackPoison) ticks on its own clock: each tick is the
// wound, never another swing of the mob that laid it (src/render/characters/
// damage_attack_animation.ts isMobPoisonTick). The Splinter of the Hammer's physical Mounting
// Weight was the one poison the renderer read as a swing: every tick restarted its attack and cut
// its Shearing Blow.

import { describe, expect, it } from 'vitest';
import {
  damageEventStartsAttackAnimation,
  isMobPoisonTick,
} from '../src/render/characters/damage_attack_animation';
import { MOBS } from '../src/sim/data';

const HAMMER = 'heart_final_splinter_hammer';

describe("a mob's poison ticks", () => {
  it("are the poison's own ticks, by its template and its name", () => {
    expect(MOBS[HAMMER].stackPoison?.name).toBe('Mounting Weight');
    expect(MOBS[HAMMER].stackPoison?.school).toBe('physical');
    expect(isMobPoisonTick(HAMMER, 'Mounting Weight')).toBe(true);
    // Another mob's same-named hit is not its poison, and nothing without a template is.
    expect(isMobPoisonTick('heart_ring_warder', 'Mounting Weight')).toBe(false);
    expect(isMobPoisonTick(undefined, 'Mounting Weight')).toBe(false);
    expect(isMobPoisonTick(HAMMER, null)).toBe(false);
  });

  it('never start a swing, while its own blows still do', () => {
    const hammer = { kind: 'mob', templateId: HAMMER, castingAbility: null };
    expect(damageEventStartsAttackAnimation(hammer, null, undefined, 'Mounting Weight')).toBe(
      false,
    );
    expect(damageEventStartsAttackAnimation(hammer, null, undefined, null)).toBe(true);
  });

  it('cover every mob poison the renderer could read as a swing', () => {
    // Only a physical hit starts a swing (renderer.ts's damage arm), so a physical poison is the
    // case this rule exists for; every one is caught.
    for (const [id, m] of Object.entries(MOBS)) {
      const poison = m.stackPoison;
      if (poison?.school !== 'physical') continue;
      expect(isMobPoisonTick(id, poison.name), id).toBe(true);
    }
  });
});
