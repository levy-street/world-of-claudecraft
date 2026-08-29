import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A byte-identical pin on generated chunk geometry.
//
// The terrain generator is about to be split so its compute half (the row
// fills, which touch no WebGL) can run in a Worker instead of stealing main
// thread time. That move must not change a single vertex: same seed, same
// world. These hashes are the safety net for the whole sequence, including the
// later swap of THREE.Color palette math for plain floats, where an
// unreplicated sRGB-to-linear conversion would silently reshade the world
// without changing anything's shape.
//
// If one of these fails after a refactor, the refactor changed the world. That
// is the point. Re-mint the expected hash ONLY when you intend the visual
// change and have looked at it.

function mockEmptyAssetLoads(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => new Promise(() => {})),
    loadKtx2Texture: vi.fn(() => new Promise(() => {})),
    loadTexture: vi.fn(() => new Promise(() => {})),
    releaseGltf: vi.fn(),
  }));
  const texture = (): THREE.DataTexture => {
    const data = new Uint8Array([255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  };
  vi.doMock('../src/render/textures', () => ({
    groundDetailTexture: vi.fn(texture),
    groundSplatMaps: vi.fn(() => ({
      grass: texture(),
      dirt: texture(),
      rock: texture(),
      sand: texture(),
      mud: texture(),
      snow: texture(),
    })),
    macroNoiseTexture: vi.fn(texture),
    skyTexture: vi.fn(texture),
    waterNormalish: vi.fn(texture),
    waterNormalMaps: vi.fn(() => [texture(), texture()]),
  }));
}

/** Stable digest of one attribute's raw numbers, rounded to a float32-safe
 *  precision so an unrelated FP-associativity change does not cry wolf. */
function hashAttribute(values: ArrayLike<number>): string {
  const hash = createHash('sha256');
  const buf = new Float64Array(1);
  for (let i = 0; i < values.length; i++) {
    // round to 6 decimals: far tighter than any visible difference, loose
    // enough to survive a compiler reassociating a sum
    buf[0] = Math.round(values[i] * 1e6) / 1e6;
    hash.update(new Uint8Array(buf.buffer, 0, 8));
  }
  return hash.digest('hex').slice(0, 16);
}

describe('generated chunk geometry is stable', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pins every vertex attribute of the Eastbrook chunks for seed 20061', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    const task = terrain.ensureZone(zoneAt(0, 0));
    await vi.runAllTimersAsync();
    await task;

    const meshes = terrain.group.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
    // 36 in-rect chunks and no gap super-chunks any more: the Proving Shore
    // tutorial island claimed the west cell, so nearest-rect ownership no
    // longer hands the Vale any gap cells (was 48 with 12 merged gap meshes).
    expect(meshes.length).toBe(36);

    // Order the chunks by their own geometry bounds, so the pin does not depend
    // on build ORDER (which the worker move is expressly going to change).
    const keyed = meshes.map((mesh) => {
      const geo = mesh.geometry;
      geo.computeBoundingBox();
      const box = geo.boundingBox;
      if (!box) throw new Error('chunk geometry has no bounding box');
      return { geo, box, key: `${Math.round(box.min.x)}:${Math.round(box.min.z)}` };
    });
    keyed.sort((a, b) => a.key.localeCompare(b.key));

    const digestOf = (chunks: typeof keyed): string => {
      const digest = createHash('sha256');
      for (const { geo, key } of chunks) {
        digest.update(key);
        for (const name of ['position', 'normal', 'color', 'uv']) {
          const attr = geo.getAttribute(name);
          expect(attr, `${key} missing ${name}`).toBeTruthy();
          digest.update(`${name}:${hashAttribute(attr.array as unknown as ArrayLike<number>)}`);
        }
        const index = geo.getIndex();
        expect(index, `${key} missing index`).toBeTruthy();
        if (index)
          digest.update(`index:${hashAttribute(index.array as unknown as ArrayLike<number>)}`);
      }
      return digest.digest('hex').slice(0, 32);
    };

    // The in-rect chunks split from the gap fill by their bounds: every Vale
    // rect chunk starts at x >= -180 (the skirt overhangs by under a yard).
    const inRect = keyed.filter(({ box }) => box.min.x >= -181);
    const gapFill = keyed.filter(({ box }) => box.min.x < -181);
    expect(inRect.length).toBe(36);
    // The Proving Shore tutorial island owns every former Vale gap cell, so a
    // Vale build produces zero gap-fill super-chunks now; the island's own
    // chunks arrive only with its zone build.
    expect(gapFill.length).toBe(0);

    // Re-minted for the natural-relief heightfield plus the shared height
    // lattice in terrain_chunk_build.ts (vertex normals now difference the
    // lattice at the chunk's own spacing instead of a fixed 1.5yd stencil).
    // Both were intended, reviewed visual changes. Re-minted again for the
    // gather-node placement fix (herb_eastbrook_4 moved off the boarball
    // pitch to (6,-69) is the move these chunks see): an authored node pos
    // is a calm-anchor world fixture, so the pads around the old and new
    // spots reshape nearby vertices. Localization checked against the dense
    // height atlas (tests/terrain_height_parity.test.ts fixture, re-minted
    // in the same commit): the whole ten-node placement fix moves 146 of
    // its 140639 points, 0.1 percent, all inside the moved nodes' pad
    // footprints. Re-minted again for the Proving Shore tutorial island
    // (provingCoast/provingMoat reshape the Vale's west strand) and once more
    // on the v0.37.0 merge, which added the northwest coast spit carve in
    // applyValeCoast (the low beach shelf under the grey cliff foot submerged
    // so the bay water meets the cliff; its window x -211.5..-132.5,
    // z 116.5..145.5 straddles the rect edge into the island's cell, where it
    // composes with the island appliers). Re-minted once more on the
    // release/v0.39.0 castles merge, whose vale terrain edits (the
    // walk-in castle grounds era; the release's own terrain-height fixture
    // moved in the same merge) reshape these chunks again on the merged
    // tree, AND because the island's zone rect adds two BORDER_EDGES rows
    // whose gaussian ridge walls (RIDGE_SIGMA 26, both sides of each new
    // edge) reshape the Willowfen's south shore band (z 204..244, moves up
    // to +7.2yd), the vale's north-west corner past the carve at x -176
    // (up to 7.5yd), and a few Mirefen points on the same edge; nothing in
    // those bands crosses the waterline and the town centre is
    // bit-identical (PR #3467 review, finding 2 measured base vs head).
    // Digest stable across two runs.
    // Re-minted for the Copper Dig relocation to the dig headland (New
    // Eastbrook program, docs/design/eastbrook-revamp/master-plan.md): the
    // dig-headland coast lobe, the site's mode level terrain stamp, the
    // relocated cluster's own camp flatten, and the VACATED old camp's
    // flatten disc reverting all reshape the vale's southeast. Localization
    // checked on a 1yd lattice over x -220..60, z -180..20 at the production
    // seed: 20,704 of 56,481 points move, every one inside x -211..-18,
    // z -155..-3 (the old flatten disc union the new headland), the town
    // core reads byte-identical, and the largest move is 6.33 at the new
    // coast. An intended, looked-at world change, not drift.
    // Re-minted for the Sowfield demolition (the New Eastbrook program,
    // docs/design/eastbrook-revamp/master-plan.md): the stadium's flatten arm,
    // stand lift, and decoration exclusion left with the minigame, so the
    // southern basin returns to natural vale ground. Localization checked on a
    // 1yd lattice over x -100..80, z -180..20 at the production seed against
    // the pre-demolition tree: 7,656 of 36,381 points move, every one inside
    // x -63..41, z -148..-74 (the flatten rect plus its 8yd apron), the town
    // core reads byte-identical, and the largest move is 13.90 where the
    // stand tiers stood. An intended, looked-at world change, not drift.
    // Re-minted for phase 0b of the New Eastbrook program (the harbor-town
    // plat, docs/design/eastbrook-revamp/master-plan.md): the southern basin
    // coastline moves seaward on two new land lobes plus the town-plat level
    // stamps, the interim dig headland reverts to open sea, and the whole
    // Copper Dig cluster (level stamp, camp flattens, ore veins, road leg)
    // re-lands northeast past the wolf runs. Localization checked on a 1yd
    // lattice over x -220..70, z -220..220 at the production seed against a
    // HEAD worktree: 50,002 of 128,331 points move, every one inside two
    // disjoint windows: 35,688 in x -213..65, z -210..-14 (the basin plat and
    // the reverted headland; the largest move anywhere is 15.21 where the new
    // basin lobe lifts old seabed into shore at (-72,-153)) and 14,314 in
    // x -104..40, z 81..207 (the new dig grade; largest move 8.85 where the
    // level stamp cuts the rise at (-34,165)), the old town core near (0,-3)
    // reads byte-identical, and nothing between the windows moves. Both
    // digests move because the reverted headland straddles the rect edge at
    // x = -180. An intended, looked-at world change, not drift.
    // Re-minted for the beach apron (owner direction: no cliff edges on the
    // Sowfield coast, smooth beach shores). Ten SOWFIELD_BEACH_TERRAIN_EDITS
    // level stamps ride the plat's south waterline arc: shore-band slopes
    // drop from 1.9 to 0.07-0.18 and beach widths grow from 3-7yd to
    // 23-30yd. Localization: 1yd lattice against a worktree at the plat
    // commit, 8,871 of 128,331 points move, all inside x -93..69,
    // z -193..-118 (the shore strip; max move 11.25 at (-68,-156) where the
    // apron lifts old seabed into strand), town core zero. The gap-fill
    // digest holds: the strip stays clear of the x = -180 rect edge.
    // Final quay pass in the same change: three skirt stamps ring the flat
    // pads and one covers the south shoulder, so every land-side rim walks
    // under the climb gate; the digest above is minted against this final
    // Streets re-threaded for the lane-clearance proofs in the same change
    // One more mint: the herb-node moves are terrain inputs too (node ground
    // Minted once more for the owner refinements: the fanned piers, the
    // Round 2: the basin lobe trims north so the sea meets the town, and
    // The trimmed lobe also moves the gap super-chunk this time. // the strand smoothing stamp rides the same mint. // harbor sand aprons, and the quay dressing move the shore heights. // pads), the digest follows the final node set. // (roads are height appliers); this digest is the final street set. // stamp set. // An intended, looked-at world change, not drift.
    // Re-minted 2026-08 for the harbor move (the New Eastbrook program,
    // d19aa33f76, docs/design/eastbrook-revamp/site-plan.md): layout v3
    // lands Eastbrook on the harbor quay, with wave A carving the cove and
    // quay pad before it, wave D mooring the harbor fleet on calm-anchor
    // pads that re-grade the seabed at the moorings after it, and this
    // change landing the final harbor-geometry polish. Localization checked
    // on a 1yd lattice over x -220..70, z -220..220 at the production seed
    // against a git worktree at HEAD: 17,962 of 128,331 points move, every
    // one inside x -131..58, z -166..100 (the vacated old town ground and
    // the Wolf Run re-grade, the shore strip, and the quay approaches;
    // largest move 1.77 at (-32,72)), the civic-square town core carries
    // only finish grading (52 of its 61x61 core lattice points move, none
    // by more than 0.011), and nothing at or west of x -161 moves, clear of
    // the x = -180 rect edge. The gap-fill digest therefore HOLDS,
    // recomputed byte-identical on the live tree; both digests were
    // computed twice and are deterministic. An intended, looked-at world
    // change, not drift.
    // Re-minted for owner refinement round 3 (the coastline pulled to the
    // town's doorstep): the basin lobes trim again, the town-front shallows
    // bay carves the strand up to z -132..-147 across the frontage, the
    // beach stamps re-lay as a narrow apron riding that line, and the new
    // seabed apron row takes the stamped shelf below the waterline exactly
    // where the un-stamped field already reads open sea (visible waterline
    // within 1.5yd of the field line at every probed transect). Roads moved
    // with it (promenade trimmed to the strand, coast track re-tied, the
    // inn lane added, the wider main street). Evidence: 1yd lattice over
    // x -75..45, z -170..-100 on the live tree: 5,126 dry and 3,465 wet
    // cells, heights within [-7.70, 2.41], zero non-finite, and the worst
    // dry-to-dry step is 1.172 at (-75,-140) (the pasture-coast blend),
    // under the 1.5 climb gate; every town building pad probed level with
    // its round-2 grade. An intended, looked-at world change, not drift.
    // Re-minted for owner refinement round 4 (the Wolf Run reads green
    // meadow, not strand): terrain_chunk_build.ts now multiplies its shore
    // and vale-strand paint factors by shoreWaterGate, the same gate the far
    // vista already applied (far_terrain_core.ts), closing the documented
    // near/far seam gap. Positions, normals, uvs, and indices are untouched
    // (the wiring never reads or writes a height); only colors and splat
    // weights move, and only on dry in-band ground. Probe evidence at the
    // production seed: the gate answers 0 across the Wolf Run basin at
    // (0,-16) h -3.05, (16,-8) h -3.05, (24,0) h -2.86, and 1 at the town's
    // south strand (-14,-136) h -2.72 and the cove rim (-99,-37) h -3.40,
    // so real beaches keep their shipped sand exactly. Localization on a 1yd
    // lattice over x -220..70, z -220..220: 15,253 of 128,331 points carry a
    // nonzero paint factor with gate under 1, every one inside x -83..70,
    // z -124..206 (the basin and the dry pass toward Mirefen; nothing south
    // of z -124, so the strand stays sand), all east of the x = -180 rect
    // edge. The gap-fill digest therefore HOLDS, recomputed byte-identical
    // on the live tree; both digests were computed twice and are
    // deterministic. An intended, looked-at world change, not drift.
    // Re-minted for owner refinement round 4: the KayKit barracks and watch
    // tower took the retired armoury's Wolf Run lot as decor props, and decor
    // props with a collider radius are calm-anchor terrain inputs, so their
    // pads reshape the old town ground locally (the barracks lot at
    // (17.5,-5.5) and the tower knoll at (27,-13)). Computed twice in
    // separate processes, identical both times. An intended, looked-at world
    // change, not drift.
    // Re-minted for owner refinement round 5: Smith Haldren's KayKit
    // blacksmith lands on the civic green at (2,-112) (a decor prop with a
    // clearance radius is a calm-anchor terrain input, so its pad levels the
    // seat), and the quay walk road extends to run the full quay pad
    // (z -40..-68; roads are height appliers) so the streetlamp planner
    // seats more landside lamps for the dock area's dark nights. Computed
    // twice in separate processes, identical both times. An intended,
    // looked-at world change, not drift.
    // Re-minted again in round 5: the straight quay stub only ever earned
    // the lamp planner one 26yd sample, so the quay walk re-lays as a
    // serpentine running the whole pad and down to the south beach path
    // (z -32..-92, two swings toward the deck line adding the arc that
    // buys the second and third samples; the pad ground holds near -2,
    // above the planner's -3 floor, so both roadsides plant). The dock
    // district goes from two lamps to four: (-87.3,-45), (-99.4,-68.2) at
    // the dockfront, (-88.2,-90.2) at the beach path mouth, plus the
    // standing northeast shore lamp. Roads are height appliers, so the
    // re-lay regrades along the new line. Computed twice in separate
    // processes, identical both times. An intended, looked-at world
    // change, not drift.
    // Re-minted for owner round 6 (the team-feedback wave). Four world edits
    // reshape ground here, all of them intended: the boar and bandit camps
    // traded ground and stepped north, so their flatten discs and calm rings
    // moved with them (a camp levels a disc of radius*1.8 around its centre);
    // the quay boardwalk gained a narrow graded strip under its planks, where a
    // berm used to punch up THROUGH the deck; the churchyard enclosure, its
    // second grave plot and the harbour quarter's gardens mint new calm
    // anchors; and three coastal buildings joined the town. The rise house that
    // left the chapel green does NOT appear here (buildings mint no calm pad).
    // Computed twice in separate processes, identical both times. An intended,
    // looked-at world change, not drift.
    // Re-minted again for owner round 6b: three town NPCs were redistributed by
    // role along the dock road (marshal_redbrook, apothecary_lin, card_master)
    // and their calm pads travelled with them, while the Collapsed Reliquary
    // delve marker and the reliquary_hill POI both left the town chapel rise
    // for the Mirror Lake shore, taking their calm anchors off this ground. The
    // chapel re-shell changes NO terrain: it swaps the building's mesh and
    // height only, and a building mints no calm pad or height stamp. Computed
    // twice in separate processes, identical both times. An intended,
    // looked-at world change, not drift.
    // Re-minted once more for owner round 6b's own wave. Four intended world
    // edits reshape ground here: the second vale bandit camp moved from
    // (90,-90) to (115,42) and Gorrak's boss camp from (92,-92) to (118,45), so
    // both flatten discs (a camp levels a disc of radius*1.8) left the old
    // ground and re-land northeast; the moved NPC calm pads travelled with the
    // two market stalls, forgemistress_darva, tinker_gizzel and FURY; and the
    // retired Vale Chapel graveyard took its anchor at (4,-56) and its spirit
    // healer off this ground. The camp dressing (two tents, two crates, one
    // campfire) moved with the band and carries colliders, so it re-seats too.
    // Every one of those sites is east of the x = -180 rect edge, so the
    // gap-fill digest below HOLDS, recomputed byte-identical on the live tree.
    // Computed twice in separate processes, identical both times. An intended,
    // looked-at world change, not drift.
    // Re-minted once more in round 6c: the owner sited the boar meadow at the
    // west road's end, so both boar camps' flatten discs and calm rings
    // moved again, the Boar Meadow poi pad followed, and the meadow gained
    // flower drifts whose walk-through props each mint an optional calm
    // pad. Computed twice in separate processes, identical both times. An
    // intended, looked-at world change, not drift.
    // Re-minted in round 6e (owner reports): the eleven flowerGlow street and
    // meadow plantings left the zone (their optional calm pads with them),
    // Brother Halven's NPC pad followed his delve to the Mirror Lake mouth at
    // (-136,112), and the road[2] coast track re-arced onto dry sand around
    // the bay south of town (roads are height appliers). All inside the rect,
    // east of x = -180. Computed twice in separate processes, identical both
    // times. An intended, looked-at world change, not drift.
    // The gap super-chunks did NOT take this re-mint: see above.
    // Re-minted on the integration merge of the eastbrook program and the
    // Proving Shore island: both sides' intended terrain changes combine, so
    // the digest matches neither parent (set from a suite run on the merged
    // tree).
    expect(digestOf(inRect)).toBe('1d9b0a4a7e0d97c5a11c918b1a8f29c3');
    // The gap super-chunk digest pin is gone with the gap chunks themselves
    // (the island claims the old vale gap cells); gapFill.length above pins
    // their absence.

    terrain.cancelStreaming();
  });
});
