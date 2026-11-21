// The Masterless Strength's mechanic AI for the raid bots (scripts/heart_raid.mjs
// BOSS=final; the plumbing is scripts/lib/heart_raid_bots.mjs). The tanks drag
// the boss round the Anvil's four quarters by their Overload bars (no root
// since 2026-11-19: it can be dragged at any time; it is moved on once its bar fills past two thirds,
// toward the emptier neighbour, never parked in the ring), the raid follows it
// and plays each quarter's kit: out of Basalt Fist's spot and lanes, the Fire
// Whirls, the pools and the cracks, spread for the Leaping Bolt, one player on
// each Storm Orb, everyone under Weight of the Anvil (every tier, every
// Anvil: Heroic's Crushed was removed on 2026-11-20). The woken stars (the rework of 2026-11-18): out of every pillar's
// rise, Sky Strike and Arcing Stone ring, never in a Crossing Blade's line;
// the pillars are walls (walked round, no sight through them); a bot marked
// for a blade leads its line through the pillars, the Storm-Charged ones
// first (their pulse on the whole raid is the clock), then steps off it once
// it locks; and the drag prefers waking the Quench (the blades) once pillars
// stand. In the intermissions the damage dealers
// burn the Splinters (Rime Toll kicked); in the final phase everyone stays in
// the ring; on Mythic's hidden phase nobody stands on a fallen or falling
// quarter. Reads only what the server sends; the geometry is the sim's own
// pure module (claim-local).
//
// Its own elements (Jose's brief of 2026-11-19 (b)): the tanks swap on
// Elemental Strike (the generic swap at 4 stacks of any element), the raid
// keeps 6 yd off a tank carrying 3 or more Static Charge, everyone steps out
// of each fusion combo's footprints (steam, lava, the Firestorm and Avalanche
// lanes, the hail, the spires' links), a Magma Rift mark walks away from the
// raid, and each Opposing Elements mark walks to its paired opposite (the
// nearest free one), keeping clear of every other mark.
//
// Hardening Frost (2026-11-20): the ring planted at a tank's feet from
// Biting Frost's fifth stack is a hazard everyone steps out of. Every fresh
// floor hazard is noticed through the reaction model
// (scripts/lib/heart_raid_reaction.mjs: 250 to 650 ms, now and then a slip of
// another 0.9 to 1.8 s), so the raid plays like a competent human raid, not a
// perfect one. The off-tank waits with a clear line for its taunt (never
// behind a pillar), the raid soaks the Anvil on the mark's far side from the
// boss, and a Storm Orb goes to a free damage dealer before a healer.
//
// IGNORE=drag  the tanks never move the boss on (the key mechanic: Overload)
// IGNORE=swap  the tanks never swap on Elemental Strike (the tank's death test)
// START=40     a few seconds into the pull the leader jumps the boss to its
//              second intermission (/dev heart final inter40): the raid then
//              plays the 40 percent call and fights on into the 15 percent
//              final phase (START=15 jumps straight to the final phase).

import { HEART_ROOM } from '../../src/sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  HEART_QUARTERS,
  heartQuarterSpot,
} from '../../src/sim/content/smith_heart_quarters';
import {
  ELEMENT_AURAS,
  ELEMENT_OBJECTS,
  ELEMENT_TUNING as ET,
  elementLaneOf,
  hailOf,
  polaritiesCancel,
  polarityOf,
  residueOf,
  rimeOf,
  STRIKE_AURAS,
  spireLinks,
  spireOf,
  steamOf,
} from '../../src/sim/encounters/smith_heart/final_elements_ids';
import {
  FINAL_AURAS,
  FINAL_CASTS,
  FINAL_OBJECTS,
  FINAL_TUNING,
  finalLaneOf,
  finalPillarOf,
  finalZoneOf,
  overloadAuraId,
} from '../../src/sim/encounters/smith_heart/final_ids';
import {
  FINAL_ADD_MOBS,
  FINAL_PHASE_AURAS,
  FINAL_PHASE_CASTS,
  hiddenFallenAt,
  inRingGap,
  FINAL_PHASE_AURAS as PA,
  QUENCH_RING_LIFE,
  quarterBit,
  quenchRingFront,
  quenchRingGaps,
  quenchRingOf,
} from '../../src/sim/encounters/smith_heart/final_phase_ids';
import { laneReach } from '../../src/sim/encounters/smith_heart/heat_geometry';
import {
  HEAT_OBJECTS,
  HEAT_TUNING,
  swellLaneOf,
} from '../../src/sim/encounters/smith_heart/heat_ids';
import {
  add,
  alive,
  auraOf,
  fightSec,
  fmtSec,
  HEROIC_PLUS,
  hasAura,
  hypot,
  IGNORE,
  log,
  rand,
  segDist,
  tankAssign,
  unit,
} from './heart_raid_bots.mjs';
import { createReaction } from './heart_raid_reaction.mjs';

const T = FINAL_TUNING;
/** Where the pull jumps (START=40 or 15; empty: the whole fight). */
const START = (process.env.START ?? '').trim();
const SPLINTERS = new Set(Object.values(FINAL_ADD_MOBS));
const L = (world, p) => ({ x: p.x - world.origin.x, z: p.z - world.origin.z });
const W = (world, p) => ({ x: p.x + world.origin.x, z: p.z + world.origin.z });
/** Move the boss on once its quarter's bar passes this. */
const MOVE_AT = 45;

