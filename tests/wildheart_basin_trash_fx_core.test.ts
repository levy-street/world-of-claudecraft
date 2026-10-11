// The Wildheart Basin trash hunt's render plan
// (src/render/wildheart_basin/basin_trash_fx_core.ts): every telegraph, reach
// and span reads the sim's own templates (the trash mechanics pass in
// src/sim/content/wildheart.ts), the kick glyphs follow the sim's interrupt
// table, the tongue catches whom the sim's lane catches, and the creature
// looks play existing clips at the rate that fits the sim's bars.
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { WILDHEART_MOB_KEYS } from '../src/render/characters/wildheart_creature_looks';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph/telegraph_look_core';
import { basinTelegraphSpecs } from '../src/render/wildheart_basin/basin_fx_core';
import {
  dreadSkullLookInto,
  HUNT_TUNING,
  KICK_GLYPH_RADIUS,
  projectileFlight,
  quarryMarkLookInto,
  RAPTOR_PACK_FRENZY_AURA,
  SNARLBARK_ABILITY,
  TOAD_MOUTH,
  TRASH_BODY_HEIGHT,
  TRASH_CAST_CLIPS,
  TRASH_FX_POOLS,
  TRASH_PARTY_SIZE,
  TRASH_SHOCKS,
  toadMouthInto,
  tongueCatchInto,
  tongueHoldLimit,
  tongueReeledIn,
  trashBodyHeight,
  trashCastClipRate,
  trashCastKickable,
  trashCastSpecs,
  trashFxPools,
  trashPullCensuses,
  trashShockLook,
} from '../src/render/wildheart_basin/basin_trash_fx_core';
import { TOAD_CLIP } from '../src/render/wildheart_basin/basin_trash_model_core';
import { WILDHEART_BASIN_PACKS, WILDHEART_BASIN_SPAWNS } from '../src/sim/content/wildheart';
import { MOBS } from '../src/sim/data';
import {
  BASIN_RAPTOR_ID,
  HEXCALLER_ID,
  RAVAGER_ID,
  SPORE_TOAD_ID,
  STALKER_ID,
  SUNBONE_DREAD_TOTEM_ID,
  TOTEM_BINDER_ID,
  VINE_LASHER_ID,
} from '../src/sim/encounters/wildheart_basin/ids';
import { inLane } from '../src/sim/mob/trash_kit/lane';
import {
  WILDHEART_ANCESTRAL_SAP,
  WILDHEART_KIT_CAST_SCHOOLS,
  WILDHEART_QUARRY_MARK,
  WILDHEART_RATTLING_DREAD,
  WILDHEART_SNARING_TONGUE,
  WILDHEART_TOAD_HEX,
  WILDHEART_WAR_ROAR,
} from '../src/sim/mob/trash_kit/wildheart_cast_ids';
import { PARTY_MAX } from '../src/sim/social/party';

const hunt = (id: string) => MOBS[id]?.trashKit?.wildheart;

