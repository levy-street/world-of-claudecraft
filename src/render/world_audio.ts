// Pure world-to-audio routing. Static prop data determines footstep surfaces
// and positional ambience anchors without adding presentation-only sim events.

import { DUNGEON_X_THRESHOLD, getActiveWorldContent, PROPS } from '../sim/data';
import { dockSectionAt } from '../sim/dock_layout';
import { isAtSowfield } from '../sim/vale_cup_layout';
import { groundHeight, waterLevelAt, zoneBiomeAt } from '../sim/world';
import type { AmbientPointSource, Surface } from './audio_sink';

export function isOnDockDeck(x: number, z: number): boolean {
  for (const dock of getActiveWorldContent().props.docks)
    if (dockSectionAt(dock, x, z) >= 0) return true;
  return false;
}

export function footstepSurfaceAt(
  seed: number,
  x: number,
  y: number,
  z: number,
  weatherOn: boolean,
): Surface {
  if (x > DUNGEON_X_THRESHOLD) return 'stone';
  if (isOnDockDeck(x, z)) return 'wood';
  const waterLevel = waterLevelAt(x, z);
  if (groundHeight(x, z, seed) < waterLevel && y <= waterLevel + 0.3) return 'water';
  const biome = zoneBiomeAt(z);
  if (biome === 'vale') return 'grass';
  if (biome === 'marsh') return 'dirt';
  return weatherOn ? 'snow' : 'stone';
}

export function crowdAmbienceAt(
  x: number,
  z: number,
  inDungeon: boolean,
  matchLive: boolean,
): number {
  if (inDungeon || !isAtSowfield(x, z)) return 0;
  return matchLive ? 1 : 0.4;
}

export function buildWorldAmbientSources(seed: number): AmbientPointSource[] {
  const sources: AmbientPointSource[] = [];
  for (let i = 0; i < PROPS.campfires.length; i++) {
    const [x, z] = PROPS.campfires[i];
    sources.push({
      id: `world:campfire:${x}:${z}`,
      kind: 'campfire',
      x,
      y: groundHeight(x, z, seed) + 0.6,
      z,
    });
  }
  for (let i = 0; i < PROPS.stalls.length; i++) {
    const stall = PROPS.stalls[i];
    if (!stall.smithy) continue;
    sources.push({
      id: `world:forge:${stall.x}:${stall.z}`,
      kind: 'forge',
      x: stall.x,
      y: groundHeight(stall.x, stall.z, seed) + 1,
      z: stall.z,
    });
  }
  return sources;
}
