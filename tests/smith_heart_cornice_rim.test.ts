// The Storm Cornice's drawn rim agrees with where a body falls (Jose's
// playtest of 2026-11-04: pale rock showed past the red edge, and you still
// fell there). The red lip is drawn on the field's own open cliff runs
// (breath_fight_fx_core.ts gapLips); the rock past it was the Cornice's own
// skirt flaring out under the lip with a pale scoured band painted on it.
// Now the Cornice's skirt falls SHEER for its first yards
// (field_mesh_core.ts `sheer`) and its face under the lip falls into shadow
// (breath_stone_core.ts), so nothing past the lip reads as ground; the
// other Breath faces (and the isles, other surfaces) keep their look.

import { describe, expect, it } from 'vitest';
import { planFieldCliffs } from '../src/render/authored_field/field_mesh_core';
import {
  BREATH_CLIFF_PALE,
  breathCliffPaint,
  CORNICE_LIP,
  CORNICE_SHEER,
  CORNICE_SURFACE,
  corniceRimFace,
} from '../src/render/smith_heart/breath_stone_core';
import {
  HEART_ROCK_HANG,
  planHeartHangs,
  planHeartRockLips,
} from '../src/render/smith_heart/heart_rock_hang_core';
import { HEART_ROCK_LIP } from '../src/render/smith_heart/heart_rock_plan_core';
import { gapLips } from '../src/render/smith_heart_fx/breath_fight_fx_core';
import {
  BREATH,
  CORNICE_WALLED_BEARINGS,
  SMITH_HEART_FIELD,
} from '../src/sim/content/smith_heart_layout';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';

const C = BREATH.cornice;
const ell = (x: number, z: number) => Math.hypot((x - C.x) / C.rx, (z - C.z) / C.rz);

describe("the Cornice's rim", () => {
  const base = {
    voidFloor: SMITH_HEART_FIELD.voidHeight - 25,
    columnStep: 1.6,
    rowStep: 3,
    flare: 0.22,
  };

  it('the Cornice is the surface the sheer option names', () => {
    expect(SMITH_HEART_FIELD.surfaces.some((s) => s.id === CORNICE_SURFACE)).toBe(true);
  });

  it('falls sheer under its lip: no skirt rock past the walkable edge for its first yards', () => {
    const past = (data: { positions: number[] }) => {
      let n = 0;
      let worst = 0;
      for (let i = 0; i < data.positions.length; i += 3) {
        const x = data.positions[i];
        const y = data.positions[i + 1];
        const z = data.positions[i + 2];
        if (ell(x, z) > 1.25 || y > C.h - 0.5 || y < C.h - CORNICE_SHEER) continue;
        // The climb's head in the west keeps its wall and its own stair's
        // faces (never an open lip).
        const deg = ((Math.atan2(x - C.x, z - C.z) * 180) / Math.PI + 360) % 360;
        if (deg >= CORNICE_WALLED_BEARINGS.from - 15 && deg <= CORNICE_WALLED_BEARINGS.to + 15)
          continue;
        // Past the lip: the floor there is the void (no ground under it).
        if (authoredFieldHeight(SMITH_HEART_FIELD, x, z) > SMITH_HEART_FIELD.voidHeight + 1)
          continue;
        // How far past the Cornice's own walkable floor this vertex stands.
        let out = Number.POSITIVE_INFINITY;
        for (let a = 0; a < 360; a += 4) {
          const r = (a * Math.PI) / 180;
          const px = x - Math.sin(r) * 0.5;
          const pz = z - Math.cos(r) * 0.5;
          if (authoredFieldHeight(SMITH_HEART_FIELD, px, pz) >= C.h - 0.2) out = Math.min(out, 0.5);
        }
        if (out === Number.POSITIVE_INFINITY) {
          n++;
          worst = Math.max(worst, ell(x, z));
        }
      }
      return n;
    };
    const flared = planFieldCliffs(SMITH_HEART_FIELD, base);
    const sheer = planFieldCliffs(SMITH_HEART_FIELD, {
      ...base,
      sheer: { surfaces: new Set([CORNICE_SURFACE]), depth: CORNICE_SHEER },
    });
    // The flared skirt stood rock well out past the lip (the bug) ...
    expect(past(flared)).toBeGreaterThan(50);
    // ... the sheer one never more than half a yard off the walkable floor.
    expect(past(sheer)).toBe(0);
  });

  it('its face under the lip falls into shadow; only a hair of crust under the red edge', () => {
    // A point on the Cornice's south rim, just under the lip.
    const x = C.x;
    const z = C.z + C.rz - 1;
    expect(corniceRimFace(x, z, C.h)).toBe(true);
    const lum = (c: readonly number[]) => c[0] + c[1] + c[2];
    const pale = lum(BREATH_CLIFF_PALE);
    for (const depth of [0.6, 1.2, 2, 3]) {
      expect(lum(breathCliffPaint(x, C.h - depth, z, C.h))).toBeLessThan(pale * 0.62);
    }
    expect(CORNICE_LIP.crust).toBeLessThan(0.5);
    // A face under another walk keeps the scoured pale lip.
    expect(corniceRimFace(x, z, C.h - 20)).toBe(false);
    expect(corniceRimFace(C.x + 300, C.z, C.h)).toBe(false);
  });

  it('the red lip is still drawn on the very runs that kill', () => {
    const lips = gapLips();
    const segs = lips.flatMap((l) => l.segments);
    expect(segs.length).toBeGreaterThan(20);
    for (const sg of segs) {
      const mx = (sg.ax + sg.bx) / 2;
      const mz = (sg.az + sg.bz) / 2;
      // Just outside the drawn lip: the void.
      expect(
        authoredFieldHeight(SMITH_HEART_FIELD, mx + sg.nx * 0.6, mz + sg.nz * 0.6),
      ).toBeLessThanOrEqual(SMITH_HEART_FIELD.voidHeight + 1);
    }
  });

  it("the rock kit's lips and hung faces on its rim sit tucked under the brink, never set out past it", () => {
    const near = (x: number, z: number) => ell(x, z) < 1.12 && ell(x, z) > 0.8;
    const pieces = [...planHeartHangs(), ...planHeartRockLips()].filter(
      (p) => near(p.x, p.z) && Math.abs(p.y - C.h) < 6,
    );
    expect(pieces.length).toBeGreaterThan(0);
    for (const p of pieces) {
      const tuck = p.piece.startsWith('Kit_RockHang')
        ? HEART_ROCK_HANG.corniceTuck
        : HEART_ROCK_LIP.corniceTuck;
      // Its snowy brink well under the Cornice's floor: never a ledge at the lip.
      expect(p.y).toBeLessThanOrEqual(C.h - tuck + 1e-6);
    }
  });
});