describe('the hunt telegraphs draw the sim edge', () => {
  const specs = trashCastSpecs();

  it('reads every reach off the templates', () => {
    const roar = hunt(RAVAGER_ID)?.roar;
    const dread = hunt(SUNBONE_DREAD_TOTEM_ID)?.dread;
    const tongue = hunt(SPORE_TOAD_ID)?.tongue;
    expect(roar && dread && tongue).toBeTruthy();
    expect(specs[WILDHEART_WAR_ROAR]).toMatchObject({
      shape: 'ring',
      range: roar?.radius,
      anchor: 'caster',
    });
    expect(specs[WILDHEART_RATTLING_DREAD]).toMatchObject({
      shape: 'ring',
      range: dread?.radius,
      anchor: 'caster',
    });
    expect(specs[WILDHEART_SNARING_TONGUE]).toMatchObject({
      shape: 'lane',
      range: tongue?.length,
      halfWidth: tongue?.halfWidth,
      anchor: 'caster',
    });
    // The content's own numbers (a retune moves the drawing with it).
    expect(roar?.radius).toBe(15);
    expect(dread?.radius).toBe(8);
    expect(tongue?.length).toBe(22);
    expect(tongue?.halfWidth).toBe(1.5);
  });

  it('marks the single-target casts under their victim', () => {
    expect(specs[WILDHEART_QUARRY_MARK]?.anchor).toBe('target');
    expect(specs[WILDHEART_TOAD_HEX]?.anchor).toBe('target');
  });

  it('paints the threat, never the school', () => {
    const palette = new Set(Object.values(TELEGRAPH_THREAT_COLORS));
    for (const spec of Object.values(specs)) expect(palette.has(spec.color)).toBe(true);
    expect(specs[WILDHEART_WAR_ROAR]?.color).toBe(TELEGRAPH_THREAT_COLORS.interrupt);
    expect(specs[WILDHEART_TOAD_HEX]?.color).toBe(TELEGRAPH_THREAT_COLORS.control);
    expect(specs[WILDHEART_RATTLING_DREAD]?.color).toBe(TELEGRAPH_THREAT_COLORS.control);
    expect(specs[WILDHEART_SNARING_TONGUE]?.color).toBe(TELEGRAPH_THREAT_COLORS.control);
    expect(specs[WILDHEART_QUARRY_MARK]?.color).toBe(TELEGRAPH_THREAT_COLORS.danger);
  });

  it('turns a kick glyph under exactly the casts the sim lets a player kick', () => {
    for (const [id, spec] of Object.entries(specs)) {
      expect(spec.kick, id).toBe(Object.hasOwn(WILDHEART_KIT_CAST_SCHOOLS, id));
    }
    expect(trashCastKickable(WILDHEART_WAR_ROAR)).toBe(true);
    expect(trashCastKickable(WILDHEART_TOAD_HEX)).toBe(true);
    expect(trashCastKickable(WILDHEART_QUARRY_MARK)).toBe(false);
    expect(trashCastKickable(WILDHEART_RATTLING_DREAD)).toBe(false);
    expect(trashCastKickable(WILDHEART_SNARING_TONGUE)).toBe(false);
    // Every kick in the basin reads alike: the Sap's own glyph.
    expect(KICK_GLYPH_RADIUS).toBe(basinTelegraphSpecs()[WILDHEART_ANCESTRAL_SAP]?.range);
  });

  it('races the roar and the dread out to exactly the reach the sim tested', () => {
    expect(TRASH_SHOCKS.roar.radius).toBe(hunt(RAVAGER_ID)?.roar?.radius);
    expect(TRASH_SHOCKS.dread.radius).toBe(hunt(SUNBONE_DREAD_TOTEM_ID)?.dread?.radius);
    const end = trashShockLook(TRASH_SHOCKS.roar, TRASH_SHOCKS.roar.seconds);
    expect(end.radius).toBeCloseTo(TRASH_SHOCKS.roar.radius * 1.12, 5);
    expect(end.alpha).toBe(0);
    expect(trashShockLook(TRASH_SHOCKS.dread, 0).alpha).toBe(1);
  });
});