export const final = {
  key: 'final',
  title: 'Masterless Strength',
  tids: { boss: 'heart_masterless_strength' },
  tp: '/dev heart tp final',
  // The paladin pulls with its 29 yd taunt from a quarter, so the boss walks
  // straight out of the ring (Heart Unbound stacks every second it stays).
  opener: 'ot',
  // Elemental Strike: the swap at the brief's count, whatever its element.
  swapAura: IGNORE === 'swap' ? [] : Object.values(STRIKE_AURAS),
  swapStacks: ET.swapAt,
  resetGrace: 50000,
  setup(diff) {
    const out = ['/dev heart kill guardians', '/dev heart portal', '/dev heart final reset'];
    out.push(`/dev heart final ${diff}`);
    return out;
  },

  locate(world) {
    const b = world.mobs.boss;
    if (!b) return false;
    world.origin = { x: b.x - HEART_ROOM.x, z: b.z - HEART_ROOM.z };
    world.center = { x: b.x, z: b.z };
    world.home = unit(world.center, world.obs.self);
    world.anchor = world.center;
    world.prepull = add(world.center, world.home, 26);
    world.rangeScale = 0.7;
    world.arcSpan = 1.2;
    world.reach = 70;
    return true;
  },

  read(world) {
    const o = {
      danger: [],
      lanes: [],
      orbs: [],
      anvils: [],
      ice: [],
      pillars: [],
      blades: [],
      bladeLanes: [],
      rings: [],
      spires: [],
      rimes: [],
    };
    // A Quenching Ring's age is ours to keep (its object carries its gaps,
    // not its age): first seen, it was just raised.
    world.ringBorn ??= new Map();
    const seenRings = new Set();
    for (const e of world.obs.ents.values()) {
      if (e.k !== 'object' || typeof e.tid !== 'string') continue;
      const t = e.tid;
      const at = { x: e.x, z: e.z, r: e.sc ?? 3, f: e.f ?? 0, id: e.id };
      const ring = quenchRingOf(t);
      if (ring) {
        seenRings.add(e.id);
        if (!world.ringBorn.has(e.id)) world.ringBorn.set(e.id, Date.now());
        const age = (Date.now() - world.ringBorn.get(e.id)) / 1000;
        if (age < QUENCH_RING_LIFE)
          o.rings.push({
            ...at,
            front: quenchRingFront(age),
            gaps: quenchRingGaps(ring.seed, ring.gaps),
          });
        continue;
      }
      // Hardening Frost (2026-11-20): a 3.5 yd ring planted at the tank's
      // feet from Biting Frost's fifth stack, closing 3 s later and freezing
      // whoever still stands in it: everyone steps out, the tank first.
      if (rimeOf(t) !== null) {
        o.rimes.push({ ...at, r: ET.rimeR });
        o.danger.push({ ...at, r: ET.rimeR + 1 });
        continue;
      }
      // Its own elements' footprints.
      if (steamOf(t)) {
        // A drifting cloud: where it is and a little round it.
        o.danger.push({ ...at, r: at.r + 1.8 });
        continue;
      }
      if (t === ELEMENT_OBJECTS.lava || residueOf(t)) {
        o.danger.push({ ...at, r: at.r + 1 });
        continue;
      }
      if (hailOf(t) !== null) {
        o.danger.push({ ...at, r: at.r + 1 });
        continue;
      }
      const elane =
        elementLaneOf(ELEMENT_OBJECTS.firePrefix, t) ??
        elementLaneOf(ELEMENT_OBJECTS.avalanchePrefix, t);
      if (elane) {
        const d = { x: Math.sin(at.f), z: Math.cos(at.f) };
        o.lanes.push({
          id: at.id,
          from: add(at, d, -elane.length / 2),
          to: add(at, d, elane.length / 2),
          half: elane.half + 1,
        });
        continue;
      }
      const sp = spireOf(t);
      if (sp) {
        o.spires.push({ ...at, ...sp });
        o.danger.push({ ...at, r: ET.spireR + 0.8 });
        continue;
      }
      const pillar = finalPillarOf(t);
      if (pillar) {
        o.pillars.push({ ...at, r: T.pillarR, charged: pillar === 'charged' });
        // A charged pillar's ground bites every second (2026-11-19): stay off it.
        if (pillar === 'charged') o.danger.push({ ...at, r: T.chargedZoneR + 1 });
        continue;
      }
      if (t.startsWith(FINAL_OBJECTS.bladePrefix)) {
        o.blades.push(at);
        continue;
      }
      const lane = finalLaneOf(t);
      if (lane) {
        // The line's object stands at its middle (final_blades.ts laneMiddle).
        const d = { x: Math.sin(at.f), z: Math.cos(at.f) };
        const from = add(at, d, -lane.length / 2);
        o.bladeLanes.push({
          id: at.id,
          from,
          to: add(at, d, lane.length / 2),
          half: T.bladeHalf + 1.2,
          state: lane.state,
        });
        continue;
      }
      if (t.startsWith(FINAL_OBJECTS.risePrefix)) o.danger.push({ ...at, r: T.riseKnockR + 1.2 });
      else if (t.startsWith(FINAL_OBJECTS.strikePrefix)) o.danger.push({ ...at, r: T.skyR + 1.2 });
      // Arcing Stone's ring: a pillar about to be charged (a strike seeks the
      // stone on every tier since 2026-11-20): the raid keeps out of it.
      else if (t.startsWith(FINAL_OBJECTS.arcPrefix)) o.danger.push({ ...at, r: T.arcR + 1.5 });
      else if (t.startsWith(FINAL_OBJECTS.orbPrefix)) o.orbs.push(at);
      else if (t.startsWith(FINAL_OBJECTS.anvilPrefix))
        o.anvils.push({ ...at, r: at.r || T.anvilR });
      else if (t.startsWith(FINAL_OBJECTS.crackPrefix)) o.ice.push({ ...at, r: at.r + 1.2 });
      else if (t.startsWith(FINAL_OBJECTS.whirlPrefix) || t.startsWith(FINAL_OBJECTS.devilPrefix)) {
        // A tornado rolls on (6.3 yd a second since 2026-11-19; a Breath Dust
        // Devil 5, wandering): keep clear of where it will be, not only where
        // it is (the Heroic bot raids of 2026-11-18).
        const r = at.r + 2;
        const d = { x: Math.sin(at.f), z: Math.cos(at.f) };
        o.danger.push({ ...at, r }, { ...add(at, d, 5), r }, { ...add(at, d, 10), r: r - 1 });
      } else if (
        t.startsWith(FINAL_OBJECTS.whirlPrefix) ||
        t.startsWith(FINAL_OBJECTS.poolPrefix) ||
        t.startsWith(FINAL_OBJECTS.tremorPrefix) ||
        t.startsWith(HEAT_OBJECTS.fistPrefix) ||
        t === HEAT_OBJECTS.wave
      )
        o.danger.push({
          ...at,
          // A wave's wall is waveDepth deep behind its object: the circle
          // must cover the box's corners (as the Heat guardian's bots do).
          r:
            at.r +
            (t.startsWith(FINAL_OBJECTS.whirlPrefix) ? 2 : t === HEAT_OBJECTS.wave ? 2.5 : 1.3),
        });
      else if (swellLaneOf(t)) {
        const d = { x: Math.sin(at.f), z: Math.cos(at.f) };
        o.lanes.push({
          id: at.id,
          from: { x: at.x, z: at.z },
          // To the Anvil's rim since 2026-11-19 (laneReach), never the guardian's 32 yd.
          to: add(
            at,
            d,
            laneReach(
              at.x - (world.origin?.x ?? 0),
              at.z - (world.origin?.z ?? 0),
              at.f,
              HEAT_TUNING.laneLength,
            ),
          ),
          half: HEAT_TUNING.laneHalf + 1,
        });
      }
    }
    for (const id of world.ringBorn.keys()) if (!seenRings.has(id)) world.ringBorn.delete(id);
    // The Storm Spires' links: a line between each pair the lightning joins.
    const groups = new Map();
    for (const sp of o.spires) {
      if (!groups.has(sp.group)) groups.set(sp.group, []);
      groups.get(sp.group)[sp.index] = sp;
    }
    for (const list of groups.values())
      for (const [a, b] of spireLinks(list.length))
        if (list[a] && list[b])
          o.lanes.push({
            id: list[a].id,
            from: list[a],
            to: list[b],
            half: ET.spireLinkHalf + 1.2,
          });
    // The reaction model: each bot notices a fresh footprint a human-ish
    // moment after it appears (and now and then late); forget the gone ones.
    world.react ??= createReaction(rand);
    const live = new Set();
    for (const e of world.obs.ents.values()) if (e.k === 'object') live.add(e.id);
    world.react.prune(live);

    world.o = o;
    const b = world.mobs.boss;
    world.anchor = alive(b) ? b : world.center;
    world.splinters = world.adds.filter((a) => SPLINTERS.has(a.tid));
  },

  onFloor(world, at) {
    const l = L(world, at);
    const r = Math.hypot(l.x - HEART_ROOM.x, l.z - HEART_ROOM.z);
    return r < HEART_QUARTERS.rimR - 4;
  },
  tankSpot(world, st, b, t) {
    // A Splinter is held where it rose (its signature is its quarter's).
    if (t && SPLINTERS.has(t.tid)) return t;
    // The tank NOT holding the boss waits beside it on its outer side (away
    // from the central ring), ready for the swap: a taunt from a drag spot
    // across the room pulled the boss through the ring into Heart Unbound
    // (the bot raids of 2026-11-20).
    const boss = world.mobs.boss;
    if (alive(boss) && boss.aggro !== b.pid && !final.isFinalPhase(world))
      return standbySpot(world, st, b, boss);
    return dragSpot(world, st);
  },
  // An intermission's Splinters are split between the tanks in turn (the
  // shielded boss needs none): each takes back its own when one turns away.
  tankAssign(world, st, b, me) {
    const s = world.splinters ?? [];
    if (!s.length) return tankAssign(world, st, b, me);
    const tanks = world
      .living()
      .filter((p) => p.tank)
      .sort((x, y) => x.pid - y.pid);
    const mine = s
      .slice()
      .sort((x, y) => x.id - y.id)
      .filter((_, i) => tanks[i % tanks.length]?.pid === b.pid);
    const loose = mine.find((m) => m.aggro !== b.pid);
    b.tankTarget = (loose ?? mine[0])?.id ?? null;
    b.loose = loose
      ? { r: loose.id, m: loose, onTank: !!world.players.get(loose.aggro)?.tank }
      : null;
  },
  meleeReach() {
    return 7;
  },
  // The pillars are walls: walked round, and no sight line through them.
  obstacles(world) {
    return (world.o?.pillars ?? []).map((p) => ({ x: p.x, z: p.z, r: p.r + 0.8 }));
  },
  blocksLine(world, a, b) {
    for (const p of world.o?.pillars ?? [])
      if (segDist(p, a, b) < p.r + 0.3 && hypot(a, p) > p.r && hypot(b, p) > p.r) return true;
    return false;
  },
  // The healers stand between the ring and the boss's quarter (14 yd out on
  // its bearing, a little apart): every tank and the raid round the boss in
  // reach, and only a step when the boss changes quarter.
  roleSpot(world, st, b) {
    // The Splinter of the Quench's Rime Toll must be kicked: two ranged
    // interrupters stand in its reach (the main kick and its backup), on its
    // side toward the ring, apart.
    const toll = { mage: -0.5, hunter: 0.5 }[b.spec.key];
    if (toll !== undefined) {
      const q = (world.splinters ?? []).find((a) => a.tid === FINAL_ADD_MOBS.quench && alive(a));
      if (q) {
        const a = Math.atan2(world.center.x - q.x, world.center.z - q.z) + toll;
        return add(q, { x: Math.sin(a), z: Math.cos(a) }, 18 + (q.reach ?? 0));
      }
    }
    if (b.spec.role !== 'healer') return null;
    const boss = world.mobs.boss;
    if (!alive(boss) || hypot(boss, world.center) < 4) return null;
    const u = unit(world.center, boss);
    const side = b.spec.key === 'h1' ? 1 : -1;
    // Outside the central ring (16 yd): a healer the boss turns on must
    // never pull it into the ring, where Heart Unbound wipes the raid (the
    // bot raids of 2026-11-20 after a tank swap).
    return add(add(world.center, u, HEART_QUARTERS.ringR + 6), { x: -u.z, z: u.x }, side * 4);
  },
  targets(world) {
    const s = world.splinters;
    if (s.length) return s.slice().sort((x, y) => x.hp / x.mhp - y.hp / y.mhp)[0];
    const b = world.mobs.boss;
    return b && !hasAura(b, FINAL_PHASE_AURAS.shield) ? b : null;
  },
  plan(world, st) {
    init(st);
    if (!START || st.started || fightSec() < 6) return;
    st.started = true;
    const line = START === '15' ? '/dev heart final last' : '/dev heart final inter40';
    world.leader.chat(line);
    log(`START: the leader jumps the boss (${line})`);
  },
  // Rime Toll rung out strikes the whole raid for 650 to 720 (most of a
  // cloth pool on top of Splintered Strength): a fumbled kick gets a backup.
  backupKick(castId) {
    return castId === FINAL_PHASE_CASTS.toll;
  },
  // The healers top the raid up through Weight of the Anvil's bar: a share
  // lands on everyone under it at once.
  topUp(world) {
    const b = world.mobs.boss;
    // The whole Hammer visit: its first Anvil falls 16 s in, too soon to
    // lift a worn raid in the bar's 6 s alone.
    return (
      (!!b && b.cast === FINAL_CASTS.anvil) ||
      (world.o?.anvils.length ?? 0) > 0 ||
      zoneOfBoss(world) === 'hammer'
    );
  },
  kickables(world) {
    return world.splinters
      .filter((m) => m.cast === FINAL_PHASE_CASTS.toll)
      .map((m) => ({ mob: m, cast: m.cast }));
  },

  bad(world, st, at) {
    const o = world.o;
    if (!o) return false;
    if (!final.onFloor(world, at)) return true;
    // The quarter fight: nobody stands in the central ring, so a boss that
    // turns on anyone (a lost aggro, a swap) is never drawn into it.
    const boss = world.mobs.boss;
    if (
      boss &&
      !final.isFinalPhase(world) &&
      !hasAura(boss, FINAL_PHASE_AURAS.shield) &&
      !hasAura(boss, FINAL_PHASE_AURAS.hidden) &&
      hypot(at, world.center) < HEART_QUARTERS.ringR + 2
    )
      return true;
    const seen = (h) => sees(world, st, h);
    for (const h of [...o.danger, ...o.ice]) if (seen(h) && hypot(h, at) < h.r) return true;
    for (const ln of o.lanes) if (seen(ln) && segDist(at, ln.from, ln.to) < ln.half) return true;
    for (const ln of o.bladeLanes)
      if (seen(ln) && segDist(at, ln.from, ln.to) < ln.half) return true;
    for (const p of o.pillars) if (hypot(p, at) < p.r + 1) return true;
    const b = world.mobs.boss;
    const hid = b ? auraOf(b, FINAL_PHASE_AURAS.hidden) : null;
    if (hid) {
      const next = Math.round(hid.value2 ?? -1);
      const mask = Math.round(hid.value ?? 0) | (next >= 0 && next < 4 ? 1 << next : 0);
      const l = L(world, at);
      if (hiddenFallenAt(mask, l.x, l.z)) return true;
    }
    return false;
  },
  hazards(world, st, b, me) {
    const out = [];
    const o = world.o;
    if (!o) return out;
    for (const h of [...o.danger, ...o.ice]) if (sees(world, st, h)) out.push(h);
    // The Leaping Bolt and Drawn Lightning: spread from the marked.
    const boss = world.mobs.boss;
    if (boss?.cast === FINAL_CASTS.bolt && boss.castTgt !== b.pid) {
      const t = world.players.get(boss.castTgt);
      if (t) out.push({ x: t.x, z: t.z, r: T.boltLeap ?? 7.5 });
    }
    for (const p of world.living()) {
      if (p.pid === b.pid) continue;
      if (hasAura(p, FINAL_AURAS.drawn)) out.push({ x: p.x, z: p.z, r: (T.drawnReach ?? 8) + 1.5 });
      if (hasAura(p, FINAL_PHASE_AURAS.coal)) out.push({ x: p.x, z: p.z, r: 9.5 });
    }
    // Static Charge (Elemental Strike in the Breath): a tank carrying 3 or
    // more arcs to everyone within 6 yd, so the raid keeps off it.
    for (const p of world.living()) {
      if (p.pid === b.pid) continue;
      const sc = auraOf(p, STRIKE_AURAS.breath);
      if (sc && (sc.stacks ?? 1) >= ET.arcFrom) out.push({ x: p.x, z: p.z, r: ET.arcReach + 1.5 });
      // A Magma Rift mark erupts under its player.
      if (hasAura(p, ELEMENT_AURAS.magmaMark)) out.push({ x: p.x, z: p.z, r: ET.magmaR + 1.5 });
    }
    // Opposing Elements: never within reach of a mark that is not my partner.
    if (hasAura(me, ELEMENT_AURAS.polarity)) {
      const partner = st.polarityPair?.get(b.pid) ?? null;
      for (const p of world.living()) {
        if (p.pid === b.pid || p.pid === partner) continue;
        if (hasAura(p, ELEMENT_AURAS.polarity)) out.push({ x: p.x, z: p.z, r: ET.meetR + 2.5 });
      }
    }
    // The Splinter of the Breath on the hunt: its Buffeting Gale strikes
    // everyone but its quarry within 7 yd every second (its tank too).
    const hunter = huntingBreath(world);
    if (hunter && !hasAura(me, FINAL_PHASE_AURAS.tether))
      out.push({ x: hunter.x, z: hunter.z, r: BUFFET_REACH + 2 });
    // A Splinter's Shearing Blow cone: only its target stands in front.
    for (const s of world.splinters) {
      if (s.cast !== FINAL_PHASE_CASTS.shear || s.castTgt === b.pid) continue;
      const f = { x: Math.sin(s.f ?? 0), z: Math.cos(s.f ?? 0) };
      for (const k of [3, 6, 9]) out.push({ ...add(s, f, k), r: k * 0.8 + 1 });
    }
    return out;
  },

  track(world, st) {
    track(world, st);
  },
  duty(world, st, b, me) {
    return duty(world, st, b, me);
  },

  statusLine(world) {
    const b = world.mobs.boss;
    if (!b) return '-';
    const z = zoneCode(b);
    const bars = HEART_QUARTER_ORDER.map(
      (v) => `${v[0]}${Math.round(auraOf(b, overloadAuraId(v))?.value ?? 0)}`,
    ).join(' ');
    return `zone ${z}; bars ${bars}; splinters ${world.splinters.length}`;
  },
  report(world, st, note) {
    init(st);
    note(`Quarter changes: ${st.zones.map((z) => `${fmtSec(z.t)} ${z.zone}`).join(', ')}`);
    note(
      `Overload bursts: ${st.bursts}; stages: ${st.stages.map((s) => `${fmtSec(s.t)} ${s.what}`).join(', ') || '-'}`,
    );
    if (START)
      note(
        `Staged: the pull jumped to ${START === '15' ? 'the final phase' : 'the 40 percent call'} (START=${START})`,
      );
    note(`Anvils: ${st.anvils ?? 0} (under each: ${(st.anvilUnder ?? []).join(', ') || '-'})`);
    note(
      `Stars: pillars risen ${st.pillarsSeen ?? 0}, most standing ${st.pillarsMax ?? 0}, most charged ${st.chargedMax ?? 0}, shattered ${st.shattered ?? 0} (charged ${st.chargedShattered ?? 0}), blades ${st.bladesSeen ?? 0}`,
    );
    note(
      `Heart Unbound: ${st.unboundTicks ?? 0} stacks gained (most ${st.unboundMax ?? 0}); Hardening Frost: ${st.rimes ?? 0} rings, ${st.freezes ?? 0} frozen; late reactions rolled: ${st.slips ?? 0}`,
    );
    note(
      `Its own elements: most Elemental Strike stacks on a tank ${st.strikeMax ?? 0}; fusions ${
        Object.entries(st.combos ?? {})
          .map(([k, v]) => `${k} x${v.n}`)
          .join(', ') || '-'
      }; polarity rounds ${st.polarityRounds ?? 0}`,
    );
  },
  row(world, st) {
    init(st);
    return [
      ['Quarters', String(st.zones.length)],
      ['Bursts', String(st.bursts)],
      ['Pillars', `${st.pillarsSeen ?? 0}/${st.shattered ?? 0}`],
      ['Charged', String(st.chargedMax ?? 0)],
      ['Stacks', String(st.strikeMax ?? 0)],
      ['Unbound', String(st.unboundMax ?? 0)],
      ['Frozen', String(st.freezes ?? 0)],
    ];
  },
  // The machine-readable side of the report (heart_raid_bots.mjs writes it
  // beside the fight log as JSON).
  summary(world, st) {
    init(st);
    return {
      quarters: st.zones,
      bursts: st.bursts,
      stages: st.stages,
      anvils: st.anvils ?? 0,
      anvilUnder: st.anvilUnder ?? [],
      pillarsSeen: st.pillarsSeen ?? 0,
      pillarsMax: st.pillarsMax ?? 0,
      chargedMax: st.chargedMax ?? 0,
      shattered: st.shattered ?? 0,
      blades: st.bladesSeen ?? 0,
      strikeMax: st.strikeMax ?? 0,
      combos: Object.fromEntries(Object.entries(st.combos ?? {}).map(([k, v]) => [k, v.n])),
      polarityRounds: st.polarityRounds ?? 0,
      unboundGained: st.unboundTicks ?? 0,
      unboundMax: st.unboundMax ?? 0,
      rimes: st.rimes ?? 0,
      freezes: st.freezes ?? 0,
      slips: st.slips ?? 0,
    };
  },
};

