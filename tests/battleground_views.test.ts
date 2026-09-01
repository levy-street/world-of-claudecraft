// The battleground view map (src/render/battleground_views.ts): the copy the
// player is matched into builds when they stand in the band, the queue
// proposal prebuilds a hidden copy whose pieces link ahead, the per-frame
// drive pushes the ward state and releases a copy the session is done with,
// and the renderer's compile gate reaches the stream through the host. Which pieces the stream
// gates, and which attach ungated, is battleground.ts's own contract, pinned
// in tests/battleground_compile_gate.test.ts.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stripComments } from './helpers/strip_comments';

const { built, commit, origins } = vi.hoisted(() => ({
  built: [] as { origin: { x: number; z: number }; seed: number; opts: unknown }[],
  commit: vi.fn(async () => {}),
  // Every slot battlegroundOrigin was asked for: the read allocates a point, so
  // the per-frame band walk must stop consulting it once a slot is shown.
  origins: { slots: [] as number[] },
}));

vi.mock('../src/sim/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sim/data')>();
  return {
    ...actual,
    battlegroundOrigin: (slot: number) => {
      origins.slots.push(slot);
      return actual.battlegroundOrigin(slot);
    },
  };
});

vi.mock('../src/render/battleground', () => ({
  battlegroundAssetPrewarm: { commit },
  buildBattleground: (
    origin: { x: number; z: number },
    seed: number,
    opts: { compileGate?: (target: THREE.Object3D) => Promise<unknown> },
  ) => {
    built.push({ origin, seed, opts });
    const group = new THREE.Group();
    group.name = 'battleground';
    // One streamed piece lands right away; the real stream gates it, this
    // stand-in only has to produce a group the view map can own.
    const part = new THREE.Mesh();
    part.name = 'terrain';
    group.add(part);
    return { group, setWardState: vi.fn(), dispose: vi.fn() };
  },
}));

import {
  type BattlegroundViewHost,
  type BattlegroundViews,
  BG_PREBUILD_SLOT,
  createBattlegroundViewState,
  ensureBattlegroundViewNear,
  prebuildBattlegroundView,
  updateBattlegroundViews,
} from '../src/render/battleground_views';
import { BG_SLOT_COUNT, battlegroundOrigin } from '../src/sim/data';
import type { BgInfo, BgMatchInfo, BgProposalInfo } from '../src/world_api/battleground';

function host() {
  const scene = new THREE.Scene();
  const compileGate = vi.fn(async () => {});
  const api: BattlegroundViewHost = { scene, seed: 7, lowGfx: false, fireLights: [], compileGate };
  return { scene, compileGate, api };
}

beforeEach(() => {
  built.length = 0;
  commit.mockClear();
  origins.slots.length = 0;
});

describe('ensureBattlegroundViewNear', () => {
  it('builds the copy of the slot the player stands in, visible, once', () => {
    const { scene, api } = host();
    const views: BattlegroundViews = new Map();
    const origin = battlegroundOrigin(1);
    ensureBattlegroundViewNear(views, origin.x + 10, origin.z - 10, api);
    ensureBattlegroundViewNear(views, origin.x + 10, origin.z - 10, api);
    expect(built).toHaveLength(1);
    expect(built[0].origin).toEqual(origin);
    expect(built[0].seed).toBe(7);
    expect(built[0].opts).toBe(api);
    expect([...views.keys()]).toEqual([1]);
    expect(views.get(1)?.group.visible).toBe(true);
    expect(scene.children).toEqual([views.get(1)?.group]);
    // The host reaches buildBattleground whole, so the renderer's compile gate
    // is what the stream gates each piece on.
    expect((built[0].opts as { compileGate?: unknown }).compileGate).toBe(api.compileGate);
  });

  it('stops consulting a slot origin once that copy is shown', () => {
    const { api } = host();
    const views: BattlegroundViews = new Map();
    const origin = battlegroundOrigin(1);
    // The origin above went through the recorder too: only the ensure call's
    // own reads may satisfy the pin.
    origins.slots.length = 0;
    // The frame that flips the copy still has to place the player, so it reads
    // every slot's origin.
    ensureBattlegroundViewNear(views, origin.x, origin.z, api);
    expect(origins.slots).toContain(1);
    expect(views.get(1)?.group.visible).toBe(true);
    // Every frame after it: slot 1 short-circuits on the shown copy, so its
    // origin is never minted again, and nothing is rebuilt.
    origins.slots.length = 0;
    ensureBattlegroundViewNear(views, origin.x, origin.z, api);
    expect(origins.slots).not.toContain(1);
    expect(origins.slots).toHaveLength(BG_SLOT_COUNT - 1);
    expect(built).toHaveLength(1);
    expect(views.get(1)?.group.visible).toBe(true);
  });

  it('builds nothing while the player is outside every slot', () => {
    const { api } = host();
    const views: BattlegroundViews = new Map();
    const origin = battlegroundOrigin(0);
    ensureBattlegroundViewNear(views, origin.x + 1000, origin.z, api);
    expect(built).toHaveLength(0);
    expect(BG_SLOT_COUNT).toBeGreaterThan(1);
  });
});

