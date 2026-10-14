// Hidden encounter-visual compile at first interior attach. runBackgroundPrewarm
// links programs on idle GPU slots; the built visuals are kept alive without
// dispose because three drops a program when its last material is disposed.
import * as THREE from 'three';
import { MOBS } from '../sim/data';
import { VARKHUL_BOSS_ID } from '../sim/ignivar_raid_ids';
import { GPU_WORK_PRIORITY } from './background_gpu_queue';
import { type CharacterVisual, createCharacterVisual } from './characters';
import { registerContextRestoreReset } from './context_restore_registry';
import { GFX } from './gfx';
import { idleSlot, runIdleQueue } from './idle_queue';
import { buildIgnivarEncounterPrewarmVisual } from './ignivar_encounter';
import { buildIgnivarForgeJudgmentPrewarmVisual } from './ignivar_forge_judgment';
import { buildIgnivarRotatingRaysPrewarmVisual } from './ignivar_rotating_rays';
import {
  type EncounterPrewarmSet,
  encounterPrewarmDisabled,
  encounterPrewarmForInterior,
  encounterPrewarmSpecForSets,
  type InteriorEncounterPrewarmSpec,
  unclaimedEncounterPrewarmSets,
} from './interior_encounter_prewarm';
import type { InteriorEncounterPrewarmHost } from './interior_encounter_prewarm_host';
import { collectObjectTextures } from './material_texture_slots';
import {
  buildVarkhulForgePortalPrewarmVisual,
  type VarkhulForgePortalPrewarmVisual,
} from './necromancy_army_portal_fx';
import { buildNythraxisGravePrewarmVisual } from './nythraxis_grave_flame_visual';
import { runBackgroundPrewarm } from './prewarm_pass';
import { setRenderCategory } from './renderer_diagnostics';
import { buildVarkhulAssemblyPrewarmVisual } from './varkhul_assembly_visual';
import { buildVarkhulEncounterPrewarmVisual } from './varkhul_encounter';
import { buildVarkhulForgeBeamPrewarmVisual } from './varkhul_forge_beam_visual';
import { buildVarkhulForgestormPrewarmVisual } from './varkhul_forgestorm_visual';
import { buildVarkhulInterceptBeamPrewarmVisual } from './varkhul_intercept_beam_visual';
import { buildVarkhulWorldfirePrewarmVisual } from './varkhul_worldfire_visual';

const startedByHost = new WeakMap<object, Set<EncounterPrewarmSet>>();
const keepAliveByHost = new WeakMap<object, CharacterVisual[]>();
const varkhulKeepAliveByHost = new WeakMap<object, THREE.Group[]>();
const varkhulPortalKeepAliveByHost = new WeakMap<object, VarkhulForgePortalPrewarmVisual[]>();
// Hosts whose kept-alive catalog lost its programs to a context restore while
// the player was outside every encounter interior: relinked at the next attach.
const staleKeepAliveHosts = new WeakSet<object>();
// Which interior each host is standing in, so a context restore can relink
// kept-alive encounter visuals immediately only when their interior is live.
const activeInteriorByHost = new WeakMap<object, string>();
const IDLE_MS = 250;
const TEXTURE_BATCH = 2;

/** The host reports every interior change here, including leaving one (null):
 *  a stale value would keep relinking encounter visuals after the player left. */
export function setEncounterPrewarmInterior(host: object, interior: string | null): void {
  if (interior) activeInteriorByHost.set(host, interior);
  else activeInteriorByHost.delete(host);
}