/** The zone on the boss's state aura (a value of 0, the first quarter, rides
 *  the wire as an absent value). */
function zoneCode(b) {
  const a = auraOf(b, FINAL_AURAS.state);
  return a ? finalZoneOf(a.value ?? 0) : 'ring';
}

function init(st) {
  if (st.zones) return;
  Object.assign(st, {
    zones: [],
    bursts: 0,
    stages: [],
    prevZone: null,
    prevBars: {},
    prevStage: null,
    next: null,
  });
}

function zoneOfBoss(world) {
  const b = world.mobs.boss;
  return b ? zoneCode(b) : 'ring';
}
function bar(world, vein) {
  const b = world.mobs.boss;
  return auraOf(b, overloadAuraId(vein))?.value ?? 0;
}

/** The off-tank's spot beside the boss, ready to taunt at the swap: on the
 *  boss's outer side (away from the central ring), within a warrior's taunt
 *  reach, with a clear line to it (a Wake the Stone pillar between them
 *  blocked the taunt and the holder ran to 6 Elemental Strike stacks in the
 *  bot raids of 2026-11-21), off every hazard. */
function standbySpot(world, st, b, boss) {
  const out = unit(world.center, boss);
  const base = Math.atan2(out.x, out.z);
  const r = Math.min(7, 5 + (boss.reach ?? 0));
  for (const da of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
    const a = base + da;
    const at = add(boss, { x: Math.sin(a), z: Math.cos(a) }, r);
    if (!final.onFloor(world, at) || final.bad(world, st, at)) continue;
    if (final.blocksLine(world, at, boss)) continue;
    return at;
  }
  return add(boss, out, r);
}