describe('the hunt reads the sim', () => {
  it('names the frenzy, the thorns and the tuning the sim uses', () => {
    expect(RAPTOR_PACK_FRENZY_AURA).toBe('pack_frenzy');
    expect(MOBS[BASIN_RAPTOR_ID]?.packFrenzy).toEqual(HUNT_TUNING.packFrenzy);
    expect(SNARLBARK_ABILITY).toBe(MOBS[VINE_LASHER_ID]?.thorns?.name);
    expect(SNARLBARK_ABILITY).toBe('Snarlbark');
    expect(HUNT_TUNING.mark).toBe(hunt(STALKER_ID)?.mark);
    expect(HUNT_TUNING.hex).toBe(hunt(HEXCALLER_ID)?.hex);
  });

  it('catches with the tongue exactly whom the sim lane catches', () => {
    const tongue = HUNT_TUNING.tongue;
    if (!tongue) throw new Error('the Spore Toad has no tongue');
    const toad = { x: 10, z: 20 };
    const yaw = 0.6;
    const ax = Math.sin(yaw);
    const az = Math.cos(yaw);
    const at = (along: number, side: number) => ({
      x: toad.x + ax * along + az * side,
      z: toad.z + az * along - ax * side,
    });
    const players = [
      { id: 1, dead: false, kind: 'player', pos: at(12, 0) },
      { id: 2, dead: false, kind: 'player', pos: at(20, tongue.halfWidth - 0.2) },
      { id: 3, dead: false, kind: 'player', pos: at(12, tongue.halfWidth + 2) },
      { id: 4, dead: false, kind: 'player', pos: at(-3, 0) },
      { id: 5, dead: true, kind: 'player', pos: at(6, 0) },
      { id: 6, dead: false, kind: 'mob', pos: at(6, 0) },
      { id: 7, dead: false, kind: 'player', pos: at(tongue.length + 4, 0) },
    ];
    const out = tongueCatchInto([], toad, yaw, players, 0);
    expect(out).toEqual([1, 2]);
    for (const p of players) {
      if (p.kind !== 'player' || p.dead) continue;
      const sim = inLane(toad.x, toad.z, yaw, tongue.length, tongue.halfWidth, p.pos.x, p.pos.z);
      expect(out.includes(p.id), `player ${p.id}`).toBe(sim);
    }
    // The grace takes a mirrored body a hair outside the edge.
    const edge = [{ id: 8, dead: false, kind: 'player', pos: at(10, tongue.halfWidth + 0.3) }];
    expect(tongueCatchInto([], toad, yaw, edge)).toEqual([8]);
  });

  it('holds the tongue for the reel the sim runs, and lets go at its stop', () => {
    const tongue = HUNT_TUNING.tongue;
    if (!tongue) throw new Error('the Spore Toad has no tongue');
    expect(tongueHoldLimit()).toBeCloseTo((tongue.length - tongue.stop) / tongue.reel + 0.6, 6);
    expect(tongueReeledIn(tongue.stop)).toBe(true);
    expect(tongueReeledIn(tongue.stop + 1)).toBe(false);
  });

  it('puts the toad mouth up front at the head', () => {
    const out = toadMouthInto({ x: 0, y: 0, z: 0 }, { x: 4, y: 1, z: 6 }, 0, 2.4);
    const h = trashBodyHeight(SPORE_TOAD_ID, 2.4);
    expect(out.x).toBeCloseTo(4, 6);
    expect(out.z).toBeCloseTo(6 + h * TOAD_MOUTH.forward, 6);
    expect(out.y).toBeCloseTo(1 + h * TOAD_MOUTH.up, 6);
  });
});

describe('the hunt bodies and clips', () => {
  it('draws each body at the height its visual stands', () => {
    const keyOf: Record<string, string> = {
      [BASIN_RAPTOR_ID]: WILDHEART_MOB_KEYS[BASIN_RAPTOR_ID],
      [STALKER_ID]: 'mob_wildheart_stalker',
      [RAVAGER_ID]: 'mob_wildheart_ravager',
      [HEXCALLER_ID]: 'mob_wildheart_hexcaller',
      [SPORE_TOAD_ID]: WILDHEART_MOB_KEYS[SPORE_TOAD_ID],
      [SUNBONE_DREAD_TOTEM_ID]: WILDHEART_MOB_KEYS[SUNBONE_DREAD_TOTEM_ID],
    };
    for (const [id, key] of Object.entries(keyOf)) {
      expect(VISUALS[key]?.height, id).toBeCloseTo(TRASH_BODY_HEIGHT[id] ?? -1, 6);
    }
  });

  it('gives the Dread Totem its own body beside the Sunbone Totem', () => {
    const key = WILDHEART_MOB_KEYS[SUNBONE_DREAD_TOTEM_ID];
    expect(key).toBe('wildheart_sunbone_dread_totem');
    const dread = VISUALS[key];
    const totem = VISUALS.wildheart_sunbone_totem;
    expect(dread?.url).not.toBe(totem?.url);
    expect(dread?.clips.castByAbility?.[WILDHEART_RATTLING_DREAD]).toBe('Rattle');
  });

  it('plays each hunt cast on an existing clip, fitted to the sim bar', () => {
    const rigs: [string, string][] = [
      ['mob_wildheart_stalker', WILDHEART_QUARRY_MARK],
      ['mob_wildheart_ravager', WILDHEART_WAR_ROAR],
      ['mob_wildheart_hexcaller', WILDHEART_TOAD_HEX],
      [WILDHEART_MOB_KEYS[SPORE_TOAD_ID], WILDHEART_SNARING_TONGUE],
    ];
    for (const [key, castId] of rigs) {
      const clips = VISUALS[key]?.clips;
      expect(clips?.castByAbility?.[castId], key).toBe(TRASH_CAST_CLIPS[castId]?.clip);
      expect(clips?.castTimeScaleByAbility?.[castId], key).toBeCloseTo(
        trashCastClipRate(castId),
        6,
      );
    }
    // A fitted clip plays once over the template's bar.
    const mark = hunt(STALKER_ID)?.mark;
    const tongue = hunt(SPORE_TOAD_ID)?.tongue;
    expect(trashCastClipRate(WILDHEART_QUARRY_MARK)).toBeCloseTo(2 / (mark?.castTime ?? 0), 6);
    expect(trashCastClipRate(WILDHEART_SNARING_TONGUE)).toBeCloseTo(
      TOAD_CLIP.tongueFire / (tongue?.castTime ?? 0),
      6,
    );
    expect(trashCastClipRate(WILDHEART_WAR_ROAR)).toBe(1);
    // The Sap keeps the Hexcaller's own cast; the hex reads differently.
    expect(VISUALS.mob_wildheart_hexcaller?.clips.cast).not.toBe(
      TRASH_CAST_CLIPS[WILDHEART_TOAD_HEX]?.clip,
    );
  });
});

