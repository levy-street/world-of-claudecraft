import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { SHIMMER_WIRE_KEY, StealthShimmerWire } from '../server/stealth_shimmer_wire';
import {
  applyStealthShimmerSnapshot,
  decodeStealthShimmers,
} from '../src/net/stealth_shimmer_wire';
import {
  type DrawnShimmer,
  SHIMMER_FADE_IN,
  SHIMMER_FADE_OUT,
  SHIMMER_STRENGTH,
  SHIMMER_TIME_PERIOD,
  shimmerShaderTime,
  stepShimmers,
} from '../src/render/stealth_shimmer_core';
import { StealthShimmerVisual } from '../src/render/stealth_shimmer_visual';
import { Sim } from '../src/sim/sim';
import {
  forEachShimmer,
  SHIMMER_MAX_REACH,
  SHIMMER_SEND_INTERVAL_TICKS,
  SHIMMER_VIEW_CAP,
  type StealthShimmer,
  shimmerFor,
  shimmerSources,
  stealthShimmersSeenBy,
} from '../src/sim/stealth_shimmer';
import type { Aura, Entity } from '../src/sim/types';
import { threeProgramKeys } from './helpers/three_program_keys';

// Stealth Rework, shimmer band: an ENEMY stealther past the detection cone's
// spot radius, out to twice it, shows a rim glint instead of nothing. The
// viewer gets a rounded position and a fade, never an id, and never a shimmer
// on an enemy whose body it is already shown.

type TestSim = Sim & { nextId: number };

function stealthAura(id = 'stealth'): Aura {
  return {
    id,
    name: 'Duskveil',
    kind: 'stealth',
    remaining: 3600,
    duration: 3600,
    value: 0.5,
    sourceId: 0,
    school: 'physical',
  };
}