/** Where the boss's tank stands: in the quarter it drinks until its bar is
 *  two thirds full, then the emptier neighbour quarter. */
function dragSpot(world, st) {
  init(st);
  const b = world.mobs.boss;
  if (!alive(b)) return world.center;
  if (hasAura(b, FINAL_PHASE_AURAS.shield) || final.isFinalPhase(world)) return b;
  const z = zoneOfBoss(world);
  let target = st.next ?? (z === 'ring' ? lowest(world, null) : z);
  // Heroic: a change while the raid is still Vein-Shaken hits three times
  // as hard, so the tanks wait the mark out unless the bar runs high. The
  // boss's state aura carries the mark's seconds left (value3, the server's
  // own clock), the raid's own auras the same mark.
  const markLeft = auraOf(b, FINAL_AURAS.state)?.value3 ?? 0;
  const shaken = markLeft > 0 || world.living().some((p) => hasAura(p, FINAL_AURAS.shaken));
  // While the mark holds, the tank keeps the boss in the quarter it just
  // entered: no stale drag target and no walk back to the last quarter
  // after it (the runs of 2026-11-11 crossed twice inside 20 s and
  // took Vein Shock three times over). A bar running high still moves it.
  if (HEROIC_PLUS && shaken && z !== 'ring' && bar(world, z) < 75) {
    if (st.next && st.next !== z)
      log(`HOLD: Vein-Shaken ${markLeft} s, ${z} kept (not ${st.next})`);
    st.next = null;
    target = z;
  }
  // The next Anvil falls a tier's anvilEvery later, so the boss leaves the
  // Hammer once one has fallen: every Anvil is a raid-wide soak and a Tremor
  // Crack round, so one per Hammer visit is the clean rotation.
  const hammerDone = z === 'hammer' && (st.anvilFellAt ?? 0) > (st.zoneAt ?? Date.now());
  if (
    IGNORE !== 'drag' &&
    z !== 'ring' &&
    (bar(world, z) >= MOVE_AT || hammerDone) &&
    (!shaken || bar(world, z) >= 75) &&
    (!st.next || st.next === z)
  ) {
    const i = HEART_QUARTER_ORDER.indexOf(z);
    const n = HEART_QUARTER_ORDER.length;
    const a = HEART_QUARTER_ORDER[(i + 1) % n];
    const c = HEART_QUARTER_ORDER[(i + n - 1) % n];
    target = bar(world, a) <= bar(world, c) ? a : c;
    // Pillars standing and the blades still asleep: wake the Quench next if
    // it neighbours (its blades are the only way to break them), and never
    // wake the storm over them first.
    const pillars = world.o?.pillars.length ?? 0;
    const mask = auraOf(b, PA.phase)?.value2 ?? 0;
    const awake = (v) => (mask & quarterBit(v)) !== 0;
    if (pillars >= 2 && !awake('quench') && (a === 'quench' || c === 'quench')) target = 'quench';
    else if (pillars >= 2 && !awake('breath') && target === 'breath') {
      const other = target === a ? c : a;
      if (bar(world, other) < 70) target = other;
    }
    st.next = target;
    log(`DRAG: ${z} bar at ${Math.round(bar(world, z))}, on to ${target}`);
  }
  if (st.next && z === st.next) st.next = null;
  const spot = W(world, heartQuarterSpot(target));
  // Never through the ring: a straight line from quarter to quarter can
  // brush it, so the tank walks round by the rim side of the ridge.
  const tank = world.players.get(b.aggro);
  const from = tank ?? b;
  const R = HEART_QUARTERS.ringR + 4;
  if (segDist(world.center, from, spot) < R && hypot(from, world.center) > R) {
    const mid = { x: (from.x + spot.x) / 2, z: (from.z + spot.z) / 2 };
    const out = unit(world.center, mid);
    return add(world.center, out, Math.max(R + 8, hypot(world.center, from)));
  }
  return spot;
}
final.isFinalPhase = (world) => {
  const b = world.mobs.boss;
  return !!b && b.mhp > 0 && b.hp / b.mhp <= 0.15 && !hasAura(b, FINAL_PHASE_AURAS.hidden);
};

