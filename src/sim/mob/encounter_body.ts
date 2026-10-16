// Which mob templates are an encounter's own, for the ordinary-mob rules added
// for trash: the cast line-of-sight rule (mob/cast_sight.ts) and the walk
// round a wall (mob/chase_route.ts). Those rules leave an encounter alone, so
// every boss keeps the casting and the movement it was authored and tuned
// with.
//
// There is no single flag for "a boss". MobTemplate.boss marks the dungeon
// finals, the raid bosses and the world bosses, but the named mid-bosses follow
// the boss rules "even without the boss: true flag" (content/dungeons.ts), so
// two predicates are built from the marks the content already carries:
//
//   isBossTemplate: the boss flag, or a place on a dungeon's gate roster
//     (DungeonGateDef.bosses and sealWhileEngaged: every mob a door waits on,
//     which is every mid-boss). Who the SIGHT rule leaves alone.
//
//   isEncounterBody: a boss as above, or a ccImmune template: the same
//     mid-bosses again, and the scripted great bodies that are not bosses (the
//     Turretback Hermit, the Sledge Tusker, the Mere Hydra's heads, the Great
//     Saurian). Who plans no ROUTE. Wider on purpose: a template caught here
//     only keeps the straight chase it has always had, and the search knows
//     nothing of an encounter's keep-out circles or scripted positions.
//
// The sight rule is the narrower of the two so that a named open-world caster
// that is merely control-immune (the corrupted priest Malric) still may not
// cast through a wall.
//
// Pure over the content tables; the gate roster is gathered once, on first use
// (never at import: instances/dungeon_gates.ts sits above this module).

import { DUNGEONS, MOBS } from '../data';
import { dungeonGateBossIds } from '../instances/dungeon_gates';

let gateRoster: ReadonlySet<string> | null = null;

function onAGateRoster(templateId: string): boolean {
  if (gateRoster === null) {
    const ids = new Set<string>();
    for (const dungeon of Object.values(DUNGEONS)) {
      for (const id of dungeonGateBossIds(dungeon)) ids.add(id);
    }
    gateRoster = ids;
  }
  return gateRoster.has(templateId);
}

/** A boss: flagged one, or a mob a dungeon gate waits on (see the header). */
export function isBossTemplate(templateId: string): boolean {
  return MOBS[templateId]?.boss === true || onAGateRoster(templateId);
}

/** A boss or a scripted great body (see the header). */
export function isEncounterBody(templateId: string): boolean {
  return isBossTemplate(templateId) || MOBS[templateId]?.ccImmune === true;
}
