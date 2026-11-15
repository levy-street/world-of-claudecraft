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
    { step: 'Start', frame: 'Overworld', label: 'Walk into the active quest area', ...quest.area },
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
    instructions.push('Talk to ' + npc.name + ' at ' + coords(npc.pos) + ' to start the activity.');
  }
  switch (obj.type) {
    case 'kill':
      instructions.push(
        'Defeat ' +
          quest.count +
          ' ' +
          MOBS[obj.targetMobId].name +
          '. You and the enemy must both be inside the marked area. You must get credit for the kill. If a group member has died and released their spirit, the game checks where their body is. Camp pins show where the enemies can appear.',
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
        'Pick up cargo at marker 1. Carry it to marker 2, then interact to unload it. Each pickup spot only counts once. Cargo makes you move 25% slower. You lose it if you die, disconnect or leave the area. Keep going with different pickup spots until you have delivered ' +
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
          ' nodes inside the area until the counter gets to ' +
          quest.count +
          '.',
      );
      break;
    case 'interact':
      objects(obj.targetObjectItemId, 1);
      instructions.push(
        'Use the marked objects inside the ring until you have ' + quest.count + ' credits.',
      );
      break;
    case 'salvage':
      instructions.push(
        'Recover ' +
          quest.count +
          ' different pieces from around the shipwreck. Only one arrangement of pieces is out each week, so collect the ones you can see. Each spot only counts once. After ' +
          FARSHORE_SALVAGE_AMBUSH.triggerCount +
          ' pickups, an optional raider ambush can open at ' +
          coords(FARSHORE_SALVAGE_AMBUSH.portal) +
          '. The ambush does not change your piece counter.',
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
        'Use the caravan to start it moving. Follow it along the numbered waypoints. Keep it alive through ' +
          escort.ambushes.length +
          ' ambushes. At the final waypoint, you must be alive and within ' +
          escort.creditRadius +
          ' yd of it to get credit.',
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
        'Climb into the cannon. Aim a little ahead of the enemies coming toward you, because shots take time to land. Hold the line through ' +
          CANNON_WAVES.length +
          ' waves. Then kill the final commander (' +
          CANNON_ENEMIES.commander.hp +
          ' health). The wall’s integrity must still be above zero at the end. If the commander gets through, you fail, even if the wall is still standing. After you get the reward, endless waves begin.',
      );
      for (const [action, shot] of Object.entries(CANNON_ACTIONS))
        instructions.push(
          action[0].toUpperCase() +
            action.slice(1) +
            ' deals ' +
            shot.damage +
            ' base damage to enemies within ' +
            shot.radius +
            ' yd. It lands after ' +
            shot.flightTicks / TICK_RATE +
            ' sec. It is ready again after ' +
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
        'Read both the Standing Orders and the Watch Ledger. Then talk to all four suspects. Go back to ' +
          INVESTIGATION_NPCS[0].name +
          ' and blame the guard whose story does not match the clues. If you guess wrong, that guard is crossed off the list. Then defeat your own unmasked spy (infiltrator) within 180 sec. You and the spy must both be inside the quest area.',
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
          ' sec timer. Each press turns one tile a quarter turn clockwise. Link the source through tiles that touch, so the beam leaves the target tile on its marked side. If time runs out, start the board again. Solving the first board finishes the quest. The charged bonus boards after it are optional.',
      );
      break;
    case 'match3':
      objects(obj.activationObjectItemId, 1);
      instructions.push(
        'Open the sweets board. Swap two pieces that sit side by side or one above the other. Make a straight line of three or more matching pieces. Every piece you clear counts toward the ' +
          quest.count +
          ' you need. This includes pieces cleared by a chain reaction (cascade). A move is only used when the swap works. If you run out of moves for the day, restart the board. Restarting resets its tiles, your moves and your cleared-piece count.',
      );
      break;
    case 'forging':
      for (const station of FORGE_STATIONS)
        if (station.id === 'tools' || station.id === 'fuel')
          point(station.name, station, station.id === 'fuel' ? 2 : 3);
      instructions.push(
        'Feed the fire with firewood and strike the anvil ' +
          FORGE_STRIKES +
          ' times. Each strike must happen while the moving needle is in the target band and the heat is at least ' +
          FORGE_HEAT_FLOOR +
          '. Firewood adds ' +
          FORGE_STOKE_HEAT +
          ' heat, up to 100. You can add firewood once every ' +
          FORGE_STOKE_COOLDOWN +
          ' sec. Heat falls by ' +
          FORGE_HEAT_DECAY +
          ' each second. The ingot crate and the well are just for show.',
      );
      instructions.push(
        'A strike that is too cold or at the wrong time counts as one mistake. ' +
          FORGE_MAX_MISTAKES +
          ' mistakes end the run. For medals, ' +
          FORGE_WRONG_PENALTY +
          ' sec is added to your time for each mistake. Gold needs a time of ' +
          FORGE_GOLD_SECONDS +
          ' sec or less, and Silver needs ' +
          FORGE_SILVER_SECONDS +
          ' sec or less. Any successful run earns credit, with or without a medal.',
      );
      break;
    case 'glider': {
      point('Launch position', GLIDER_LAUNCH_SITE.playerLaunch);
      const names = ['Windrider Slalom', 'Valleys', 'Switchbacks'];
      instructions.push(
        'Pick one course and wait for the countdown. Fly through its rings in the order listed. Before time runs out, glide down onto the landing pad. You must be inside the pad’s circle and within 3 yd of the ground. You only get the reward for a winning flight while the quest is active and you have not been paid for it yet. Flights after that are just practice.',
      );
      GLIDER_COURSES.forEach((course, i) => {
        const pad = course.landingPad;
        alternatives.push(
          names[i] +
            ' · ' +
            course.minRings +
            ' rings needed. Gold ' +
            course.medals?.goldSeconds +
            ' sec, Silver ' +
            course.medals?.silverSeconds +
            ' sec, timeout ' +
            course.medals?.timeoutSeconds +
            ' sec. The course map shows how high each ring is, next to its spot on the ground.',
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
        'Talk to the instructor to start each round. Remember the shape you are shown. Go to the starting mark. Then walk along the lines of the shape, either way around, and come back to the start. Stay within ' +
          WORLD_QUEST_TRACE_TOLERANCE +
          ' yd of each line. Fighting or leaving the ground can make you fail. You have ' +
          WORLD_QUEST_TRACE_RUN_SECONDS +
          ' sec for each drawing.',
      );
      instructions.push(
        'Draw the triangle, then the square, then the harder shape you are given. The last shape depends on the student and the quest rotation. Finishing all three shapes earns credit, with or without a medal.',
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
        'Borrow the cloak. Sneak up behind a dispatch carrier, within 2.5 yd. When you are under ' +
          100 * SHADOW_STEAL_SUSPICION_LIMIT +
          '% suspicion, use Pickpocket. Then stay still for 1 sec, out of the lantern beams. Each carrier gives one dispatch. Collect ' +
          quest.count +
          ' different dispatches. If you are caught, go from the safe spot back to the scout and put the cloak on again.',
      );
      for (const g of SHADOW_GUARDS)
        if (!g.sentry) point('Dispatch carrier ' + coords(g.npc.pos), g.npc.pos, 2);
      point('Safe spot after capture', SHADOW_SAFE_SPOT, 3);
      break;
    }
    case 'wisp_maze': {
      const maze = WISP_MAZE_LAYOUT;
      instructions.push(
        'Talk to the keeper to start a maze run. Walk through the middle of each of its ' +
          maze.openCells.length +
          ' open squares to pick up every coin purse and radiant wisp. Normal has ' +
          WISP_MAZE_PROFILES.normal.enemyCount +
          ' guardians and ' +
          WISP_MAZE_PROFILES.normal.powerSeconds +
          ' sec of power for each wisp. Hard has ' +
          WISP_MAZE_PROFILES.hard.enemyCount +
          ' guardians and ' +
          WISP_MAZE_PROFILES.hard.powerSeconds +
          ' sec of power. While you have power, touch a guardian to send it away.',
      );
      instructions.push(
        'Touching a guardian without power costs a life and sends you back to the entrance. After you lose three lives, your lives refill, and you keep the purses you picked up. Picking up the last purse or wisp finishes the quest.',
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
    point('Do the activity inside this circle', quest.area, 1, quest.area.radius);
  instructions.push('You get paid as soon as you finish. You do not need to go back to anyone.');
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
/** `bossLink` names the final boss in each route line; a bare boss name can match a quest page of the same name. */
export function weeklyRoute(
  quest: WeeklyQuestDef,
  bossLink: (mobId: string, name: string) => string = (_id, name) => name,
) {
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
      routes.push(route.map((d) => d.name).join(' → ') + ' → ' + bossLink(bossId, bossName));
    }
    detail =
      'Earn ' +
      quest.count +
      ' final-boss clear' +
      (quest.count === 1 ? '' : 's') +
      '. Each kill listed here gives one credit to every player on the clear list who can get it. Normal and Heroic both count. ' +
      (quest.kind === 'raid'
        ? 'For Nythraxis, credit goes to the players in the room. Each Crucible boss room also counts on its own. '
        : '') +
      'Pick any route below:\n' +
      routes.map((r) => '* ' + r).join('\n') +
      '\n';
  } else if (quest.kind === 'worldboss') {
    for (const boss of WORLD_BOSSES)
      points.push({ step: 1, frame: 'Overworld', label: MOBS[boss.templateId].name, ...boss.pos });
    detail = 'Help defeat a world boss when it appears at one of the marked spots.';
  } else
    detail =
      'Join the battleground queue and finish ' +
      quest.count +
      ' matches. Wins and losses both count. The queue takes you to the match.';
  return (
    'Talk to ' +
    npc.name +
    ' next to the Weekly Vault and choose one charge for the week. ' +
    detail +
    (detail.endsWith('\n') ? '' : ' ') +
    'You get the purse and cache when you finish. If your bags are full, Ravenpost sends you the cache. To claim the commendation, pick a faction in the weekly window that can still give you more standing. If you finish but do not claim the commendation, it waits for you after the reset. You cannot pick a new charge until you claim it. You do not need to go back to anyone.\n\n' +
    questMap({ points })
  );
}
