// The Studio projects the document onto the active WorldContent on every load
// (app.ts rebuildActiveWorld). The renderer's zone-atmosphere pass reads the
// authored rig from THAT projection (applyZoneAtmosphere: world.lighting ??
// null), so a field the projection forgets is a field the viewport wipes on
// its first frame. Lighting was forgotten: every map opened with the shipped
// rig until a maker nudged a slider, which is how a map read "dark and
// overcast" in the Studio while its document said otherwise.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

function sourceOf(relativePath: string): string {
  return codeWithoutLineComments(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

describe('editor active-world projection', () => {
  it('carries every atmosphere field the renderer reads back off the world', () => {
    const app = sourceOf('../src/editor/app.ts');
    const start = app.indexOf('  private rebuildActiveWorld(): void {');
    expect(start).toBeGreaterThan(-1);
    const body = app.slice(start, app.indexOf('\n  }\n', start));
    for (const field of [
      'lighting',
      'weather',
      'zoneAtmosphere',
      'skybox',
      'terrainStyle',
      'timeScale',
    ]) {
      expect(body, field).toMatch(new RegExp(`world\\.${field} = `));
    }
    // and the renderer really does read them from the projection
    const atmosphere = sourceOf('../src/render/authored_map/zone_atmosphere.ts');
    expect(atmosphere).toContain(
      'this.sink.setEditorLighting(local?.lighting ?? world.lighting ?? null)',
    );
    expect(atmosphere).toContain(
      'this.sink.setEditorWeather(local?.weather ?? world.weather ?? null)',
    );
    const facade = sourceOf('../src/render/editor_api/editor_api.ts');
    expect(facade).toContain('this.zoneAtmosphere = new ZoneAtmosphere(this)');
  });

  it("carries the zone graveyards the viewport's Sim spawns its Spirit Healers at", () => {
    // The viewport builds its Sim from customMapToWorldContent, which projects
    // services.graveyards; sim.ts requires the active content to carry the same
    // record, or the collider build's healer-spot veto forks from the Sim's.
    const app = sourceOf('../src/editor/app.ts');
    const start = app.indexOf('  private rebuildActiveWorld(): void {');
    const body = app.slice(start, app.indexOf('\n  }\n', start));
    expect(body).toContain('zoneGraveyards(world.zones)');
    expect(body).toMatch(/world\.services = \{ graveyards \}/);
    const projection = sourceOf('../src/editor/custom_map.ts');
    expect(projection).toContain('zoneGraveyards(world.zones)');
  });
});
