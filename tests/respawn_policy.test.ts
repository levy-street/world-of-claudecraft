// Pins the open-world respawn policy (src/sim/respawn_policy.ts): the level-band
// tiers, the precedence chain around them, and the death site that consumes it.
import { describe, expect, it } from 'vitest';
import { CORPSE_DURATION } from '../src/sim/combat/damage';
import {
  DUNGEON_X_THRESHOLD,
  instanceOrigin,
  MOBS,
  ZONES,
  zoneAt,
  zoneContaining,
} from '../src/sim/data';
import {
  baseRespawnSecondsAt,
  DEFAULT_RESPAWN_SECONDS,
  isSelfScheduled,
  LEGACY_RESPAWN_SECONDS,
  resolveRespawnSeconds,
  TRASH_RESPAWN_SECONDS_HIGH,
  TRASH_RESPAWN_SECONDS_LOW,
  TRASH_RESPAWN_SECONDS_MID,
  trashRespawnSecondsForZone,
} from '../src/sim/respawn_policy';
import { Sim } from '../src/sim/sim';
import { DT, type ZoneDef } from '../src/sim/types';

// A minimal ZoneDef the tier function can read; only levelRange and the optional
// override matter to it, so the rest is inert filler.
function zoneWithBand(bandCap: number, trashRespawnSeconds?: number): ZoneDef {
  return {
    id: 'test_zone',
    name: 'Test Zone',
    zMin: 0,
    zMax: 100,
    levelRange: [1, bandCap],
    biome: 'vale',
    hub: { x: 0, z: 0, radius: 10, name: 'Test' },
    graveyard: { x: 0, z: 0 },
    lakes: [],
    pois: [],
    welcome: '',
    ...(trashRespawnSeconds === undefined ? {} : { trashRespawnSeconds }),
  };
}

describe('trashRespawnSecondsForZone: the level-band tiers', () => {
  it('gives starter bands (cap <= 7) the fast tier', () => {
    expect(TRASH_RESPAWN_SECONDS_LOW).toBe(60);
    expect(trashRespawnSecondsForZone(zoneWithBand(7))).toBe(60);
    expect(trashRespawnSecondsForZone(zoneWithBand(1))).toBe(60);
  });

  it('gives mid bands (cap 8 to 14) the middle tier', () => {
    expect(TRASH_RESPAWN_SECONDS_MID).toBe(120);
    expect(trashRespawnSecondsForZone(zoneWithBand(8))).toBe(120);
    expect(trashRespawnSecondsForZone(zoneWithBand(14))).toBe(120);
  });

  it('gives endgame bands (cap >= 15) the slow tier', () => {
    expect(TRASH_RESPAWN_SECONDS_HIGH).toBe(180);
    expect(trashRespawnSecondsForZone(zoneWithBand(15))).toBe(180);
    expect(trashRespawnSecondsForZone(zoneWithBand(20))).toBe(180);
  });

  it('crosses each tier boundary at exactly the documented cap', () => {
    // Decisive on the boundary itself: 7|8 and 14|15 must differ.
    expect(trashRespawnSecondsForZone(zoneWithBand(7))).not.toBe(
      trashRespawnSecondsForZone(zoneWithBand(8)),
    );
    expect(trashRespawnSecondsForZone(zoneWithBand(14))).not.toBe(
      trashRespawnSecondsForZone(zoneWithBand(15)),
    );
  });

  it('lets one zone override its tier with trashRespawnSeconds', () => {
    expect(trashRespawnSecondsForZone(zoneWithBand(20, 45))).toBe(45);
    // ...including down past the fast tier, and including an explicit 0.
    expect(trashRespawnSecondsForZone(zoneWithBand(7, 300))).toBe(300);
    expect(trashRespawnSecondsForZone(zoneWithBand(20, 0))).toBe(0);
  });

  it('falls back to the flat default for a null zone', () => {
    expect(DEFAULT_RESPAWN_SECONDS).toBe(25);
    expect(trashRespawnSecondsForZone(null)).toBe(25);
    expect(trashRespawnSecondsForZone(undefined)).toBe(25);
  });

  it('keeps the off-map fallback and the legacy schedule base as separate knobs', () => {
    // They are both 25 today, but they answer different questions: retiming the
    // off-map fallback must never silently retime every shipped rare.
    expect(LEGACY_RESPAWN_SECONDS).toBe(25);
    expect(DEFAULT_RESPAWN_SECONDS).toBe(25);
  });
});

