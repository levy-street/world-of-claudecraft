// The Hollow Crypt trash mechanics pass, render side: the telegraph specs and
// floor-object telegraphs (src/render/hollow_crypt/crypt_trash_fx_core.ts),
// the hero effects' pure plan (crypt_trash_kit_fx_core.ts), the bone pile's
// visual and the Bone Brute's crush clip (characters/manifest.ts), and the
// finale's lane filter that keeps the trash objects out of the Knellwyrm's
// fire lanes (crypt_finale_fx_core.ts). Every size and clock is pinned to the
// sim template it is read from, so a retune moves the visual with it.

import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph/telegraph_look_core';
import { paintsOwnBreath } from '../src/render/hollow_crypt/crypt_creature_fx_core';
import { isKnellLaneTemplate } from '../src/render/hollow_crypt/crypt_finale_fx_core';
import {
  cryptObjectTelegraphs,
  cryptTelegraphSpecs,
  ruptureCasterReach,
} from '../src/render/hollow_crypt/crypt_trash_fx_core';
import {
  barrowEmbersSpec,
  boltArcInto,
  CARRION_BOLT,
  CRYPT_KIT_SLOTS,
  carrionEyeSeconds,
  claimSlot,
  crackedGlow,
  crustPlateSpot,
  embersFlameRate,
  eyeGlyph,
  GRANITE_FLAKES_PER_LAYER,
  GRANITE_PLATES_PER_LAYER,
  graniteCrust,
  graniteSpec,
  HOLLOW_CRYPT_DUNGEON,
  hazardLevel,
  inHollowCrypt,
  LAYER_SLAM_SECONDS,
  layerSlam,
  MARROW_CRACK,
  marrowCrack,
  marrowCrushCone,
  nearestWithin,
  PILE_UNSEEN_PROGRESS,
  pileBornAt,
  pileGlow,
  pileProgress,
  pilePulseHz,
  pileRattleRate,
  RUPTURE_BLAST,
  reassembleSeconds,
  rimesilkLane,
  ruptureRingFill,
  ruptureScorch,
  ruptureSpec,
  STRAND,
  splinterReach,
  strandPhase,
  webNetLevel,
} from '../src/render/hollow_crypt/crypt_trash_kit_fx_core';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import {
  KNELL_LANE_MARK_TEMPLATE,
  KNELL_LANE_TEMPLATE,
  KNELL_PYRE_TEMPLATE,
} from '../src/sim/encounters/hollow_crypt/ids';
import {
  CRYPT_BARROW_EMBERS,
  CRYPT_CARRION_EYE,
  CRYPT_GRAVE_RUPTURE,
  CRYPT_MARROW_CRUSH,
  CRYPT_RIMESILK_SPIT,
  CRYPT_RUPTURE_POOL,
  CRYPT_RUPTURE_RING,
  CRYPT_TRASH_OBJECT_TEMPLATES,
} from '../src/sim/mob/trash_kit/cast_ids';
import type { Entity } from '../src/sim/types';

const PALETTE = new Set(Object.values(TELEGRAPH_THREAT_COLORS));

