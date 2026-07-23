// The rule for the v02 class bodies: an INSTANT ability (no cast time) plays NO
// animation. Only cast-time spells and channels animate, and they do so via the
// renderer's base cast state (clips.cast = Spellcasting), which needs no
// per-ability wiring. So the v02 caster/hybrid/ranged classes must carry NO
// `attackByAbility` map, and their instant spells must carry NO `castFx` (which
// is what would otherwise fire a one-shot flourish on an instant cast).
//
// The WARRIOR is the deliberate exception: its shouts + Sanguine Aura + Raised
// Guard are the maintainer's original pre-v02 design (the shout roar + ground
// shockwave is a built-in feature), so it keeps its castFx/attackByAbility.
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { ABILITIES } from '../src/sim/data';

// v02 classes with no dedicated per-ability gesture map. Warrior has its original
// shouts and Rogue has the deliberately authored Kick clip.
const NO_ABILITY_GESTURES = [
  'player_paladin',
  'player_mage',
  'player_druid',
  'player_priest',
  'player_warlock',
  'player_shaman',
  'player_hunter',
] as const;

const CLEANED_CLASSES = new Set([
  'paladin',
  'mage',
  'druid',
  'priest',
  'rogue',
  'warlock',
  'shaman',
  'hunter',
]);

const ALLOWED_INSTANT_GESTURES = new Set(['rogue/kick']);

describe('instant abilities play no animation (v02 bodies)', () => {
  for (const key of NO_ABILITY_GESTURES) {
    it(`${key} has no attackByAbility flourish map`, () => {
      expect(VISUALS[key].clips.attackByAbility).toBeUndefined();
    });
  }

  it('no instant (non-cast-time, non-channel) ability on a cleaned class carries castFx', () => {
    const offenders: string[] = [];
    for (const [id, def] of Object.entries(ABILITIES)) {
      const d = def as { class?: string; castTime?: number; channel?: unknown; castFx?: string };
      if (!d.class || !CLEANED_CLASSES.has(d.class)) continue;
      const instant = (d.castTime ?? 0) === 0 && !d.channel;
      const key = `${d.class}/${id}`;
      if (instant && d.castFx && !ALLOWED_INSTANT_GESTURES.has(key)) offenders.push(key);
    }
    expect(offenders).toEqual([]);
  });

  it('leaves the warrior shouts / flourishes intact (the intentional exception)', () => {
    // anchor so the scoped guard above is not vacuous: the warrior still carries castFx.
    expect(ABILITIES.battle_shout?.castFx).toBe('shout');
    expect(ABILITIES.sanguine_aura?.castFx).toBe('weaponAura');
  });

  it('leaves the Rogue Kick dedicated gesture intact', () => {
    expect(ABILITIES.kick?.castFx).toBe('gesture');
    expect(VISUALS.player_rogue.clips.attackByAbility).toEqual({ kick: '2H_Kick' });
  });
});