describe('the ZoneDef.trashRespawnSeconds override, end to end', () => {
  const overridden = zoneWithBand(20, 45);

  it('beats the level band through the full resolution, not just the tier fn', () => {
    expect(trashRespawnSecondsForZone(overridden)).toBe(45);
    // Same zone with no override would be the 180s endgame tier.
    expect(trashRespawnSecondsForZone(zoneWithBand(20))).toBe(180);
  });

  it('still loses to an explicit SimConfig base, as types.ts documents', () => {
    // baseRespawnSecondsAt returns before it ever consults a zone, so a host
    // that pins the world wins over any per-zone knob.
    expect(baseRespawnSecondsAt(-90, 700, 7)).toBe(7);
  });
});

describe('zoneContaining: strict rect containment, no fallback', () => {
  it('resolves an open-world position to its zone, like zoneAt does', () => {
    // Eastbrook Vale's Wolf Run camp.
    expect(zoneContaining(-27, 71)?.id).toBe('eastbrook_vale');
    expect(zoneAt(-27, 71).id).toBe('eastbrook_vale');
    // A column zone beside the strip.
    expect(zoneContaining(292, 312)?.id).toBe('galecrest');
  });

  it('returns null inside a dungeon instance, where zoneAt would still name a zone', () => {
    const origin = instanceOrigin(0, 0);
    expect(zoneContaining(origin.x, origin.z)).toBeNull();
    // The contrast that makes this function necessary: zoneAt's southmost-band
    // fallback happily reports a real zone for the same far-east coordinate.
    expect(zoneAt(origin.x, origin.z)).not.toBeNull();
  });

  it('returns null past the north edge and outside the world columns', () => {
    const northmost = ZONES.reduce((a, b) => (b.zMax > a.zMax ? b : a));
    expect(zoneContaining(0, northmost.zMax + 10)).toBeNull();
    expect(zoneContaining(9999, 0)).toBeNull();
  });

  it('is half-open on the z seam: zMax belongs to the next band up', () => {
    // Eastbrook Vale [-180, 180) hands z=180 to Mirefen Marsh.
    expect(zoneContaining(0, 179.9)?.id).toBe('eastbrook_vale');
    expect(zoneContaining(0, 180)?.id).toBe('mirefen_marsh');
  });

  it('is half-open on the x seam too, where the strip meets a column', () => {
    // The strip runs to x=180 exclusive; Galecrest's column starts there.
    expect(zoneContaining(179.9, 300)?.id).toBe('mirefen_marsh');
    expect(zoneContaining(180, 300)?.id).toBe('galecrest');
  });
});

describe('baseRespawnSecondsAt: the global override vs the zone tier', () => {
  it('reads the zone tier at a position when no global base is configured', () => {
    // Eastbrook Vale [1-7] -> fast, Mirefen Marsh [6-13] -> mid,
    // Thornpeak Heights [13-20] -> slow.
    expect(baseRespawnSecondsAt(-27, 71, undefined)).toBe(60);
    expect(baseRespawnSecondsAt(-40, 230, undefined)).toBe(120);
    expect(baseRespawnSecondsAt(-90, 700, undefined)).toBe(180);
  });

  it('lets an explicitly configured base win over every zone tier', () => {
    expect(baseRespawnSecondsAt(-27, 71, 2)).toBe(2);
    expect(baseRespawnSecondsAt(-90, 700, 2)).toBe(2);
    // 0 is explicit, not absent.
    expect(baseRespawnSecondsAt(-90, 700, 0)).toBe(0);
  });

  it('falls back to the flat default off the authored map', () => {
    const origin = instanceOrigin(0, 0);
    expect(baseRespawnSecondsAt(origin.x, origin.z, undefined)).toBe(25);
  });
});