export function startInteriorEncounterPrewarm(interior: string, host: object): void {
  if (encounterPrewarmDisabled(typeof location === 'undefined' ? '' : location.search)) return;
  const typed = host as InteriorEncounterPrewarmHost;
  const spec = encounterPrewarmForInterior(interior);
  if (!spec || typed.shutdownStarted) return;
  // The attach is the earliest honest answer to "which interior is live".
  setEncounterPrewarmInterior(host, interior);
  registerContextRestoreReset('interior-encounter-prewarm', host, forgetEncounterPrewarmContext);
  if (staleKeepAliveHosts.delete(host)) relinkKeptAlive(typed);
  const started = startedByHost.get(host) ?? new Set<EncounterPrewarmSet>();
  startedByHost.set(host, started);
  // Claimed per SET, not per interior: the raid reaches the Varkhul and Ignivar
  // sets from several interiors, and a set an earlier room is still building
  // must not be built a second time beside it.
  const sets = unclaimedEncounterPrewarmSets(spec, started);
  if (sets.length > 0) {
    for (const set of sets) started.add(set);
    // Handled the moment it exists: the background GPU queue REJECTS every
    // pending unit when the renderer shuts down (logout, graphics rebuild), and
    // a rejection sitting un-awaited across that window is reported as an
    // unhandledrejection, which is the client's fatal overlay.
    // Forget the sets again on failure: they are claimed BEFORE the work, so a
    // rejected pass (a shutdown mid-flight, a compile that threw) would
    // otherwise leave them cold for the session and link them at first draw.
    void runInteriorEncounterPrewarm(encounterPrewarmSpecForSets(spec, sets), typed).catch(() => {
      for (const set of sets) started.delete(set);
    });
  }
}

/** A WebGL context restore: every claimed set was linked on the lost context.
 *  The kept-alive catalog is linked again as it stands (the visuals are built,
 *  only their programs are gone), at once when the player is in an encounter
 *  interior, else at the next attach. */
function forgetEncounterPrewarmContext(host: object): void {
  const typed = host as InteriorEncounterPrewarmHost;
  if (typed.shutdownStarted) return;
  const interior = activeInteriorByHost.get(host);
  if (!interior) {
    staleKeepAliveHosts.add(host);
    return;
  }
  relinkKeptAlive(typed);
}

function relinkKeptAlive(host: InteriorEncounterPrewarmHost): void {
  const visuals = keepAliveByHost.get(host) ?? [];
  const groups = varkhulKeepAliveByHost.get(host) ?? [];
  const portals = varkhulPortalKeepAliveByHost.get(host) ?? [];
  if (visuals.length + groups.length + portals.length === 0) return;
  const group = new THREE.Group();
  group.name = 'interior-encounter-prewarm';
  placeHiddenPrewarmGroup(host, group);
  for (const visual of visuals) {
    visual.root.visible = true;
    group.add(visual.root);
  }
  for (const kept of groups) {
    kept.visible = true;
    group.add(kept);
  }
  for (const portal of portals) group.add(portal.root);
  void compileEncounterPrewarmGroup(host, group)
    .catch(() => {
      // Soft-fail like the first pass: whatever stays cold links at first use.
    })
    .finally(() => {
      for (const visual of visuals) {
        visual.root.removeFromParent();
        visual.root.visible = false;
      }
      for (const kept of groups) {
        kept.removeFromParent();
        kept.visible = false;
      }
    });
}

