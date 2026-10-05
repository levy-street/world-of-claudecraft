// src/render/characters/weapon_loadout_core.ts: which clip set a WOC body plays for what its
// hands hold (two-hand weapon, one-hand weapon with a free off hand, a weapon in each hand, or
// the default clips), and how a clip name resolves through a loadout's swap map.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type ClipMap, VISUALS } from '../src/render/characters/manifest';
import {
  type LoadoutFacts,
  swappedClip,
  weaponLoadout,
} from '../src/render/characters/weapon_loadout_core';
import { weaponTypeForItem } from '../src/sim/content/weapon_skin_rules';
import { ITEMS } from '../src/sim/data';
import { weaponHand } from '../src/sim/equipment_rules';

// a warrior-shaped body: shows the equipped mainhand and offhand, no fixed off-hand prop
const body = (over: Partial<LoadoutFacts>): LoadoutFacts => ({
  mainhandItemId: null,
  offhandItemId: null,
  stowed: false,
  showsMainhand: true,
  showsOffhand: true,
  fixedOffhand: false,
  ...over,
});

describe('weaponLoadout', () => {
  it('fixtures are what the rules key on', () => {
    const great = ITEMS.eastbrook_greatsword;
    const staff2h = ITEMS.briarroot_staff;
    expect(great.kind === 'weapon' && weaponHand(great)).toBe('twohand');
    expect(staff2h.kind === 'weapon' && weaponHand(staff2h)).toBe('twohand');
    expect(weaponTypeForItem('briarroot_staff')).toBe('staff');
    expect(weaponTypeForItem('gnarled_staff')).toBe('staff');
    expect(ITEMS.rusty_dagger.kind).toBe('weapon');
    expect(ITEMS.eastbrook_buckler).toBeDefined();
  });

  it('a two-hand weapon is the two-hand loadout while the off hand holds no weapon', () => {
    expect(weaponLoadout(body({ mainhandItemId: 'eastbrook_greatsword' }))).toBe('twohand');
    // an offhand the body cannot show leaves that hand empty: still the one two-hander
    expect(
      weaponLoadout(
        body({
          mainhandItemId: 'eastbrook_greatsword',
          offhandItemId: 'eastbrook_greatsword',
          showsOffhand: false,
        }),
      ),
    ).toBe('twohand');
  });

  it("a Titan's Grip pair (a two-hander in either hand) plays the dual set, never the two-hand one", () => {
    expect(
      weaponLoadout(
        body({ mainhandItemId: 'eastbrook_greatsword', offhandItemId: 'eastbrook_greatsword' }),
      ),
    ).toBe('dual');
    expect(
      weaponLoadout(
        body({ mainhandItemId: 'eastbrook_greatsword', offhandItemId: 'rusty_dagger' }),
      ),
    ).toBe('dual');
    expect(
      weaponLoadout(
        body({ mainhandItemId: 'rusty_dagger', offhandItemId: 'eastbrook_greatsword' }),
      ),
    ).toBe('dual');
  });

  it('a staff is carried in one hand, even one flagged two-hand', () => {
    expect(weaponLoadout(body({ mainhandItemId: 'briarroot_staff' }))).toBe('single');
    expect(weaponLoadout(body({ mainhandItemId: 'gnarled_staff' }))).toBe('single');
  });

  it('a one-hand weapon plays the single set only while the off hand is empty', () => {
    expect(weaponLoadout(body({ mainhandItemId: 'rusty_dagger' }))).toBe('single');
    expect(
      weaponLoadout(body({ mainhandItemId: 'rusty_dagger', offhandItemId: 'eastbrook_buckler' })),
    ).toBeNull();
  });

  it('a blade in each hand plays the dual set (the crossed guard); a shield never does', () => {
    expect(ITEMS.eastbrook_buckler.kind).not.toBe('weapon');
    expect(
      weaponLoadout(body({ mainhandItemId: 'rusty_dagger', offhandItemId: 'rusty_dagger' })),
    ).toBe('dual');
    expect(
      weaponLoadout(body({ mainhandItemId: 'worn_sword', offhandItemId: 'rusty_dagger' })),
    ).toBe('dual');
    // an empty mainhand shows the class default blade, so the hands still hold two
    expect(weaponLoadout(body({ offhandItemId: 'rusty_dagger' }))).toBe('dual');
    // a body that cannot show its mainhand is not holding two blades
    expect(
      weaponLoadout(
        body({
          showsMainhand: false,
          mainhandItemId: 'rusty_dagger',
          offhandItemId: 'rusty_dagger',
        }),
      ),
    ).toBeNull();
    // sheathed: the hands are empty
    expect(
      weaponLoadout(
        body({ mainhandItemId: 'rusty_dagger', offhandItemId: 'rusty_dagger', stowed: true }),
      ),
    ).toBeNull();
  });

  it('an empty mainhand shows the class default one-hand weapon', () => {
    expect(weaponLoadout(body({}))).toBe('single');
  });

  it('sheathed props leave the hands empty: the default clips', () => {
    expect(
      weaponLoadout(body({ mainhandItemId: 'eastbrook_greatsword', stowed: true })),
    ).toBeNull();
    expect(weaponLoadout(body({ mainhandItemId: 'rusty_dagger', stowed: true }))).toBeNull();
  });

  it('a body with a fixed mainhand ignores the equipped weapon (the hunter crossbow)', () => {
    const hunter = { showsMainhand: false, showsOffhand: false };
    expect(weaponLoadout(body({ ...hunter, mainhandItemId: 'eastbrook_greatsword' }))).toBe(
      'single',
    );
    expect(weaponLoadout(body({ ...hunter, offhandItemId: 'rusty_dagger' }))).toBe('single');
  });

  it('a fixed off-hand prop fills the hand (the warlock book)', () => {
    expect(weaponLoadout(body({ fixedOffhand: true, mainhandItemId: 'rusty_dagger' }))).toBeNull();
    expect(
      weaponLoadout(body({ fixedOffhand: true, mainhandItemId: 'eastbrook_greatsword' })),
    ).toBe('twohand');
  });
});