describe('crypt trash telegraphs: the mechanics pass', () => {
  const specs = cryptTelegraphSpecs();

  it('draws the Marrow Crush cone at the Bone Brute breath cone the sim lands', () => {
    const b = MOBS.crypt_bone_brute.breathCone;
    expect(b?.castId).toBe(CRYPT_MARROW_CRUSH);
    expect(specs[CRYPT_MARROW_CRUSH]).toMatchObject({
      shape: 'cone',
      range: b?.range,
      arcDeg: b?.arcDeg,
      color: TELEGRAPH_THREAT_COLORS.danger,
    });
  });

  it('lays the Rimesilk Spit lane at the widow lane length and half width', () => {
    const line = MOBS.bonechill_widow.trashKit?.line;
    expect(line?.castId).toBe(CRYPT_RIMESILK_SPIT);
    expect(specs[CRYPT_RIMESILK_SPIT]).toMatchObject({
      shape: 'lane',
      range: line?.length,
      halfWidth: line?.halfWidth,
      // A root: crowd control, never the kick colour.
      color: TELEGRAPH_THREAT_COLORS.control,
    });
    expect(rimesilkLane()).toEqual({
      length: line?.length,
      halfWidth: line?.halfWidth,
      root: line?.root,
    });
  });

  it('puts a kick glyph under both kickable marks', () => {
    for (const id of [CRYPT_GRAVE_RUPTURE, CRYPT_CARRION_EYE]) {
      expect(specs[id]?.shape, id).toBe('sigil');
      expect(specs[id]?.color, id).toBe(TELEGRAPH_THREAT_COLORS.interrupt);
    }
  });

  it('paints every trash floor object, in the threat palette, never in the kick colour', () => {
    const objects = cryptObjectTelegraphs();
    expect(Object.keys(objects).sort()).toEqual([...CRYPT_TRASH_OBJECT_TEMPLATES].sort());
    for (const [id, o] of Object.entries(objects)) {
      expect(PALETTE.has(o.color), id).toBe(true);
      expect(o.color, id).not.toBe(TELEGRAPH_THREAT_COLORS.interrupt);
    }
    // The rupture ring fills with its caster's bar; the pool and embers burn.
    expect(objects[CRYPT_RUPTURE_RING]).toMatchObject({
      shape: 'ring',
      drive: 'cast',
      castId: CRYPT_GRAVE_RUPTURE,
    });
    expect(objects[CRYPT_RUPTURE_POOL]).toMatchObject({ shape: 'ring', drive: 'hazard' });
    expect(objects[CRYPT_BARROW_EMBERS]).toMatchObject({
      shape: 'cone',
      drive: 'hazard',
      arcDeg: MOBS.crypt_ossuary_drake.breathCone?.arcDeg,
    });
  });

  it('looks for the rupture caster at least as far out as it can cast', () => {
    const range = MOBS.crypt_gravecaller_necromancer.trashKit?.rupture?.range ?? 0;
    expect(range).toBeGreaterThan(0);
    expect(ruptureCasterReach()).toBeGreaterThan(range);
  });

  it('paints the Bone Brute crush itself (a crack, never the generic fire cone)', () => {
    expect(paintsOwnBreath('crypt_bone_brute')).toBe(true);
    expect(paintsOwnBreath('crypt_ossuary_drake')).toBe(true);
    expect(paintsOwnBreath('crypt_ossuary_warrior')).toBe(false);
  });

  it('keeps the trash floor objects out of the Knellwyrm fire lanes', () => {
    expect(isKnellLaneTemplate(KNELL_LANE_MARK_TEMPLATE)).toBe(true);
    expect(isKnellLaneTemplate(KNELL_LANE_TEMPLATE)).toBe(true);
    expect(isKnellLaneTemplate(KNELL_PYRE_TEMPLATE)).toBe(false);
    for (const id of CRYPT_TRASH_OBJECT_TEMPLATES) expect(isKnellLaneTemplate(id), id).toBe(false);
  });
});

describe('the kit host: slots and the crypt gate', () => {
  it('pins the slot counts of every pool a roster walk claims', () => {
    expect(CRYPT_KIT_SLOTS).toEqual({
      piles: 6,
      pools: 3,
      gargoyles: 3,
      eyes: 4,
      nets: 5,
      embers: 2,
      objects: 8,
    });
  });

  it('never evicts a live owner: its own slot, else a free one, else none', () => {
    const slots = [{ owner: 11 }, { owner: -1 }, { owner: 12 }];
    expect(claimSlot(slots, 12)).toBe(slots[2]);
    expect(claimSlot(slots, 13)).toBe(slots[1]);
    expect(slots[1].owner).toBe(13);
    // Full: the newcomer gets nothing, and every live owner keeps its slot.
    expect(claimSlot(slots, 14)).toBeNull();
    expect(slots.map((s) => s.owner)).toEqual([11, 13, 12]);
    // A second claim by a holder returns the same slot (no re-lay).
    expect(claimSlot(slots, 13)).toBe(slots[1]);
  });

  it('walks the roster only inside the Hollow Crypt claim', () => {
    const crypt = DUNGEONS[HOLLOW_CRYPT_DUNGEON];
    expect(crypt).toBeDefined();
    expect(inHollowCrypt(instanceOrigin(crypt.index, 0).x)).toBe(true);
    // The open world (the instance bands sit far out on +x).
    expect(inHollowCrypt(0)).toBe(false);
    const other = Object.values(DUNGEONS).find((d) => d.id !== HOLLOW_CRYPT_DUNGEON);
    if (other) expect(inHollowCrypt(instanceOrigin(other.index, 0).x)).toBe(false);
  });
});

