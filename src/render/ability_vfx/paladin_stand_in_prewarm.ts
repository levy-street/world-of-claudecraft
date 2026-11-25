// The Paladin kit recipe's home for the programs the RENDERER draws for a
// Paladin, beside the kit's own pools: Aegis of the First Dawn, Holy Ground
// (Consecration), Divine Ascension, Avenging Wrath's wings and rune band, and
// the shield and weapon glow. Each is a bespoke visual a driver builds per
// view or per zone and disposes when it ends, so nothing held its programs and
// each first cast linked them in a live frame (212 to 232 ms worst frames for
// a first Holy Ground at Ultra). Their boot home, ABILITY_MATERIAL_SOURCES, is
// linked as one unit by the very last background unit, about two minutes after
// the curtain on a slow boot, and a zone that ended before then released its
// programs, so the next cast linked them again.
//
// Here they ride the kit recipe (active_kit_prewarm.ts), which runs seconds
// after a local Paladin's entry or a remote one's first sighting, at the FRONT
// of the Paladin recipe: one hidden stand-in each, FRESH instances owned by
// this renderer (the boot group keeps the module singletons; one Object3D has
// one parent) and never disposed while the renderer lives, so a zone or a pair
// of wings ending can never release a program. The recipe cuts one compile
// per distinct program (drawProgramSignature over the compile gate's own piece
// cut), each settled over every variant and then touched, the shape of the
// kit pools' CrestPrewarm units. There is no upload unit: the live visuals
// draw geometry of their own, so a bounded draw of a stand-in would upload
// buffers no live draw reads. No cast waits on these: the drivers draw
// ungated, and this recipe only makes their first draw a cache hit.
//
// The group is built with the kit's pools in AbilityVfxFx's constructor, so
// fx.ts marks it as the kit's own preparation and the boot link walk skips it
// (prewarm.ts markOwnKitPreparation): no other class pays for its links.

import * as THREE from 'three';
import { createPaladinShieldGlowStandIn } from '../characters/paladin_shield_glow_fx';
import { linkPiecesOf } from '../compile_gate_pieces';
import { registerContextRestoreReset } from '../context_restore_registry';
import { drawProgramSignature } from '../draw_program_signature_core';
import { isProgramKnownReady } from '../linked_program_readiness';
import {
  type LinkedProgramLike,
  type MaterialPropertiesLike,
  touchLinkedProgram,
} from '../linked_program_touch';
import { createPaladinAegisStandIn } from '../paladin_aegis_visual';
import { createPaladinAscensionStandIn } from '../paladin_ascension_visual';
import { createPaladinAvengingWrathStandIn } from '../paladin_avenging_wrath_visual';
import { createPaladinConsecrationStandIn } from '../paladin_consecration_visual';
import type { PrewarmResumeUnit } from '../prewarm_resume';
import { settleProgramVariants } from '../program_variant_settle';
import type { CrestPrewarmHost } from './crest_prewarm';

/** The renderer-owned Paladin visuals, in recipe order: the measured worst
 *  first-cast links lead. */
export const PALADIN_KIT_STAND_INS: readonly { id: string; build(): THREE.Object3D }[] = [
  { id: 'consecration', build: () => createPaladinConsecrationStandIn().root },
  { id: 'aegis', build: () => createPaladinAegisStandIn().root },
  { id: 'avenging-wrath', build: () => createPaladinAvengingWrathStandIn().root },
  { id: 'ascension', build: () => createPaladinAscensionStandIn().root },
  { id: 'shield-glow', build: () => createPaladinShieldGlowStandIn().root },
];

interface Piece {
  id: string;
  /** The draw whose compile links the piece's program (compiled in place). */
  object: THREE.Object3D;
  materials: THREE.Material[];
}

function materialsOf(object: THREE.Object3D): THREE.Material[] {
  const own = (object as THREE.Mesh).material;
  return own ? (Array.isArray(own) ? own : [own]) : [];
}

/** Every proved program of `materials`, each variant (canvas and offscreen,
 *  and whatever else three keyed for them): what the touch tail warms. */
function provedPrograms(
  properties: MaterialPropertiesLike,
  materials: readonly THREE.Material[],
): LinkedProgramLike[] {
  const found: LinkedProgramLike[] = [];
  for (const material of materials) {
    const programs = (
      properties.get(material) as { programs?: Map<string, LinkedProgramLike> } | undefined
    )?.programs;
    for (const program of programs?.values() ?? [])
      if (isProgramKnownReady(program) && !found.includes(program)) found.push(program);
  }
  return found;
}

