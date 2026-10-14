// Pure world-to-audio routing. Static prop data determines footstep surfaces
// and positional ambience anchors without adding presentation-only sim events.

import { DUNGEON_X_THRESHOLD, getActiveWorldContent } from '../sim/data';
import { dockSectionAt } from '../sim/dock_layout';
import type { MapPointSound } from '../sim/types';
import { groundHeight, waterLevelAt, zoneBiomeAt } from '../sim/world';
import type { AmbientPointSource, PointSoundSource, Surface } from './audio_sink';

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
  const waterLevel = waterLevelAt(x, z, seed);
  if (groundHeight(x, z, seed) < waterLevel && y <= waterLevel + 0.3) return 'water';
  const biome = zoneBiomeAt(x, z);
  if (biome === 'vale') return 'grass';
  if (biome === 'marsh' || biome === 'ember') return 'dirt'; // ember: sandy waste
  if (biome === 'amber' || biome === 'fen') return 'grass';
  return weatherOn ? 'snow' : 'stone'; // peaks: snowy when weather is on
}

export function buildWorldAmbientSources(seed: number): AmbientPointSource[] {
  const sources: AmbientPointSource[] = [];
  const props = getActiveWorldContent().props;
  for (let i = 0; i < props.campfires.length; i++) {
    const [x, z] = props.campfires[i];
    sources.push({
      id: `world:campfire:${x}:${z}`,
      kind: 'campfire',
      x,
      y: groundHeight(x, z, seed) + 0.6,
      z,
    });
  }
  for (let i = 0; i < props.buildings.length; i++) {
    const building = props.buildings[i];
    if (building.id !== 'eastbrook_smithy') continue;
    sources.push({
      id: `world:forge:${building.x}:${building.z}`,
      kind: 'forge',
      x: building.x,
      y: groundHeight(building.x, building.z, seed) + 1,
      z: building.z,
    });
  }
  for (let i = 0; i < props.stalls.length; i++) {
    const stall = props.stalls[i];
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

/** Resolve the document's authored point sounds (editor Sound tool) into world
 *  space once per session: the saved `y` is a height above the terrain seat, the
 *  same convention the editor viewport's badges use, so it is seated here rather
 *  than in the audio engine. Ids are index-based because the list is fixed for
 *  the life of the world (a playtest re-launches on every edit). */
export function buildAuthoredPointSources(
  nodes: readonly MapPointSound[],
  seed: number,
): PointSoundSource[] {
  const sources: PointSoundSource[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    sources.push({
      id: `map:sound:${i}`,
      key: n.sound,
      x: n.x,
      y: groundHeight(n.x, n.z, seed) + n.y,
      z: n.z,
      volume: n.volume,
      radius: n.radius,
    });
  }
  return sources;
}
