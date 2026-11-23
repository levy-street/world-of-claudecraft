// Balgath's death, as ground effects: WHEN they fire and WHERE, for balgath_fx.ts to draw.
//
// The fall itself is his authored clip (Balgath_Death, scripts/assets/balgath_cyclops/
// clip_library.py): the eye goes out, he staggers and topples backward, and his back hits
// the fen at 1.80s (tests/balgath_death.test.ts reads it off the shipped file). This
// core owns the two things a clip cannot carry because they belong to the WORLD rather than
// the body:
//
//  - the LANDING: dust, rock chips, a silt ring, a crater and a camera jolt for whoever is
//    near, fired BALGATH_DEATH_IMPACT_SEC after the alive-to-dead edge, at the spot his back
//    lands (behind his feet along his facing, since he falls backward);
//  - the SINK: at the end of the corpse window the sim lowers the corpse into the ground
//    (src/sim/mob/boss_corpse_sink.ts), and this throws dust off the body while it goes, so
//    thirteen yards of granite leaves in a cloud of its own dust instead of a clean slide.
//
// Edge-driven off the live entity (dead, position), never off an event: a corpse that
// enters view already dead (the rig was built after the kill) must NOT replay a landing
// nobody saw, which only a per-body first-sighting record can tell apart. The sink reads
// the one signal every host carries for every entity, its position, so it works offline
// and online alike without a wire field of its own.
//
// Three/DOM/i18n-free and deterministic (a sim-time clock advanced by the caller), so a
// Vitest drives it directly and the RENDER_PURE_CORES sweep covers it.

/** Seconds from the death edge to his back hitting the ground: the clip's IMPACT beat. */
export const BALGATH_DEATH_IMPACT_SEC = 1.8;

/** Camera trauma of the landing, above his smash (0.45): the heaviest thing he ever does. */
export const BALGATH_DEATH_TRAUMA = 0.6;

/**
 * His VisualDef height (src/render/characters/manifest.ts mob_balgath_cyclops), the unit
 * the offsets below scale by. A test welds the two, since a data-only manifest cannot be
 * imported into a pure core without dragging the whole visual table in.
 */
export const BALGATH_VISUAL_HEIGHT = 3.2;

/**
 * Where his back lands, as a fraction of his standing height behind his feet. Measured off
 * the shipped Balgath_Death's last frame: the middle of his back (halfway from his hips to
 * his head) lies about 0.6 of his height behind where he stood.
 */
export const BALGATH_DEATH_FALL_REACH = 0.6;

/** Radius of the landing's dust and ring, as a fraction of his standing height. */
export const BALGATH_DEATH_BLAST_FRACTION = 0.45;

/** Yards below where he lay that count as sinking (a tolerance on a streamed position). */
export const BALGATH_SINK_EPS = 0.05;

/** Seconds between dust puffs while the corpse sinks. */
export const BALGATH_SINK_DUST_INTERVAL = 0.4;

export interface DeathFxBody {
  id: number;
  dead?: boolean;
  pos: { x: number; y: number; z: number };
  facing?: number;
  scale?: number;
}

/** One ground effect to draw this frame. */
export interface DeathFxCue {
  kind: 'impact' | 'sinkStart' | 'sinkDust';
  x: number;
  z: number;
  /** World-unit radius of the effect. */
  radius: number;
}

/** Where his body lies, and how wide the landing is, for a body at `pos` facing `facing`. */
export function deathLandingSpot(
  pos: { x: number; z: number },
  facing = 0,
  scale = 1,
): { x: number; z: number; radius: number } {
  const height = BALGATH_VISUAL_HEIGHT * scale;
  const back = height * BALGATH_DEATH_FALL_REACH;
  return {
    x: pos.x - Math.sin(facing) * back,
    z: pos.z - Math.cos(facing) * back,
    radius: height * BALGATH_DEATH_BLAST_FRACTION,
  };
}

/** Append one cue at the body's landing spot. Called only on a frame that emits, so a
 *  corpse lying out its fifteen-minute window allocates nothing the rest of the time. */
function pushCue(out: DeathFxCue[], kind: DeathFxCue['kind'], body: DeathFxBody): void {
  out.push({ kind, ...deathLandingSpot(body.pos, body.facing, body.scale) });
}

interface BodyRecord {
  dead: boolean;
  /** Clock time the landing fires, or null when none is pending. */
  landAt: number | null;
  /** Height the corpse lay at, or null while alive. */
  baseY: number | null;
  sinking: boolean;
  dustAt: number;
}

/**
 * Per-body death state, advanced once per frame: `begin`, then `note` every Balgath in
 * view, then `end`. Cues are appended to the caller's array (no allocation per frame beyond
 * the cues themselves, which only exist on the frames something happens).
 */
export class BalgathDeathTracker {
  private bodies = new Map<number, BodyRecord>();
  private present = new Set<number>();
  private clock = 0;

  begin(dt: number): void {
    this.clock += Math.max(0, dt);
    this.present.clear();
  }

  note(body: DeathFxBody, out: DeathFxCue[]): void {
    const dead = body.dead === true;
    this.present.add(body.id);
    let rec = this.bodies.get(body.id);
    if (!rec) {
      // First sighting. A body already dead here died out of view: no landing replay.
      rec = { dead, landAt: null, baseY: dead ? body.pos.y : null, sinking: false, dustAt: 0 };
      this.bodies.set(body.id, rec);
    } else if (dead && !rec.dead) {
      rec.landAt = this.clock + BALGATH_DEATH_IMPACT_SEC;
      rec.baseY = body.pos.y;
    } else if (!dead && rec.dead) {
      rec.landAt = null;
      rec.baseY = null;
      rec.sinking = false;
    }
    rec.dead = dead;
    if (!dead) return;
    if (rec.landAt !== null && this.clock >= rec.landAt) {
      rec.landAt = null;
      pushCue(out, 'impact', body);
    }
    if (rec.baseY === null || body.pos.y >= rec.baseY - BALGATH_SINK_EPS) return;
    if (!rec.sinking) {
      rec.sinking = true;
      rec.dustAt = this.clock + BALGATH_SINK_DUST_INTERVAL;
      pushCue(out, 'sinkStart', body);
      return;
    }
    if (this.clock >= rec.dustAt) {
      rec.dustAt += BALGATH_SINK_DUST_INTERVAL;
      pushCue(out, 'sinkDust', body);
    }
  }

  /** Forget bodies that left the world or the view, so the table cannot grow unbounded. */
  end(): void {
    for (const id of this.bodies.keys()) if (!this.present.has(id)) this.bodies.delete(id);
  }

  clear(): void {
    this.bodies.clear();
    this.present.clear();
  }

  /** Bodies tracked right now (a test seam for the bounded-table rule). */
  size(): number {
    return this.bodies.size;
  }
}
