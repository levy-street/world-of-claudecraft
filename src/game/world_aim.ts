// World-aim: the registry for the one active in-world pointer surface (the
// Gauntlet sigil slab). The hud registers a surface while its trial wants
// strokes; main.ts's world-pointer glue asks for it on every claimed pointer
// event and routes the rect-local point back through onPoint. Plain vectors
// only (no Three import) so ui/hud code can author rects without render types.

export interface WorldAimVec3 {
  x: number;
  y: number;
  z: number;
}

/** A world-space interaction rectangle: center plus HALF-extent u/v vectors. */
export interface WorldAimRect {
  center: WorldAimVec3;
  u: WorldAimVec3;
  v: WorldAimVec3;
}

export interface WorldAimSurface {
  rect: WorldAimRect;
  onPoint(u: number, v: number, phase: 'down' | 'move' | 'up'): void;
}

export class WorldAim {
  private current: WorldAimSurface | null = null;

  set(surface: WorldAimSurface | null): void {
    this.current = surface;
  }

  surface(): WorldAimSurface | null {
    return this.current;
  }
}