function lowest(world, not) {
  return HEART_QUARTER_ORDER.filter((v) => v !== not).sort(
    (x, y) => bar(world, x) - bar(world, y),
  )[0];
}

function track(world, st) {
  init(st);
  trackElements(world, st);
  // Weight of the Anvil: how many stood under it as it fell (its mark gone).
  const anvil = world.o?.anvils[0] ?? null;
  if (st.anvilSeen && !anvil) {
    const a = st.anvilSeen;
    const under = world.living().filter((p) => hypot(p, a) <= T.anvilR);
    const out = world
      .living()
      .filter((p) => hypot(p, a) > T.anvilR)
      .map((p) => `${p.name} ${hypot(p, a).toFixed(0)} yd ${p.bot?.prevDuty ?? '?'}`);
    log(`ANVIL fell: ${under.length} under${out.length ? `; out: ${out.join(', ')}` : ''}`);
    st.anvils = (st.anvils ?? 0) + 1;
    st.anvilFellAt = Date.now();
    st.anvilUnder = [...(st.anvilUnder ?? []), under.length];
  }
  if (anvil && !st.anvilSeen) {
    const marked = world.living().find((p) => hasAura(p, FINAL_AURAS.anvilMark));
    log(
      `ANVIL marked: ${marked ? `${marked.name}${marked.tank ? ' (tank)' : ''}` : 'nobody (it turns)'}; farthest ${Math.round(Math.max(0, ...world.living().map((p) => hypot(p, anvil))))} yd`,
    );
  }
  st.anvilSeen = anvil ? { x: anvil.x, z: anvil.z } : null;
  // The stars: pillars risen and shattered (the charged ones counted), blades.
  const ps = world.o?.pillars ?? [];
  const ids = new Set(ps.map((p) => p.id));
  const charged = ps.filter((p) => p.charged).length;
  for (const p of ps) if (!st.pillarIds?.has(p.id)) st.pillarsSeen = (st.pillarsSeen ?? 0) + 1;
  for (const [id, wasCharged] of st.pillarCharged ?? new Map()) {
    if (ids.has(id)) continue;
    st.shattered = (st.shattered ?? 0) + 1;
    if (wasCharged) st.chargedShattered = (st.chargedShattered ?? 0) + 1;
    log(`PILLAR shattered${wasCharged ? ' (it was Storm-Charged)' : ''}`);
  }
  st.pillarIds = ids;
  st.pillarCharged = new Map(ps.map((p) => [p.id, p.charged]));
  st.pillarsMax = Math.max(st.pillarsMax ?? 0, ps.length);
  if (charged > (st.chargedNow ?? 0)) log(`STORM-CHARGED: ${charged} pillars charged`);
  st.chargedNow = charged;
  st.chargedMax = Math.max(st.chargedMax ?? 0, charged);
  const bladeIds = new Set((world.o?.blades ?? []).map((x) => x.id));
  for (const id of bladeIds) if (!st.bladeIds?.has(id)) st.bladesSeen = (st.bladesSeen ?? 0) + 1;
  st.bladeIds = bladeIds;
  trackCounters(world, st);
  const z = zoneOfBoss(world);
  if (z !== st.prevZone && world.mobs.boss?.aggro != null) {
    st.zones.push({ t: fightSec(), zone: z });
    st.zoneAt = Date.now();
    log(`QUARTER: the boss drinks ${z}`);
    st.prevZone = z;
  }
  for (const v of HEART_QUARTER_ORDER) {
    const now = bar(world, v);
    if ((st.prevBars[v] ?? 0) > 90 && now < 20) {
      st.bursts++;
      log(`OVERLOAD BURST: ${v}`);
    }
    st.prevBars[v] = now;
  }
  const b = world.mobs.boss;
  const ph = b ? auraOf(b, FINAL_PHASE_AURAS.phase) : null;
  const key = ph ? `${ph.value}` : null;
  if (key !== st.prevStage) {
    if (key) {
      st.stages.push({ t: fightSec(), what: `stage ${key}` });
      log(`PHASE: stage ${key}`);
    }
    st.prevStage = key;
  }
}

