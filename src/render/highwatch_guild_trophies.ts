// Lantern Hall's trophy room (render-only): shows each dungeon trophy in the guild's model only
// to a viewing player who has cleared that dungeon, and its plaque's gilding only once cleared
// on Heroic (highwatch_guild_trophies_core.ts decides). The trophies and the gilding are parts
// of the model of their own (scripts/assets/highwatch_guild/), so this only flips `visible` on
// meshes the building already owns: no material, no geometry, no light is created, and the
// town view's preparation and reveal own their programs (placed_town_buildings.ts).
//
// Driven from the Highwatch town view's update (highwatch_town.ts). The parts are bound once
// the guild's model has loaded (retried on a slow cadence until then), and re-applied only
// when the viewer's clear records move.
//
// A part the model carries in one material loads as one bare mesh, and the low tier's interior
// cull (placed_town_buildings.ts) flips `visible` on that same mesh as the viewer walks out of
// and back into its range: shared, the cull's re-show would show a trophy the viewer has not
// earned. So the room flips a holder group of its own round such a part (visibilityNode), never
// the mesh, and the two flags multiply.
import * as THREE from 'three';
import type { IWorld } from '../world_api';
import {
  GUILD_TROPHY_DUNGEONS,
  guildTrophyNodeNames,
  guildTrophySignatureOf,
  guildTrophyStates,
} from './highwatch_guild_trophies_core';

const GUILD_GROUP_NAME = 'highwatchBuilding:highwatch_guild';
/** Frames between attempts to find the guild's parts while its model is still loading. */
const BIND_RETRY_FRAMES = 8;

interface BoundParts {
  readonly trophy: THREE.Object3D;
  readonly gilt: THREE.Object3D;
}

export interface GuildTrophyRoom {
  /** One frame: bind the parts if the model has loaded, re-apply if the records moved. */
  sync(world: Pick<IWorld, 'deedStats'>): void;
}

/** The node the room flips for a part: the part itself when it loaded as a group of meshes (the
 *  cull flips those meshes, never the group), or a holder group put round it, in its place and
 *  with no transform of its own, when it loaded as one bare mesh. */
export function visibilityNode(part: THREE.Object3D): THREE.Object3D {
  const parent = part.parent;
  if (!(part as THREE.Mesh).isMesh || !parent) return part;
  const holder = new THREE.Group();
  holder.name = `${part.name}:trophyRoom`;
  parent.add(holder);
  holder.add(part);
  holder.updateMatrixWorld(true);
  return holder;
}

export function createGuildTrophyRoom(townGroup: THREE.Object3D): GuildTrophyRoom {
  let parts: BoundParts[] | null = null;
  let applied = -1;
  let wait = 0;

  const bind = (): BoundParts[] | null => {
    const guild = townGroup.getObjectByName(GUILD_GROUP_NAME);
    if (!guild) return null;
    const found: BoundParts[] = [];
    for (const dungeon of GUILD_TROPHY_DUNGEONS) {
      const names = guildTrophyNodeNames(dungeon);
      const trophy = guild.getObjectByName(names.trophy);
      const gilt = guild.getObjectByName(names.gilt);
      if (!trophy || !gilt) return null;
      found.push({ trophy, gilt });
    }
    // (only once every part is there, so a half-loaded model is never wrapped)
    return found.map(({ trophy, gilt }) => ({
      trophy: visibilityNode(trophy),
      gilt: visibilityNode(gilt),
    }));
  };

  return {
    sync(world) {
      if (!parts) {
        if (wait > 0) {
          wait--;
          return;
        }
        parts = bind();
        if (!parts) {
          wait = BIND_RETRY_FRAMES;
          return;
        }
        applied = -1;
      }
      const records = world.deedStats?.dungeonClears;
      const sig = guildTrophySignatureOf(records);
      if (sig === applied) return;
      applied = sig;
      const states = guildTrophyStates(records);
      for (const [i, state] of states.entries()) {
        parts[i].trophy.visible = state.trophy;
        parts[i].gilt.visible = state.gilt;
      }
    },
  };
}