// A level-20 rogue (stealthed) and a level-20 warrior in an active duel. The
// warrior faces +z, so at equal level the spot radius is 5 yd inside the 45
// degree cone ahead and 2.5 yd anywhere else.
function duel(): { sim: TestSim; rogue: Entity; foe: Entity } {
  const sim = new Sim({ seed: 11, playerClass: 'rogue', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  const foeId = sim.addPlayer('warrior', 'Foe');
  const d = {
    a: sim.playerId,
    b: foeId,
    state: 'active' as const,
    timer: 0,
    controlled: new Map(),
  };
  sim.ctx.duels.set(sim.playerId, d);
  sim.ctx.duels.set(foeId, d);
  const rogue = sim.player;
  const foe = sim.entities.get(foeId)!;
  foe.level = 20;
  foe.pos = { ...rogue.pos };
  foe.facing = 0;
  rogue.auras.push(stealthAura());
  rogue.stealthed = true;
  return { sim, rogue, foe };
}

function placeFrom(e: Entity, from: Entity, dx: number, dz: number): void {
  e.pos = { x: from.pos.x + dx, y: from.pos.y, z: from.pos.z + dz };
}

const NONE_SEEN = (): boolean => false;

function shimmersFor(sim: Sim, viewer: Entity): StealthShimmer[] {
  const out: StealthShimmer[] = [];
  forEachShimmer(sim.ctx, viewer, shimmerSources(sim.ctx), NONE_SEEN, (s) => out.push(s));
  return out;
}

describe('the band', () => {
  it('reaches from the spot radius to twice it, cone-aware, with a stepped fade', () => {
    const { rogue, foe } = duel();
    placeFrom(rogue, foe, 0, 7); // in the cone: radius 5, band to 10
    expect(shimmerFor(foe, rogue)?.fade).toBe(0.75); // 1 - 2/5 = 0.6 -> 0.75
    placeFrom(rogue, foe, 0, 9.9);
    expect(shimmerFor(foe, rogue)?.fade).toBe(0.25);
    placeFrom(rogue, foe, 0, 10.1);
    expect(shimmerFor(foe, rogue)).toBeNull();
    placeFrom(rogue, foe, 4, 0); // the flank: radius 2.5, band to 5
    expect(shimmerFor(foe, rogue)?.fade).toBe(0.5); // 1 - 1.5/2.5 = 0.4 -> 0.5
    placeFrom(rogue, foe, 5.1, 0);
    expect(shimmerFor(foe, rogue)).toBeNull();
    placeFrom(rogue, foe, 0, -4); // behind: same short radius
    expect(shimmerFor(foe, rogue)?.fade).toBe(0.5);
  });

  it('carries a rounded position and a fade, and nothing else', () => {
    const { rogue, foe } = duel();
    rogue.pos = { x: foe.pos.x + 0.37, y: foe.pos.y + 0.31, z: foe.pos.z + 7.62 };
    const s = shimmerFor(foe, rogue)!;
    expect(Object.keys(s).sort()).toEqual(['fade', 'x', 'y', 'z']);
    expect(s.x).toBe(Math.round(rogue.pos.x));
    expect(s.z).toBe(Math.round(rogue.pos.z));
    expect(s.y).toBe(Math.round(rogue.pos.y * 2) / 2);
    expect(Number.isInteger(s.fade * 4)).toBe(true);
  });

  it('only enemies, never Vanish or Greater Invisibility, never the dead', () => {
    const { sim, rogue, foe } = duel();
    placeFrom(rogue, foe, 0, 7);
    expect(shimmersFor(sim, foe)).toHaveLength(1);
    expect(shimmersFor(sim, rogue)).toHaveLength(0); // the foe is not stealthed
    rogue.auras = [stealthAura('vanish')];
    expect(shimmerSources(sim.ctx)).toHaveLength(0);
    rogue.auras = [stealthAura('greater_invisibility')];
    expect(shimmerSources(sim.ctx)).toHaveLength(0);
    rogue.auras = [stealthAura('tactical_camo')];
    expect(shimmersFor(sim, foe)).toHaveLength(1);
    rogue.dead = true;
    expect(shimmerSources(sim.ctx)).toHaveLength(0);
    rogue.dead = false;
    rogue.auras = [];
    expect(shimmerSources(sim.ctx)).toHaveLength(0); // unstealthed: just visible
    rogue.auras = [stealthAura()];
    sim.ctx.duels.clear(); // no longer hostile
    expect(shimmersFor(sim, foe)).toHaveLength(0);
  });

  it('never shimmers on an enemy the viewer already sees, and caps the list', () => {
    const { sim, rogue, foe } = duel();
    placeFrom(rogue, foe, 0, 7);
    const out: StealthShimmer[] = [];
    forEachShimmer(
      sim.ctx,
      foe,
      [rogue],
      (src) => src.id === rogue.id,
      (s) => out.push(s),
    );
    expect(out).toHaveLength(0);
    const many = Array.from({ length: SHIMMER_VIEW_CAP + 3 }, () => rogue);
    expect(forEachShimmer(sim.ctx, foe, many, NONE_SEEN, () => {})).toBe(SHIMMER_VIEW_CAP);
    foe.dead = true;
    expect(forEachShimmer(sim.ctx, foe, [rogue], NONE_SEEN, () => {})).toBe(0);
  });

  it('judges distance before hostility, and never ships a non-finite position', () => {
    const { sim, rogue, foe } = duel();
    const isHostileTo = vi.fn(() => true);
    placeFrom(rogue, foe, 0, SHIMMER_MAX_REACH + 1);
    expect(forEachShimmer({ isHostileTo }, foe, [rogue], NONE_SEEN, () => {})).toBe(0);
    expect(isHostileTo).not.toHaveBeenCalled();
    placeFrom(rogue, foe, 0, 7);
    expect(forEachShimmer({ isHostileTo }, foe, [rogue], NONE_SEEN, () => {})).toBe(1);
    expect(isHostileTo).toHaveBeenCalledTimes(1);
    rogue.pos = { x: Number.NaN, y: 0, z: 0 };
    expect(shimmerFor(foe, rogue)).toBeNull();
    expect(shimmersFor(sim, foe)).toHaveLength(0);
  });

  it('offline: the spot rule decides "seen", and one list per tick by identity', () => {
    const { sim, rogue, foe } = duel();
    placeFrom(rogue, foe, 0, 4); // inside the 5 yd cone radius: seen, no shimmer
    expect(stealthShimmersSeenBy(sim.ctx, foe.id)).toHaveLength(0);
    placeFrom(rogue, foe, 0, 7);
    // Same tick: the memo still hands back this tick's (empty) list.
    expect(stealthShimmersSeenBy(sim.ctx, foe.id)).toHaveLength(0);
    sim.tick();
    placeFrom(rogue, foe, 0, 7);
    const a = stealthShimmersSeenBy(sim.ctx, foe.id);
    expect(a).toHaveLength(1);
    expect(stealthShimmersSeenBy(sim.ctx, foe.id)).toBe(a);
  });
});

describe('server wire', () => {
  function wired() {
    const ctx = duel();
    placeFrom(ctx.rogue, ctx.foe, 0, 7);
    const lastSent: Record<string, string> = {};
    const sent = new Set<number>();
    const wire = new StealthShimmerWire(ctx.sim);
    const suffix = () => wire.beginBroadcast().suffixFor(ctx.foe, lastSent, sent);
    return { ...ctx, lastSent, sent, suffix };
  }

  it('sends rows of four numbers, with no id, then nothing while unchanged', () => {
    const { suffix, rogue } = wired();
    const out = suffix();
    const rows = JSON.parse(out.slice(`,"${SHIMMER_WIRE_KEY}":`.length));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(4);
    expect(rows[0]).not.toContain(rogue.id);
    expect(out).not.toContain('Duskveil');
    expect(suffix()).toBe('');
  });

  it('moves at most twice a second, but drops a shimmer at once', () => {
    const { sim, rogue, foe, sent, suffix } = wired();
    expect(suffix()).not.toBe('');
    placeFrom(rogue, foe, 0, 8.2); // crossed a yard line
    sim.tickCount += 1;
    expect(suffix()).toBe(''); // paced
    sim.tickCount += SHIMMER_SEND_INTERVAL_TICKS;
    expect(JSON.parse(suffix().slice(`,"${SHIMMER_WIRE_KEY}":`.length))[0][2]).toBe(
      Math.round(rogue.pos.z),
    );
    sim.tickCount += 1;
    sent.add(rogue.id); // the body is now in the snapshot
    expect(suffix()).toBe(`,"${SHIMMER_WIRE_KEY}":[]`); // at once, inside the pacing window
  });

  it('paces a shimmer leaving the band, but sends a first shimmer at once', () => {
    const { sim, rogue, foe, suffix } = wired();
    expect(suffix()).not.toBe('');
    placeFrom(rogue, foe, 0, 12); // out of the band (not seen): no rush
    sim.tickCount += 1;
    expect(suffix()).toBe('');
    sim.tickCount += SHIMMER_SEND_INTERVAL_TICKS;
    expect(suffix()).toBe(`,"${SHIMMER_WIRE_KEY}":[]`);
    sim.tickCount += 1;
    placeFrom(rogue, foe, 0, 7); // back in, after none: news is not held
    expect(suffix()).not.toBe('');
  });

  it('orders rows by position, so row order says nothing about who is who', () => {
    const { sim, rogue, foe } = duel();
    const second = sim.entities.get(sim.addPlayer('rogue', 'Second'))!;
    second.level = 20;
    second.auras.push(stealthAura());
    second.stealthed = true;
    for (const id of [second.id]) {
      const d = { a: foe.id, b: id, state: 'active' as const, timer: 0, controlled: new Map() };
      sim.ctx.duels.set(id, d);
    }
    const hostile = { isHostileTo: () => true };
    const lastSent: Record<string, string> = {};
    const wire = new StealthShimmerWire(
      Object.assign(Object.create(sim), hostile, {
        players: sim.players,
        entities: sim.entities,
        tickCount: 0,
      }),
    );
    placeFrom(rogue, foe, 1, 8);
    placeFrom(second, foe, -1, 7);
    const rows = JSON.parse(wire.beginBroadcast().suffixFor(foe, lastSent, new Set()).slice(7));
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBeLessThan(rows[1][0]);
  });

  it('with many stealthers, the grid finds exactly what a plain walk finds', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', noPlayer: true }) as TestSim;
    const viewers: Entity[] = [];
    let seed = 11;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 60; i++) {
      const e = sim.entities.get(sim.addPlayer(i < 30 ? 'rogue' : 'warrior', `P${i}`))!;
      e.level = 20;
      e.pos = { x: rnd() * 120 - 60, y: 0, z: rnd() * 120 - 60 };
      e.facing = rnd() * 6.28;
      if (i < 30) {
        e.auras.push(stealthAura());
        e.stealthed = true;
      } else viewers.push(e);
    }
    const world = {
      isHostileTo: () => true,
      players: sim.players,
      entities: sim.entities,
      tickCount: 0,
    };
    const wire = new StealthShimmerWire(world).beginBroadcast();
    const sources = shimmerSources(world);
    let compared = 0;
    for (const viewer of viewers) {
      const lastSent: Record<string, string> = {};
      const got = wire.suffixFor(viewer, lastSent, new Set());
      const want: StealthShimmer[] = [];
      forEachShimmer(world, viewer, sources, NONE_SEEN, (sh) => want.push(sh));
      const rows = JSON.parse(got.slice(`,"${SHIMMER_WIRE_KEY}":`.length)) as number[][];
      const key = (r: number[]) => r.join(',');
      const wantRows = want.map((w) => [w.x, w.y, w.z, w.fade]);
      if (want.length < SHIMMER_VIEW_CAP) {
        expect(rows.map(key).sort()).toEqual(wantRows.map(key).sort());
        compared += want.length;
      } else expect(rows).toHaveLength(SHIMMER_VIEW_CAP);
    }
    expect(compared).toBeGreaterThan(5); // the scene really exercised the band
  });

  it('clears a fresh session once, then stays silent with nobody stealthed', () => {
    const { rogue, suffix } = wired();
    rogue.auras = [];
    expect(suffix()).toBe(`,"${SHIMMER_WIRE_KEY}":[]`);
    expect(suffix()).toBe('');
  });

  it('ships the shimmer, not the entity, through a real broadcast', () => {
    const server = new GameServer();
    const fakeWs = () => {
      const sent: any[] = [];
      return {
        sent,
        ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } as never,
      };
    };
    const vFc = fakeWs();
    const rFc = fakeWs();
    const viewer = server.join(vFc.ws, 1, 1, 'Viewer', 'warrior', null);
    const rogueS = server.join(rFc.ws, 2, 2, 'Sneak', 'rogue', null);
    if ('error' in viewer || 'error' in rogueS) throw new Error('join failed');
    server.sim.setPlayerLevel(20, viewer.pid);
    server.sim.setPlayerLevel(20, rogueS.pid);
    server.sim.duelRequest(rogueS.pid, viewer.pid);
    server.sim.duelAccept(rogueS.pid);
    for (let i = 0; i < 20 * 5 && server.sim.duelFor(viewer.pid)?.state !== 'active'; i++)
      server.sim.tick();
    const v = server.sim.entities.get(viewer.pid)!;
    const r = server.sim.entities.get(rogueS.pid)!;
    const put = (dz: number) => {
      const p = server.sim.groundPos(v.pos.x, v.pos.z + dz);
      r.pos = p;
      r.prevPos = { ...p };
      server.sim.grid.update(r);
      server.sim.playerGrid.update(r);
    };
    v.facing = 0;
    r.auras.push(stealthAura());
    r.stealthed = true;
    put(7);
    const snapOf = () => {
      (server as any).broadcastSnapshots();
      for (let i = vFc.sent.length - 1; i >= 0; i--)
        if (vFc.sent[i].t === 'snap') return vFc.sent[i];
      return null;
    };
    const snap = snapOf();
    expect(snap.ents.some((w: any) => w.id === r.id)).toBe(false);
    expect(snap[SHIMMER_WIRE_KEY]).toEqual([
      [Math.round(r.pos.x), Math.round(r.pos.y * 2) / 2, Math.round(r.pos.z), 0.75],
    ]);
    put(3); // inside the cone radius: the body is sent and the shimmer cleared
    const next = snapOf();
    expect(next.ents.some((w: any) => w.id === r.id)).toBe(true);
    expect(next[SHIMMER_WIRE_KEY]).toEqual([]);
  });
});