describe('the hunt looks', () => {
  it('pops the quarry sigil in and fades it out with the mark', () => {
    const look = () => ({ alpha: 0, size: 0 });
    const fresh = quarryMarkLookInto(look(), 6, 6, 0);
    const held = quarryMarkLookInto(look(), 3, 6, 0);
    expect(fresh.size).toBeLessThan(held.size);
    expect(quarryMarkLookInto(look(), 0, 6, 0).alpha).toBe(0);
    expect(held.alpha).toBeGreaterThan(0.8);
  });

  it('burns the skull eyes hotter as the dread bar runs', () => {
    const look = () => ({ alpha: 0, eyes: 0, size: 0 });
    for (const t of [0, 0.3, 1.7]) {
      const full = dreadSkullLookInto(look(), 1, t);
      const idle = dreadSkullLookInto(look(), 0, t);
      expect(full.eyes).toBeGreaterThan(idle.eyes);
      expect(full.size).toBeGreaterThan(idle.size);
    }
  });

  it('writes the looks into the caller record (no per-frame object)', () => {
    const mark = { alpha: -1, size: -1 };
    expect(quarryMarkLookInto(mark, 3, 6, 0.4)).toBe(mark);
    expect(mark.alpha).toBeGreaterThan(0);
    const skull = { alpha: -1, eyes: -1, size: -1 };
    expect(dreadSkullLookInto(skull, 0.5, 0.4)).toBe(skull);
    expect(skull.size).toBeCloseTo(1.75, 6);
  });

  it('keeps a projectile on screen long enough to read, never a slow lob', () => {
    expect(projectileFlight(0, 46)).toBeCloseTo(0.12, 6);
    expect(projectileFlight(23, 46)).toBeCloseTo(0.5, 6);
    expect(projectileFlight(500, 46)).toBe(0.9);
    expect(projectileFlight(Number.NaN, 46)).toBe(0.12);
  });
});

// ---- the pools: every actionable telegraph has a slot in the worst pull -------

/** An independent recount of one Wildheart pull, by template (the casts the
 *  trash pass gives each body; a Totem-Binder's at most `maxAlive` totems,
 *  all of them Dread Totems in the worst case). */
