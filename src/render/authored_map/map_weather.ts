// Map-authored weather (WorldContent.weather) plus the cloud deck and aurora it
// drives, moved out of renderer.ts. Both layers are built lazily by the first
// record that asks for them, so a map without authored weather (the built-in
// world included) owns neither.

import type * as THREE from 'three';
import type { MapWeather } from '../../sim/types';
import { AuroraSky } from '../aurora_sky';
import { CloudLayer } from '../clouds';

export class MapWeatherLayers {
  private cloudLayer: CloudLayer | null = null;
  private auroraSky: AuroraSky | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  set(weather: MapWeather | null): void {
    if (weather?.clouds && weather.clouds.coverage > 0.01) {
      this.cloudLayer ??= new CloudLayer(this.scene);
      this.cloudLayer.setConfig(weather.clouds);
    } else {
      this.cloudLayer?.setConfig(null);
    }
    // The map's aurora rides the same authored record (0 disposes it).
    const aurora = weather?.aurora ?? 0;
    if (aurora > 0.005) {
      this.auroraSky ??= new AuroraSky(this.scene);
      this.auroraSky.setStrength(aurora);
    } else {
      this.auroraSky?.setStrength(0);
    }
  }

  /** Per frame, from the camera, on the cosmetic ambience clock (`scale` is
   *  the map's world speed) and the day/night clock. */
  update(cameraPos: THREE.Vector3, dt: number, time: number, scale: number, night: number): void {
    this.cloudLayer?.update(cameraPos, dt * scale);
    this.auroraSky?.update(time * scale, cameraPos, night);
  }
}
