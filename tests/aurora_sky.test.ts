// The map-authored aurora (render/aurora_sky.ts, MapWeather.aurora): curtains
// hung over the CAMERA wherever it goes, brightest at night, faint by day.
// SPACEY: "give us an aurora in the sky, still make the weather
// dynamic, just make it look more chill and less dark/dull".

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { newFlatCustomMap } from '../src/editor/custom_map';
import {
  AURORA_DAY_FLOOR,
  AURORA_HEIGHT,
  AURORA_RENDER_ORDER,
  AURORA_RING,
  AuroraSky,
  auroraNightScale,
} from '../src/render/aurora_sky';
import { SKY_BACKGROUND_RENDER_ORDER } from '../src/render/sky';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

function sourceOf(relativePath: string): string {
  return codeWithoutLineComments(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

describe('map aurora', () => {
  it('never quite leaves the sky by day, and is whole at night', () => {
    expect(AURORA_DAY_FLOOR).toBeGreaterThan(0);
    expect(AURORA_DAY_FLOOR).toBeLessThan(0.5);
    expect(auroraNightScale(0)).toBe(AURORA_DAY_FLOOR);
    expect(auroraNightScale(1)).toBe(1);
    expect(auroraNightScale(0.5)).toBeCloseTo((AURORA_DAY_FLOOR + 1) / 2, 6);
    expect(auroraNightScale(-3)).toBe(AURORA_DAY_FLOOR);
    expect(auroraNightScale(9)).toBe(1);
    // hung well out and well up: over the peaks and the cloud deck, never in
    // the maker's face like the puffs were
    expect(AURORA_RING).toBeGreaterThan(300);
    expect(AURORA_HEIGHT).toBeGreaterThan(200);
  });

  it('is off at strength 0 and tolerates garbage', () => {
    const scene = new THREE.Scene();
    const sky = new AuroraSky(scene);
    sky.setStrength(0);
    expect(scene.getObjectByName('map-aurora')).toBeUndefined();
    sky.setStrength(Number.NaN);
    expect(scene.getObjectByName('map-aurora')).toBeUndefined();
    // no canvas here (node): building is a no-op, and updating stays safe
    sky.setStrength(0.8);
    sky.update(1, new THREE.Vector3(), 1);
    sky.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('survives the document round trip as a 0..1 strength', () => {
    const map = newFlatCustomMap('Aurora Test', 'map_aurora_test', 1752710400000, {
      width: 60,
      height: 60,
    });
    map.weather = { aurora: 1.7, clouds: { coverage: 0.16, height: 7 } };
    const doc = sanitizeMapDoc(JSON.parse(JSON.stringify(map)));
    expect(doc?.weather?.aurora).toBe(1);
    expect(doc?.weather?.clouds).toEqual({ coverage: 0.16, height: 7 });
    map.weather = { aurora: 0 };
    const none = sanitizeMapDoc(JSON.parse(JSON.stringify(map)));
    expect(none?.weather?.aurora).toBeUndefined();
  });

  it('is wired: the renderer builds it from the weather record and moves it every frame', () => {
    const renderer = sourceOf('../src/render/renderer.ts');
    const layers = sourceOf('../src/render/authored_map/map_weather.ts');
    expect(layers).toContain("import { AuroraSky } from '../aurora_sky'");
    const setter = layers.slice(
      layers.indexOf('  set(weather'),
      layers.indexOf('\n  }', layers.indexOf('  set(weather')),
    );
    expect(setter).toContain('this.auroraSky ??= new AuroraSky(this.scene)');
    expect(setter).toContain('this.auroraSky.setStrength(aurora)');
    expect(setter).toContain('this.auroraSky?.setStrength(0)');
    expect(sourceOf('../src/render/editor_api/editor_api.ts')).toContain(
      'this.mapWeather.set(weather)',
    );
    // per frame, from the camera, on the day/night clock
    expect(layers).toContain('this.auroraSky?.update(time * scale, cameraPos, night)');
    expect(renderer).toContain(
      'mapWeather.update(cam, dt, this.time, ambienceScale, this.dnGlobalNight)',
    );
    // and the Studio's weather panel authors it
    const app = sourceOf('../src/editor/app.ts');
    expect(app).toContain('aurora: w?.aurora ?? 0');
    expect(app).toContain('if (w.aurora > 0.005) out.aurora =');
    const inspector = sourceOf('../src/editor/inspector.ts');
    expect(inspector).toContain("slider(t('editor.weather.aurora')");
  });

  it('draws after the sky dome, which would otherwise paint over the depth-less curtains', () => {
    expect(AURORA_RENDER_ORDER).toBeGreaterThan(SKY_BACKGROUND_RENDER_ORDER);
    const src = sourceOf('../src/render/aurora_sky.ts');
    expect(src).toContain('mesh.renderOrder = AURORA_RENDER_ORDER');
  });
});
