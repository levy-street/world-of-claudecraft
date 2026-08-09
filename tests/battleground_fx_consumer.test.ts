// The props<->fx contract: BattlegroundFx.update() driven over REAL groups
// from buildBattlegroundObject, with a burst-recording Vfx stub and a
// hand-rolled BgInfo. This is the consumer-side coverage the pure-core test
// (tests/battleground_fx.test.ts) cannot give: the userData.bg handshake, the
// lean apply/reset, gem pose application, burst
// anchors/colors per transition, and the track-invalidation rules. The BgInfo
// fixture shape is identical for the offline Sim and the wire mirror (one
// facet type), so a single fixture covers both worlds.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BattlegroundFx,
  BG_RING_ALLY,
  BG_RING_DASH_SPEC,
  BG_RING_ENEMY,
} from '../src/render/battleground_fx';
import { BG_RUNE_BOB_AMP } from '../src/render/battleground_fx_core';
import { type BgObjectRefs, buildBattlegroundObject } from '../src/render/battleground_props';
import type { Vfx } from '../src/render/vfx';
import { BG_TEAM_COLORS } from '../src/sim/battleground_layout';
import { RUNE_VISUALS } from '../src/sim/social/battleground';
import type { BgFlagInfo, BgInfo } from '../src/world_api/battleground';

function flagInfo(state: BgFlagInfo['state'], carrierPid: number | null = null): BgFlagInfo {
  return { state, carrierPid, carrierName: carrierPid === null ? null : 'Carrier', carrierTeam: 1 };
}

function bgInfo(flags: [BgFlagInfo, BgFlagInfo]): BgInfo {
  return {
    rating: 1500,
    wins: 0,
    losses: 0,
    captures: 0,
    queued: false,
    queueSize: 0,
    firstWinBonusReady: true,
    proposal: null,
    requeueIn: 0,
    queuedParty: 0,
    ladder: [],
    match: {
      state: 'active',
      myTeam: 0,
      capsToWin: 3,
      scores: [0, 0],
      flags,
      players: [],
      countdown: 0,
      timeLeft: 800,
      waveIn: [5, 10],
      respawnIn: 0,
      winner: null,
    },
  };
}

interface Burst {
  x: number;
  y: number;
  z: number;
  colors: readonly number[];
  count: number;
  power: number;
}

function makeHarness() {
  const bursts: Burst[] = [];
  const swirls: { pid: number; color: number }[] = [];
  const vfx = {
    buffSwirl(pid: number, color: number) {
      swirls.push({ pid, color });
    },
    fireworkBurst(
      at: { x: number; y: number; z: number },
      colors: readonly number[],
      count = 46,
      power = 1,
    ) {
      bursts.push({ x: at.x, y: at.y, z: at.z, colors, count, power });
    },
  } as unknown as Vfx;
  const crimsonFlag = buildBattlegroundObject('bg_flag', BG_TEAM_COLORS[0], false);
  const azureFlag = buildBattlegroundObject('bg_flag', BG_TEAM_COLORS[1], false);
  const rune = buildBattlegroundObject('bg_rune', 0xffd280, false);
  const views = new Map([
    [101, { group: crimsonFlag.group }],
    [102, { group: azureFlag.group }],
    [103, { group: rune.group }],
  ]);
  const entities = new Map<number, { auras: { id: string }[] }>();
  const sim = {
    bgInfo: bgInfo([flagInfo('home'), flagInfo('home')]) as BgInfo | null,
    entities,
  };
  const fx = new BattlegroundFx(sim, views, vfx);
  const refs = (g: { userData: Record<string, unknown> }) =>
    g.userData.bg as Extract<BgObjectRefs, { kind: 'flag' }>;
  return { bursts, swirls, views, sim, entities, fx, crimsonFlag, azureFlag, rune, refs };
}

