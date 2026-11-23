// Authored per-zone atmosphere (lighting / weather / skybox / world speed),
// moved out of renderer.ts. Applies the map-wide or per-zone record only when
// the active zone changes. In the editor the free-cam look-at is the "player"
// for this purpose, so flying over a zone adopts its atmosphere the way
// walking in would.

import { getActiveWorldContent, zoneAt } from '../../sim/data';
import type { MapWeather } from '../../sim/types';
import { resolveSkyboxUrl } from '../assets/skyboxes';
import type { EditorLightingProfile } from '../editor_lighting';
import { atmosphereResampleDue, worldAuthorsAtmosphere } from './zone_atmosphere_core';

/** Where an adopted atmosphere lands (the renderer's editor setters). */
export interface ZoneAtmosphereSink {
  setEditorLighting(profile: EditorLightingProfile | null): void;
  setAmbienceScale(scale: number): void;
  setEditorWeather(weather: MapWeather | null): void;
  setEditorSkybox(url: string | null): void;
}

export class ZoneAtmosphere {
  private zoneId: string | null = null;
  private skybox: string | null | undefined;
  private sampleX = Number.NaN;
  private sampleZ = Number.NaN;

  constructor(private readonly sink: ZoneAtmosphereSink) {}

  /** Apply map-wide or per-zone atmosphere only when the active zone changes. */
  apply(x: number, z: number, editorActive: boolean): void {
    if (!atmosphereResampleDue(this.zoneId !== null, this.sampleX, this.sampleZ, x, z)) return;
    this.sampleX = x;
    this.sampleZ = z;
    const world = getActiveWorldContent();
    if (!worldAuthorsAtmosphere(world, editorActive)) return;
    const zone = zoneAt(x, z);
    if (zone.id === this.zoneId) return;
    this.zoneId = zone.id;
    const local = world.zoneAtmosphere?.[zone.id];
    this.sink.setEditorLighting(local?.lighting ?? world.lighting ?? null);
    this.sink.setAmbienceScale(local?.timeScale ?? world.timeScale ?? 1);
    this.sink.setEditorWeather(local?.weather ?? world.weather ?? null);
    const token = local && Object.hasOwn(local, 'skybox') ? local.skybox : world.skybox;
    this.skybox = token;
    void resolveSkyboxUrl(token).then((url) => {
      if (this.skybox !== token) return;
      this.sink.setEditorSkybox(url);
    });
  }

  /** Invalidate the zone cache after live editor changes to atmosphere data. */
  refresh(): void {
    this.zoneId = null;
    this.sampleX = Number.NaN;
    this.sampleZ = Number.NaN;
  }
}