/** The counters the report and the JSON summary read: Heart Unbound's
 *  stacks, Hardening Frost rings and freezes, the reaction model's slips. */
function trackCounters(world, st) {
  const b = world.mobs.boss;
  const ub = b ? auraOf(b, FINAL_AURAS.unbound) : null;
  const stacks = ub ? Math.round(ub.value ?? ub.stacks ?? 1) : 0;
  if (stacks > (st.unboundNow ?? 0)) {
    st.unboundTicks = (st.unboundTicks ?? 0) + 1;
    st.unboundMax = Math.max(st.unboundMax ?? 0, stacks);
    log(`HEART UNBOUND: ${stacks} stacks`);
  }
  st.unboundNow = stacks;
  st.rimeIds ??= new Set();
  for (const r of world.o?.rimes ?? []) {
    if (st.rimeIds.has(r.id)) continue;
    st.rimeIds.add(r.id);
    st.rimes = (st.rimes ?? 0) + 1;
    log("HARDENING FROST: a ring at the tank's feet");
  }
  st.frozenNow ??= new Set();
  for (const p of world.living()) {
    const f = hasAura(p, ELEMENT_AURAS.frozen);
    if (f && !st.frozenNow.has(p.pid)) {
      st.frozenNow.add(p.pid);
      st.freezes = (st.freezes ?? 0) + 1;
      log(`FROZEN: ${p.name} (Hardening Frost closed on them)`);
    } else if (!f) st.frozenNow.delete(p.pid);
  }
  st.slips = world.react?.slips() ?? 0;
}

/** Its own elements: the polarity pairs (each mark to the nearest free
 *  opposite, decided once a round), the strike's stacks and the combos seen. */
function trackElements(world, st) {
  const marked = world
    .living()
    .map((p) => ({ p, a: auraOf(p, ELEMENT_AURAS.polarity) }))
    .filter((m) => m.a)
    .map((m) => ({ p: m.p, el: polarityOf(m.a.value ?? 0) }));
  if (marked.length === 0) st.polarityPair = null;
  else {
    const stale =
      !st.polarityPair ||
      marked.some((m) => !st.polarityPair.has(m.p.pid) && !st.polarityAlone?.has(m.p.pid));
    if (stale) {
      if (!st.polarityPair) {
        st.polarityRounds = (st.polarityRounds ?? 0) + 1;
        log(`POLARITY: ${marked.map((m) => `${m.p.name} ${m.el}`).join(', ')}`);
      }
      const pair = new Map();
      const free = marked.slice().sort((x, y) => x.p.pid - y.p.pid);
      for (const m of free) {
        if (pair.has(m.p.pid)) continue;
        const opp = free
          .filter((q) => !pair.has(q.p.pid) && q !== m && polaritiesCancel(m.el, q.el))
          .sort((x, y) => hypot(x.p, m.p) - hypot(y.p, m.p))[0];
        if (!opp) continue;
        pair.set(m.p.pid, opp.p.pid);
        pair.set(opp.p.pid, m.p.pid);
      }
      st.polarityPair = pair;
      st.polarityAlone = new Set(marked.filter((m) => !pair.has(m.p.pid)).map((m) => m.p.pid));
    }
  }
  // The most stacks a tank carried.
  for (const p of world.living()) {
    if (!p.tank) continue;
    for (const id of Object.values(STRIKE_AURAS)) {
      const a = auraOf(p, id);
      if (!a) continue;
      st.strikeMax = Math.max(st.strikeMax ?? 0, a.stacks ?? 1);
      st.strikeSeen ??= new Map();
      const key = `${a.stacks ?? 1} ${id.replace('heart_final_strike_', '')}`;
      if (st.strikeSeen.get(p.pid) !== key) {
        st.strikeSeen.set(p.pid, key);
        log(`STRIKE: ${p.name} now ${key}`);
      }
    }
  }
  // The combos seen (by their objects' first sight; one fusion a burst).
  st.comboSeen ??= new Set();
  st.combos ??= {};
  for (const e of world.obs.ents.values()) {
    if (e.k !== 'object' || typeof e.tid !== 'string' || st.comboSeen.has(e.id)) continue;
    const t = e.tid;
    let kind = null;
    if (steamOf(t)) kind = 'steam';
    else if (t === ELEMENT_OBJECTS.lava) kind = 'magma';
    else if (elementLaneOf(ELEMENT_OBJECTS.firePrefix, t)) kind = 'firestorm';
    else if (hailOf(t) !== null) kind = 'hail';
    else if (elementLaneOf(ELEMENT_OBJECTS.avalanchePrefix, t)) kind = 'avalanche';
    else if (spireOf(t)) kind = 'spires';
    if (!kind) continue;
    st.comboSeen.add(e.id);
    const c = st.combos[kind];
    if (!c || Date.now() - c.last > 8000) {
      st.combos[kind] = { n: (c?.n ?? 0) + 1, last: Date.now() };
      log(`FUSION: ${kind}`);
    } else c.last = Date.now();
  }
}