describe('the dual set on the WOC bodies', () => {
  it("strikes a Titan's Grip pair's heavy chop as the X-slash, never both fists on one grip", () => {
    for (const key of ['player_warrior', 'player_paladin', 'player_rogue'] as const) {
      const dual = VISUALS[key].clips.loadoutSwaps?.dual ?? null;
      expect(
        swappedClip(dual, '2H_Chop', () => true),
        key,
      ).toBe('Dual_Cross');
      // the whole dual set, untouched by the 2026-09-30 two-hand change
      expect(dual, key).toEqual({
        Combat_Idle: 'Combat_Idle_Dual',
        Hit: 'Hit_Dual',
        '1H_Chop': 'Dual_Stab',
        '1H_Slash': 'Dual_Cross',
        '2H_Chop': 'Dual_Cross',
      });
      // while ONE two-hander strikes it as the single set's one-hand chop
      const twohand = VISUALS[key].clips.loadoutSwaps?.twohand ?? null;
      expect(
        swappedClip(twohand, '2H_Chop', () => true),
        key,
      ).toBe('1H_Chop_Single');
    }
  });
});

describe('swappedClip', () => {
  const swap = { Combat_Idle: 'Combat_Idle_Single', Idle_Look: '', Run: 'Run_Missing' };
  const has = (c: string) => c !== 'Run_Missing';
  it('resolves a mapped clip to its variant', () => {
    expect(swappedClip(swap, 'Combat_Idle', has)).toBe('Combat_Idle_Single');
  });
  it("suppresses a clip mapped to ''", () => {
    expect(swappedClip(swap, 'Idle_Look', has)).toBeNull();
  });
  it('falls back to the named clip when the variant is not in the rig', () => {
    expect(swappedClip(swap, 'Run', has)).toBe('Run');
  });
  it('passes unmapped clips and a missing map straight through', () => {
    expect(swappedClip(swap, 'Death', has)).toBe('Death');
    expect(swappedClip(null, 'Idle', has)).toBe('Idle');
  });
});

/** Every clip name a ClipMap can reach: each string anywhere in it (base states, attack lists,
 *  per-ability and per-hand entries, the loadout maps' targets, emotes, splits) plus the clips its
 *  blade contacts are timed on. */
function reachableClips(clips: ClipMap): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(clips);
  out.push(...Object.keys(clips.contacts ?? {}));
  return out;
}