async function runInteriorEncounterPrewarm(
  spec: InteriorEncounterPrewarmSpec,
  host: InteriorEncounterPrewarmHost,
): Promise<void> {
  if (host.shutdownStarted) return;
  const group = new THREE.Group();
  group.name = 'interior-encounter-prewarm';
  placeHiddenPrewarmGroup(host, group);
  const varkhulKeepAlive: THREE.Group[] = [];
  const varkhulPortalKeepAlive: VarkhulForgePortalPrewarmVisual[] = [];

  const keepAlive: CharacterVisual[] = [];
  let idx = 0;
  const place = (visual: CharacterVisual): void => {
    visual.root.visible = true;
    visual.root.position.set(((idx % 8) - 3.5) * 2.8, 0, Math.floor(idx / 8) * 2.8);
    group.add(visual.root);
    idx++;
  };

  // Varkhul stands in the Inner Crucible before the pull, and his view keeps
  // drawing while its compile gate is pending (raidEncounterViewVisibleDuringCompile
  // re-shows it every frame), so its programs link in a live frame unless a
  // twin linked them earlier (the harvest caught two body programs doing so). Same
  // factory and entity shape as the live view, so the same visual key and
  // program keys. Constrained devices skip it: the rig is held for the session
  // and creature bodies stream there, so it may not even be resident.
  const buildVarkhulRig = (): void => {
    if (GFX.constrainedMemory) return;
    const template = MOBS[VARKHUL_BOSS_ID];
    if (!template) return;
    const entity = host.prewarmEntity('mob', template.id, template.color, template.scale);
    const visual = createCharacterVisual(entity);
    if (!visual) return;
    keepAlive.push(visual);
    place(visual);
  };

  // Each visual is a few ms of pure CPU. Built in one loop they all land on
  // the frame that attaches the interior (measured: a >150ms stall at arena
  // entry), so the build drains across idle slots exactly like the compile
  // below.
  const units: Array<() => void> = [
    // Nythraxis's eruption, flame patches, Gravefire strip, and Binding Sigil:
    // actionable floor visuals built lazily by per-frame encounter sync, so
    // their first appearance must not link programs inside live combat. FIRST,
    // so it is also compiled first: the eruption lands seconds after the pull.
    ...(spec.nythraxisGraveVisuals
      ? [
          () => {
            const grave = buildNythraxisGravePrewarmVisual();
            grave.position.set(-24, 0, 0);
            group.add(grave);
            varkhulKeepAlive.push(grave);
          },
        ]
      : []),
    ...(spec.varkhulVisuals
      ? [
          buildVarkhulRig,
          () => {
            const encounter = buildVarkhulEncounterPrewarmVisual();
            const forgestorm = buildVarkhulForgestormPrewarmVisual();
            const forgeBeams = buildVarkhulForgeBeamPrewarmVisual();
            const interceptBeam = buildVarkhulInterceptBeamPrewarmVisual();
            const forgePortals = buildVarkhulForgePortalPrewarmVisual();
            const worldfire = buildVarkhulWorldfirePrewarmVisual();
            encounter.position.set(-12, 0, 0);
            forgestorm.position.set(-12, 0, 12);
            forgeBeams.position.set(12, 0, 0);
            interceptBeam.position.set(0, 0, 12);
            forgePortals.root.position.set(0, 0, 12);
            worldfire.position.set(0, 0, -12);
            group.add(
              encounter,
              forgestorm,
              forgeBeams,
              interceptBeam,
              forgePortals.root,
              worldfire,
            );
            varkhulKeepAlive.push(
              encounter,
              forgestorm,
              forgeBeams,
              interceptBeam,
              forgePortals.root,
              worldfire,
            );
            varkhulPortalKeepAlive.push(forgePortals);
          },
          // Its own idle unit: the Assembly stages ten full rune stations, so
          // sharing the unit above would concatenate both builds into one task.
          () => {
            const assembly = buildVarkhulAssemblyPrewarmVisual();
            assembly.position.set(-36, 0, 0);
            group.add(assembly);
            varkhulKeepAlive.push(assembly);
          },
        ]
      : []),
    // Ignivar's own mechanic visuals share the interior with Varkhul's but are
    // otherwise built lazily during per-frame encounter sync, after the view
    // compile-gate enumeration: first onset would link their programs (the
    // Judgment charred-ground and fire-beam shaders included) in a live frame.
    ...(spec.ignivarVisuals
      ? [
          () => {
            const encounter = buildIgnivarEncounterPrewarmVisual();
            encounter.position.set(24, 0, 0);
            group.add(encounter);
            varkhulKeepAlive.push(encounter);
          },
          // Its own idle unit: four full fire-beam lanes plus flame blades.
          () => {
            const rays = buildIgnivarRotatingRaysPrewarmVisual();
            rays.position.set(36, 0, 0);
            group.add(rays);
            varkhulKeepAlive.push(rays);
          },
          // Its own idle unit: the heaviest per-entity build in the encounter
          // (three shelters, three warnings, three cue beams, the arena fire).
          () => {
            const judgment = buildIgnivarForgeJudgmentPrewarmVisual();
            judgment.position.set(0, 0, 36);
            group.add(judgment);
            varkhulKeepAlive.push(judgment);
          },
        ]
      : []),
  ];
  await runIdleQueue(units, (unit) => unit(), {
    batchSize: 1,
    timeoutMs: IDLE_MS,
    cancelled: () => host.shutdownStarted,
  });

  if (host.shutdownStarted || group.children.length === 0) return;

  try {
    await compileEncounterPrewarmGroup(host, group);
  } finally {
    const held = keepAliveByHost.get(host) ?? [];
    held.push(...keepAlive);
    keepAliveByHost.set(host, held);
    for (const visual of keepAlive) {
      visual.root.removeFromParent();
      visual.root.visible = false;
    }
    const heldVarkhul = varkhulKeepAliveByHost.get(host) ?? [];
    heldVarkhul.push(...varkhulKeepAlive);
    varkhulKeepAliveByHost.set(host, heldVarkhul);
    for (const visual of varkhulKeepAlive) {
      visual.removeFromParent();
      visual.visible = false;
    }
    const heldPortals = varkhulPortalKeepAliveByHost.get(host) ?? [];
    heldPortals.push(...varkhulPortalKeepAlive);
    varkhulPortalKeepAliveByHost.set(host, heldPortals);
  }
}

