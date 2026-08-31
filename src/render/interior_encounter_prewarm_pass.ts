// Hidden character compile at first interior attach. runBackgroundPrewarm
// links programs on idle GPU slots; Soul Rend clones are kept alive without
// dispose because three drops a program when its last material is disposed.
import * as THREE from 'three';
import { WEAPON_SKINS } from '../sim/content/weapon_skins';
import { CLASSES } from '../sim/data';
import { ALL_CLASSES, type PlayerClass } from '../sim/types';
import { GPU_WORK_PRIORITY } from './background_gpu_queue';
import { type CharacterVisual, createCharacterVisual } from './characters';
import { GFX } from './gfx';
import { idleSlot, runIdleQueue } from './idle_queue';
import { buildIgnivarEncounterPrewarmVisual } from './ignivar_encounter';
import { buildIgnivarForgeJudgmentPrewarmVisual } from './ignivar_forge_judgment';
import { buildIgnivarRotatingRaysPrewarmVisual } from './ignivar_rotating_rays';
import {
  encounterPrewarmDisabled,
  encounterPrewarmForInterior,
  type InteriorEncounterPrewarmSpec,
  type LiveSoulRendLook,
  liveSoulRendPrewarmIdentity,
  planInteriorEncounterPrewarm,
  shouldQueueLiveSoulRendPrewarm,
  vfxWeaponSkinIds,
} from './interior_encounter_prewarm';
import type { InteriorEncounterPrewarmHost } from './interior_encounter_prewarm_host';
import { collectObjectTextures } from './material_texture_slots';
import {
  buildVarkhulForgePortalPrewarmVisual,
  type VarkhulForgePortalPrewarmVisual,
} from './necromancy_army_portal_fx';
import { runBackgroundPrewarm } from './prewarm_pass';
import { setRenderCategory } from './renderer_diagnostics';
import { buildVarkhulAssemblyPrewarmVisual } from './varkhul_assembly_visual';
import { buildVarkhulEncounterPrewarmVisual } from './varkhul_encounter';
import { buildVarkhulForgeBeamPrewarmVisual } from './varkhul_forge_beam_visual';
import { buildVarkhulInterceptBeamPrewarmVisual } from './varkhul_intercept_beam_visual';
import { buildVarkhulWorldfirePrewarmVisual } from './varkhul_worldfire_visual';
import { WEAPON_VFX } from './weapon_vfx';

const startedByHost = new WeakMap<object, Set<string>>();
const keepAliveByHost = new WeakMap<object, CharacterVisual[]>();
const varkhulKeepAliveByHost = new WeakMap<object, THREE.Group[]>();
const varkhulPortalKeepAliveByHost = new WeakMap<object, VarkhulForgePortalPrewarmVisual[]>();
const liveWarmedByVisual = new WeakMap<CharacterVisual, Set<string>>();
// One live body warms at a time, per host. Each pass waits for its own idle
// slot, but a raid arrives together: six independent waits resolve in the SAME
// idle period and their program links concatenate into one long task (measured:
// a >150ms stall in the arrival window even with the clone pass deferred).
// Chaining them spreads one body per idle period instead.
const liveChainByHost = new WeakMap<object, Promise<void>>();
// Which interior each host is standing in. Owned here rather than as a field on
// the renderer: the host publishes it from its ambience pass, which runs AFTER
// its entity loop, so a body created on the attach frame would read a stale
// value; and a monolith under a line ratchet should not carry a field that
// exists only for this seam.
const activeInteriorByHost = new WeakMap<object, string>();
const IDLE_MS = 250;
const TEXTURE_BATCH = 2;
const SOUL_REND_SKIN_HOST_CLASS = 'warrior';

/** The host reports every interior change here, including leaving one (null):
 *  a stale value would keep warming live bodies outside the encounter. */
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
  // Held as a const so the failure arm below can close over it.
  const started = startedByHost.get(host) ?? new Set<string>();
  startedByHost.set(host, started);
  if (!started.has(interior)) {
    started.add(interior);
    // Handled the moment it exists: the background GPU queue REJECTS every
    // pending unit when the renderer shuts down (logout, graphics rebuild), and
    // a rejection sitting un-awaited across that window is reported as an
    // unhandledrejection, which is the client's fatal overlay.
    // Forget the interior again on failure: the key is claimed BEFORE the work,
    // so a rejected pass (a shutdown mid-flight, a compile that threw) would
    // otherwise leave the catalog cold for the session and link it at first draw.
    void runInteriorEncounterPrewarm(spec, typed).catch(() => {
      started.delete(interior);
    });
  }
  for (const [id, view] of typed.views) {
    if (!view.visual) continue;
    queueLiveSoulRendPrewarm(
      host,
      view.visual,
      view,
      typed.sim.entities.get(id)?.kind ?? '',
      interior,
    );
  }
}