describe('Reassemble: the bone pile', () => {
  it('starts the countdown at the windup, or mid-way for a pile seen without it', () => {
    expect(pileBornAt(3, 10, 8)).toBe(3);
    // Unknown start: placed PILE_UNSEEN_PROGRESS into the countdown (reads urgent).
    const born = pileBornAt(null, 10, 8);
    expect(pileProgress(10 - born, 8)).toBeCloseTo(PILE_UNSEEN_PROGRESS, 9);
    expect(PILE_UNSEEN_PROGRESS).toBeGreaterThan(0);
    expect(PILE_UNSEEN_PROGRESS).toBeLessThan(1);
  });

  it('counts down the template seconds', () => {
    const seconds = MOBS.crypt_ossuary_warrior.trashKit?.reassemble?.seconds;
    expect(reassembleSeconds()).toBe(seconds);
    expect(pileProgress(0, 8)).toBe(0);
    expect(pileProgress(4, 8)).toBeCloseTo(0.5, 9);
    expect(pileProgress(20, 8)).toBe(1);
    expect(pileProgress(-1, 8)).toBe(0);
  });

  it('beats faster, rattles harder and glows hotter as the warrior nears standing', () => {
    let hz = 0;
    let rattle = 0;
    for (let p = 0; p <= 1.0001; p += 0.1) {
      expect(pilePulseHz(p)).toBeGreaterThan(hz);
      expect(pileRattleRate(p)).toBeGreaterThan(rattle);
      hz = pilePulseHz(p);
      rattle = pileRattleRate(p);
    }
    expect(pilePulseHz(1)).toBeGreaterThan(pilePulseHz(0) * 4);
    // On the beat and between beats, the last seconds burn brighter than the first.
    expect(pileGlow(0, 1).ring).toBeGreaterThan(pileGlow(0, 0).ring);
    expect(pileGlow(0.5, 1).ring).toBeGreaterThan(pileGlow(0.5, 0).ring);
    // A beat: the peak outshines the trough.
    expect(pileGlow(0, 0.5).ring).toBeGreaterThan(pileGlow(0.5, 0.5).ring);
  });

  it('tethers the nearest necromancer inside the reach, else none', () => {
    const necros = [
      { x: 30, z: 0 },
      { x: 10, z: 0 },
      { x: -10, z: 0 },
    ];
    expect(nearestWithin(0, 0, necros, 3, 40)).toBe(1);
    expect(nearestWithin(0, 0, necros, 1, 40)).toBe(0);
    expect(nearestWithin(0, 0, necros, 3, 5)).toBe(-1);
    expect(nearestWithin(0, 0, [], 0, 40)).toBe(-1);
  });
});

describe('Grave Rupture', () => {
  it('reads the ring, the bar and the pool off the necromancer template', () => {
    const r = MOBS.crypt_gravecaller_necromancer.trashKit?.rupture;
    expect(ruptureSpec()).toEqual({
      radius: r?.radius,
      range: r?.range,
      castTime: r?.castTime,
      poolSeconds: r?.pool.seconds,
    });
  });

  it('fills the ring with its caster bar, else on its own age', () => {
    expect(ruptureRingFill(0.3, 99, 2.5)).toBe(0.3);
    expect(ruptureRingFill(null, 1.25, 2.5)).toBeCloseTo(0.5, 9);
    expect(ruptureRingFill(null, 10, 2.5)).toBe(1);
    expect(ruptureRingFill(1.4, 0, 2.5)).toBe(1);
  });

  it('flashes, chars and cools the crater, then is gone', () => {
    expect(ruptureScorch(0).flash).toBe(1);
    expect(ruptureScorch(RUPTURE_BLAST.flash + 0.01).flash).toBe(0);
    expect(ruptureScorch(0.5).char).toBeGreaterThan(ruptureScorch(3.5).char);
    expect(ruptureScorch(RUPTURE_BLAST.scorch + 0.1)).toEqual({ flash: 0, char: 0, embers: 0 });
  });

  it('swells a hazard in and fades it out once its object is gone', () => {
    expect(hazardLevel(0, -1)).toBe(0);
    expect(hazardLevel(1, -1)).toBe(1);
    expect(hazardLevel(1, 0.2)).toBeCloseTo(0.5, 9);
    expect(hazardLevel(1, 1)).toBe(0);
  });
});