function duty(world, st, b, me) {
  init(st);
  // The bot this tick's hazard checks are for (act() asks duty first).
  st.viewer = b.spec.key;
  const o = world.o;
  const boss = world.mobs.boss;
  // A Quenching Ring riding out at me: into its nearest gap at my distance
  // (outside a gap its front chills and hurts; the healers died to it in the
  // Heroic bot raids of 2026-11-18, the bots never read it before).
  for (const r of o.rings ?? []) {
    const d = hypot(me, r);
    if (d < r.front - 0.5 || d > r.front + 16) continue;
    const bearing = Math.atan2(me.x - r.x, me.z - r.z);
    if (inRingGap(bearing, r.gaps, 18)) continue;
    const g = r.gaps
      .slice()
      .sort(
        (x, y) =>
          Math.abs(Math.atan2(Math.sin(x - bearing), Math.cos(x - bearing))) -
          Math.abs(Math.atan2(Math.sin(y - bearing), Math.cos(y - bearing))),
      )[0];
    const at = {
      x: r.x + Math.sin(g) * Math.max(d, r.front + 2),
      z: r.z + Math.cos(g) * Math.max(d, r.front + 2),
    };
    if (final.onFloor(world, at)) return { goal: at, tol: 0.8, duty: 'ring gap' };
  }
  // Opposing Elements: to my paired opposite (both walk to the middle).
  if (hasAura(me, ELEMENT_AURAS.polarity)) {
    const partner = st.polarityPair?.get(b.pid);
    const q = partner !== undefined ? world.players.get(partner) : null;
    if (q && alive(q)) {
      const mid = { x: (me.x + q.x) / 2, z: (me.z + q.z) / 2 };
      const goal = final.bad(world, st, mid) ? { x: q.x, z: q.z } : mid;
      return { goal, tol: 0.6, duty: 'polarity: to my opposite' };
    }
  }
  // Weight of the Anvil's own mark holds still whatever else it carries: its
  // circle follows that player, so walking off (a Magma Rift mark) dragged
  // the soak away from the raid and nobody stood under it (the bot raids of
  // 2026-11-21: 0 under, 1,000 on everyone).
  const anvilNow = o.anvils[0];
  if (anvilNow && hasAura(me, FINAL_AURAS.anvilMark))
    return { goal: { x: me.x, z: me.z }, tol: 1.5, duty: 'anvil (marked)' };
  // Magma Rift under me: away from the raid before it erupts.
  if (hasAura(me, ELEMENT_AURAS.magmaMark)) {
    const spot = spread(world, st, me, ET.magmaR + 3);
    if (spot) return { goal: spot, tol: 1, duty: 'magma: away' };
  }
  // Weight of the Anvil: everyone under it, on every tier.
  const anvil = o.anvils[0];
  // The off-tank soaks too, and the main tank when the mark lies at the
  // boss's feet: 9,000 split is lethal on cloth with three bodies missing.
  // Every body under it, the off-tank too: the share is the total over the
  // soakers. The main tank comes only when the mark lies clear of the ring
  // (the boss follows him, and in the ring Heart Unbound strikes the raid).
  // The bot holding the boss (its aggro): the one who may stay out.
  const mainTank = me.tank && (boss?.aggro === me.pid || me.pid === st.mainTankPid);
  const ringClear = !!anvil && hypot(anvil, world.center) > HEART_QUARTERS.ringR + T.anvilR + 3;
  // Its circle follows its marked player (Jose's playtest of 2026-11-19): the
  // marked one holds still so the raid can gather on them.
  if (anvil && hasAura(me, FINAL_AURAS.anvilMark))
    return { goal: { x: me.x, z: me.z }, tol: 1.5, duty: 'anvil (marked)' };
  // A mark that must keep apart (Drawn Lightning, a Bursting Coal) stays out
  // of the soak: its arcs or its burst would land on the whole stack (a
  // Drawn Lightning carrier in the stack took 1,130 and killed a raider in
  // the Heroic bot raids of 2026-11-21); the others share without it.
  const apart = hasAura(me, FINAL_AURAS.drawn) || hasAura(me, FINAL_PHASE_AURAS.coal);
  if (anvil && !apart && (!mainTank || ringClear) && sees(world, st, anvil)) {
    const i = world.bots.indexOf(b);
    // A mark near the boss (its tank marked, the melee's own spot): the raid
    // gathers on the mark's far side, out of Forge Fist's frontal cone.
    let ang = i * 1.3;
    if (alive(boss) && hypot(boss, anvil) < 12) {
      const away = unit(boss, anvil);
      ang = Math.atan2(away.x, away.z) + ((i % 7) / 6 - 0.5) * 2.2;
    }
    // The mark's carrier also wearing a Magma Rift: stand inside the Anvil
    // but outside the rift's reach round them until it erupts.
    const carrier = world.living().find((p) => hasAura(p, FINAL_AURAS.anvilMark));
    const rift = !!carrier && hasAura(carrier, ELEMENT_AURAS.magmaMark);
    const r = rift ? Math.min(anvil.r - 0.8, ET.magmaR + 1.2) : Math.min(3, anvil.r - 2);
    return {
      goal: add(anvil, { x: Math.sin(ang), z: Math.cos(ang) }, r),
      tol: rift ? 0.5 : 0.8,
      duty: 'anvil',
    };
  }
  // Marked for a Crossing Blade: lead the line through the pillars (the
  // Storm-Charged first), then step off it as it locks.
  const bm = auraOf(me, FINAL_AURAS.bladeMark);
  if (bm) {
    const blade = o.blades.slice().sort((x, y) => hypot(x, me) - hypot(y, me))[0];
    if (blade) {
      if ((bm.value ?? 1) >= 2) {
        // Locked: off the line, sideways.
        const ln = o.bladeLanes
          .slice()
          .sort((x, y) => segDist(me, x.from, x.to) - segDist(me, y.from, y.to))[0];
        if (ln) {
          const d = unit(ln.from, ln.to);
          for (const side of [1, -1]) {
            const at = add(me, { x: -d.z * side, z: d.x * side }, T.bladeHalf + 3.5);
            if (!final.bad(world, st, at) || segDist(at, ln.from, ln.to) > ln.half)
              return { goal: at, tol: 0.6, duty: 'off the blade' };
          }
        }
      } else {
        // Only a pillar the mark can reach before the line locks: the aim
        // runs the tier's bladeAim from the mark (FINAL_DIFFICULTY), locking
        // bladeLock before the end. A charged pillar across the room left the
        // line through nothing and two charged pillars standing (the bot
        // raids of 2026-11-21).
        st.bladeSeenAt ??= new Map();
        if (!st.bladeSeenAt.has(blade.id)) st.bladeSeenAt.set(blade.id, Date.now());
        const aim = HEROIC_PLUS ? 3.5 : 4;
        const left = aim - T.bladeLock - (Date.now() - st.bladeSeenAt.get(blade.id)) / 1000;
        const reach = Math.max(0, left - 0.3) * 6.5;
        const ps = o.pillars
          .slice()
          .sort((x, y) => Number(y.charged) - Number(x.charged) || hypot(x, me) - hypot(y, me));
        for (const p of ps) {
          // Stand on the ray from the blade through the pillar: just before
          // it or just past it, whichever is nearer (the line runs on through
          // the mark to the far rim, so either side breaks it; the near side
          // never walks round the wall).
          const d = unit(blade, p);
          const past = add(p, d, p.r + 4);
          const before = add(p, d, -(p.r + 3));
          const spots = [past, before]
            .filter(
              (q) => final.onFloor(world, q) && !final.bad(world, st, q) && hypot(q, me) <= reach,
            )
            .sort((x, y) => hypot(x, me) - hypot(y, me));
          const at = spots[0];
          if (!at) continue;
          if (st.bladeLed !== blade.id) {
            st.bladeLed = blade.id;
            log(`BLADE: ${me.name} leads the line through a ${p.charged ? 'charged ' : ''}pillar`);
          }
          return {
            goal: at,
            tol: 1.2,
            duty: p.charged ? 'blade: charged pillar' : 'blade: pillar',
          };
        }
      }
    }
  }
  // A Storm Orb each: the nearest free bot steps on it, never one already
  // carrying a mark of its own (the hunt's quarry, a coal, a rift, a
  // polarity) and a healer only when no damage dealer is free: a healer
  // pounced on and then sent onto an orb died in the bot raids of 2026-11-21.
  if (o.orbs.length && !me.tank) {
    const taken = new Set();
    const busy = (q) =>
      hasAura(q, FINAL_PHASE_AURAS.tether) ||
      hasAura(q, FINAL_PHASE_AURAS.coal) ||
      hasAura(q, ELEMENT_AURAS.magmaMark) ||
      hasAura(q, ELEMENT_AURAS.polarity) ||
      hasAura(q, FINAL_AURAS.anvilMark);
    for (const orb of o.orbs) {
      const p = world
        .living()
        .filter((q) => q.bot && !q.tank && !taken.has(q.pid) && !busy(q))
        .sort((x, y) => Number(x.healer) - Number(y.healer) || hypot(x, orb) - hypot(y, orb))[0];
      if (!p) continue;
      taken.add(p.pid);
      if (p.pid === b.pid) return { goal: orb, tol: 0.6, duty: 'orb' };
    }
  }
  // The Splinter of the Breath's hunt: its quarry leads it away from the
  // raid; everyone else steps out of its Buffeting Gale.
  const hunter = huntingBreath(world);
  if (hunter) {
    if (hasAura(me, FINAL_PHASE_AURAS.tether)) {
      const spot = spread(world, st, me, BUFFET_REACH + 5);
      if (spot) return { goal: spot, tol: 1, duty: 'lead the gale away' };
    } else if (hypot(me, hunter) < BUFFET_REACH + 2) {
      return {
        goal: add(hunter, unit(hunter, me), BUFFET_REACH + 3.5),
        tol: 0.8,
        duty: 'out of the gale',
      };
    }
  }
  // The Leaping Bolt's target, a Bursting Coal, Drawn Lightning: away.
  if (
    (boss?.cast === FINAL_CASTS.bolt && boss.castTgt === b.pid) ||
    hasAura(me, FINAL_AURAS.drawn) ||
    hasAura(me, FINAL_PHASE_AURAS.coal)
  ) {
    const spot = spread(world, st, me, 10);
    if (spot) return { goal: spot, tol: 1, duty: 'spread' };
  }
  // Ember Mark (Heroic): the marked gather at one far spot.
  if (hasAura(me, FINAL_AURAS.ember)) {
    const far = add(
      world.center,
      unit(world.center, boss ?? world.center),
      HEART_QUARTERS.rimR - 8,
    );
    return { goal: far, tol: 1.5, duty: 'ember' };
  }
  if (final.bad(world, st, me)) {
    const spot = spread(world, st, me, 0);
    if (spot) return { goal: spot, tol: 0.8, duty: 'dodge' };
  }
  return null;
}

/** Has this tick's bot noticed hazard `h` yet (the reaction model)? */
function sees(world, st, h) {
  if (!world.react || !st.viewer) return true;
  return world.react.noticed(st.viewer, h.id, Date.now());
}

/** The Buffeting Gale's reach (final_phase_ids.ts FINAL_PHASE_TUNING buffetReach). */
const BUFFET_REACH = 7;
/** The Splinter of the Breath while it hunts a Wind-Tethered player (null otherwise). */
function huntingBreath(world) {
  const s = (world.splinters ?? []).find((a) => a.tid === FINAL_ADD_MOBS.breath && alive(a));
  if (!s) return null;
  return world.living().some((p) => hasAura(p, FINAL_PHASE_AURAS.tether)) ? s : null;
}

/** The nearest safe spot at least `gap` from every other player. */
function spread(world, st, me, gap) {
  const others = world.living().filter((p) => p.pid !== me.pid);
  for (let r = 0; r <= 24; r += 2) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const at = add(me, { x: Math.sin(a), z: Math.cos(a) }, r);
      if (final.bad(world, st, at)) continue;
      if (gap && others.some((p) => hypot(p, at) < gap)) continue;
      return at;
    }
  }
  return null;
}

export default final;