/** `look` is null for a rig that holds nothing it can swap (a druid or warlock
 *  FORM body), which is also why a form visual could never be found by an
 *  entity lookup: it is not any view's `visual`. The caller passes the kind for
 *  the same reason, and because both call sites already hold the answer. */
export function queueLiveSoulRendPrewarm(
  host: object,
  visual: CharacterVisual,
  look: LiveSoulRendLook | null,
  kind: string,
  interior?: string | null,
): void {
  const typed = host as InteriorEncounterPrewarmHost;
  const interiorId = interior ?? activeInteriorByHost.get(host) ?? null;
  if (!interiorId) return;
  const spec = encounterPrewarmForInterior(interiorId);
  // Refuse on the interior FIRST: every createView, every form build and every
  // held-look change in ANY interior reaches this, and only one interior has a
  // spec at all.
  if (!spec) return;
  const identity = liveSoulRendPrewarmIdentity(look);
  // Held as a const so the failure arm below can close over it.
  const warmed = liveWarmedByVisual.get(visual) ?? new Set<string>();
  liveWarmedByVisual.set(visual, warmed);
  if (
    !shouldQueueLiveSoulRendPrewarm({
      disabled: encounterPrewarmDisabled(typeof location === 'undefined' ? '' : location.search),
      spec,
      kind,
      shutdown: typed.shutdownStarted,
      already: warmed.has(identity),
    })
  ) {
    return;
  }
  warmed.add(identity);
  const chain = (liveChainByHost.get(host) ?? Promise.resolve()).then(() =>
    compileLiveSoulRendClones(typed, visual).catch(() => {
      // One body failing to warm never stalls the bodies behind it, and its
      // look is un-claimed so the next queue for the same look retries instead
      // of leaving that body's clones cold.
      warmed.delete(identity);
    }),
  );
  liveChainByHost.set(host, chain);
}