describe('client decode', () => {
  it('keeps well-formed rows, drops malformed ones, caps the list', () => {
    expect(decodeStealthShimmers([[1, 2, 3, 0.5]])).toEqual([{ x: 1, y: 2, z: 3, fade: 0.5 }]);
    expect(
      decodeStealthShimmers([[1, 2, 3], [1, 2, 3, 0], [1, 2, 3, 1.5], [1, 'a', 3, 0.5], null]),
    ).toHaveLength(0);
    const many = Array.from({ length: SHIMMER_VIEW_CAP + 4 }, (_, i) => [i, 0, 0, 1]);
    expect(decodeStealthShimmers(many)).toHaveLength(SHIMMER_VIEW_CAP);
  });

  it('an absent key keeps what is held, [] clears it', () => {
    const world = { stealthShimmers: decodeStealthShimmers([[1, 2, 3, 0.5]]) };
    applyStealthShimmerSnapshot(world, {});
    expect(world.stealthShimmers).toHaveLength(1);
    applyStealthShimmerSnapshot(world, { ssh: [] });
    expect(world.stealthShimmers).toHaveLength(0);
  });
});

describe('render plan', () => {
  const at = (x: number, z: number, fade = 1): StealthShimmer => ({ x, y: 0, z, fade });

  it('draws at 25% strength, frozen under reduced motion', () => {
    expect(SHIMMER_STRENGTH).toBe(0.25);
    expect(shimmerShaderTime(12.5, false)).toBe(12.5);
    expect(shimmerShaderTime(12.5, true)).toBe(0);
    expect(shimmerShaderTime(SHIMMER_TIME_PERIOD * 40 + 3, false)).toBeCloseTo(3);
  });

  it('fades a new shimmer in, eases a moved one, fades a lost one out', () => {
    const drawn: DrawnShimmer[] = [];
    stepShimmers(drawn, [at(10, 0, 0.75)], 0, 0, 0);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].alpha).toBe(0);
    stepShimmers(drawn, [at(10, 0, 0.75)], SHIMMER_FADE_IN, 0, 0);
    expect(drawn[0].alpha).toBe(0.75);
    // A one-yard step is eased, never jumped.
    stepShimmers(drawn, [at(11, 0, 0.75)], 0.05, 0, 0);
    expect(drawn[0].x).toBeGreaterThan(10);
    expect(drawn[0].x).toBeLessThan(11);
    // It turns its front to the viewer (forward is +z).
    expect(drawn[0].yaw).toBeCloseTo(Math.atan2(0 - drawn[0].x, 0 - drawn[0].z));
    // Lost: fades out, then goes.
    stepShimmers(drawn, [], SHIMMER_FADE_OUT / 2, 0, 0);
    expect(drawn).toHaveLength(1);
    stepShimmers(drawn, [], SHIMMER_FADE_OUT, 0, 0);
    expect(drawn).toHaveLength(0);
  });

  it('at the draw cap, live shimmers come before fading ones', () => {
    const drawn: DrawnShimmer[] = [];
    stepShimmers(drawn, [at(0, 0)], 1, null, null);
    stepShimmers(drawn, [at(30, 0)], 0.01, null, null); // the first is now fading
    expect(drawn[0].x).toBe(30);
    expect(drawn[1].target).toBe(0);
  });

  it('a far target is a new shimmer, not a slide across the field', () => {
    const drawn: DrawnShimmer[] = [];
    stepShimmers(drawn, [at(0, 0)], 1, null, null);
    stepShimmers(drawn, [at(20, 0)], 0.05, null, null);
    expect(drawn).toHaveLength(2);
    // The old one fades where it stood; the new one starts where its target is.
    expect(drawn.map((d) => d.x).sort((p, q) => p - q)).toEqual([0, 20]);
    expect(drawn.find((d) => d.x === 20)!.alpha).toBeLessThan(drawn.find((d) => d.x === 0)!.alpha);
  });
});