describe('resolveRespawnSeconds: full precedence', () => {
  const thornpeak = { x: -90, z: 700 }; // level band [13, 20] -> 180s
  const vale = { x: -27, z: 71 }; // level band [1, 7] -> 60s

  it('lets a template respawnSeconds win over everything', () => {
    expect(resolveRespawnSeconds({ respawnSeconds: 10 }, thornpeak, undefined)).toBe(10);
    expect(resolveRespawnSeconds({ respawnSeconds: 10 }, thornpeak, 2)).toBe(10);
    // ...and it is NOT multiplied by the rare 4x.
    expect(resolveRespawnSeconds({ respawnSeconds: 10, rare: true }, thornpeak, undefined)).toBe(
      10,
    );
  });

  it('applies the zone tier to plain trash', () => {
    expect(resolveRespawnSeconds({}, thornpeak, undefined)).toBe(180);
    expect(resolveRespawnSeconds({}, vale, undefined)).toBe(60);
    expect(resolveRespawnSeconds(undefined, vale, undefined)).toBe(60);
  });

  it('keeps a bare rare on the historical base, so its 100s cadence holds', () => {
    // `rare: true` with no authored multiplier is a SCHEDULE too: 4 x 25 is the
    // 100s every bare rare shipped with, and it must not drift with the band.
    expect(resolveRespawnSeconds({ rare: true }, thornpeak, undefined)).toBe(100);
    expect(resolveRespawnSeconds({ rare: true }, vale, undefined)).toBe(100);
    // The explicit global base still multiplies the same way it always did.
    expect(resolveRespawnSeconds({ rare: true }, thornpeak, 2)).toBe(8);
  });

  it('keeps an authored respawnMult on the historical base, so its wall clock holds', () => {
    // 7.2 * 25 = the three minutes a quest rare shipped with, in EVERY band.
    expect(resolveRespawnSeconds({ respawnMult: 7.2 }, vale, undefined)).toBe(180);
    expect(resolveRespawnSeconds({ respawnMult: 7.2 }, thornpeak, undefined)).toBe(180);
    // 864 * 25 = six hours, not the forty-plus the tier base would have produced.
    expect(resolveRespawnSeconds({ respawnMult: 864 }, thornpeak, undefined)).toBe(21_600);
    // An authored multiplier also beats the rare default, as it always did.
    expect(resolveRespawnSeconds({ respawnMult: 2, rare: true }, thornpeak, undefined)).toBe(50);
    // ...and an explicit global base still overrides what it multiplies.
    expect(resolveRespawnSeconds({ respawnMult: 7.2 }, thornpeak, 2)).toBe(14.4);
  });

  it('classifies self-scheduled templates by multiplier OR rare status', () => {
    expect(isSelfScheduled({ respawnMult: 4 })).toBe(true);
    expect(isSelfScheduled({ rare: true })).toBe(true);
    expect(isSelfScheduled({ respawnMult: 4, rare: true })).toBe(true);
    expect(isSelfScheduled({})).toBe(false);
    // Elite and boss status alone do NOT self-schedule: an open-world boss that
    // never declared a cadence rides the zone tier like the trash around it.
    expect(isSelfScheduled({ rare: false })).toBe(false);
    expect(isSelfScheduled(undefined)).toBe(false);
  });

  it('leaves EVERY shipped self-scheduled template on its exact pre-change schedule', () => {
    // A true quantification over the real catalog, not a hand-picked list: every
    // rare and every authored-multiplier template, priced from three different
    // bands, must equal what the flat-25s era produced.
    const selfScheduled = Object.values(MOBS).filter(
      (t) => t.respawnSeconds === undefined && isSelfScheduled(t),
    );
    // 25 ship today; the floor sits at the real count so thinning the
    // population (and quietly shrinking this sweep) fails here.
    expect(selfScheduled.length).toBeGreaterThanOrEqual(25);
    const drift: string[] = [];
    for (const t of selfScheduled) {
      const before = LEGACY_RESPAWN_SECONDS * (t.respawnMult ?? (t.rare ? 4 : 1));
      for (const pos of [vale, thornpeak, { x: 0, z: 1500 }]) {
        const now = resolveRespawnSeconds(t, pos, undefined);
        if (now !== before) drift.push(`${t.id} at (${pos.x},${pos.z}): ${before} -> ${now}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('names exactly the templates whose respawn DID move, so the change is visible', () => {
    // The complement of the pin above. Only unscheduled open-world bosses and
    // plain trash may appear here; a rare showing up is the regression.
    const moved = Object.values(MOBS)
      .filter((t) => t.respawnSeconds === undefined && isSelfScheduled(t))
      .filter(
        (t) =>
          resolveRespawnSeconds(t, thornpeak, undefined) !==
          LEGACY_RESPAWN_SECONDS * (t.respawnMult ?? (t.rare ? 4 : 1)),
      )
      .map((t) => t.id);
    expect(moved).toEqual([]);
    // ...while plain trash and unscheduled bosses DO move, so the tier is live.
    expect(resolveRespawnSeconds(MOBS.warlord_drogmar, thornpeak, undefined)).toBe(180);
    expect(MOBS.warlord_drogmar.boss).toBe(true);
    expect(MOBS.warlord_drogmar.respawnMult).toBeUndefined();
  });

  it('uses the SPAWN position, not the death position', () => {
    // Same template, two different homes: the band decides.
    expect(resolveRespawnSeconds({}, vale, undefined)).not.toBe(
      resolveRespawnSeconds({}, thornpeak, undefined),
    );
  });
});

describe('the death site consumes the policy', () => {
  it('puts a slain open-world mob down for its zone tier, not the old flat 25s', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior' });
    expect(sim.cfg.respawnSeconds).toBeUndefined();
    const mob = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'forest_wolf',
    );
    if (!mob) throw new Error('no forest_wolf spawned');
    const home = zoneContaining(mob.spawnPos.x, mob.spawnPos.z);
    expect(home?.id).toBe('eastbrook_vale');
    sim.dealDamage(null, mob, 99_999, false, 'physical', null, 'hit');
    expect(mob.dead).toBe(true);
    expect(mob.respawnTimer).toBe(TRASH_RESPAWN_SECONDS_LOW);
    expect(mob.respawnTimer).not.toBe(DEFAULT_RESPAWN_SECONDS);
  });

  it('honors an explicit global base, which is what the fast suites rely on', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior', respawnSeconds: 2 });
    const mob = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'forest_wolf',
    );
    if (!mob) throw new Error('no forest_wolf spawned');
    sim.dealDamage(null, mob, 99_999, false, 'physical', null, 'hit');
    expect(mob.respawnTimer).toBe(2);
  });

  it('gives every live open-world spawn a real zone, never the off-map fallback', () => {
    // The static camp-rect check in tests/camp_density.test.ts covers authored
    // centres; this covers where mobs ACTUALLY stand, since campSpawnOffset plus
    // findSafePos can displace a spawn off its centre. Any open-world mob that
    // landed outside every rect would take DEFAULT_RESPAWN_SECONDS and become a
    // 25s farm pocket, which is the regression this pins.
    const sim = new Sim({ seed: 20061, playerClass: 'warrior', noPlayer: true });
    const openWorld = [...sim.entities.values()].filter(
      (e) => e.kind === 'mob' && e.spawnPos.x < DUNGEON_X_THRESHOLD,
    );
    expect(openWorld.length).toBeGreaterThan(500);
    const orphans = openWorld
      .filter((e) => zoneContaining(e.spawnPos.x, e.spawnPos.z) === null)
      .map((e) => `${e.templateId} at (${e.spawnPos.x.toFixed(1)}, ${e.spawnPos.z.toFixed(1)})`);
    expect(orphans).toEqual([]);
    // ...and none of them resolved to the fallback by another route either.
    for (const e of openWorld) {
      const template = MOBS[e.templateId];
      if (template?.respawnSeconds !== undefined || isSelfScheduled(template)) continue;
      expect(resolveRespawnSeconds(template, e.spawnPos, undefined), e.templateId).not.toBe(
        DEFAULT_RESPAWN_SECONDS,
      );
    }
  });

  it('is not pushed out by the corpse window, which the yield model assumes', () => {
    // updateMob defers an in-place respawn while the corpse is still lootable,
    // so the effective delay is max(tier, corpse window). Giving coinless trash
    // harvest tags makes those corpses lootable where they were not, which would
    // silently stretch the delay if the corpse window ever exceeded a tier.
    // CORPSE_DURATION is 60 and the fastest tier is 60, so the tier still wins
    // everywhere; farm_yield prices camps on the tier alone and stays correct.
    expect(CORPSE_DURATION).toBeLessThanOrEqual(TRASH_RESPAWN_SECONDS_LOW);
    expect(CORPSE_DURATION).toBeLessThanOrEqual(TRASH_RESPAWN_SECONDS_MID);
    expect(CORPSE_DURATION).toBeLessThanOrEqual(TRASH_RESPAWN_SECONDS_HIGH);

    // ...and end to end: a harvestable Eastbrook beast is back on the 60s tier,
    // not 60 plus a corpse window.
    const sim = new Sim({ seed: 20061, playerClass: 'warrior', noPlayer: true });
    const wolf = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'forest_wolf',
    );
    if (!wolf) throw new Error('no forest_wolf spawned');
    expect(MOBS.forest_wolf.componentTags?.length).toBeGreaterThan(0);
    sim.dealDamage(null, wolf, 99_999, false, 'physical', null, 'hit');
    expect(wolf.dead).toBe(true);
    expect(wolf.respawnTimer).toBe(TRASH_RESPAWN_SECONDS_LOW);
    const deadline = Math.ceil(TRASH_RESPAWN_SECONDS_LOW / DT) + 4;
    let revivedAt: number | null = null;
    for (let i = 0; i < deadline && revivedAt === null; i++) {
      sim.tick();
      if (!wolf.dead) revivedAt = sim.time;
    }
    expect(revivedAt).not.toBeNull();
    // Within one tick of the tier, so no corpse window was added on top.
    expect(revivedAt as number).toBeGreaterThanOrEqual(TRASH_RESPAWN_SECONDS_LOW);
    expect(revivedAt as number).toBeLessThan(TRASH_RESPAWN_SECONDS_LOW + 1);
  });

  it('still caps corpse decay at a fixed template respawn (the training dummy)', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior' });
    const dummy = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'training_dummy',
    );
    if (!dummy) throw new Error('no training_dummy spawned');
    const fixed = MOBS.training_dummy?.respawnSeconds;
    expect(fixed).toBe(10);
    // The dummy's whole point is a huge HP pool; overkill it outright.
    sim.dealDamage(null, dummy, dummy.hp, false, 'physical', null, 'hit');
    expect(dummy.dead).toBe(true);
    // Its fixed schedule beats Thornpeak's 180s tier, and still caps corpse decay.
    expect(dummy.respawnTimer).toBe(fixed);
    expect(dummy.corpseTimer).toBeLessThanOrEqual(fixed as number);
  });
});