async function runInteriorEncounterPrewarm(
  spec: InteriorEncounterPrewarmSpec,
  host: InteriorEncounterPrewarmHost,
): Promise<void> {
  if (host.shutdownStarted) return;
  // Phone-class WebKit runs a deliberately minimal prewarm because a fully
  // warmed manifest re-inflates GPU memory past the per-process ceiling (see
  // prewarm_policy.ts). The catalog is 30-odd rigs held for the session; the
  // live arm below is bounded by the bodies actually in the room, so THAT is
  // the half a constrained device keeps.
  if (GFX.constrainedMemory && !spec.varkhulVisuals && !spec.ignivarVisuals) return;
  const plan = planInteriorEncounterPrewarm(spec, {
    playerClasses: GFX.constrainedMemory ? [] : ALL_CLASSES,
    weaponSkinIds: GFX.constrainedMemory ? [] : vfxWeaponSkinIds(WEAPON_SKINS, WEAPON_VFX),
  });
  const group = new THREE.Group();
  group.name = 'interior-encounter-prewarm';
  placeHiddenPrewarmGroup(host, group);
  const keepAlive: CharacterVisual[] = [];
  const varkhulKeepAlive: THREE.Group[] = [];
  const varkhulPortalKeepAlive: VarkhulForgePortalPrewarmVisual[] = [];
  let idx = 0;
  const place = (visual: CharacterVisual): void => {
    visual.root.visible = true;
    visual.root.position.set(((idx % 8) - 3.5) * 2.8, 0, Math.floor(idx / 8) * 2.8);
    group.add(visual.root);
    idx++;
  };

  const buildPlayerClass = (cls: PlayerClass): void => {
    const entity = host.prewarmEntity('player', cls, CLASSES[cls]?.color ?? 0xffffff, 1);
    const visual = createCharacterVisual(entity);
    if (!visual) return;
    visual.setSoulRend(true);
    keepAlive.push(visual);
    place(visual);
  };

  const buildWeaponSkin = (skinId: string): void => {
    const entity = host.prewarmEntity(
      'player',
      SOUL_REND_SKIN_HOST_CLASS,
      CLASSES[SOUL_REND_SKIN_HOST_CLASS]?.color ?? 0xffffff,
      1,
    );
    const visual = createCharacterVisual(entity);
    if (!visual) return;
    const payloads = visual.setWeaponSkin(skinId);
    if (!payloads || payloads.length === 0) {
      visual.dispose();
      return;
    }
    visual.setSoulRend(true);
    keepAlive.push(visual);
    place(visual);
  };

  // Each catalog rig is a skinned clone plus a full material clone pass, a few
  // ms of pure CPU. Built in one loop the whole catalog lands on the frame that
  // attaches the interior (measured: a >150ms stall at arena entry), so the
  // build drains across idle slots exactly like the compile below.
  const units: Array<() => void> = [
    ...plan.playerClasses.map((cls) => () => buildPlayerClass(cls)),
    ...plan.weaponSkinIds.map((skinId) => () => buildWeaponSkin(skinId)),
    ...(spec.varkhulVisuals
      ? [
          () => {
            const encounter = buildVarkhulEncounterPrewarmVisual();
            const forgeBeams = buildVarkhulForgeBeamPrewarmVisual();
            const interceptBeam = buildVarkhulInterceptBeamPrewarmVisual();
            const forgePortals = buildVarkhulForgePortalPrewarmVisual();
            const worldfire = buildVarkhulWorldfirePrewarmVisual();
            encounter.position.set(-12, 0, 0);
            forgeBeams.position.set(12, 0, 0);
            interceptBeam.position.set(0, 0, 12);
            forgePortals.root.position.set(0, 0, 12);
            worldfire.position.set(0, 0, -12);
            group.add(encounter, forgeBeams, interceptBeam, forgePortals.root, worldfire);
            varkhulKeepAlive.push(
              encounter,
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
  const pos = host.sim.player.pos;
  group.position.set(pos.x, pos.y, pos.z - 24);
  setRenderCategory(group, 'prewarm');
  group.visible = false;
}

function liveSoulRendProxyMesh(
  source: THREE.Mesh,
  overlay: THREE.Material | THREE.Material[],
): THREE.Mesh {
  const skinned = source as THREE.SkinnedMesh;
  if (skinned.isSkinnedMesh) {
    const proxy = new THREE.SkinnedMesh(source.geometry, overlay);
    if (skinned.skeleton) proxy.bind(skinned.skeleton, skinned.bindMatrix);
    proxy.castShadow = source.castShadow;
    return proxy;
  }
  const proxy = new THREE.Mesh(source.geometry, overlay);
  proxy.castShadow = source.castShadow;
  return proxy;
}

async function compileLiveSoulRendClones(
  host: InteriorEncounterPrewarmHost,
  visual: CharacterVisual,
): Promise<void> {
  if (host.shutdownStarted) return;
  // Cloning a live rig's whole material set is a few ms of CPU, and the callers
  // are createView and applyWeaponSkin: a raid arriving together would pay one
  // clone pass per body on the very frames already building those bodies
  // (measured: a second >150ms stall in the arrival window). Wait for an idle
  // slot first, exactly like the compile below.
  await idleSlot(IDLE_MS, { maxTimeoutDeferrals: 2 });
  if (host.shutdownStarted) return;
  const slots = visual.prewarmSoulRendSlots();
  if (slots.length === 0) return;
  const group = new THREE.Group();
  group.name = 'live-soul-rend-prewarm';
  placeHiddenPrewarmGroup(host, group);
  const batch = new THREE.Group();
  batch.name = 'live-soul-rend-prewarm-batch';
  for (const slot of slots) {
    batch.add(liveSoulRendProxyMesh(slot.source, slot.overlay));
  }
  group.add(batch);
  // No keep-alive here, unlike the catalog: a live body's clones live on the
  // CharacterVisual, and its dispose() disposes them (disposeEffectMaterials),
  // which releases the program whatever else still references the mesh. Holding
  // the proxies would pin a departed player's skeleton and materials forever and
  // keep nothing warm.
  await compileEncounterPrewarmGroup(host, group);
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
          run: () => host.renderBoundedPrewarmRoot(groupLike as THREE.Group, childRoot),
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
