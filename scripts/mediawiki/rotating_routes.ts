import {
  CANNON_ACTIONS,
  CANNON_ENEMIES,
  CANNON_WAVES,
} from '../../src/sim/content/cannon_encounter';
import { FARSHORE_SALVAGE_PLACEMENTS } from '../../src/sim/content/farshore_shipwreck_layout';
import { VEHICLE_STATIONS } from '../../src/sim/content/vehicle_stations';
import { WEEKLY_EMISSARY_NPC_DEF, type WeeklyQuestDef } from '../../src/sim/content/weekly_quests';
import { FORGE_STATIONS } from '../../src/sim/content/world_quest_forging';
import {
  GLIDER_APPRENTICE_NPC_DEF,
  GLIDER_LAUNCH_SITE,
} from '../../src/sim/content/world_quest_glider';
import { GLIDER_COURSES } from '../../src/sim/content/world_quest_glider_levels';
import {
  INVESTIGATION_CLUES,
  INVESTIGATION_NPCS,
  INVESTIGATION_VARIANTS,
} from '../../src/sim/content/world_quest_investigation';
import {
  SHADOW_GUARDS,
  SHADOW_SAFE_SPOT,
  SHADOW_STEAL_SUSPICION_LIMIT,
} from '../../src/sim/content/world_quest_shadow';
import { WISP_MAZE_SITE } from '../../src/sim/content/world_quest_wisp_maze';
import {
  FARSHORE_SALVAGE_ENTITY_ID_START,
  WORLD_QUEST_ESCORTS,
} from '../../src/sim/content/world_quests';
import {
  BUILTIN_WORLD,
  DUNGEON_LIST,
  gatherNodesInActiveWorld,
  MOBS,
  NPCS,
} from '../../src/sim/data';
import { FINAL_BOSS_DUNGEONS } from '../../src/sim/deeds';
import {
  DAILY_LOCKOUT_RAID_ROOMS,
  WEEKLY_LOCKOUT_RAID_ROOMS,
} from '../../src/sim/instances/dungeons';
import {
  FORGE_GOLD_SECONDS,
  FORGE_HEAT_DECAY,
  FORGE_HEAT_FLOOR,
  FORGE_MAX_MISTAKES,
  FORGE_SILVER_SECONDS,
  FORGE_STOKE_COOLDOWN,
  FORGE_STOKE_HEAT,
  FORGE_STRIKES,
  FORGE_WRONG_PENALTY,
} from '../../src/sim/minigames/forge_workshop';
import {
  WISP_MAZE_LAYOUT,
  WISP_MAZE_PROFILES,
  wispMazeCellCenter,
} from '../../src/sim/minigames/wisp_maze';
import type { WorldQuestDef } from '../../src/sim/types';
import { type DungeonDef, TICK_RATE } from '../../src/sim/types';
import { WORLD_BOSSES } from '../../src/sim/world_boss';
import { FARSHORE_SALVAGE_AMBUSH } from '../../src/sim/world_quest_ambush';
import { positionInWorldQuestArea } from '../../src/sim/world_quest_area';
import {
  WORLD_QUEST_TRACE_RUN_SECONDS,
  WORLD_QUEST_TRACE_TOLERANCE,
} from '../../src/sim/world_quest_trace_geometry';
import { WORLD_QUEST_LEY_TIMER_SECONDS } from '../../src/sim/world_quests';
import { questMap, type RoutePoint } from './quest_map';

