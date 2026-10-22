import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { canonicalWorldLayoutBase } from '../scripts/lib/world_layout_base.mjs';

// Exercise the real migration in an isolated bundle. Normal test imports and
// the on-disk active layout remain untouched while the candidate is evaluated.
it('reconciles the source and preserves gameplay while keeping corrected services accessible', async () => {
  const source = readFileSync('data/maps/eastbrook_and_mirefen_changes.map.json', 'utf8');
  // Jamie confirmed these authored lifts in Skynet 1b33f2ac (2026-10-22).
  // Keep them while fixing the approaches; lowering the buildings is not a fix.
  const map = JSON.parse(source);
  for (const [uid, y] of [
    ['9f55209138d4', -0.5],
    ['f32027eb7020', -1],
    ['aee7bfdee547', -0.5],
  ]) {
    expect(map.placements.find((p) => p.uid === uid)?.y, uid).toBe(y);
  }
  const review = JSON.parse(
    readFileSync('data/world_layout/eastbrook_and_mirefen.review.json', 'utf8'),
  );
  expect(createHash('sha256').update(source).digest('hex')).toBe(review.sourceSha256);
  const scratch = mkdtempSync(path.join(tmpdir(), 'layout-candidate-'));
  async function bundle(name, contents, plugins) {
    const outfile = path.join(scratch, `${name}.cjs`);
    await build({
      stdin: { contents, loader: 'ts', resolveDir: process.cwd() },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile,
      logLevel: 'silent',
      define: {
        'import.meta.env': '{}',
        'import.meta.url': JSON.stringify(pathToFileURL(outfile).href),
      },
      plugins,
    });
    // esbuild already compiled this isolated runtime. Load it with Node directly;
    // feeding its full world-data bundle back through Vitest's module transformer
    // needlessly recompiles the entire game and source-map snapshot.
    return createRequire(import.meta.url)(outfile);
  }
  try {
    const canonical = await bundle(
      'canonical',
      `
      import { BUILTIN_WORLD } from './src/sim/data';
      import { AUTHORED_TOWN_BUILDINGS } from './src/sim/authored_town_registry';
      import { currentLayoutScenery } from './src/editor/world_layout_snapshot';
      import { compileWorldLayout } from './src/editor/world_layout_export';
      export { emitWorldLayoutModule } from './src/editor/world_layout_export';
      export const world = BUILTIN_WORLD;
      export function compile(map, review) {
        return compileWorldLayout(map, BUILTIN_WORLD,
          AUTHORED_TOWN_BUILDINGS, review, currentLayoutScenery());
      }
    `,
      [canonicalWorldLayoutBase()],
    );
    const base = { world: canonical.world, report: canonical.compile(JSON.parse(source), review) };
    expect(base.report.unboundPlacementUids).toEqual([]);
    expect(base.report.issues).toEqual([]);
    for (const [id, lift] of [
      ['eastbrook_bank', -0.5],
      ['icemantle_trade_hall', -1],
      ['eldershine_market', -0.5],
    ]) {
      expect(base.report.layout.buildings[id].lift, id).toBe(lift);
    }
    // Exercise the actual emitted module as well as the candidate projection.
    // Typed terrain chunks must preserve every stamp and its original order.
    const emitted = await bundle(
      'emitted',
      canonical.emitWorldLayoutModule(base.report, review.sourceSha256),
      [],
    );
    expect(emitted.WORLD_LAYOUT).toEqual(base.report.layout);
    const candidate = await bundle(
      'candidate',
      `
      import { BUILTIN_WORLD as world, GATHER_NODES } from './src/sim/data';
      import { AUTHORED_TOWN_BUILDINGS } from './src/sim/authored_town_registry';
      import { gatherNodesFor } from './src/sim/moved_objects';
      import { groundHeight } from './src/sim/world';
      import { isBlocked } from './src/sim/colliders';
      import { WORLD_SEED as seed } from './src/sim/world_seed';
      import { Sim } from './src/sim/sim';
      export { world };
      export { probeLayoutServices } from './tests/helpers/world_layout_service_probe';
      export function probe(x,z) {
        const height = groundHeight(x,z,seed);
        return {height, blocked:isBlocked(seed,x,z,.5,false,undefined,0,{y:height,lift:0})};
      }
      export function walkEntrances() {
        const sim = new Sim({seed, playerClass:'warrior', noPlayer:true});
        // Keep complete world geometry; isolate traversal from nearby combat.
        sim.entities.clear();
        const pid = sim.addPlayer('warrior', 'Layout walker');
        const player = sim.entities.get(pid), meta = sim.players.get(pid);
        return AUTHORED_TOWN_BUILDINGS.filter(b=>b.walkIn).map(b=>{
          const f=b.frontStandingPoint, dx=Math.sin(b.rotation), dz=Math.cos(b.rotation);
          const bank=b.id==='highwatch_counting_house';
          const raised=['eastbrook_bank','icemantle_trade_hall','eldershine_market'].includes(b.id);
          // Begin outside the entire approach stamp, not already atop its rise.
          const approach=raised?5:2;
          const start=bank?{x:-34.5,z:686}:{x:f.x-dx*approach,z:f.z-dz*approach};
          const target={x:f.x+dx*4.5,z:f.z+dz*4.5};
          const route=bank?[f,target]:[target];
          Object.assign(player.pos,{...start,y:groundHeight(start.x,start.z,seed)+.05});
          Object.assign(player.prevPos,player.pos);
          player.hp=player.maxHp=999999; player.dead=false; player.vy=0; player.airborne=false;
          meta.moveInput.forward=false;
          for(let i=0;i<20;i++)sim.tick();
          let next=0;
          for(let i=0;i<600 && next<route.length;i++){
            const aim=route[next];
            player.facing=Math.atan2(aim.x-player.pos.x,aim.z-player.pos.z);
            meta.moveInput.forward=true;sim.tick();
            const tolerance=next===route.length-1?.6:.23;
            if(Math.hypot(aim.x-player.pos.x,aim.z-player.pos.z)<tolerance)next++;
          }
          meta.moveInput.forward=false;
          return {id:b.id,reached:next===route.length};
        });
      }
      export const doors = AUTHORED_TOWN_BUILDINGS.filter(b=>b.walkIn)
        .map(b=>({id:b.id,...b.frontStandingPoint}));
      export const nodes = gatherNodesFor(world.objectMoves,GATHER_NODES);
    `,
      [
        {
          name: 'reviewed-candidate',
          setup(plugin) {
            plugin.onLoad({ filter: /[\\/]world_layout[\\/]active\.ts$/ }, () => ({
              contents: `export const WORLD_LAYOUT = ${JSON.stringify(base.report.layout)};`,
              loader: 'ts',
            }));
          },
        },
      ],
    );
    const withoutPosition = ({ pos: _pos, facing: _facing, ...gameplay }) => gameplay;
    expect(Object.keys(candidate.world.npcs)).toEqual(Object.keys(base.world.npcs));
    for (const [id, npc] of Object.entries(candidate.world.npcs)) {
      expect(withoutPosition(npc), id).toEqual(withoutPosition(base.world.npcs[id]));
    }
    for (const service of ['mailboxes', 'noticeboards', 'musterBoards']) {
      expect(candidate.world.services[service], service).toEqual(base.world.services[service]);
    }
    for (const station of candidate.world.services.stations) {
      const original = base.world.services.stations.find((s) => s.id === station.id);
      expect({ type: station.type, master: station.masterNpcId }).toEqual({
        type: original.type,
        master: original.masterNpcId,
      });
    }
    // Literal regressions from the complete map, not mocks of the new helpers.
    for (const id of ['keeper_saelwyn', 'scout_einna', 'weekly_emissary']) {
      const p = candidate.world.npcs[id].pos;
      expect(candidate.probe(p.x, p.z).blocked, id).toBe(false);
    }
    for (const id of ['highwatch_counting_house', 'gibbetmere_inn']) {
      const p = candidate.doors.find((b) => b.id === id);
      expect(candidate.probe(p.x, p.z).blocked, id).toBe(false);
    }
    const herb = candidate.nodes.find((n) => n.id === 'herb_thornpeak_t2b').pos;
    const h = candidate.probe(herb.x, herb.z).height;
    let approaches = 0;
    for (let i = 0; i < 16; i++) {
      const p = candidate.probe(
        herb.x + Math.cos((i * Math.PI) / 8) * 2.5,
        herb.z + Math.sin((i * Math.PI) / 8) * 2.5,
      );
      if (!p.blocked && Math.abs(p.height - h) < 2) approaches++;
    }
    expect(
      approaches,
      'herb retains nearby standing positions on its terrain level',
    ).toBeGreaterThan(0);
    const walks = candidate.walkEntrances();
    expect(walks).toHaveLength(38);
    expect(walks.filter((walk) => !walk.reached)).toEqual([]);
    const services = candidate.probeLayoutServices();
    expect(services.crafts.map(({ recipe, ok }) => [recipe, ok])).toEqual([
      ['recipe_sootscale_mantle', true],
      ['recipe_pan_seared_perch', true],
      ['recipe_wardweave_cowl', true],
      ['recipe_thorium_mining_pick', true],
      ['recipe_duskhide_wraps', true],
      ['recipe_silverleaf_healing_draught', true],
    ]);
    expect(services.graves).toHaveLength(20);
    expect(services.graves.filter((g) => !g.ghost || !g.revived || g.distance > 0.01)).toEqual([]);
    expect(services.dungeon).toMatchObject({ entered: true, left: true });
    expect(services.dungeon.distanceFromExpectedExit).toBeLessThan(0.01);
    expect(candidate.world.objectMoves['practiceDummy:healing_dummy_tank'].removed).toBe(true);
    expect(Object.values(base.report.layout.buildings).some((b) => b.path.includes('manor'))).toBe(
      false,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