// A bounded prewarm render draws only what the camera can see, and a dungeon
// interior sits far from the world origin: a group left at 0,0,0 is culled, so
// the pass would link each program without ever paying its first DRAW. The zone
// prewarm plants its group in front of the player for the same reason.
function placeHiddenPrewarmGroup(host: InteriorEncounterPrewarmHost, group: THREE.Group): void {
  placeAtPlayer(host, group);
  setRenderCategory(group, 'prewarm');
  group.visible = false;
}

function placeAtPlayer(host: InteriorEncounterPrewarmHost, group: THREE.Group): void {
  const pos = host.sim.player.pos;
  group.position.set(pos.x, pos.y, pos.z - 24);
}

async function compileEncounterPrewarmGroup(
  host: InteriorEncounterPrewarmHost,
  group: THREE.Group,
): Promise<void> {
  host.scene.add(group);
  try {
    await runBackgroundPrewarm([group], {
      supportsAsyncCompile: host.asyncCompileSupported,
      idleSlot: () => idleSlot(IDLE_MS, { maxTimeoutDeferrals: 2 }),
      compileChild: async (child) => {
        const childRoot = child as THREE.Object3D;
        await host.backgroundGpuWork.run(
          () => host.compilePrewarmColorPrograms(childRoot, true),
          GPU_WORK_PRIORITY.VISIBLE_PREWARM,
          `encounter-prewarm-color:${childRoot.name || childRoot.type}`,
        );
        await host.backgroundGpuWork.run(
          () => host.compileShadowPrograms(childRoot),
          GPU_WORK_PRIORITY.VISIBLE_PREWARM,
          `encounter-prewarm-shadow:${childRoot.name || childRoot.type}`,
        );
      },
      prepareChildAssets: (child) => {
        for (const texture of collectObjectTextures(child as THREE.Object3D, false)) {
          host.webgl.initTexture(texture);
        }
      },
      warmChildUnits: (groupLike, child) => {
        const childRoot = child as THREE.Object3D;
        const units: { label: string; run: () => void }[] = [];
        const textures = [...collectObjectTextures(childRoot, false)];
        for (let i = 0; i < textures.length; i += TEXTURE_BATCH) {
          const batch = textures.slice(i, i + TEXTURE_BATCH);
          units.push({
            label: 'encounter-prewarm-tex',
            run: () => {
              for (const texture of batch) host.webgl.initTexture(texture);
            },
          });
        }
        units.push({
          label: `encounter-prewarm-render:${childRoot.name || childRoot.type}`,
          run: () => {
            // A pass that starts in the Forge-Lift can still be draining when
            // the raid walks into the Halls, another instance origin: placed
            // once, its later children would be culled from their first draw.
            placeAtPlayer(host, groupLike as THREE.Group);
            host.renderBoundedPrewarmRoot(groupLike as THREE.Group, childRoot);
          },
        });
        return units;
      },
      renderWarmPass: () => {},
      runUpload: (work, label) =>
        host.backgroundGpuWork.run(
          work,
          GPU_WORK_PRIORITY.VISIBLE_PREWARM,
          label ?? 'encounter-prewarm-upload',
        ),
    });
  } finally {
    group.removeFromParent();
  }
}