export function worldRouteData(quest: WorldQuestDef) {
  const obj = quest.objective;
  const points: RoutePoint[] = [
    { step: 'Start', frame: 'Overworld', label: 'Enter the active quest area', ...quest.area },
  ];
  const instructions: string[] = [];
  const alternatives: string[] = [];
  const extraMaps: string[] = [];
  const coords = (p: { x: number; z: number }) =>
    '(' + Number(p.x.toFixed(3)) + ', ' + Number(p.z.toFixed(3)) + ')';
  const point = (label: string, pos: { x: number; z: number }, step = 1, radius?: number) =>
    points.push({ step, label, x: pos.x, z: pos.z, frame: 'Overworld', radius });
  function objects(id: string, step: number) {
    for (const group of BUILTIN_WORLD.groundObjects.filter((g) => g.itemId === id))
      for (const pos of group.positions)
        if (positionInWorldQuestArea(pos, quest)) point(group.name, pos, step);
  }
  if ('instructorNpcId' in obj) {
    const npc = NPCS[obj.instructorNpcId];
    point(npc.name, npc.pos);
    instructions.push(
      'Speak with ' + npc.name + ' at ' + coords(npc.pos) + ' to start the activity.',
    );
  }
  switch (obj.type) {
    case 'kill':
      instructions.push(
        'Defeat ' +
          quest.count +
          ' ' +
          MOBS[obj.targetMobId].name +
          ' while both you and the enemy are inside the marked area. You must receive kill credit. A released group member is checked at their corpse. Camp pins show possible spawns.',
      );
      for (const c of BUILTIN_WORLD.camps)
        if (
          c.mobId === obj.targetMobId &&
          Math.hypot(c.center.x - quest.area.x, c.center.z - quest.area.z) <=
            c.radius + quest.area.radius
        )
          point(MOBS[c.mobId].name + ' camp', c.center, 1, c.radius);
      break;
    case 'delivery':
      objects(obj.pickupObjectItemId, 1);
      objects(obj.deliveryObjectItemId, 2);
      instructions.push(
        'Pick up cargo at marker 1, carry it to marker 2, then interact to unload. Each pickup location counts once. Cargo slows movement by 25% and is lost on death, disconnect or leaving the area. Repeat with different pickups until you have delivered ' +
          quest.count +
          '.',
      );
      break;
    case 'gather':
      for (const n of gatherNodesInActiveWorld())
        if (n.type === obj.nodeType && positionInWorldQuestArea(n.pos, quest))
          point(obj.nodeType + ' node', n.pos);
      instructions.push(
        'Gather from ' +
          obj.nodeType +
          ' nodes inside the area until the counter reaches ' +
          quest.count +
          '.',
      );
      break;
    case 'interact':
      objects(obj.targetObjectItemId, 1);
      instructions.push(
        'Interact with the marked objects inside the ring until you reach ' +
          quest.count +
          ' credits.',
      );
      break;
    case 'salvage':
      instructions.push(
        'Recover ' +
          quest.count +
          ' different pieces from the visible arrangement around the shipwreck. Each location counts once. After ' +
          FARSHORE_SALVAGE_AMBUSH.triggerCount +
          ' pickups, the optional raider ambush can open at ' +
          coords(FARSHORE_SALVAGE_AMBUSH.portal) +
          '. The collection counter is separate from the ambush.',
      );
      obj.layouts.forEach((ids, index) => {
        const locations = ids.map(
          (id) => FARSHORE_SALVAGE_PLACEMENTS[id - FARSHORE_SALVAGE_ENTITY_ID_START],
        );
        alternatives.push(
          'Arrangement ' +
            (index + 1) +
            ': ' +
            locations
              .map((p) => p.key.replace(/^wq_/, '').replaceAll('_', ' ') + ' ' + coords(p))
              .join(' · '),
        );
        locations.forEach((p, i) => {
          point(
            'Arrangement ' + (index + 1) + ', ' + p.key.replace(/^wq_/, '').replaceAll('_', ' '),
            p,
            i + 1,
          );
        });
      });
      break;
    case 'escort': {
      const escort = WORLD_QUEST_ESCORTS[obj.escortId];
      point('Start the escort', escort.start);
      escort.waypoints.forEach((pos, i) => {
        const wave = escort.ambushes.find((a) => a.atWaypoint === i);
        point(
          'Escort waypoint ' +
            (i + 1) +
            (wave
              ? ' · ' + wave.count + ' ' + MOBS[wave.mobId].name + ' (level ' + wave.level + ')'
              : ''),
          pos,
          i + 2,
        );
      });
      instructions.push(
        'Interact with the caravan to set it moving. Follow it along the numbered waypoints. Keep it alive through ' +
          escort.ambushes.length +
          ' ambushes and stay alive within ' +
          escort.creditRadius +
          ' yd at the final waypoint for credit.',
      );
      break;
    }
    case 'vehicle': {
      const station = VEHICLE_STATIONS.find((s) => s.id === obj.stationId)!;
      point('Board the cannon', station);
      point(
        'Breach line',
        { x: (station.field.minX + station.field.maxX) / 2, z: station.field.maxZ },
        2,
      );
      instructions.push(
        'Board the cannon and aim ahead of the incoming enemies. Hold the line through ' +
          CANNON_WAVES.length +
          ' waves, kill the final commander (' +
          CANNON_ENEMIES.commander.hp +
          ' health) and finish with integrity above zero. Letting the commander through fails the encounter even if the wall survives. Endless waves start after the reward.',
      );
      for (const [action, shot] of Object.entries(CANNON_ACTIONS))
        instructions.push(
          action[0].toUpperCase() +
            action.slice(1) +
            ' deals ' +
            shot.damage +
            ' base damage within ' +
            shot.radius +
            ' yd after ' +
            shot.flightTicks / TICK_RATE +
            ' sec. It recharges in ' +
            shot.cooldownTicks / TICK_RATE +
            ' sec.' +
            (shot.slowTicks
              ? ' Slows targets to ' +
                shot.slowMultiplier * 100 +
                '% speed for ' +
                shot.slowTicks / TICK_RATE +
                ' sec.'
              : '') +
            (shot.burnTicks
              ? ' Burns for ' +
                shot.burnDamage +
                ' per second for ' +
                shot.burnTicks / TICK_RATE +
                ' sec.'
              : ''),
        );
      break;
    }
    case 'investigation':
      for (const c of INVESTIGATION_CLUES) point(c.name, c, 1);
      for (const n of INVESTIGATION_NPCS.slice(1)) point(n.name, n.pos, 2);
      point('Make your accusation to ' + INVESTIGATION_NPCS[0].name, INVESTIGATION_NPCS[0].pos, 3);
      instructions.push(
        'Read both the Standing Orders and Watch Ledger, then speak with all four suspects. Return to ' +
          INVESTIGATION_NPCS[0].name +
          ' to accuse the guard whose statement conflicts with the evidence. A wrong guess rules that guard out. Defeat your own revealed infiltrator within 180 sec while you and the target are inside the objective area.',
      );
      for (const v of INVESTIGATION_VARIANTS)
        alternatives.push(
          'If the Standing Orders say “' +
            v.clues[0] +
            '” accuse ' +
            INVESTIGATION_NPCS[v.culprit + 1].name +
            '.',
        );
      break;
    case 'puzzle':
      objects(obj.activationObjectItemId, 1);
      instructions.push(
        'Interact with the board to start the ' +
          WORLD_QUEST_LEY_TIMER_SECONDS +
          ' sec timer. Each press rotates one tile clockwise a quarter turn. Connect the source through adjoining tiles so the beam exits the marked side of the target tile. If time expires, restart the board. Solving the base board pays the quest. Charged bonus boards are optional.',
      );
      break;
    case 'match3':
      objects(obj.activationObjectItemId, 1);
      instructions.push(
        'Open the confection board and swap two pieces next to one another horizontally or vertically. Make a straight line of three or more matching pieces. Each cleared piece, including cascades, counts toward the ' +
          quest.count +
          ' required. Only an accepted swap uses a move. If the daily move limit runs out, restart the board: this resets its tiles, moves and cleared-piece count.',
      );
      break;
    case 'forging':
      for (const station of FORGE_STATIONS)
        if (station.id === 'tools' || station.id === 'fuel')
          point(station.name, station, station.id === 'fuel' ? 2 : 3);
      instructions.push(
        'Stoke the firewood and strike the anvil ' +
          FORGE_STRIKES +
          ' times while the moving needle is in the target band and heat is at least ' +
          FORGE_HEAT_FLOOR +
          '. Firewood adds ' +
          FORGE_STOKE_HEAT +
          ' heat, up to 100, every ' +
          FORGE_STOKE_COOLDOWN +
          ' sec. Heat falls by ' +
          FORGE_HEAT_DECAY +
          ' per sec. The ingot crate and well are scenery.',
      );
      instructions.push(
        'A cold or mistimed strike counts as one mistake. ' +
          FORGE_MAX_MISTAKES +
          ' mistakes end the run. For medals, add ' +
          FORGE_WRONG_PENALTY +
          ' sec per mistake to elapsed time. Gold requires at most ' +
          FORGE_GOLD_SECONDS +
          ' sec, Silver at most ' +
          FORGE_SILVER_SECONDS +
          ' sec. Any successful run earns credit.',
      );
      break;
    case 'glider': {
      point('Launch position', GLIDER_LAUNCH_SITE.playerLaunch);
      const names = ['Windrider Slalom', 'Valleys', 'Switchbacks'];
      instructions.push(
        'Choose one course and wait for the countdown. Fly through its rings in the listed order. Descend onto the landing pad within its radius and within 3 yd of the ground before time runs out. Only a winning flight on an active, unpaid quest grants the reward. Later flights are practice.',
      );
      GLIDER_COURSES.forEach((course, i) => {
        const pad = course.landingPad;
        alternatives.push(
          names[i] +
            ' · ' +
            course.minRings +
            ' required rings. Gold ' +
            course.medals?.goldSeconds +
            ' sec, Silver ' +
            course.medals?.silverSeconds +
            ' sec, timeout ' +
            course.medals?.timeoutSeconds +
            ' sec. The course map lists ring heights beside their ground coordinates.',
        );
        const rings: RoutePoint[] = course.rings.map((r) => ({
          step: r.id,
          label: 'Ring ' + r.id + ' at height ' + r.y + ' yd',
          frame: 'Overworld',
          x: r.x,
          z: r.z,
          radius: r.radius,
        }));
        rings.unshift({
          step: 'Start',
          label: 'Launch for ' + names[i],
          frame: 'Overworld',
          ...GLIDER_LAUNCH_SITE.playerLaunch,
        });
        rings.push({
          step: course.rings.length + 1,
          label: 'Finish on landing pad at height ' + pad.y + ' yd',
          frame: 'Overworld',
          ...pad,
        });
        extraMaps.push(
          questMap({ points: rings }).replace(
            '== Route map ==',
            '== ' + names[i] + ' flight route ==',
          ),
        );
        alternatives.push('Land at ' + coords(pad) + ' within ' + pad.radius + ' yd.');
      });
      point(
        'Land at the marked pad',
        GLIDER_COURSES[0].landingPad,
        2,
        GLIDER_COURSES[0].landingPad.radius,
      );
      point(
        'Optional return updraft: ' + GLIDER_APPRENTICE_NPC_DEF.name,
        GLIDER_APPRENTICE_NPC_DEF.pos,
        3,
      );
      break;
    }
    case 'tracing': {
      instructions.push(
        'Talk to the instructor to start each round. Memorize the preview, move to the starting mark, then walk its connected edges clockwise or counterclockwise and return to the start. Keep within ' +
          WORLD_QUEST_TRACE_TOLERANCE +
          ' yd of each edge. Combat or leaving the ground can fail the run. Each drawing allows ' +
          WORLD_QUEST_TRACE_RUN_SECONDS +
          ' sec.',
      );
      instructions.push(
        'Complete the triangle, then the square, then the assigned advanced figure. The last figure varies by student and rotation. Completing all three strokes earns credit regardless of medal.',
      );
      for (const shape of [
        ...obj.shapes.slice(0, -1),
        ...(obj.advancedShapes ?? obj.shapes.slice(-1)),
      ]) {
        alternatives.push(shape.kind + ' · ' + shape.points.map(coords).join(' → '));
      }
      break;
    }
    case 'shadow': {
      instructions.push(
        'Borrow the cloak. Approach a dispatch carrier from behind, within 2.5 yd. At under ' +
          100 * SHADOW_STEAL_SUSPICION_LIMIT +
          '% suspicion, use Pickpocket and stay still for 1 sec out of lantern beams. Each carrier gives one dispatch. Collect ' +
          quest.count +
          ' different dispatches. If caught, return to the scout from the safe spot and re-cloak.',
      );
      for (const g of SHADOW_GUARDS)
        if (!g.sentry) point('Dispatch carrier ' + coords(g.npc.pos), g.npc.pos, 2);
      point('Safe spot after capture', SHADOW_SAFE_SPOT, 3);
      break;
    }
    case 'wisp_maze': {
      const maze = WISP_MAZE_LAYOUT;
      instructions.push(
        'Start a maze run with the keeper. Walk through the center of each of its ' +
          maze.openCells.length +
          ' open cells to collect every coin purse and radiant wisp. Normal has ' +
          WISP_MAZE_PROFILES.normal.enemyCount +
          ' guardians and ' +
          WISP_MAZE_PROFILES.normal.powerSeconds +
          ' sec of power per wisp. Hard has ' +
          WISP_MAZE_PROFILES.hard.enemyCount +
          ' guardians and ' +
          WISP_MAZE_PROFILES.hard.powerSeconds +
          ' sec of power. Touch a guardian while powered to banish it.',
      );
      instructions.push(
        'Unprotected contact costs a life and returns you to the entrance. After three lost lives the lives reset, but your collected purses remain. The last pickup completes the quest.',
      );
      for (const cell of [maze.spawnCell, ...maze.powerCells]) {
        const p = wispMazeCellCenter(cell);
        point(
          cell === maze.spawnCell ? 'Maze entry' : 'Radiant wisp',
          { x: WISP_MAZE_SITE.x + p.x, z: WISP_MAZE_SITE.z + p.z },
          2,
        );
      }
      break;
    }
    default: {
      const unhandled: never = obj;
      throw Error('Missing world quest route ' + JSON.stringify(unhandled));
    }
  }
  if (points.length === 1)
    point('Complete the activity inside this circle', quest.area, 1, quest.area.radius);
  instructions.push('Completion pays automatically. There is no hand-in NPC.');
  return { instructions, alternatives, points, extraMaps };
}