describe('the two-hand loadout on the WOC bodies (2026-09-30: no two-hand stance)', () => {
  const has = () => true;
  const WOC_KEYS = Object.keys(VISUALS).filter((key) => VISUALS[key].wocCharacter);

  it('plays the one-hand clips out of combat: a two-hander is held in one fist like a one-hand sword', () => {
    for (const key of ['player_warrior', 'player_paladin', 'player_shaman'] as const) {
      const twohand = VISUALS[key].clips.loadoutSwaps?.twohand ?? null;
      for (const clip of [
        'Idle',
        'Idle_Look',
        'Walk',
        'Run',
        'Walk_Back',
        'Jump',
        'Fall',
        'Land',
      ]) {
        expect(swappedClip(twohand, clip, has), `${key} ${clip}`).toBe(clip);
      }
      for (const clip of ['Strafe_Left', 'Strafe_Right', 'Sheathe', 'Death', 'Wave']) {
        expect(swappedClip(twohand, clip, has), `${key} ${clip}`).toBe(clip);
      }
    }
  });

  it('fights on the single set: the free-hand battle stance, its hit reaction and every strike', () => {
    for (const key of ['player_warrior', 'player_paladin', 'player_shaman'] as const) {
      const twohand = VISUALS[key].clips.loadoutSwaps?.twohand ?? null;
      expect(swappedClip(twohand, 'Combat_Idle', has), key).toBe('Combat_Idle_Single');
      expect(swappedClip(twohand, 'Hit', has), key).toBe('Hit_Single');
      expect(swappedClip(twohand, '1H_Chop', has), key).toBe('1H_Chop_Single');
      expect(swappedClip(twohand, '1H_Slash', has), key).toBe('1H_Slash_Single');
      // the heavy chop (the auto attack through attackByHand.twohand, Mortal Strike, Execute,
      // Final Edict...): 2H_Chop takes both fists onto the grip, so it is the single chop here
      expect(VISUALS[key].clips.attackByHand?.twohand, key).toBe('2H_Chop');
      expect(swappedClip(twohand, '2H_Chop', has), key).toBe('1H_Chop_Single');
    }
  });

  it('is exactly the single set plus its heavy chop on every WOC body', () => {
    expect(WOC_KEYS).toHaveLength(18);
    for (const key of WOC_KEYS) {
      const swaps = VISUALS[key].clips.loadoutSwaps;
      expect(swaps?.twohand, key).toEqual({ ...swaps?.single, '2H_Chop': '1H_Chop_Single' });
    }
  });

  it('leaves no two-hand (*_2H) clip reachable from any WOC body', () => {
    for (const key of WOC_KEYS) {
      const reachable = reachableClips(VISUALS[key].clips);
      expect(reachable, key).toContain('Combat_Idle_Single');
      expect(
        reachable.filter((name) => name.endsWith('_2H')),
        key,
      ).toEqual([]);
    }
  });

  it('keeps a one-hand weapon and a staff on their own heavy chop (the single set maps no 2H_Chop)', () => {
    // a staff is the single loadout, flagged two-hand or not: the staff classes' auto attack and a
    // staff shaman's two-hand swing stay 2H_Chop, as does a one-hand warrior's Mortal Strike
    expect(weaponLoadout(body({ mainhandItemId: 'briarroot_staff' }))).toBe('single');
    for (const key of WOC_KEYS) {
      const single = VISUALS[key].clips.loadoutSwaps?.single ?? null;
      expect(swappedClip(single, '2H_Chop', has), key).toBe('2H_Chop');
    }
    for (const key of ['player_priest', 'player_mage', 'player_druid'] as const) {
      expect(VISUALS[key].clips.attack, key).toEqual(['2H_Chop']);
    }
  });

  it('applies no loadout roll: a two-hander sits in the fist unturned, like a one-hand sword', () => {
    // the old loadout-wide quarter roll (later keyed inside the *_2H clips, which left the
    // library 2026-09-30) is gone
    const visual = readFileSync('src/render/characters/visual.ts', 'utf8');
    const assets = readFileSync('src/render/characters/assets.ts', 'utf8');
    const core = readFileSync('src/render/characters/weapon_loadout_core.ts', 'utf8');
    expect(visual).not.toContain('applyHoldRoll');
    expect(assets).not.toContain('handGrip');
    expect(core).not.toContain('heldRollDegrees');
    expect(core).not.toContain('HOLD_ROLL');
  });
});
