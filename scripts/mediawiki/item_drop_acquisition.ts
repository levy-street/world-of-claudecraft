import { THATCHGRIN_ID } from '../../src/sim/content/gourdlight_eve_scarecrow';
import { HEROIC_BOSS_LOOT } from '../../src/sim/content/heroic_loot';
import { RIFT_THEMES } from '../../src/sim/content/rift/themes';
import { DUNGEON_LIST, getActiveWorldContent, ITEMS, MOBS, QUESTS } from '../../src/sim/data';
import { heroicLootItemId } from '../../src/sim/loot/heroic_item';
import { resolveScarecrowField } from '../../src/sim/seasonal/scarecrow_field';
import { WORLD_BOSSES } from '../../src/sim/world_boss';
import { WORLD_SEED } from '../../src/sim/world_seed';
import { type ArticleTools, pct, ref } from './entity_format';
import { addAcquisition, classUseNote, type ItemAcquisition } from './item_acquisition_types';
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
          label: name + ' camp: loot its body where it falls',
        });
      const boss = WORLD_BOSSES.find((b) => b.templateId === id);
      if (boss)
        points.push({
          step: 2,
          frame: 'Overworld',
          ...boss.pos,
          label: name + ': appears here at set times',
        });
      if (id === THATCHGRIN_ID) {
        const field = resolveScarecrowField(WORLD_SEED);
        if (field)
          points.push({
            step: 2,
            frame: 'Overworld',
            x: field.x,
            z: field.z,
            label: name + ': seasonal event fight',
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
          label: name + ': loot its body here',
        });
      for (const o of d.objects?.filter((o) => o.itemId === relicSummons[id]) ?? [])
        points.push({
          step: 2,
          frame: d.name,
          x: o.x,
          z: o.z,
          label: 'Use ' + o.name + ' to summon ' + name + ', then defeat and loot it nearby',
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
            : instanced
              ? 'Normal and Heroic'
              : 'ordinary';
        const where = ref(w, 'mob', mob.id);
        const row = mode.entries.filter((e) => e.rollGroup === entry.rollGroup);
        const rules = [
          `${entry.rollGroup ? `Base chance: ${pct(entry.chance)}. This item shares one loot slot with other items.` : `Drop chance: ${pct(entry.chance)} each time you defeat it and can loot it.`} Each drop gives one item.`,
        ];
        if (entry.rollGroup) {
          const total = row.reduce((n, e) => n + e.chance, 0);
          // The class-lock reweight (src/sim/loot/class_locked_drop.ts) only touches
          // soulbound, class-restricted rows; say so only where such a row exists.
          const locked = row.some((e) =>
            [e.itemId, e.itemId && heroicLootItemId(e.itemId, mode.heroic)].some((rowId) => {
              const def = rowId ? ITEMS[rowId] : undefined;
              return !!def?.soulbound && !!def.requiredClass?.length;
            }),
          );
          rules.push(
            `The game rolls once for this slot, so at most one of its ${row.length} entries drops. Added together, the chances of everything in the slot come to ${pct(Math.min(1, total))}.`,
            ...(locked
              ? [
                  `Some items in this slot are soulbound and only for certain classes. An item like that is taken out of the slot first if nobody who can loot this kill plays a class that can use it. The chances of the entries left then grow to fill the gap. To work out this item's new chance, multiply its base chance by ${Number(total.toFixed(8))}, then divide by the base chances of the entries left, added together.`,
                ]
              : []),
            'Sometimes another slot on the same kill has already given out the item this slot picked. Then this slot moves on through its list and gives the next item that has not dropped yet. This can make that next item a little more likely. These chances are for the slot, not your chance of winning a party loot roll.',
          );
        }
        if (mob.worldBoss)
          rules.push(
            'This world boss rolls loot separately for each player who helped and can get its loot. Each of you gets your own loot on its body. Take yours before the body disappears. Taking your loot uses up your loot lockout for this boss.',
          );
        else if (!entry.questId)
          rules.push(
            'When the item drops, it appears on the body. If more than one player can loot it, your party loot rules decide who gets it.',
          );
        if (entry.questId)
          rules.push(
            'It only drops while ' +
              ref(w, 'quest', entry.questId) +
              ' is in your quest log and you still need more of this item for it. When it drops, every player who can loot it and still needs it gets their own copy.',
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
          rules.push(
            'You do not get it if you already have one in your bags, bank or courier cargo.',
          );
        if (mob.worldBoss && entry.unlessOwnedItem)
          rules.push(
            'You do not get it while you have ' +
              ref(w, 'item', entry.unlessOwnedItem) +
              ' in your bags, bank or courier cargo.',
          );
        if (mob.worldBoss && entry.maxPlayerLevel !== undefined)
          rules.push('Only characters at level ' + entry.maxPlayerLevel + ' or lower can get it.');
        const classNote = classUseNote(w, ITEMS[id]);
        if (classNote) rules.push(classNote);
        let points = routeCache.get(mode.heroic);
        if (!points) {
          points = locations(mob.id, mode.heroic);
          routeCache.set(mode.heroic, points);
        }
        const riftThemes = RIFT_THEMES.filter((t) => t.boss === mob.id || t.trash.includes(mob.id));
        if (riftThemes.length)
          rules.push(
            'This creature shows up on rift floors with these themes: ' +
              riftThemes.map((t) => t.name).join(', ') +
              '. Rift floors are made fresh for each run, so the portal you use and where things are on each floor change every time.',
          );
        const conditions = [
          ...(mode.heroic
            ? [
                'Before you go in, set the difficulty to Heroic. You also need to meet its entry requirements.',
              ]
            : shifted || entry.normalOnly
              ? ['Play on Normal difficulty to get this version.']
              : []),
          ...(entry.questId
            ? [
                'Accept ' +
                  ref(w, 'quest', entry.questId) +
                  '. Do not finish collecting its items yet.',
              ]
            : []),
        ].join(' ');
        addAcquisition(result, id, {
          title: 'Defeat ' + where + ' (' + modeLabel + ' drop)',
          steps: [
            (conditions ||
              (riftThemes.length
                ? 'When your realm announces a rift, go to its portal and enter the rift. Find this creature on a floor with a matching theme. See [[Rifts]] and [[Rift floors]].'
                : 'Find ' + where + ' at one of the places on the map.')) +
              (points.length
                ? ' The map shows each place it can appear, and any doors you go through to get there.'
                : ' See the creature page to learn where it appears or what makes it show up.'),
            (relicSummons[mob.id]
              ? 'While The Sealed Crypt is active, click the relic shown on the map to summon its guardian. '
              : '') +
              'Defeat ' +
              where +
              ', and make sure you are allowed to loot it. ' +
              (mob.worldBoss ? 'If it is not there, wait for the time it is set to appear.' : ''),
            'Open its body and take ' +
              ref(w, 'item', id) +
              '. ' +
              (!mob.worldBoss && !entry.questId
                ? 'If a party loot roll pops up, choose Need, Greed or Pass, following your group’s loot rules.'
                : ''),
          ],
          details: rules,
          points,
        });
      }
  }
  return result;
}
