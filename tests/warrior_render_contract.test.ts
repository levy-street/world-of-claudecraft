// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { KAYKIT_KNIGHT_WARRIOR, KAYKIT_PALADIN, VISUALS } from '../src/render/characters/manifest';
import {
  attackAbilityId,
  isSpinAttackAbility,
  weaponAttackStyle,
} from '../src/render/characters/weapon_attack_style_core';
import { wocAnimsUrl, wocBaseUrl } from '../src/render/characters/woc_armor_core';
import {
  isMobEngageCue,
  WARRIOR_SHOUT_COLORS,
  warriorCastVisualPlan,
} from '../src/render/warrior_cast_fx_core';
import { ABILITIES } from '../src/sim/data';

describe('winning Warrior attack animation routing', () => {
  it('selects a swing from the actual live hands, including Titan Grip', () => {
    expect(weaponAttackStyle('worn_sword', null)).toBeNull();
    expect(weaponAttackStyle('wyrmfang_greatblade', null)).toBe('twohand');
    expect(weaponAttackStyle('worn_sword', 'rusty_dagger')).toBe('dualwield');
    expect(weaponAttackStyle('wyrmfang_greatblade', 'deathless_greatblade')).toBe('dualwield');
    expect(weaponAttackStyle('missing_item', 'rusty_dagger')).toBeNull();
  });

  it('pins winning Warrior hand and ability clips on the WOC rig', () => {
    // The warrior rides the WOC modular body (the male base, its animation
    // library and the warrior armor set) and plays only that rig's own clip
    // vocabulary: no KayKit donor clip is ever layered on.
    expect(VISUALS.player_warrior.clips.attackByHand).toEqual({
      twohand: '2H_Chop',
      dualwield: 'Dual_Chop',
    });
    expect(VISUALS.player_warrior.clips.attackByAbility).toMatchObject({
      mortal_strike: '2H_Chop',
      execute: '2H_Chop',
      slam: '2H_Chop',
      red_harvest: '2H_Chop',
      breachmaker: '2H_Chop',
      // Shieldcrack braces behind the offhand SHIELD (the rig's guard beat;
      // it ships no shield bash), never a sword chop.
      shield_slam: 'Block',
      raging_gale: 'Dual_Chop',
      bloodthirst: 'Dual_Chop',
      // The two frontal-arc AoE strikes reap sideways (the slash), never the
      // top-to-bottom chop.
      cleave: '1H_Slash',
      revenge: '1H_Slash',
      thunder_clap: '1H_Chop',
      faultline: '1H_Chop',
      heroic_strike: '1H_Slash',
      overpower: '1H_Slash',
      hamstring: '1H_Slash',
    });
    // Instant casts carry no gesture entry on this body (owner call): with
    // none, the ability painter draws nothing and the generic cast arm goes
    // through playAttack's gestureOnly gate instead of the default swing.
    for (const silent of [
      'sanguine_aura',
      'raised_guard',
      'die_by_sword',
      'berserker_rage',
      'recklessness',
      'avatar',
      'piercing_howl',
    ]) {
      expect(VISUALS.player_warrior.clips.attackByAbility?.[silent], silent).toBeUndefined();
    }
    const renderer = readFileSync('src/render/renderer.ts', 'utf8');
    expect(renderer).toContain('this.triggerAttack(ev.sourceId, warriorCast.abilityId, true);');
    // Its only clip source is the rig's own animation library.
    expect(VISUALS.player_warrior.animUrls).toEqual([wocAnimsUrl('male')]);
  });

  it('resolves the preserved KayKit Warrior gestures from their compatible shipped donors', () => {
    for (const [key, def] of [
      ['kaykit_baseline', KAYKIT_KNIGHT_WARRIOR],
      ['player_warrior_modular', VISUALS.player_warrior_modular],
    ] as const) {
      const names = new Set<string>();
      for (const url of [def.url, ...(def.animUrls ?? [])]) {
        const bytes = readFileSync(`public/${url}`);
        const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
        for (const animation of doc.animations ?? []) names.add(animation.name);
      }
      for (const [id, name] of Object.entries(def.clips.attackByAbility ?? {})) {
        expect(names.has(name), `${key}: ${id} must bind its shipped clip ${name}`).toBe(true);
      }
      const channel = def.clips.castByAbility?.bladestorm;
      expect(channel).toBe('Warrior_Bladestorm_Loop');
      expect(names.has(channel ?? '')).toBe(true);
    }
  });

  it('does not route another class through Warrior-only authored clips', () => {
    for (const [key, def] of Object.entries(VISUALS)) {
      if (!key.startsWith('player_') || key.startsWith('player_warrior')) continue;
      for (const name of Object.values(def.clips.attackByAbility ?? {})) {
        expect(/^(Warrior_|Fury_)/.test(name), `${key}: ${name}`).toBe(false);
      }
    }
  });

  it('routes Final Edict to its dedicated one-handed Templar verdict clip at authored speed', () => {
    expect(KAYKIT_PALADIN.clips.attackByAbility).toMatchObject({
      final_edict: 'Paladin_Templars_Verdict_1H',
    });
    expect(KAYKIT_PALADIN.clips.attackTimeScaleByAbility).toMatchObject({
      final_edict: 1,
    });
  });

  it('normalizes damage-event display names and preserves the whirlwind spin cue', () => {
    expect(attackAbilityId(ABILITIES.mortal_strike.name)).toBe('mortal_strike');
    expect(attackAbilityId(ABILITIES.whirlwind.name)).toBe('whirlwind');
    expect(attackAbilityId('mortal_strike')).toBe('mortal_strike');
    expect(attackAbilityId('missing ability')).toBeUndefined();
    expect(isSpinAttackAbility('whirlwind')).toBe(true);
    expect(isSpinAttackAbility('dawnfall')).toBe(true);
    expect(isSpinAttackAbility('mortal_strike')).toBe(false);
  });

  it.each(['cleave', 'whirlwind', 'bladestorm', 'dawnfall'])(
    'forwards %s identity to the live spin selector',
    async (abilityId) => {
      const { Renderer } = await import('../src/render/renderer');
      const visual = { playWhirl: vi.fn(), playAttack: vi.fn() };
      const renderer = Object.assign(Object.create(Renderer.prototype), {
        views: new Map([[7, {}]]),
        activeVisual: () => visual,
        attackTriggerCount: 0,
      });

      renderer.triggerAttack(7, abilityId, false, 'melee');

      expect(visual.playWhirl).toHaveBeenCalledExactlyOnceWith(abilityId);
      expect(visual.playAttack).not.toHaveBeenCalled();
      expect(renderer.attackTriggerCount).toBe(1);
    },
  );
});