describe('props<->fx handshake', () => {
  it('flags and runes carry typed userData.bg refs; unknown colors carry none', () => {
    const crimson = buildBattlegroundObject('bg_flag', BG_TEAM_COLORS[0], false);
    const azure = buildBattlegroundObject('bg_flag', BG_TEAM_COLORS[1], false);
    const odd = buildBattlegroundObject('bg_flag', 0x123456, false);
    const rune = buildBattlegroundObject('bg_rune', 0xffd280, false);
    expect(crimson.group.userData.bg as BgObjectRefs).toMatchObject({ kind: 'flag', team: 0 });
    expect(azure.group.userData.bg as BgObjectRefs).toMatchObject({ kind: 'flag', team: 1 });
    expect(odd.group.userData.bg).toBeUndefined();
    expect(rune.group.userData.bg as BgObjectRefs).toMatchObject({ kind: 'rune' });
    // the gem renders SOLID in the rune color (normal blending): additive
    // washed every rune color to white under bloom
    const refs = rune.group.userData.bg as Extract<BgObjectRefs, { kind: 'rune' }>;
    const gemMesh = refs.gem.children[0] as unknown as {
      material: { blending: number; color: { getHex(): number } };
    };
    expect(gemMesh.material.blending).toBe(THREE.NormalBlending);
    expect(gemMesh.material.color.getHex()).toBe(0xffd280);
  });

  it('rune nameplate anchor clears the gem at the top of its hover', () => {
    const rune = buildBattlegroundObject('bg_rune', 0xffd280, false);
    const refs = rune.group.userData.bg as Extract<BgObjectRefs, { kind: 'rune' }>;
    // corner-down cube: half space diagonal above the spinner origin
    const gemTop = refs.gemBaseY + BG_RUNE_BOB_AMP + (0.42 * Math.sqrt(3)) / 2;
    expect(rune.height).toBeGreaterThan(gemTop);
  });
});