describe('prebuildBattlegroundView', () => {
  it('prebuilds one hidden copy at the proposal and commits the asset preload, idempotently', () => {
    const { scene, api } = host();
    const views: BattlegroundViews = new Map();
    prebuildBattlegroundView(views, api);
    prebuildBattlegroundView(views, api);
    expect(built).toHaveLength(1);
    expect(built[0].origin).toEqual(battlegroundOrigin(BG_PREBUILD_SLOT));
    expect(views.get(BG_PREBUILD_SLOT)?.group.visible).toBe(false);
    expect(scene.children).toHaveLength(1);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('shows the prebuilt copy when the player lands in its slot, and builds another slot as a hit', () => {
    const { api } = host();
    const views: BattlegroundViews = new Map();
    prebuildBattlegroundView(views, api);
    const home = battlegroundOrigin(BG_PREBUILD_SLOT);
    ensureBattlegroundViewNear(views, home.x, home.z, api);
    expect(built).toHaveLength(1);
    expect(views.get(BG_PREBUILD_SLOT)?.group.visible).toBe(true);
    const other = battlegroundOrigin(BG_PREBUILD_SLOT + 1);
    ensureBattlegroundViewNear(views, other.x, other.z, api);
    expect(built).toHaveLength(2);
    expect(views.size).toBe(2);
  });
});

/** Only the two fields the view drive reads; the rest of the readout is the
 *  HUD's. */
function bgInfo(
  proposal: BgProposalInfo | null,
  match: Partial<BgMatchInfo> | null = null,
): BgInfo {
  return { proposal, match } as unknown as BgInfo;
}

const OFFER = { id: 1, remaining: 20 } as unknown as BgProposalInfo;

describe('updateBattlegroundViews', () => {
  it('pushes the ward state of a live match to every copy', () => {
    const { api } = host();
    const views: BattlegroundViews = new Map();
    const state = createBattlegroundViewState();
    const origin = battlegroundOrigin(1);
    ensureBattlegroundViewNear(views, origin.x, origin.z, api);
    const view = views.get(1);
    updateBattlegroundViews(
      views,
      state,
      bgInfo(null, {
        state: 'active',
        myTeam: 1,
        players: [
          { pid: 7, dead: false },
          { pid: 42, dead: true },
        ] as unknown as BgMatchInfo['players'],
      }),
      42,
    );
    expect(view?.setWardState).toHaveBeenCalledWith(state.ward);
    expect(state.ward).toEqual({ countdown: false, ghost: true, myTeam: 1 });
    // The carrier is refilled in place, never re-minted: the per-frame push
    // must not allocate.
    const carrier = state.ward;
    updateBattlegroundViews(views, state, bgInfo(null, { state: 'countdown', myTeam: 0 }), 42);
    expect(state.ward).toBe(carrier);
    expect(state.ward).toEqual({ countdown: true, ghost: false, myTeam: 0 });
  });

  it('keeps the prebuilt copy while its offer has not reached the snapshot yet', () => {
    // The bgProposed event rides the events frame and the offer rides the next
    // bg key, so a frame that reads that gap as "resolved" would throw away the
    // copy it just prebuilt (the v0.36.0 queue-pop outage shape).
    const { api } = host();
    const views: BattlegroundViews = new Map();
    const state = createBattlegroundViewState();
    prebuildBattlegroundView(views, api);
    const view = views.get(BG_PREBUILD_SLOT);
    updateBattlegroundViews(views, state, null, 42);
    updateBattlegroundViews(views, state, bgInfo(null), 42);
    expect(view?.dispose).not.toHaveBeenCalled();
    expect(views.size).toBe(1);
  });

  it('releases the prebuilt copy once the offer it was built for is gone', () => {
    const { api } = host();
    const views: BattlegroundViews = new Map();
    const state = createBattlegroundViewState();
    prebuildBattlegroundView(views, api);
    const view = views.get(BG_PREBUILD_SLOT);
    // Seen: the offer landed in a snapshot.
    updateBattlegroundViews(views, state, bgInfo(OFFER), 42);
    expect(view?.dispose).not.toHaveBeenCalled();
    // Declined, or let lapse: no offer, no match, and the player never landed.
    updateBattlegroundViews(views, state, bgInfo(null), 42);
    expect(view?.dispose).toHaveBeenCalledTimes(1);
    expect(views.size).toBe(0);
    // And the seen flag resets, so the next proposal's copy gets its own window.
    expect(state.offerSeen).toBe(false);
  });

  it('holds the prebuilt copy through a seated match until the player lands', () => {
    const { api } = host();
    const views: BattlegroundViews = new Map();
    const state = createBattlegroundViewState();
    prebuildBattlegroundView(views, api);
    const view = views.get(BG_PREBUILD_SLOT);
    updateBattlegroundViews(views, state, bgInfo(OFFER), 42);
    // Accepted: the offer is gone and the match is on, but the teleport has not
    // landed, so the hidden copy is still the one the answer window bought.
    const match = bgInfo(null, { state: 'countdown', myTeam: 0 });
    updateBattlegroundViews(views, state, match, 42);
    expect(view?.dispose).not.toHaveBeenCalled();
    expect(views.size).toBe(1);
  });

  it('keeps the copy the match landed on when that is the prebuilt slot', () => {
    const { api } = host();
    const views: BattlegroundViews = new Map();
    const state = createBattlegroundViewState();
    prebuildBattlegroundView(views, api);
    updateBattlegroundViews(views, state, bgInfo(OFFER), 42);
    const home = battlegroundOrigin(BG_PREBUILD_SLOT);
    ensureBattlegroundViewNear(views, home.x, home.z, api);
    const view = views.get(BG_PREBUILD_SLOT);
    updateBattlegroundViews(
      views,
      state,
      bgInfo(null, { state: 'active', myTeam: 0, players: [] }),
      42,
    );
    expect(view?.dispose).not.toHaveBeenCalled();
    expect(view?.group.visible).toBe(true);
    expect(views.size).toBe(1);
  });

  it('releases the hidden copy once the match landed on another slot', () => {
    const { api } = host();
    const views: BattlegroundViews = new Map();
    const state = createBattlegroundViewState();
    prebuildBattlegroundView(views, api);
    updateBattlegroundViews(views, state, bgInfo(OFFER), 42);
    const hidden = views.get(BG_PREBUILD_SLOT);
    const other = battlegroundOrigin(BG_PREBUILD_SLOT + 1);
    ensureBattlegroundViewNear(views, other.x, other.z, api);
    const played = views.get(BG_PREBUILD_SLOT + 1);
    updateBattlegroundViews(
      views,
      state,
      bgInfo(null, { state: 'active', myTeam: 0, players: [] }),
      42,
    );
    expect(hidden?.dispose).toHaveBeenCalledTimes(1);
    expect(played?.dispose).not.toHaveBeenCalled();
    expect([...views.keys()]).toEqual([BG_PREBUILD_SLOT + 1]);
  });

  it('keeps the copy through the accept-wait window, while the offer still stands', () => {
    // The proposal is the answer window: as long as it is in the snapshot the
    // copy it paid for is kept, whatever else the readout carries, and the
    // seen flag latches so the frame the offer disappears can act on it.
    const { api } = host();
    const views: BattlegroundViews = new Map();
    const state = createBattlegroundViewState();
    prebuildBattlegroundView(views, api);
    const view = views.get(BG_PREBUILD_SLOT);
    for (let frame = 0; frame < 3; frame++) {
      updateBattlegroundViews(views, state, bgInfo(OFFER), 42);
    }
    expect(view?.dispose).not.toHaveBeenCalled();
    expect(views.size).toBe(1);
    expect(state.offerSeen).toBe(true);
  });

  it('keeps the copy the player played in once the readout goes away, and drops the rest', () => {
    // The match ended and the bg key is gone. The copy the player was shown
    // stays: nothing here hides it, and its programs are the next match's
    // cache hit. Every hidden copy beside it is spent and goes.
    const { api } = host();
    const views: BattlegroundViews = new Map();
    const state = createBattlegroundViewState();
    prebuildBattlegroundView(views, api);
    updateBattlegroundViews(views, state, bgInfo(OFFER), 42);
    const hidden = views.get(BG_PREBUILD_SLOT);
    const other = battlegroundOrigin(BG_PREBUILD_SLOT + 1);
    ensureBattlegroundViewNear(views, other.x, other.z, api);
    const played = views.get(BG_PREBUILD_SLOT + 1);

    updateBattlegroundViews(views, state, null, 42);

    expect(hidden?.dispose).toHaveBeenCalledTimes(1);
    expect(played?.dispose).not.toHaveBeenCalled();
    expect(played?.group.visible).toBe(true);
    expect([...views.keys()]).toEqual([BG_PREBUILD_SLOT + 1]);
    expect(played?.setWardState).toHaveBeenCalledTimes(1);
  });

  it('drains the map and finishes the frame when one copy fails to release', () => {
    // dispose() runs eight release steps plus a renderer callback: one throw
    // must not leave its slot in the map to be re-disposed every frame, skip
    // the copies after it, or take the frame's ward push down with it.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api } = host();
    const views: BattlegroundViews = new Map();
    const state = createBattlegroundViewState();
    prebuildBattlegroundView(views, api);
    // A second spent copy: the band walk only ever SHOWS one, so the map is
    // staged here to the shape a release loop with two hidden copies takes.
    const second = battlegroundOrigin(BG_PREBUILD_SLOT + 1);
    ensureBattlegroundViewNear(views, second.x, second.z, api);
    const staged = views.get(BG_PREBUILD_SLOT + 1);
    if (staged) staged.group.visible = false;
    const played = battlegroundOrigin(BG_PREBUILD_SLOT + 2);
    ensureBattlegroundViewNear(views, played.x, played.z, api);
    const shown = views.get(BG_PREBUILD_SLOT + 2);
    const failing = views.get(BG_PREBUILD_SLOT);
    const failingDispose = failing?.dispose as ReturnType<typeof vi.fn>;
    failingDispose.mockImplementation(() => {
      throw new Error('release step failed');
    });

    updateBattlegroundViews(
      views,
      state,
      bgInfo(null, { state: 'active', myTeam: 0, players: [] }),
      42,
    );

    expect(failing?.dispose).toHaveBeenCalledTimes(1);
    expect(staged?.dispose).toHaveBeenCalledTimes(1);
    expect([...views.keys()]).toEqual([BG_PREBUILD_SLOT + 2]);
    expect(shown?.setWardState).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledTimes(1);

    // And the next frame has nothing left to re-dispose.
    updateBattlegroundViews(views, state, null, 42);
    expect(failing?.dispose).toHaveBeenCalledTimes(1);
    warned.mockRestore();
  });
});

describe('the streamed parts and the renderer wiring (source pins)', () => {
  // Comment-stripped, like the sibling gate suite: a comment near-quoting a
  // pinned call must never be what satisfies a positive pin.
  const source = (rel: string) =>
    stripComments(readFileSync(new URL(rel, import.meta.url), 'utf8'));

  it('attaches the yumi maze and every field part through the compile gate, and prebuilds at the proposal', () => {
    const renderer = source('../src/render/renderer.ts');
    expect(renderer).toContain(
      'void attachSceneGroupGated(this.scene, view.group, this.worldCompileGate());',
    );
    expect(renderer).toContain('compileGate: this.worldCompileGate(),');
    expect(renderer).toContain(
      'ensureBattlegroundViewNear(this.bgViews, px, pz, this.battlegroundViewHost());',
    );
    expect(renderer).toContain(
      "case 'bgProposed':\n        prebuildBattlegroundView(this.bgViews, this.battlegroundViewHost());",
    );
    // The per-frame drive is the module's, called from the frame: the release
    // of a spent copy only ever runs if the renderer keeps calling it.
    expect(renderer).toContain(
      'updateBattlegroundViews(this.bgViews, this.bgViewState, this.sim.bgInfo, this.sim.playerId);',
    );
    expect(renderer).not.toContain('this.scene.add(view.group);');
  });

  it('drains the copies at teardown through the field the renderer declares', () => {
    // The terminal drain reads the owner through a structural cast, so nothing
    // type-checks that its field name is the renderer's: pin both spellings.
    const renderer = source('../src/render/renderer.ts');
    const lifecycle = source('../src/render/renderer_resource_lifecycle.ts');
    expect(renderer).toContain('private bgViews = new Map<number, BattlegroundView>();');
    expect(lifecycle).toContain('for (const view of resources.bgViews?.values() ?? [])');
    expect(lifecycle).toContain('resources.bgViews?.clear();');
  });
});