export function worldRoute(quest: WorldQuestDef) {
  const { instructions, alternatives, points, extraMaps } = worldRouteData(quest);
  return (
    [...instructions, ...alternatives].map((s) => '* ' + s).join('\n') +
    '\n\n' +
    questMap({ points }) +
    extraMaps.join('\n')
  );
}

// Physical travel can cross several private rooms before a credited raid boss.
// A room's doorPos is only an overworld pin when overworldDoor is enabled.
export function entranceRoute(dest: DungeonDef): DungeonDef[] {
  const path = [dest];
  while (path[0].overworldDoor === false) {
    const inside = path[0];
    const parent = DUNGEON_LIST.find(
      (d) => !path.includes(d) && d.objects?.some((o) => o.dungeonId === inside.id),
    );
    if (!parent) throw Error('No physical entrance to weekly destination ' + dest.id);
    path.unshift(parent);
  }
  return path;
}
export function weeklyRoute(quest: WeeklyQuestDef) {
  const npc = WEEKLY_EMISSARY_NPC_DEF;
  const points: RoutePoint[] = [{ step: 'Start', label: npc.name, frame: 'Overworld', ...npc.pos }];
  let detail = '';
  if (quest.kind === 'dungeons' || quest.kind === 'raid') {
    const routes: string[] = [];
    for (const [bossId, dungeonId] of Object.entries(FINAL_BOSS_DUNGEONS)) {
      const raid =
        DAILY_LOCKOUT_RAID_ROOMS.has(dungeonId) || WEEKLY_LOCKOUT_RAID_ROOMS.has(dungeonId);
      if (raid !== (quest.kind === 'raid')) continue;
      const destination = DUNGEON_LIST.find((d) => d.id === dungeonId)!;
      const bossName = MOBS[bossId].name;
      const route = entranceRoute(destination);
      const first = route[0];
      points.push({
        step: 1,
        frame: 'Overworld',
        label: 'Enter ' + first.name + ' for ' + bossName,
        ...first.doorPos,
      });
      for (let i = 1; i < route.length; i++) {
        const parent = route[i - 1],
          gate = parent.objects?.find((o) => o.dungeonId === route[i].id);
        if (gate)
          points.push({
            step: i + 1,
            frame: parent.name,
            label: gate.name + ' to ' + route[i].name,
            x: gate.x,
            z: gate.z,
          });
      }
      const spawn = destination.spawns.find((s) => s.mobId === bossId);
      if (spawn)
        points.push({
          step: route.length + 1,
          frame: destination.name,
          label: 'Defeat ' + bossName,
          x: spawn.x,
          z: spawn.z,
        });
      routes.push(route.map((d) => d.name).join(' → ') + ' → ' + bossName);
    }
    detail =
      'Earn ' +
      quest.count +
      ' final-boss clear' +
      (quest.count === 1 ? '' : 's') +
      '. Each listed kill gives one credit to its eligible clear roster. Normal and Heroic both count. ' +
      (quest.kind === 'raid'
        ? 'For Nythraxis, credit uses the room roster. Either Crucible boss room also qualifies independently. '
        : '') +
      'Choose any listed route:\n' +
      routes.map((r) => '* ' + r).join('\n') +
      '\n';
  } else if (quest.kind === 'worldboss') {
    for (const boss of WORLD_BOSSES)
      points.push({ step: 1, frame: 'Overworld', label: MOBS[boss.templateId].name, ...boss.pos });
    detail = 'Contribute to defeating a scheduled world boss at one of the marked spawns.';
  } else
    detail =
      'Join the battleground queue and finish ' +
      quest.count +
      ' matches. Wins and losses both count. The queue takes you into the match.';
  return (
    'Speak to ' +
    npc.name +
    ' beside the Weekly Vault to choose one charge for the week. ' +
    detail +
    ' The purse and cache are awarded on completion. If your bags are full, Ravenpost delivers the cache. Choose a faction with standing headroom in the weekly window to claim the commendation. A finished, unclaimed commendation carries over at reset and blocks a new charge until you claim it. No return trip is required.\n\n' +
    questMap({ points })
  );
}