describe('winning Warrior cast VFX routing', () => {
  it('keeps the authored per-shout colors and one-pump roar plan', () => {
    expect(WARRIOR_SHOUT_COLORS).toEqual({
      battle_shout: 0xff2a1a,
      demoralizing_shout: 0x9a5df0,
      emboldening_roar: 0xff5470,
      defiant_bellow: 0xff8c2a,
      rallying_cry: 0xffe9a0,
      intimidating_shout: 0x7f8ad0,
    });
    expect(warriorCastVisualPlan('shout', 'rallying_cry')).toEqual({
      kind: 'shout',
      color: 0xffe9a0,
      ringRadius: 8,
      repeats: 1,
    });
  });

  it('routes weapon aura and defensive flourish to authored clips only', () => {
    expect(warriorCastVisualPlan('weaponAura', 'sanguine_aura')).toEqual({
      kind: 'gesture',
      abilityId: 'sanguine_aura',
    });
    expect(warriorCastVisualPlan('flourish', 'raised_guard')).toEqual({
      kind: 'gesture',
      abilityId: 'raised_guard',
    });
    expect(warriorCastVisualPlan('projectile', 'heroic_throw')).toBeNull();
  });

  it('shouts play no roar on the WOC body, and the roar rides playShout at both renderer sites', () => {
    // The ability painter claims the six shouts' cue ahead of the generic arm,
    // so the emote lives on the RIG, not the plan: both sites call playShout.
    // The six shouts keep their ring and wave but play no roar gesture.
    expect(VISUALS.player_warrior.clips.shoutEmote).toBeNull();
    expect(VISUALS.player_warrior.clips.climb).toBe('Climb');
    // The 2026-09-24 animation set: strikes at 1x; the authored Sheathe swaps the prop at 46%
    // of the clip and plays whole (no chop-windup treatment).
    expect(VISUALS.player_warrior.attackTimeScale).toBe(1);
    expect(VISUALS.player_warrior.clips.stow).toBe('Sheathe');
    expect(VISUALS.player_warrior.clips.stowSwapFraction).toBeCloseTo(0.46, 6);
    expect(VISUALS.player_warrior.clips.stowPlaysWhole).toBe(true);
    // Dual_Chop is two 24-frame strikes cut on the guard at 0.4 s: each dual-wield swing
    // plays one half (tests/woc_character.test.ts measures the cut off the library).
    expect(VISUALS.player_warrior.clips.dualWieldSplit).toBeCloseTo(0.4, 6);
  });

  it('the paladin rides the same WOC body with its own armor pack and the same owner rules', () => {
    const pal = VISUALS.player_paladin;
    expect(pal.url).toBe(wocBaseUrl('male'));
    expect(pal.animUrls).toEqual([wocAnimsUrl('male')]);
    expect(pal.wocCharacter?.items.paladin_chest?.nodes).toEqual([
      'Armor_Paladin_Chest_Front',
      'Armor_Paladin_Chest_Back',
    ]);
    expect(pal.wocCharacter?.underArmorAtlas).toEqual({
      slot: 'chest',
      url: 'textures/skins/woc/paladin_underarmor.png',
    });
    // identical body treatment to the warrior
    expect(pal.height).toBe(VISUALS.player_warrior.height);
    expect(pal.attackTimeScale).toBe(1);
    expect(pal.swimRise).toEqual(VISUALS.player_warrior.swimRise);
    expect(pal.hideWeaponsWhileSwimming).toBe(true);
    expect(pal.clips.shoutEmote).toBeNull();
    expect(pal.clips.climb).toBe('Climb');
    expect(pal.clips.run).toBe('Run');
    // Weapon strikes and interrupts swing; the timed holy bolt releases a cast.
    expect(pal.clips.attackByAbility).toEqual({
      crusader_strike: '1H_Chop',
      vowkeeper_strike: '1H_Slash',
      final_edict: '2H_Chop',
      hushbrand: '1H_Chop',
      rebuke: '1H_Chop',
      mercy_lance: 'Cast_Shoot',
    });
    for (const silent of [
      'consecration',
      'bastion_sweep',
      'sunward_disc',
      'holy_shock',
      'hammer_of_justice',
      'devotion_aura',
      'sacred_bulwark',
      'avenging_wrath',
    ]) {
      expect(pal.clips.attackByAbility?.[silent], silent).toBeUndefined();
    }
    // the KayKit paladin survives as the modular baseline only
    expect(VISUALS.player_paladin_modular.animUrls?.[0]).toBe(KAYKIT_PALADIN.url);
    // One authored stroke at any depth, on the authored lane (no procedural pitch), and the
    // upright tread whenever the swimmer stops.
    expect(VISUALS.player_warrior.clips.swim).toBe('Swim');
    expect(VISUALS.player_warrior.clips.swimSurface).toBe('Swim');
    expect(VISUALS.player_warrior.clips.swimIdle).toBe('Swim_Idle');
    expect(VISUALS.player_warrior.hideWeaponsWhileSwimming).toBe(true);
    expect(VISUALS.player_warrior.swimRise?.stroke).toBeCloseTo(-0.65, 6);
    expect(VISUALS.player_warrior.clips.emote?.flex?.clips[0]).toBe('Flex');
    expect(KAYKIT_KNIGHT_WARRIOR.clips.shoutEmote).toBeUndefined();
    const renderer = readFileSync('src/render/renderer.ts', 'utf8');
    const presentation = readFileSync('src/render/renderer_ability_presentation.ts', 'utf8');
    expect(`${renderer}\n${presentation}`.match(/\.playShout\(/g)).toHaveLength(2);
    expect(renderer).not.toContain("playEmote('cheer'");
  });
});

// The renderer's spellfx handler dispatches the mob engage cue BEFORE the warrior
// cast plan, and both claim fx 'shout' and 'flourish'. Whichever wins first wins
// outright (the branch breaks), so the split between them is a contract, not an
// implementation detail: getting it wrong silently cost raised_guard its authored
// Block gesture, which is exactly the regression this pins. The renderer's own
// call site is pinned in tests/renderer_spellfx_dispatch_order.test.ts.
describe('spellfx dispatch order: mob engage cue vs warrior cast plan', () => {
  // Every shipped ability reaching the two contested fx kinds, pinned as a
  // literal so the sweep below cannot quietly shrink: adding a castFx 'shout'
  // ability OR removing one reds this row, and the per-ability assertions then
  // cover the new arrival for free.
  const CONTESTED_CAST_FX = ['shout', 'flourish'] as const;
  const playerCueAbilities = Object.values(ABILITIES)
    .filter((a) => CONTESTED_CAST_FX.includes(a.castFx as (typeof CONTESTED_CAST_FX)[number]))
    .map((a) => a.id)
    .sort();

  it('ships exactly the six warrior shouts plus raised_guard on the contested fx kinds', () => {
    expect(playerCueAbilities).toEqual([
      'battle_shout',
      'defiant_bellow',
      'demoralizing_shout',
      'emboldening_roar',
      'intimidating_shout',
      'raised_guard',
      'rallying_cry',
    ]);
  });

  it('leaves every player castFx to the warrior plan, never the mob cue', () => {
    for (const id of playerCueAbilities) {
      const fx = ABILITIES[id].castFx as string;
      expect(isMobEngageCue(fx, 'player'), `${id} must not be claimed as a mob cue`).toBe(false);
      // and it really does reach a live plan, so "not claimed" means "still works"
      expect(warriorCastVisualPlan(fx, id), `${id} must keep its warrior plan`).not.toBeNull();
    }
  });

  it('claims the brood cues, which a mob emits with no ability id', () => {
    // Mirrors the two live emits in src/sim/mob/dragonkin_brood.ts: the engage
    // bellow and the whelp hatch pounce, both sourced from a mob.
    expect(isMobEngageCue('shout', 'mob')).toBe(true);
    expect(isMobEngageCue('flourish', 'mob')).toBe(true);
  });

  it('proves the source gate is load-bearing and a reorder would not do', () => {
    // warriorCastVisualPlan claims ANY 'shout' whatever the ability id, falling
    // back to a default roar color. So the ONLY thing keeping a mob bellow out
    // of the warrior path is the source gate: drop it and every brood shout
    // repaints as a warrior shout, and moving the branch below the plan instead
    // would do exactly that.
    expect(warriorCastVisualPlan('shout', undefined)).not.toBeNull();
    // The ability id is likewise NOT a safe discriminator: a mob one-shot may
    // carry one to pick its authored clip via attackByAbility, and this stays
    // a mob cue when it does.
    expect(isMobEngageCue('shout', 'mob')).toBe(true);
  });

  // The pure core above cannot see the renderer, and the renderer imports Three,
  // so it cannot be instantiated here. That gap is exactly how the swallowed
  // warrior shouts shipped: the core was green throughout. This scans the real
  // dispatch site instead, so reverting the gate reds a test rather than nothing.
  it('routes the renderer dispatch through the gate, with no bare fx disjunction', () => {
    const src = readFileSync('src/render/renderer.ts', 'utf8');
    // the cue branch asks the predicate, and asks it about the SOURCE entity
    expect(src).toContain('isMobEngageCue(ev.fx, this.sim.entities.get(ev.sourceId)?.kind)');
    // and the pre-fix shape, which claimed player castFx too, is gone for good
    expect(src).not.toMatch(/ev\.fx === 'shout' \|\| ev\.fx === 'flourish'/);
    // the gate must still sit ABOVE the warrior plan: below it, warriorCastVisualPlan
    // would claim every ability-less mob bellow first (see the row above)
    expect(src.indexOf('isMobEngageCue(ev.fx')).toBeLessThan(
      src.indexOf('warriorCastVisualPlan(ev.fx'),
    );
  });

  it('narrows on both dimensions independently', () => {
    // fx dimension: a mob source does not make every fx kind an engage cue
    for (const fx of ['projectile', 'weaponAura', 'windup', 'beam']) {
      expect(isMobEngageCue(fx, 'mob'), fx).toBe(false);
    }
    // source dimension: no non-mob source claims the cue, including absent
    // (an event whose source entity has already left the world mirror)
    for (const kind of ['player', 'npc', 'object', undefined]) {
      expect(isMobEngageCue('shout', kind), String(kind)).toBe(false);
      expect(isMobEngageCue('flourish', kind), String(kind)).toBe(false);
    }
  });
});

describe('Signature_ clip binding is keyed on the warrior rig, not the clip name', () => {
  // Signature_* is a warrior-only naming convention (warrior_ability_clips.ts,
  // warrior_action_fallbacks.ts). visual.ts used to bind ANY shipped clip
  // whose name started with it, on every rig: a non-warrior GLB that happened
  // to ship a same-named clip (an authored donor, a future asset) would have
  // it silently wired up and playable through hasAttackClipOverride even
  // though the class never authored that override.
  function stubGltfWithSignatureClip(abilityId: string) {
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
    mesh.name = 'body';
    scene.add(mesh);
    return {
      scene,
      animations: [
        new THREE.AnimationClip('Idle', 1, []),
        new THREE.AnimationClip(`Signature_${abilityId}`, 1, []),
      ],
    };
  }

  async function buildVisual(key: string, abilityId: string) {
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltfWithSignatureClip(abilityId))),
      loadHdr: vi.fn(() => new Promise(() => undefined)),
      loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      releaseGltf: vi.fn(),
    }));
    const { charactersReady, visualAssetsResident } = await import(
      '../src/render/characters/assets'
    );
    await charactersReady();
    // a WOC body's base and library stream on demand (woc_armor_core.ts): land them first
    await vi.waitFor(() => expect(visualAssetsResident(key)).toBe(true));
    const { CharacterVisual } = await import('../src/render/characters/visual');
    const visual = new CharacterVisual(key, 0xffffff, 0);
    vi.doUnmock('../src/render/assets/loader');
    return visual;
  }

  it('binds a shipped Signature_ clip on the warrior rig', async () => {
    const visual = await buildVisual('player_warrior', 'qa_probe_ability');
    // No real attackByAbility entry for this synthetic id: true here can only
    // come from the Signature_ clip itself resolving to a live action.
    expect(VISUALS.player_warrior.clips.attackByAbility?.qa_probe_ability).toBeUndefined();
    expect(visual.hasAttackClipOverride('qa_probe_ability')).toBe(true);
  });

  it('leaves the same shipped Signature_ clip unbound on a non-warrior rig', async () => {
    const visual = await buildVisual('player_priest', 'qa_probe_ability');
    expect(VISUALS.player_priest.clips.attackByAbility?.qa_probe_ability).toBeUndefined();
    expect(visual.hasAttackClipOverride('qa_probe_ability')).toBe(false);
  });
});
