import * as THREE from 'three';
import { forgetHallowedWallBlock, noteHallowedWallBlock } from '../paladin_shield_buffs';
import type { CrestPrewarmHost } from './crest_prewarm';
import { KIT_GOLD, type PaladinKitContext } from './paladin_kit_context';
import { PaladinQuadPool } from './paladin_quad_pool';
import { WardOfFaith } from './ward_of_faith';

export const WALLS = 8;
/** An Ascension cue waits this long for its wall's aura to be seen. */
const GILD_WAIT = 1;
/** The threat ring runs out across the ground over this long. */
export const WALL_RING = 0.9;
/** The absorb share is handed to the plates as a value out of this. */
const SHARE_SCALE = 100;
const SHAPE = { wave: 0 } as const;
/** Ascension's deeper, hotter gold for the gilded wall's ring. */
const WALL_GILT = new THREE.Color(0xffc23a).multiplyScalar(1.6);

interface Wall {
  active: boolean;
  id: number;
  seen: boolean;
  age: number;
  /** The block's length, from the first frame seen (<= 0: take the next). */
  span: number;
  /** Empowered by Ascension: a gold rim on each plate, a brighter edge. */
  gilded: boolean;
}

/**
 * Hallowed Wall. Six kite-shield plates of light spin out of the raised
 * off-hand sigil and lock into a ring round the Paladin, bearing the
 * Faithwarden's sign, as a ring runs out across the ground to draw the enemy
 * in. The plates circle while the block holds; each carries a sixth of the
 * absorb and shatters off as it is worn down, the last bursting into shards if
 * it breaks, folding away as the block runs out. The plates are drawn by
 * ward_of_faith.ts's 'plates' parts; Ward of Faith keeps its dome. Recast
 * while it stands, the ring runs out again; empowered by Ascension (its
 * stronger block and absorb), every plate is gilded with a gold rim and a
 * brighter edge and the ring burns brighter.
 */
export class HallowedWall {
  private readonly pool: PaladinQuadPool<'hallowed_wall'>;
  /** The ring of shield plates. */
  readonly plates: WardOfFaith;
  private readonly walls: Wall[] = Array.from({ length: WALLS }, () => ({
    active: false,
    id: -1,
    seen: false,
    age: 0,
    span: 1,
    gilded: false,
  }));
  /** Ascension cues that came before their wall's aura: seconds waited. */
  private readonly pendingGild = new Map<number, number>();
  private readonly feet = new THREE.Vector3();

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'hallowed_wall', WALLS, {
      pull: '0.2',
      body: `
        // The ring that draws the enemy in, running out across the ground.
        float grow=1.0-sq(max(1.0-clamp(t/0.55,0.0,1.0),0.0));
        mask=(band(r,0.12+0.85*grow,0.012+0.025*grow)*1.3+band(r,0.12+0.8*grow,0.06)*0.25)
          *(1.0-grow*0.7)*(1.0-smoothstep(0.97,1.0,r));
        color=mix(vColor,HOT,0.4);
      `,
    });
    this.plates = new WardOfFaith(ctx.scene, ctx.anchor, ctx.groundY, ctx.camera, 'plates');
  }

  readonly preparation = {
    units: (host: CrestPrewarmHost) => [
      ...this.pool.preparation.units(host),
      ...this.plates.preparation.units(host),
    ],
  };

  /** Once a frame while `id` holds Hallowed Wall's block: `ward` is the share
   * of its absorb left, `remaining` the seconds of block left. */
  hold(id: number, ward: number, remaining = 8): void {
    if (!this.pool.ready()) return;
    let slot = this.walls.find((w) => w.active && w.id === id);
    if (!slot) {
      slot = this.walls.find((w) => !w.active);
      if (!slot) return;
      slot.active = true;
      slot.id = id;
      slot.age = 0;
      slot.span = Math.max(1, remaining);
      slot.gilded = false;
      // Just raised: the plates spin out of the sigil (Faithwarden's sign).
      this.plates.raise(id, 'protection');
    }
    if (slot.span <= 0) slot.span = Math.max(1, remaining);
    if (this.pendingGild.delete(id)) slot.gilded = true;
    slot.seen = true;
    const share = Number.isFinite(ward) ? Math.min(1, Math.max(0, ward)) : 0;
    this.plates.hold(id, share * SHARE_SCALE, remaining, slot.gilded);
    // The absorb broken, the block still holds: the held shield carries it,
    // as it carries Bastion Rite's.
    if (share > 0) forgetHallowedWallBlock(id);
    else noteHallowedWallBlock(id, remaining / slot.span);
  }

  /** `id` casts Hallowed Wall. Over a wall still standing, the threat ring
   * runs out again and the wall takes the new cast's strength (an Ascension
   * cue following it gilds it again). Returns whether a wall was standing. */
  cast(id: number): boolean {
    this.pendingGild.delete(id);
    const slot = this.walls.find((w) => w.active && w.id === id);
    if (!slot) return false;
    slot.age = 0;
    slot.span = 0;
    slot.gilded = false;
    return true;
  }

  /** Ascension empowered `id`'s Hallowed Wall (its cue follows the cast). */
  gild(id: number): void {
    const slot = this.walls.find((w) => w.active && w.id === id);
    if (slot) slot.gilded = true;
    // Cast this frame: the aura is seen on the next entity pass.
    else this.pendingGild.set(id, 0);
  }

  update(dt: number, reduced = false): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    for (const [id, waited] of this.pendingGild)
      if (waited + dt > GILD_WAIT) this.pendingGild.delete(id);
      else this.pendingGild.set(id, waited + dt);
    const pool = this.pool;
    pool.begin(this.ctx.camera);
    for (const w of this.walls) {
      if (!w.active) continue;
      w.age += dt;
      if (!w.seen || !this.ctx.anchor(w.id, 0, this.feet)) {
        w.active = false;
        forgetHallowedWallBlock(w.id);
        continue;
      }
      w.seen = false;
      if (w.age < WALL_RING) {
        const floor = this.ctx.groundY(this.feet.x, this.feet.z);
        const y = Number.isFinite(floor) ? Math.max(floor, this.feet.y - 0.3) : this.feet.y;
        pool.time = w.age;
        pool.ground(
          this.feet.x,
          y + 0.05,
          this.feet.z,
          8,
          w.gilded ? WALL_GILT : KIT_GOLD,
          w.gilded ? 1.5 : 1,
          SHAPE.wave,
        );
      }
    }
    pool.end();
    this.plates.update(dt, reduced);
  }

  clear(): void {
    this.pendingGild.clear();
    for (const w of this.walls) {
      if (w.active) forgetHallowedWallBlock(w.id);
      w.active = false;
    }
    this.pool.clear();
    this.plates.clear();
  }

  dispose(): void {
    this.pool.dispose();
    this.plates.dispose();
  }
}
