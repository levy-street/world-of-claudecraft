// The Wildheart caldera interior owns NO census-keyed light: its sunlit grade
// is the `wildheartField` state of interior_light_rig.ts, re-grading the
// constructor's one sun/hemi pair. The fill pair the interior used to add
// changed numDirLights/numHemiLights for the whole world scene and, interiors
// never being removed, relinked every material drawn after a Palm Reach visit
// (2026-09-12 hunt: 132 live programs at the Veiled Hollow graveyard).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyInteriorLightRig } from '../src/render/interior_light_rig';

describe('the Wildheart caldera interior and the light census', () => {
  // That wildheart_props.ts constructs no census-keyed light is pinned by
  // tests/render_light_census_pin.test.ts (the file is no longer allowlisted);
  // this suite pins the grade that replaced the fill pair.
  it('carries the caldera sunlight in the rig grade of the one sun/hemi pair', () => {
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
    const scene = new THREE.Scene();
    const targets = {
      sun,
      hemi,
      scene,
      rim: { value: 1 },
      rimColor: { value: new THREE.Color() },
    };
    const outdoor = { sunIntensity: 1.2, hemiIntensity: 0.4, envIntensity: 0.3 };
    applyInteriorLightRig('wildheartField', targets, outdoor);
    // The former fill pair (0.88 sun, 0.9 hemi) is folded into these legs, so
    // the field reads brighter than the outdoor legs it replaces.
    expect(sun.intensity).toBe(2.6);
    expect(hemi.intensity).toBe(1.5);
    expect(sun.color.getHex()).toBe(0xffd48c);
    expect(hemi.color.getHex()).toBe(0xd8ebca);
    expect(hemi.groundColor.getHex()).toBe(0x5b4a2d);
    applyInteriorLightRig('outdoor', targets, outdoor);
    expect(sun.intensity).toBe(outdoor.sunIntensity);
    expect(hemi.intensity).toBe(outdoor.hemiIntensity);
  });
});