export class PaladinStandInPrewarm {
  readonly group = new THREE.Group();
  private readonly pieces: Piece[] = [];
  private readonly compiled = new Map<string, LinkedProgramLike[]>();
  private readonly compiling = new Map<string, Promise<void>>();
  private readonly touched = new Set<LinkedProgramLike>();
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.group.name = 'paladin-stand-in-prewarm';
    this.group.visible = false;
    this.group.userData.renderCategory = 'prewarm';
    // One piece per distinct program across every stand-in: Divine
    // Ascension's wings are Avenging Wrath's, so they link once.
    const seen = new Set<string>();
    for (const source of PALADIN_KIT_STAND_INS) {
      const root = source.build();
      root.name = `${source.id}:paladin-kit-stand-in`;
      root.visible = false;
      this.group.add(root);
      let index = 0;
      for (const [representative] of linkPiecesOf(root)) {
        const fresh = materialsOf(representative).filter((material) => {
          const signature = drawProgramSignature(representative, material);
          if (seen.has(signature)) return false;
          seen.add(signature);
          return true;
        });
        if (fresh.length === 0) continue;
        this.pieces.push({
          id: `${source.id}:${index++}`,
          object: representative,
          materials: fresh,
        });
      }
    }
    scene.add(this.group);
    registerContextRestoreReset('paladin-stand-ins', this, (owner) => owner.forgetContext());
  }

  /** Every piece linked and touched on this context. */
  ready(): boolean {
    return !this.disposed && this.pieces.every((piece) => this.pieceDone(piece));
  }

  /** A WebGL context restore: every program and touched table belonged to the
   *  lost context, so `units()` offers the whole recipe again. */
  forgetContext(): void {
    this.compiled.clear();
    this.touched.clear();
  }

  private pieceDone(piece: Piece): boolean {
    const programs = this.compiled.get(piece.id);
    return programs !== undefined && programs.every((program) => this.touched.has(program));
  }

  units(host: CrestPrewarmHost): PrewarmResumeUnit[] {
    if (this.disposed) return [];
    const units: PrewarmResumeUnit[] = [];
    for (const piece of this.pieces) {
      if (this.pieceDone(piece)) continue;
      units.push({
        id: `paladin-stand-in-compile:${piece.id}`,
        run: () => {
          if (this.disposed || this.compiled.has(piece.id)) return;
          const existing = this.compiling.get(piece.id);
          if (existing) return existing;
          // Claimed only when admitted, never while the recipe is enumerated.
          const task = (async () => {
            await host.compile(piece.object, true);
            if (this.disposed) return;
            const owner = this;
            const settled = await settleProgramVariants(host.properties, piece.materials, {
              get fired() {
                return owner.disposed;
              },
            });
            if (this.disposed) return;
            if (!settled.settled) throw new Error(`Paladin ${piece.id} has unsettled programs`);
            const programs = provedPrograms(host.properties, piece.materials);
            if (programs.length === 0)
              throw new Error(`Paladin ${piece.id} expected at least one linked program`);
            this.compiled.set(piece.id, programs);
          })();
          this.compiling.set(piece.id, task);
          const release = () => this.compiling.delete(piece.id);
          void task.then(release, release);
          return task;
        },
      });
      units.push({
        id: `touch:paladin-stand-in:${piece.id}`,
        synchronous: true,
        run: () => {
          if (this.disposed) return;
          const programs = this.compiled.get(piece.id);
          if (!programs) throw new Error(`Paladin ${piece.id} was not compiled`);
          for (const program of programs) {
            if (this.touched.has(program)) continue;
            touchLinkedProgram(program);
            if (!this.disposed) this.touched.add(program);
          }
        },
      });
    }
    return units;
  }

  /** The renderer is going (AbilityVfxFx.dispose, its only caller): this is
   *  the one point the stand-ins let go of their programs. Every material here
   *  is this renderer's own instance. Some geometry is module-shared (the
   *  wings, the rune band plane, Holy Ground's fixed pieces); disposing it
   *  frees only the retiring renderer's buffers, and three uploads a disposed
   *  geometry again at its next draw in whichever renderer draws it. Textures
   *  are left alone: they may be module caches. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse((object) => {
      const geometry = (object as THREE.Mesh).geometry;
      if (geometry) geometries.add(geometry);
      for (const material of materialsOf(object)) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.compiled.clear();
    this.compiling.clear();
    this.touched.clear();
  }
}