describe('BattlegroundFx.update', () => {
  it('animates the rune gem and leaves it alone outside a match', () => {
    const h = makeHarness();
    const gem = (h.rune.group.userData.bg as Extract<BgObjectRefs, { kind: 'rune' }>).gem;
    h.fx.update(1.25);
    expect(gem.rotation.y).toBeGreaterThan(0);
    const spun = gem.rotation.y;
    h.sim.bgInfo = null;
    h.fx.update(2.5);
    expect(gem.rotation.y).toBe(spun); // early return: untouched
  });

  it('leans the pole over the carrier and resets it on drop, yawed to the carrier', () => {
    const h = makeHarness();
    const crimson = h.refs(h.crimsonFlag.group);
    h.fx.update(0.1);
    expect(crimson.lean.rotation.x).toBe(0);
    // an azure raider (pid 55) picks up the crimson flag
    const carrier = {
      group: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 1.2 }, userData: {} },
    };
    h.views.set(55, carrier as never);
    h.sim.bgInfo = bgInfo([flagInfo('carried', 55), flagInfo('home')]);
    h.fx.update(0.2);
    // The lean IS the carry tell now: the pole tips over the carrier's shoulder
    // and there is no ground ring beneath them any more.
    expect(crimson.lean.rotation.x).toBeLessThan(0);
    expect(crimson.lean.rotation.y).toBeCloseTo(1.2, 5);
    // the pole mounts BEHIND the carrier along their facing, slightly raised
    expect(crimson.lean.position.x).toBeCloseTo(-Math.sin(1.2) * 0.42, 5);
    expect(crimson.lean.position.z).toBeCloseTo(-Math.cos(1.2) * 0.42, 5);
    expect(crimson.lean.position.y).toBeGreaterThan(0);
    // carrier view vanishes for a frame: the yaw holds instead of snapping
    h.views.delete(55);
    h.fx.update(0.3);
    expect(crimson.lean.rotation.y).toBeCloseTo(1.2, 5);
    // dropped: everything resets
    h.sim.bgInfo = bgInfo([flagInfo('dropped'), flagInfo('home')]);
    h.fx.update(0.4);
    expect(crimson.lean.rotation.x).toBe(0);
    expect(crimson.lean.rotation.y).toBe(0);
    expect(crimson.lean.position.x).toBe(0);
    expect(crimson.lean.position.z).toBe(0);
  });

  it('pins the carried pole to the carrier VIEW when the flag entity lags (beast-form fix)', () => {
    const h = makeHarness();
    const carrier = {
      group: { position: { x: 4, y: 0.5, z: -2 }, rotation: { y: 0 }, userData: {} },
    };
    h.views.set(55, carrier as never);
    // the flag entity trails the sprinting carrier by a couple of yards
    h.crimsonFlag.group.position.set(2, 0, -4);
    h.sim.bgInfo = bgInfo([flagInfo('carried', 55), flagInfo('home')]);
    h.fx.update(0.1);
    const lean = h.refs(h.crimsonFlag.group).lean;
    // the mount closes the whole gap (plus the usual back offset at yaw 0)
    expect(lean.position.x).toBeCloseTo(4 - 2, 5);
    expect(lean.position.z).toBeCloseTo(-2 - -4 - 0.42, 5);
    expect(lean.position.y).toBeCloseTo(0.5 + 0.5, 5);
  });

  it('rides an identity ring on every visible match player: green ally, red enemy, hidden on corpses, torn down with the match', () => {
    const h = makeHarness();
    const match = h.sim.bgInfo?.match;
    if (!match) throw new Error('missing match');
    const row = (pid: number, team: number, dead = false) => ({
      pid,
      name: `P${pid}`,
      cls: 'rogue' as const,
      team,
      carrying: false,
      dead,
      kills: 0,
      deaths: 0,
      captures: 0,
      assists: 0,
    });
    match.players.push(row(70, 0), row(71, 1, true));
    const g70 = new THREE.Group();
    const g71 = new THREE.Group();
    h.views.set(70, { group: g70 });
    h.views.set(71, { group: g71 });
    h.fx.update(0.1);
    const ring70 = g70.children.find((c) => c instanceof THREE.Group) as THREE.Group;
    const ring71 = g71.children.find((c) => c instanceof THREE.Group) as THREE.Group;
    expect(ring70).toBeTruthy();
    expect(ring71).toBeTruthy();
    // RELATIVE colors, not team hues (the red-is-hostile convention): the
    // viewer is Crimson (myTeam 0), so their teammate rings GREEN and the
    // Azure enemy rings RED; the underlay mesh beneath is the contrast rim.
    const colorMesh = (g: THREE.Group) => g.children[1] as THREE.Mesh;
    expect((colorMesh(ring70).material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      BG_RING_ALLY,
    );
    expect((colorMesh(ring71).material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      BG_RING_ENEMY,
    );
    expect(ring70.children).toHaveLength(2); // dark underlay + color ring
    expect(ring70.visible).toBe(true);
    // The identity ring is DASHED, never the solid annulus the target reticle
    // owns, and it stays flat (rotation.x = -PI/2) with the underlay beneath.
    for (const mesh of [colorMesh(ring70), ring70.children[0] as THREE.Mesh]) {
      expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 6);
      const index = mesh.geometry.getIndex();
      expect(index?.count).toBe(BG_RING_DASH_SPEC.dashes * BG_RING_DASH_SPEC.segments * 6);
    }
    // Both layers share the pooled geometry across every player's ring.
    expect(colorMesh(ring71).geometry).toBe(colorMesh(ring70).geometry);
    expect((ring71.children[0] as THREE.Mesh).geometry).toBe(
      (ring70.children[0] as THREE.Mesh).geometry,
    );
    // The dark underlay is dashed on the same cadence, NOT a solid ring behind
    // the dashes: it overhangs each dash end (a full rim) yet still leaves a
    // gap, or the solid silhouette the dashes exist to break comes right back.
    const firstDashArc = (mesh: THREE.Mesh): number => {
      const pos = mesh.geometry.getAttribute('position');
      const angle = (i: number) => Math.atan2(pos.getY(i), pos.getX(i));
      return angle(BG_RING_DASH_SPEC.segments * 2) - angle(0);
    };
    const cell = (Math.PI * 2) / BG_RING_DASH_SPEC.dashes;
    const colorArc = firstDashArc(colorMesh(ring70));
    const underArc = firstDashArc(ring70.children[0] as THREE.Mesh);
    expect(colorArc).toBeCloseTo(cell * BG_RING_DASH_SPEC.duty, 6);
    expect(underArc).toBeGreaterThan(colorArc);
    expect(underArc).toBeLessThan(cell);
    expect(ring71.visible).toBe(false); // a corpse shows no ring
    // match over: every ring leaves the scene graph
    h.sim.bgInfo = null;
    h.fx.update(0.2);
    expect(g70.children).toHaveLength(0);
    expect(g71.children).toHaveLength(0);
  });

  it('a rune buff swirls the wearer in the rune color, throttled, and stops with the aura', () => {
    const h = makeHarness();
    const match = h.sim.bgInfo?.match;
    if (!match) throw new Error('missing match');
    match.players.push({
      pid: 77,
      name: 'Runner',
      cls: 'rogue',
      team: 0,
      carrying: false,
      dead: false,
      kills: 0,
      deaths: 0,
      captures: 0,
      assists: 0,
    });
    h.entities.set(77, { auras: [{ id: 'bg_battle_rune' }] });
    h.fx.update(0.1);
    h.fx.update(0.2); // inside the throttle window: no second swirl
    expect(h.swirls).toHaveLength(1);
    expect(h.swirls[0]).toMatchObject({ pid: 77, color: RUNE_VISUALS.damage.color });
    h.fx.update(1.1); // past the throttle: swirls again
    expect(h.swirls).toHaveLength(2);
    h.entities.set(77, { auras: [] });
    h.fx.update(2.2);
    expect(h.swirls).toHaveLength(2); // aura gone, no swirl
  });

  it('bursts on pickup at the flag, on capture/return at LAST frame position', () => {
    const h = makeHarness();
    h.fx.update(0.1); // first sighting: never a burst
    expect(h.bursts).toHaveLength(0);
    // pickup at the stand
    h.crimsonFlag.group.position.set(3, 0, -118);
    h.sim.bgInfo = bgInfo([flagInfo('carried', 55), flagInfo('home')]);
    h.fx.update(0.2);
    expect(h.bursts).toHaveLength(1);
    expect(h.bursts[0]).toMatchObject({ x: 3, z: -118 });
    expect(h.bursts[0].colors).toEqual([BG_TEAM_COLORS[0], 0xffffff]);
    // the carrier runs it to the azure stand...
    h.crimsonFlag.group.position.set(0, 0, 118);
    h.fx.update(0.3);
    expect(h.bursts).toHaveLength(1);
    // ...and scores: the flag snaps home THIS frame, the burst stays at the stand
    h.crimsonFlag.group.position.set(0, 0, -118);
    h.sim.bgInfo = bgInfo([flagInfo('home'), flagInfo('home')]);
    h.fx.update(0.4);
    expect(h.bursts).toHaveLength(2);
    expect(h.bursts[1]).toMatchObject({ x: 0, z: 118 }); // last frame's position
    expect(h.bursts[1].colors).toEqual([BG_TEAM_COLORS[1], 0xffd24a]); // capturing team
    // dropped then returned: the return burst lands where it lay
    h.sim.bgInfo = bgInfo([flagInfo('carried', 55), flagInfo('home')]);
    h.fx.update(0.5);
    h.crimsonFlag.group.position.set(20, 0, -40);
    h.sim.bgInfo = bgInfo([flagInfo('dropped'), flagInfo('home')]);
    h.fx.update(0.6); // drop: no burst
    expect(h.bursts).toHaveLength(3); // pickup at 0.5 fired
    h.crimsonFlag.group.position.set(0, 0, -118);
    h.sim.bgInfo = bgInfo([flagInfo('home'), flagInfo('home')]);
    h.fx.update(0.7);
    expect(h.bursts).toHaveLength(4);
    expect(h.bursts[3]).toMatchObject({ x: 20, z: -40 });
    expect(h.bursts[3].colors).toEqual([BG_TEAM_COLORS[0], 0x9fdc7f]);
  });

  it('a view gap invalidates the track: no burst for a transition nobody saw', () => {
    const h = makeHarness();
    h.fx.update(0.1);
    const crimsonView = h.views.get(101);
    if (!crimsonView) throw new Error('missing view');
    h.views.delete(101);
    h.fx.update(0.2); // flag view absent this frame
    // state changed while unseen; the view returns already carried
    h.views.set(101, crimsonView);
    h.sim.bgInfo = bgInfo([flagInfo('carried', 55), flagInfo('home')]);
    h.fx.update(0.3);
    expect(h.bursts).toHaveLength(0); // first sighting after the gap, silent
    // but the lean applies, which is the carry tell
    expect(h.refs(h.crimsonFlag.group).lean.rotation.x).toBeLessThan(0);
  });

  it('leaving the match resets tracks: re-entry never replays a stale transition', () => {
    const h = makeHarness();
    h.sim.bgInfo = bgInfo([flagInfo('carried', 55), flagInfo('home')]);
    h.fx.update(0.1); // first sighting
    h.sim.bgInfo = null;
    h.fx.update(0.2);
    h.sim.bgInfo = bgInfo([flagInfo('home'), flagInfo('home')]);
    h.fx.update(0.3); // would be carried->home = capture if the track leaked
    expect(h.bursts).toHaveLength(0);
  });
});

describe('renderer wiring pin', () => {
  it('bgFx.update runs in the LIVE sync fx block, exactly once', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const calls = src.match(/this\.bgFx\.update\(this\.time\);/g) ?? [];
    expect(calls).toHaveLength(1);
    // Anchored inside sync()'s per-frame fx block (the water-phase marker),
    // NOT the one-time prewarm pass: the exact regression the frontend
    // reviewer caught on first wiring.
    // The release renamed the phase marker to a method on the renderer
    // (markRendererWorldPhase); the anchor is the water phase either way.
    expect(src).toMatch(
      /WorldPhase\([^)]*'water', worldStart\);\s*\n\s*this\.bgFx\.update\(this\.time\);/,
    );
  });
});
