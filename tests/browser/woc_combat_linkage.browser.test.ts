import type { AnimationAction } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AnimState } from '../../src/render/characters/anim_state';
import * as assets from '../../src/render/characters/assets';
import { CharacterVisual } from '../../src/render/characters/visual';
import * as dressing from '../../src/render/characters/woc_armor_dressing';
import * as heads from '../../src/render/characters/woc_head_packs';
import { landWocFiles } from '../helpers/woc_streamed';

const idle: AnimState = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
};

function current(visual: CharacterVisual): AnimationAction {
  return (visual as unknown as { current: AnimationAction }).current;
}

describe('combat animation linkage on the shipped WOC rigs', () => {
  beforeAll(async () => {
    await assets.charactersReady();
    await landWocFiles(assets, dressing, heads);
  }, 90_000);

  for (const fit of ['', '_female']) {
    it(`Hunter${fit}: melee skills and close-range swings stay separate from shots`, () => {
      const visual = new CharacterVisual(`player_hunter${fit}`, 0xffffff);
      // What the hands hold picks each clip's variant (weapon_loadout_core.ts: a one-hander with
      // an empty off hand plays the single set), so compare against the loadout's name.
      const as = (name: string) =>
        (visual as unknown as { loadoutSwap: Record<string, string> | null }).loadoutSwap?.[name] ||
        name;
      try {
        for (const [ability, clip] of [
          ['raptor_strike', '1H_Chop'],
          ['mongoose_bite', '1H_Slash'],
          ['wing_clip', '1H_Slash'],
        ]) {
          visual.playAttack(ability, false, 'melee');
          visual.update(0.1, idle, true);
          expect(current(visual).getClip().name).toBe(as(clip));
          expect(current(visual).getEffectiveWeight()).toBeGreaterThan(0);
          expect(current(visual).time).toBeGreaterThan(0);
        }
        // the white swings and shots are the hand-keyed ones (woc_autoattack_core.ts)
        const melee = ['Woc_Attack_1H_0', 'Woc_Attack_1H_1'];
        visual.playAttack(undefined, false, 'melee');
        expect(melee).toContain(current(visual).getClip().name);
        visual.playAttack();
        expect(current(visual).getClip().name).toBe('Woc_Attack_Rifle');
        visual.playAttack(undefined, false, 'melee');
        expect(melee).toContain(current(visual).getClip().name);
      } finally {
        visual.dispose();
      }
    });

    it.each(['mage', 'priest', 'warlock', 'druid'])(
      `%s${fit}: a wand launch plays the authored spell release`,
      (cls) => {
        const visual = new CharacterVisual(`player_${cls}${fit}`, 0xffffff);
        try {
          visual.playAttack(undefined, false, 'wand');
          visual.update(0.1, idle, true);
          expect(current(visual).getClip().name).toBe('Cast_Shoot');
          expect(current(visual).getEffectiveWeight()).toBeGreaterThan(0);
          expect(current(visual).time).toBeGreaterThan(0);
        } finally {
          visual.dispose();
        }
      },
    );

    it.each([
      ['hunter', 'tame_beast'],
      ['hunter', 'revive_pet'],
      ['druid', 'tranquility'],
    ])(`%s${fit}: %s uses a continuous casting gesture`, (cls, ability) => {
      const visual = new CharacterVisual(`player_${cls}${fit}`, 0xffffff);
      try {
        const state = { ...idle, casting: true, castingAbility: ability };
        for (let frame = 0; frame < 90; frame++) visual.update(1 / 60, state, true);
        expect(current(visual).getClip().name).toBe('Cast_Loop');
        expect(current(visual).paused).toBe(false);
        expect(current(visual).getEffectiveWeight()).toBeGreaterThan(0);
      } finally {
        visual.dispose();
      }
    });
  }
});
