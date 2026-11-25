// The Guardian of the Breath's wind badge (src/ui/hud/dungeon/breath_wind_view.ts,
// the owner's playtest of 2026-11-25: players moved the wrong way): shown while
// the wind turns and blows, near the Cornice only; its arrow turned to where the
// player faces (up ahead, clockwise to the right) so it points the very way the
// wind carries them; never gated on a graphics preset or the hints setting.

import { describe, expect, it } from 'vitest';
import { breathWindTemplate } from '../src/sim/encounters/smith_heart/breath_ids';
import { WIND_GUST_AURA } from '../src/sim/wind_drift';
import {
  BREATH_WIND_REACH,
  BreathWindScan,
  buildBreathWindView,
  makeBreathWindView,
} from '../src/ui/hud/dungeon/breath_wind_view';

const wind = (phase: Parameters<typeof breathWindTemplate>[0], bearing: number) => ({
  id: 7,
  templateId: breathWindTemplate(phase, bearing, 10),
  kind: 'object',
  pos: { x: 100, z: 300 },
});
const at = (facing: number, dx = 0) => ({ pos: { x: 100 + dx, z: 300 }, facing });

/** Where the arrow's up (ahead) turned clockwise by `deg` points in the world,
 *  for a player facing `f` (right of ahead is (-cos f, sin f)). */
function arrowWorld(f: number, deg: number): { x: number; z: number } {
  const a = (deg * Math.PI) / 180;
  const ahead = { x: Math.sin(f), z: Math.cos(f) };
  const right = { x: -Math.cos(f), z: Math.sin(f) };
  return {
    x: ahead.x * Math.cos(a) + right.x * Math.sin(a),
    z: ahead.z * Math.cos(a) + right.z * Math.sin(a),
  };
}

describe('the Breath wind badge', () => {
  it('points the way the wind carries the body, whatever the facing', () => {
    const out = makeBreathWindView();
    for (const bearing of [0, 22, 90, 128, 182, 300])
      for (const f of [0, 0.7, -1.2, Math.PI, 2.5]) {
        const v = buildBreathWindView(wind('blow', bearing), at(f), out);
        expect(v.visible).toBe(true);
        const w = arrowWorld(f, v.rotDeg);
        const b = (bearing * Math.PI) / 180;
        // The wind blows toward (sin b, cos b) (wind_drift.ts).
        expect(w.x).toBeCloseTo(Math.sin(b), 1);
        expect(w.z).toBeCloseTo(Math.cos(b), 1);
      }
  });

  it('shows the turn (the gather) and the blow, hides calm, still, far and dead', () => {
    const out = makeBreathWindView();
    expect(buildBreathWindView(wind('gather', 90), at(0), out)).toMatchObject({
      visible: true,
      turning: true,
      label: 'Wind turning',
    });
    expect(buildBreathWindView(wind('blow', 90), at(0), out)).toMatchObject({
      visible: true,
      turning: false,
      label: 'Wind',
    });
    expect(buildBreathWindView(wind('gust', 90), at(0), out).visible).toBe(true);
    for (const phase of ['calm', 'still', 'inhale', 'storm'] as const)
      expect(buildBreathWindView(wind(phase, 90), at(0), out).visible).toBe(false);
    expect(buildBreathWindView(wind('blow', 90), at(0, BREATH_WIND_REACH + 1), out).visible).toBe(
      false,
    );
    expect(buildBreathWindView(wind('blow', 90), { ...at(0), dead: true }, out).visible).toBe(
      false,
    );
    expect(buildBreathWindView(null, at(0), out).visible).toBe(false);
  });

  it("points along the Roar's follow-through gust on the body, outranking the Cornice's wind", () => {
    const out = makeBreathWindView();
    // Thrown east (heading 90 degrees), facing north: the arrow turns right.
    const gusted = { ...at(0), auras: [{ id: WIND_GUST_AURA, value: Math.PI / 2 }] };
    expect(buildBreathWindView(wind('calm', 0), gusted, out)).toMatchObject({
      visible: true,
      rotDeg: 270,
      turning: false,
    });
    // Over a blow the other way: the gust still names the way it carries.
    expect(buildBreathWindView(wind('blow', 270), gusted, out).rotDeg).toBe(270);
    expect(buildBreathWindView(null, gusted, out).visible).toBe(true);
    expect(buildBreathWindView(null, { ...gusted, dead: true }, out).visible).toBe(false);
  });

  it('finds the wind object once per roster', () => {
    const scan = new BreathWindScan();
    const w = wind('blow', 0);
    const entities = new Map([
      [3, { id: 3, templateId: 'heart_breath_guardian', kind: 'mob', pos: { x: 0, z: 0 } }],
      [7, w],
    ]);
    expect(scan.frame({ entities, entityRosterVersion: 1 })).toBe(w);
    entities.delete(7);
    expect(scan.frame({ entities, entityRosterVersion: 2 })).toBeNull();
  });
});