describe('visual', () => {
  it('attaches hidden through the compile gate and reveals when it settles', async () => {
    const scene = new THREE.Scene();
    let settle: () => void = () => {};
    const gate = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    const visual = new StealthShimmerVisual(scene, () => 0, gate);
    expect(gate).toHaveBeenCalledWith(visual.group);
    expect(visual.group.visible).toBe(false);
    settle();
    await visual.readyForEntry;
    expect(visual.group.visible).toBe(true);
  });

  it('draws one instanced body per shimmer at 25% strength, and disposes once', () => {
    const visual = new StealthShimmerVisual(new THREE.Scene(), () => 0);
    const mesh = visual.group.children[0] as THREE.InstancedMesh;
    const material = mesh.material as THREE.ShaderMaterial;
    expect(material.name).toBe('stealth-shimmers:rim-glint');
    expect(material.uniforms.uStrength.value).toBe(0.25);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.fragmentShader).toContain('pow(clamp(1.0 - facing, 0.0, 1.0)');
    const keyBefore = threeProgramKeys(material, mesh);
    visual.update([], 0, 0.016, false, null);
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false); // no empty draw
    visual.update([at3(1, 2), at3(30, 2)], 1, 0.1, false, { x: 0, z: 0 });
    expect(mesh.count).toBe(2);
    expect(mesh.visible).toBe(true);
    // The program the gate linked is the one that draws.
    expect(threeProgramKeys(material, mesh)).toBe(keyBefore);
    expect(mesh.instanceColor).toBeNull();
    // The transparent sort reads the sphere: it follows the shimmers.
    expect(mesh.boundingSphere?.radius ?? -1).toBeGreaterThan(0);
    expect(mesh.boundingSphere?.center.x ?? 0).toBeGreaterThan(5);
    visual.update([at3(1, 2), at3(30, 2)], 2, 0.1, true, { x: 0, z: 0 });
    expect(material.uniforms.uTime.value).toBe(0);
    visual.dispose();
    expect(() => visual.dispose()).not.toThrow();
  });

  function at3(x: number, z: number): StealthShimmer {
    return { x, y: 0, z, fade: 1 };
  }
});