describe('Splinter Burst and Marrow Crush', () => {
  it('reach the sim footprints', () => {
    expect(splinterReach()).toBe(MOBS.crypt_bone_minion.deathThroes?.radius);
    const b = MOBS.crypt_bone_brute.breathCone;
    expect(marrowCrushCone()).toEqual({ range: b?.range, arcDeg: b?.arcDeg });
  });

  it('tears the crack down the whole cone, then lets it cool and go', () => {
    expect(marrowCrack(0).reach).toBe(0);
    expect(marrowCrack(MARROW_CRACK.tear).reach).toBeCloseTo(1, 9);
    let prev = -1;
    for (let t = 0; t <= MARROW_CRACK.tear; t += 0.02) {
      expect(marrowCrack(t).reach).toBeGreaterThanOrEqual(prev);
      prev = marrowCrack(t).reach;
    }
    expect(marrowCrack(MARROW_CRACK.seconds - 0.01).fade).toBeLessThan(0.1);
    expect(marrowCrack(MARROW_CRACK.seconds + 0.1).fade).toBe(0);
  });
});

describe('Granite Skin and Cracked Stone', () => {
  const { maxStacks, crackedSeconds } = graniteSpec();

  it('reads the stack cap and the crack off the gargoyle template', () => {
    const g = MOBS.crypt_chapel_gargoyle.trashKit?.granite;
    expect(maxStacks).toBe(g?.maxStacks);
    expect(crackedSeconds).toBe(g?.cracked.seconds);
  });

  it('thickens, pales and grows its orbit with every layer', () => {
    expect(graniteCrust(0, maxStacks)).toMatchObject({ plates: 0, crustDepth: 0, flakes: 0 });
    for (let s = 1; s <= maxStacks; s++) {
      const c = graniteCrust(s, maxStacks);
      const b = graniteCrust(s - 1, maxStacks);
      expect(c.plates).toBe(s * GRANITE_PLATES_PER_LAYER);
      expect(c.flakes).toBe(s * GRANITE_FLAKES_PER_LAYER);
      expect(c.crustDepth).toBeGreaterThan(b.crustDepth);
      expect(c.pale).toBeGreaterThan(b.pale);
      expect(c.orbit).toBeGreaterThan(b.orbit);
    }
    // Past the cap it holds.
    expect(graniteCrust(maxStacks + 3, maxStacks)).toEqual(graniteCrust(maxStacks, maxStacks));
  });

  it('spreads every layer over the whole body, on the unit shell, never on the talons', () => {
    const total = maxStacks * GRANITE_PLATES_PER_LAYER;
    const seen = new Set<string>();
    for (let i = 0; i < total; i++) {
      const s = crustPlateSpot(i, total);
      expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 6);
      expect(s.y).toBeGreaterThan(-0.8);
      seen.add(`${s.x.toFixed(3)}:${s.y.toFixed(3)}:${s.z.toFixed(3)}`);
    }
    expect(seen.size).toBe(total);
    // The first layer alone already reaches the chest and the belly.
    const first = Array.from({ length: GRANITE_PLATES_PER_LAYER }, (_, i) =>
      crustPlateSpot(i, total),
    );
    expect(Math.max(...first.map((s) => s.y))).toBeGreaterThan(0.3);
    expect(Math.min(...first.map((s) => s.y))).toBeLessThan(-0.2);
  });

  it('slams a layer on oversized and settles it', () => {
    expect(layerSlam(0).scale).toBeGreaterThan(1.2);
    expect(layerSlam(0).flash).toBe(1);
    expect(layerSlam(LAYER_SLAM_SECONDS)).toEqual({ scale: 1, flash: 0 });
  });

  it('glows the cracks while the aura holds and dims them out at its end', () => {
    expect(crackedGlow(0, 3, 0)).toBe(0);
    expect(crackedGlow(crackedSeconds, 0, 0)).toBe(0);
    expect(crackedGlow(crackedSeconds - 1, 1, 0)).toBeGreaterThan(0.6);
    expect(crackedGlow(0.2, 5, 0)).toBeLessThan(crackedGlow(3, 3, 0));
  });
});

