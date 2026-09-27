// The cast-VFX warm-up over the scene: the program links the boot manifest's
// vfx.ability-primitives entry runs (and hands to the resume lane as debt
// when the budget drops it), and the readiness gate the painter consults.
// The pooled primitives and the generic basics sit hidden in the scene from
// the renderer's construction, so the visible-only scene compile never
// collects them; the lazy spell stand-ins join once their group is staged.
// Every one of them gets a unit, while the gate waits on the gated families
// alone (cast_vfx_family.ts): the programs the painter draws behind it.
// renderer.ts keeps the wiring only.
//
// Linked means PROVED linked, by the settle record (linked_program_readiness.ts):
// each unit marks its root's programs once its compile settled, and the gate
// reads that record. Never three's `currentProgram` (assigned when the program
// cache hands the program over, BEFORE the link resolves under
// KHR_parallel_shader_compile, so a gate reading it opened on links still in
// flight), and never `isReady()` from a live frame (a synchronous GPU-process
// round trip the settle arm alone may issue; see the readiness module's header
// for the 5558 ms it cost once).

import type * as THREE from 'three';
import {
  abilityMaterialPrewarmMaterials,
  buildAbilityMaterialPrewarmGroup,
} from './ability_material_prewarm';
import { abilityVfxFamilyMaterials, collectAbilityVfxCompileTargets } from './ability_vfx';
import { warriorKitAssetsState } from './ability_vfx/production_assets';
import { CAST_VFX_FAMILIES, type CastVfxFamilyId } from './cast_vfx_family';
import { type CastVfxReadiness, createCastVfxReadiness } from './cast_vfx_readiness_core';
import { type CompileArmHost, linkColorPrograms } from './compile_arms';
import { isProgramKnownReady, markProgramsReadyUnder } from './linked_program_readiness';
import type { LinkedProgramLike } from './linked_program_touch';
import type { PrewarmManifestEntry } from './prewarm_entry';
import type { PrewarmResumeUnit } from './prewarm_resume';
import { REVEAL_GATE_WATCHDOG_MS } from './reveal_gate';
import {
  createPrewarmGroupSlot,
  type VariantPrewarmSlot,
  type VariantPrewarmSlotHost,
} from './variant_prewarm_slot';

/** What the gate reads off the renderer: three's per-material properties,
 *  whose `currentProgram` is the program the settle record is keyed on. */
export interface LinkedProgramSource {
  properties: { get(material: THREE.Material): unknown };
}

type CompileRoot = (root: THREE.Object3D) => Promise<void>;

const colourArm =
  (host: CompileArmHost): CompileRoot =>
  (root) =>
    linkColorPrograms(host, root, false);

/** One unit linking `root` through the colour arm (the canvas variant: the
 *  pools draw in the world pass), which records its root's programs as linked
 *  once that compile settled: the settle is the proof the gate opens on. The
 *  unit names its root, so the resume lane warms it through the worker ahead
 *  of the link (a hit where the worker is on, an announced link for the audit
 *  everywhere). */
function linkUnit(
  id: string,
  root: THREE.Object3D,
  webgl: LinkedProgramSource,
  compile: CompileRoot,
): PrewarmResumeUnit {
  return {
    id,
    roots: [root],
    run: () =>
      compile(root).then(() => {
        markProgramsReadyUnder(webgl.properties, root);
      }),
  };
}

/** One link unit per distinct pooled program, the engine family's first,
 *  then the kit's (the programs the gate waits on), then one for the staged
 *  lazy stand-ins (null before their stage), which never hold a cast.
 *  `compile` is the test seam. */
export function castVfxProgramUnits(
  scene: THREE.Object3D,
  standIns: THREE.Object3D | null,
  host: CompileArmHost,
  webgl: LinkedProgramSource,
  compile: CompileRoot = colourArm(host),
): PrewarmResumeUnit[] {
  const units = collectAbilityVfxCompileTargets(scene).map((target) =>
    linkUnit(`program:${target.id}`, target.object, webgl, compile),
  );
  if (standIns) units.push(linkUnit('ability-materials:compile', standIns, webgl, compile));
  return units;
}

/** The boot slot of the lazy stand-ins (ability_material_prewarm.ts). A
 *  dropped entry's resume units are fixed at drop time, before the stand-ins
 *  are staged, so castVfxProgramUnits holds no stand-in unit then and this
 *  slot's own resume link is the one that links them: it records their
 *  programs on the settle exactly as a cast unit does, or the gate waits them
 *  out to its deadline with every program linked. */
