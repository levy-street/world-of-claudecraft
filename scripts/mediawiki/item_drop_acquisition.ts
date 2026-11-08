import { THATCHGRIN_ID } from '../../src/sim/content/gourdlight_eve_scarecrow';
import { HEROIC_BOSS_LOOT } from '../../src/sim/content/heroic_loot';
import { RIFT_THEMES } from '../../src/sim/content/rift/themes';
import { DUNGEON_LIST, getActiveWorldContent, ITEMS, MOBS, QUESTS } from '../../src/sim/data';
import { heroicLootItemId } from '../../src/sim/loot/heroic_item';
import { resolveScarecrowField } from '../../src/sim/seasonal/scarecrow_field';
import { WORLD_BOSSES } from '../../src/sim/world_boss';
import { WORLD_SEED } from '../../src/sim/world_seed';
import { type ArticleTools, pct, ref } from './entity_format';
import { addAcquisition, type ItemAcquisition } from './item_acquisition_types';
import type { RoutePoint } from './quest_map';
import { questRoute } from './quest_route';
import { entranceRoute } from './rotating_routes';

export function dropAcquisitions(w: ArticleTools): Map<string, ItemAcquisition[]> {
  const result = new Map<string, ItemAcquisition[]>();
  const world = getActiveWorldContent();
  // activateNythraxisRelic in encounters/nythraxis.ts summons these guardians.
  const relicSummons: Record<string, string> = {
    fallen_captain_aldren: 'captains_crest',
    corrupted_priest_malric: 'priests_sigil',
    deathstalker_voss: 'royal_seal',
  };
  const questRoutes = new Map<string, ReturnType<typeof questRoute>>();
  const locations = (id: string, heroic: boolean): RoutePoint[] => {
    const points: RoutePoint[] = [];
    const name = MOBS[id].name;
    if (!heroic) {
      for (const c of world.camps.filter((c) => c.mobId === id))
        points.push({
          step: 2,
          frame: 'Overworld',
          x: c.center.x,
          z: c.center.z,
          radius: c.radius,
          label: name + ' camp; loot its corpse where defeated',
        });
      const boss = WORLD_BOSSES.find((b) => b.templateId === id);
      if (boss)
        points.push({ step: 2, frame: 'Overworld', ...boss.pos, label: name + ' scheduled spawn' });
      if (id === THATCHGRIN_ID) {
        const field = resolveScarecrowField(WORLD_SEED);
        if (field)
          points.push({
            step: 2,
            frame: 'Overworld',
            x: field.x,
            z: field.z,
            label: name + ' seasonal encounter',
          });
      }
    }
    for (const d of DUNGEON_LIST.filter(
      (d) =>
        d.spawns.some((s) => s.mobId === id) ||
        (relicSummons[id] && d.objects?.some((o) => o.itemId === relicSummons[id])),
    )) {
      const path = entranceRoute(d),
        first = path[0];
      points.push({
        step: 'Start',
        frame: 'Overworld',
        ...first.doorPos,
        label: 'Entrance to ' + first.name,
      });
      for (let i = 1; i < path.length; i++) {
        const parent = path[i - 1],
          gate = parent.objects!.find((o) => o.dungeonId === path[i].id)!;
        points.push({
          step: 1,
          frame: parent.name,
          x: gate.x,
          z: gate.z,
          label: gate.name + ' to ' + path[i].name,
        });
      }
      for (const s of d.spawns.filter((s) => s.mobId === id))
        points.push({
          step: 2,
          frame: d.name,
          x: s.x,
          z: s.z,
          label: name + '; loot its corpse here',
        });
      for (const o of d.objects?.filter((o) => o.itemId === relicSummons[id]) ?? [])
        points.push({
          step: 2,
          frame: d.name,
          x: o.x,
          z: o.z,
          label:
            'Activate ' + o.name + ' to summon ' + name + '; defeat and loot the guardian nearby',
        });
    }
    if (!points.length) {
      for (const q of Object.values(QUESTS))
        for (const [i, o] of q.objectives.entries()) {
          const targetsCreature = o.type === 'kill' && o.targetMobId === id;
          const targetsDrop =
            o.type === 'collect' && MOBS[id].loot.some((e) => e.itemId === o.itemId);
          if (!targetsCreature && !targetsDrop) continue;
          let route = questRoutes.get(q.id);
          if (!route) {
            route = questRoute(q);
            questRoutes.set(q.id, route);
          }
          points.push(
            ...route.points
              .filter((p) => p.step === i + 1)
              .map((p) => ({ ...p, step: 2, label: name + ' · ' + p.label })),
          );
        }
    }
    return points;
  };
  for (const mob of Object.values(MOBS)) {
    const instanced = DUNGEON_LIST.some((d) => d.spawns.some((s) => s.mobId === mob.id));
    const modes = [
      { entries: mob.loot, heroic: false, extra: false },
      ...(instanced
        ? [
            { entries: mob.loot, heroic: true, extra: false },
            { entries: HEROIC_BOSS_LOOT[mob.id] ?? [], heroic: true, extra: true },
          ]
        : []),
    ];
    const routeCache = new Map<boolean, RoutePoint[]>();
    for (const mode of modes)
      for (const entry of mode.entries) {
        if (!entry.itemId || (mode.heroic && entry.normalOnly)) continue;
        if (
          entry.questId &&
          !QUESTS[entry.questId]?.objectives.some(
            (o) => o.type === 'collect' && o.itemId === entry.itemId,
          )
        )
          continue;
        const id = heroicLootItemId(
          entry.itemId,
          mode.heroic && !mode.extra && !entry.questId && !entry.normalOnly,
        );
        if (!ITEMS[id]) continue;
        // An unchanged drop occurs in both modes; list its common row once.
        if (mode.heroic && !mode.extra && id === entry.itemId && !entry.normalOnly) continue;
        const shifted =
          instanced &&
          !entry.questId &&
          !entry.normalOnly &&
          heroicLootItemId(entry.itemId, true) !== entry.itemId;
        const modeLabel = mode.heroic
          ? 'Heroic'
          : entry.normalOnly || shifted
            ? 'Normal'
            : 'ordinary';
        const where = ref(w, 'mob', mob.id);
        const row = mode.entries.filter((e) => e.rollGroup === entry.rollGroup);
        const rules = [
          `Base chance is ${pct(entry.chance)} ${entry.rollGroup ? 'for this entry in one shared loot slot' : 'per eligible kill'}. Each successful entry supplies one item.`,
        ];
        if (entry.rollGroup) {
          const total = row.reduce((n, e) => n + e.chance, 0);
          rules.push(
            `This slot shares one roll across ${row.length} entries, with a total drop chance of ${pct(Math.min(1, total))}. Soulbound class-locked entries unusable by the eligible group are removed. For a retained entry, multiply its base chance by ${Number(total.toFixed(8))} divided by the sum of retained chances.`,
            'If another slot on this kill already awarded the selected item, the roll moves forward through this pool to the next item not already awarded. This can increase that next item’s final odds. These are per-slot chances, not your chance of winning a party loot roll.',
          );
        }
        if (mob.worldBoss)
          rules.push(
            'This world boss rolls personal loot separately for each eligible contributor. Loot your own corpse allocation before it despawns. Taking a personal reward uses the boss loot lockout.',
          );
        else if (!entry.questId)
          rules.push(
            'A successful roll puts the item on the corpse. Party loot rules decide who receives it when more than one player is eligible.',
          );
        if (entry.questId)
          rules.push(
            'Have ' +
              ref(w, 'quest', entry.questId) +
              ' active and still need this item for its collect objective. The successful roll supplies a personal copy to each eligible player who still needs it.',
          );
        if (entry.questId) {
          const q = QUESTS[entry.questId];
          const objective = q.objectives.findIndex(
            (o) => o.type === 'collect' && o.itemId === entry.itemId,
          );
          const route = questRoutes.get(q.id) ?? questRoute(q);
          questRoutes.set(q.id, route);
          rules.push(...route.notes.filter((n) => n.step === objective + 1).map((n) => n.text));
        }
        if (mob.worldBoss && entry.unlessOwned)
          rules.push('No award if you already keep this item in bags, bank or courier cargo.');
        if (mob.worldBoss && entry.unlessOwnedItem)
          rules.push(
            'No award while you keep ' +
              ref(w, 'item', entry.unlessOwnedItem) +
              ' in bags, bank or courier cargo.',
          );
        if (mob.worldBoss && entry.maxPlayerLevel !== undefined)
          rules.push('Only characters at level ' + entry.maxPlayerLevel + ' or below qualify.');
        if (ITEMS[id].requiredClass?.length)
          rules.push(
            'Class-locked to ' +
              ITEMS[id].requiredClass!.map((c) => ref(w, 'class', c)).join(', ') +
              '.',
          );
        let points = routeCache.get(mode.heroic);
        if (!points) {
          points = locations(mob.id, mode.heroic);
          routeCache.set(mode.heroic, points);
        }
        const riftThemes = RIFT_THEMES.filter((t) => t.boss === mob.id || t.trash.includes(mob.id));
        if (riftThemes.length)
          rules.push(
            'Appears on generated rift floors with these themes: ' +
              riftThemes.map((t) => t.name).join(', ') +
              '. The active portal and floor positions change between runs.',
          );
        const conditions = [
          ...(mode.heroic
            ? ['Set the instance to Heroic before entering and meet its entry requirements.']
            : shifted || entry.normalOnly
              ? ['Use Normal difficulty for this version.']
              : []),
          ...(entry.questId
            ? [
                'Accept ' +
                  ref(w, 'quest', entry.questId) +
                  ' and leave its collect objective unfinished.',
              ]
            : []),
        ].join(' ');
        addAcquisition(result, id, {
          title: 'Defeat ' + where + ' (' + modeLabel + ' drop)',
          steps: [
            (conditions ||
              (riftThemes.length
                ? 'Follow a realm rift announcement to its portal, enter the rift and find this creature on a matching floor. See [[Rifts]] and [[Rift floors]].'
                : 'Find ' + where + ' at one of the mapped locations.')) +
              (points.length
                ? ' The map shows alternative spawn sites and any approach doors.'
                : ' Follow the creature page for its spawn or encounter trigger.'),
            (relicSummons[mob.id]
              ? 'Click the mapped relic while The Sealed Crypt is active to summon its guardian. '
              : '') +
              'Defeat ' +
              where +
              ' while eligible for its loot. ' +
              (mob.worldBoss ? 'Wait for its scheduled appearance if it is absent.' : ''),
            'Open the corpse and take ' +
              ref(w, 'item', id) +
              '. ' +
              (!mob.worldBoss && !entry.questId
                ? 'If a party roll appears, choose Need, Greed or Pass according to your group’s loot rules.'
                : ''),
          ],
          details: rules,
          points,
        });
      }
  }
  return result;
}