function recount(pack: string) {
  const members = WILDHEART_BASIN_SPAWNS.filter((s) => s.packId === pack).map((s) => s.mobId);
  const n = (id: string) => members.filter((m) => m === id).length;
  const binders = n(TOTEM_BINDER_ID);
  const maxAlive = hunt(TOTEM_BINDER_ID)?.totems?.maxAlive ?? 0;
  const dread = n(SUNBONE_DREAD_TOTEM_ID) + binders * maxAlive;
  return {
    // Quarry Mark, War Roar, Toad Hex, Rattling Dread: one ring a caster.
    rings: n(STALKER_ID) + n(RAVAGER_ID) + n(HEXCALLER_ID) + dread,
    // The kickable ones: the War Roar and the Toad Hex.
    kicks: n(RAVAGER_ID) + n(HEXCALLER_ID),
    toads: n(SPORE_TOAD_ID),
    skulls: dread,
    stalkers: n(STALKER_ID),
    hexcallers: n(HEXCALLER_ID),
  };
}

/** The worst pull plus the next worst chained into it. */
function worstTwo(values: number[]): number {
  const sorted = [...values].sort((a, b) => b - a);
  return (sorted[0] ?? 0) + (sorted[1] ?? 0);
}

describe('the trash fx pools hold the worst real pull', () => {
  const pulls = WILDHEART_BASIN_PACKS.map((p) => ({ pack: p, ...recount(p) }));
  const worst = (k: keyof ReturnType<typeof recount>) => Math.max(...pulls.map((p) => p[k]));
  const chained = (k: keyof ReturnType<typeof recount>) => worstTwo(pulls.map((p) => p[k]));

  it('counts every pull as the independent recount does', () => {
    const census = trashPullCensuses(WILDHEART_BASIN_SPAWNS);
    for (const p of pulls) {
      const c = census.get(p.pack);
      expect(c, p.pack).toBeDefined();
      expect(c?.rings, p.pack).toBe(p.rings);
      expect(c?.kicks, p.pack).toBe(p.kicks);
      expect(c?.lanes, p.pack).toBe(p.toads);
      expect(c?.skulls, p.pack).toBe(p.skulls);
      expect(c?.spears, p.pack).toBe(p.stalkers);
      expect(c?.hexes, p.pack).toBe(p.hexcallers);
    }
    // The packs the review named: g12 is the ringed worst, g6 holds three
    // Spore Toads, g13 two, and every binder can stand two Dread Totems.
    expect(recount('g12').rings).toBe(5);
    expect(recount('g6').toads).toBe(3);
    expect(recount('g13').toads).toBe(2);
    expect(worst('skulls')).toBe(2);
  });

  it('sizes every actionable pool past the worst pull, with a chained pull of headroom', () => {
    expect(TRASH_FX_POOLS).toEqual(trashFxPools(WILDHEART_BASIN_SPAWNS));
    expect(TRASH_FX_POOLS.rings).toBe(chained('rings'));
    expect(TRASH_FX_POOLS.rings).toBeGreaterThan(worst('rings'));
    expect(TRASH_FX_POOLS.kicks).toBe(chained('kicks'));
    expect(TRASH_FX_POOLS.kicks).toBeGreaterThan(worst('kicks'));
    expect(TRASH_FX_POOLS.lanes).toBe(chained('toads'));
    expect(TRASH_FX_POOLS.lanes).toBeGreaterThan(worst('toads'));
    expect(TRASH_FX_POOLS.skulls).toBe(chained('skulls'));
    expect(TRASH_FX_POOLS.skulls).toBeGreaterThan(worst('skulls'));
    expect(TRASH_FX_POOLS.spears).toBeGreaterThanOrEqual(worst('stalkers'));
    expect(TRASH_FX_POOLS.hexes).toBeGreaterThanOrEqual(worst('hexcallers'));
  });

  it('gives every player a reeling tongue catches its own tongue, and every quarry its mark', () => {
    // The Snaring Tongue catches every player in its lane: a whole party per
    // toad, every toad of the pull (and the chained one) at once.
    expect(TRASH_PARTY_SIZE).toBe(PARTY_MAX);
    expect(PARTY_MAX).toBe(5);
    expect(TRASH_FX_POOLS.tongues).toBe(TRASH_FX_POOLS.lanes * PARTY_MAX);
    expect(TRASH_FX_POOLS.tongues).toBeGreaterThanOrEqual(worst('toads') * PARTY_MAX);
    expect(TRASH_FX_POOLS.marks).toBe(PARTY_MAX);
  });
});