export function castVfxStandInSlot(
  host: VariantPrewarmSlotHost,
  webgl: LinkedProgramSource,
  onStage: (materials: THREE.Material[]) => void,
): VariantPrewarmSlot {
  return createPrewarmGroupSlot(host, 'ability-materials', {
    stage: () => {
      const group = buildAbilityMaterialPrewarmGroup();
      onStage(abilityMaterialPrewarmMaterials(group));
      return group;
    },
    link: (group) =>
      host.compileColorPrograms(group).then(() => {
        markProgramsReadyUnder(webgl.properties, group);
      }),
  });
}

export const CAST_VFX_FIRST_READS_ENTRY_ID = 'vfx.cast-first-reads';

/** The boot entry for the reads a player acts on that draw through a closed
 *  cast gate (the hard-CC band's overlay cloud, the terrain-draped area ring),
 *  plus the Vfx particle cloud: it draws from the first frame, but only a
 *  settle proves its program to the gate. Deadline-exempt and placed before
 *  vfx.ability-primitives, so these link and are PROVED behind the curtain
 *  instead of linking cold on the first stun or area cast after it. Exempt is
 *  not never dropped: an entry that starts past the manifest's hard deadline
 *  is deferred all the same (prewarmEntryShouldDefer), and its units then
 *  resume as `programs.` debt ahead of the ability primitives'. */
export function castVfxFirstReadsEntry(
  roots: readonly (THREE.Object3D | null | undefined)[],
  host: CompileArmHost,
  webgl: LinkedProgramSource,
  compile: CompileRoot = colourArm(host),
): PrewarmManifestEntry {
  const units = (): PrewarmResumeUnit[] =>
    roots.flatMap((root, index) =>
      root ? [linkUnit(`first-read:${root.name || root.type}:${index}`, root, webgl, compile)] : [],
    );
  return {
    id: CAST_VFX_FIRST_READS_ENTRY_ID,
    category: 'vfx',
    priority: 61.75,
    required: false,
    deadlineExempt: true,
    resumeProgramUnits: units,
    // Every unit settles before the entry reports: one root's failed compile
    // must not end the entry while the others' links, and so their proofs,
    // are still in flight.
    run: async () => {
      const failed = (await Promise.allSettled(units().map((unit) => unit.run()))).find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failed) throw failed.reason;
    },
    detail: () => `roots=${units().length}`,
  };
}

/** How long the cast gate may hold before it opens whatever its programs say.
 *  Three times the reveal watchdog, the project's own bound for "the world
 *  should be up by now": far past any legitimate resume on any device, so the
 *  deadline can only be reached by a lane that has genuinely stopped. A choice
 *  with its reason, not a measurement, and derived rather than tuned. */
export const CAST_VFX_READY_DEADLINE_MS = REVEAL_GATE_WATCHDOG_MS * 3;

/** What the gate stamps its once-per-frame walk with: three's render count,
 *  which moves on every rendered frame and never inside one. */
export interface CastVfxGateHost extends LinkedProgramSource {
  info?: { render: { frame: number } };
}

/** The gate over each family's programs in the scene. Their pools are built
 *  with the renderer, before any consult, so each set is read once and nothing
 *  waits on a stage. The kit family stands down on a device that declined the
 *  kit's assets (warriorKitAssetsState), where its pools never draw. */
export function createSceneCastVfxReadiness(
  scene: THREE.Object3D,
  webgl: CastVfxGateHost,
  now: () => number = () => performance.now(),
  deadlineMs: number = CAST_VFX_READY_DEADLINE_MS,
  kitDeclined: () => boolean = () => warriorKitAssetsState() === 'declined',
): CastVfxReadiness {
  let byFamily: Map<CastVfxFamilyId, THREE.Material[]> | null = null;
  const materialsOf = (id: CastVfxFamilyId): THREE.Material[] => {
    byFamily ??= abilityVfxFamilyMaterials(scene);
    return byFamily.get(id) ?? [];
  };
  return createCastVfxReadiness<THREE.Material>({
    now,
    frame: () => webgl.info?.render.frame ?? Number.NaN,
    deadlineMs,
    families: CAST_VFX_FAMILIES.map(({ id, bit }) => ({
      id,
      bit,
      materials: () => materialsOf(id),
      declined: id === 'kit' ? kitDeclined : undefined,
    })),
    // The PROGRAM the settle record proved, not a boolean: the core keys its
    // answer on it, so a material three has repointed at a program no settle
    // has seen reads pending again instead of riding the earlier one's answer.
    linked: (material) => {
      const program = (
        webgl.properties.get(material) as { currentProgram?: LinkedProgramLike | null }
      ).currentProgram;
      return program && isProgramKnownReady(program) ? program : null;
    },
  });
}
