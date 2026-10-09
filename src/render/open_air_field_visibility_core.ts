// Which built open-air field draws: only the one the player stands in.
//
// An open-air dungeon field (open_air_fields.ts) is built once per claimed
// slot and never removed, and its backdrop is made to be seen from inside it:
// a sky dome that rides the camera and is never culled, a cirque of peaks or
// a sea or a lagoon reaching far past its own instance cell. The instance
// bands sit only one cell apart (sim/data.ts instanceOrigin), so a field left
// drawn after the player moved on stood in the next dungeon's sky: the
// Gravewyrm Sanctum's aurora over the Drowned Temple, its peaks hanging there
// as shards (the camera is outside that mesh, so only the slopes facing it
// survive the backface cull).
//
// The roster below holds every built field and hides all but the one whose
// instance cell holds the player: the same position, and the same cells, the
// sim files a body under (dungeonAt, instanceSlotForZ), so the field of the
// instance a player is in always draws and no other does. Only scenery hangs
// under a field root; a dungeon's telegraphs and encounter effects attach to
// the scene themselves.
//
// A field root also carries its fires' point lights, and the light budget
// ranks against the ancestry it sees (fire_light_registry.ts), so the renderer
// syncs the roster at the head of every budget pass, never from a cull sweep
// after it: a field's lights shine on the frame it is shown again. Hiding a
// root moves no light count (a field holds point lights only, and those are
// carrier sources three never gathers), so it links no program.
//
// PURE: no Three (a root is anything with the three fields used here), no
// DOM, no clock.

import { instanceOrigin, instanceOriginX } from '../sim/data';

// Half a dungeon band and half a slot: the cell one instance owns, taken from
// the instance plane's own spacing so the two cannot drift apart.
const HALF_BAND = (instanceOriginX(1) - instanceOriginX(0)) / 2;
const HALF_SLOT = (instanceOrigin(0, 1).z - instanceOrigin(0, 0).z) / 2;

/** A built field's slot origin (world x and z). */
export interface OpenAirFieldOrigin {
  readonly ox: number;
  readonly oz: number;
}

/** What the roster needs of a field's scene root (a THREE.Group fits). */
export interface OpenAirFieldRoot {
  visible: boolean;
  position: { set(x: number, y: number, z: number): unknown };
  userData: Record<string, unknown>;
}

interface RosterEntry extends OpenAirFieldOrigin {
  readonly root: OpenAirFieldRoot;
  /** True while this roster is what hides the root. */
  hidden: boolean;
}

/**
 * The index of the field whose instance cell holds the point (x, z), or -1
 * when it stands in none of them (the overworld, a closed dungeon, a slot
 * whose own field is still building). A cell is half open toward +x and +z,
 * the way the instance plane rounds a position to its band and slot, so no
 * two cells share a point; of two fields built at one origin the newest wins.
 */
export function openAirFieldAt(
  fields: readonly OpenAirFieldOrigin[],
  x: number,
  z: number,
): number {
  for (let i = fields.length - 1; i >= 0; i--) {
    const dx = x - fields[i].ox;
    const dz = z - fields[i].oz;
    if (dx >= -HALF_BAND && dx < HALF_BAND && dz >= -HALF_SLOT && dz < HALF_SLOT) return i;
  }
  return -1;
}

/** Every open-air field built this session, and which one of them draws. */
export class OpenAirFieldRoster {
  private readonly fields: RosterEntry[] = [];

  /** Build the field of the slot anchored at (ox, oz) and take it on: placed
   *  at its origin, tagged as dungeon scenery, and from here drawn only while
   *  the player stands in its instance. The caller attaches it. */
  async build<D, R extends OpenAirFieldRoot>(
    make: (deps: D, ox: number, oz: number) => R | Promise<R>,
    deps: D,
    ox: number,
    oz: number,
  ): Promise<R> {
    const root = await make(deps, ox, oz);
    root.position.set(ox, 0, oz);
    root.userData.renderCategory = 'dungeon';
    this.fields.push({ root, ox, oz, hidden: false });
    return root;
  }

  /**
   * Hide every field but the one holding the player at (x, z). The roster
   * only ever hides a visible root and only reveals a root it hid itself, so
   * a root its compile gate still holds hidden (gated_scene_attach.ts) stays
   * the gate's to reveal, wherever the player stands.
   */
  sync(x: number, z: number): void {
    const held = openAirFieldAt(this.fields, x, z);
    for (let i = 0; i < this.fields.length; i++) {
      const field = this.fields[i];
      if (i === held) {
        if (field.hidden) {
          field.root.visible = true;
          field.hidden = false;
        }
      } else if (field.root.visible) {
        field.root.visible = false;
        field.hidden = true;
      }
    }
  }
}