describe('Carrion Eye', () => {
  it('holds the mark for the template seconds', () => {
    expect(carrionEyeSeconds()).toBe(MOBS.crypt_crow_caller.trashKit?.eye?.seconds);
  });

  it('arcs the bolt from the staff to the victim', () => {
    const out = { x: 0, y: 0, z: 0 };
    expect(boltArcInto(0, 0, 2, 0, 10, 1, 0, CARRION_BOLT.lift, out)).toEqual({ x: 0, y: 2, z: 0 });
    expect(boltArcInto(1, 0, 2, 0, 10, 1, 0, CARRION_BOLT.lift, out)).toEqual({
      x: 10,
      y: 1,
      z: 0,
    });
    const mid = boltArcInto(0.5, 0, 2, 0, 10, 1, 0, CARRION_BOLT.lift, out);
    expect(mid.y).toBeCloseTo(1.5 + CARRION_BOLT.lift, 9);
  });

  it('opens the eye, keeps it open, and closes it as the mark ends', () => {
    expect(eyeGlyph(0, 6, 0.5).alpha).toBe(0);
    expect(eyeGlyph(1, 5, 0.5).alpha).toBe(1);
    expect(eyeGlyph(5.8, 0.2, 0.5).alpha).toBeCloseTo(0.5, 9);
    expect(eyeGlyph(6, 0, 0.5).alpha).toBe(0);
  });
});

describe('Rimesilk Spit and Barrow Embers', () => {
  it('shoots the strand down the lane, holds it, and frays it away', () => {
    expect(strandPhase(0).head).toBe(0);
    expect(strandPhase(STRAND.shoot).head).toBe(1);
    expect(strandPhase(STRAND.shoot + STRAND.hang * 0.5).alpha).toBe(1);
    expect(strandPhase(STRAND.shoot + STRAND.hang + STRAND.fade + 0.01).alpha).toBe(0);
  });

  it('snaps the web net shut and thaws it with the root', () => {
    expect(webNetLevel(2, 0)).toBe(0);
    expect(webNetLevel(1.5, 0.5)).toBe(1);
    expect(webNetLevel(0, 2)).toBe(0);
  });

  it('burns the drake cone for the template seconds, denser with more effects', () => {
    const d = MOBS.crypt_ossuary_drake;
    expect(barrowEmbersSpec()).toEqual({
      arcDeg: d.breathCone?.arcDeg,
      seconds: d.trashKit?.scorch?.seconds,
    });
    const range = d.breathCone?.range ?? 0;
    const arc = d.breathCone?.arcDeg ?? 0;
    expect(embersFlameRate(range, arc, 1)).toBeGreaterThan(embersFlameRate(range, arc, 0.45));
    expect(embersFlameRate(100, 360, 1)).toBeLessThanOrEqual(260);
  });
});

describe('the bone pile and the brute on the rigs', () => {
  it('draws no body for the pile, but keeps a wide click capsule on it', () => {
    const key = visualKeyFor({ kind: 'mob', templateId: 'crypt_bone_pile' } as Entity);
    expect(key).toBe('crypt_skel_bone_pile');
    expect(VISUALS[key].bodyless).toBe(true);
    expect(VISUALS[key].clickRadius ?? 0).toBeGreaterThanOrEqual(1.8);
  });

  it('stands the warrior up with the skeleton awaken flourish on revive', () => {
    const key = visualKeyFor({ kind: 'mob', templateId: 'crypt_ossuary_warrior' } as Entity);
    expect(VISUALS[key].clips.flourish).toBe('Skeletons_Awaken_Standing');
  });

  it('heaves the golem slam over the Marrow Crush bar, locked to it', () => {
    const key = visualKeyFor({ kind: 'mob', templateId: 'crypt_bone_brute' } as Entity);
    const def = VISUALS[key];
    expect(def.clips.castByAbility?.[CRYPT_MARROW_CRUSH]).toBe('Golem_Slam');
    expect(def.clips.castTimeScaleByAbility?.[CRYPT_MARROW_CRUSH]).toBeGreaterThan(0);
    expect(def.castClipSync).toEqual([CRYPT_MARROW_CRUSH]);
  });
});
