// Deterministic dev-only finder scenarios, extracted verbatim from Sim.
import { FINDER_ACTIVITIES } from '../content/dungeon_finder';
import type { Role } from '../content/talents';
import { FIRST_TALENT_LEVEL, TALENTS } from '../content/talents';
import type { Sim } from '../sim';
import type { SimContext } from '../sim_context';
import type { PlayerClass } from '../types';

type FinderDevHost = Pick<
  Sim,
  | 'players'
  | 'entities'
  | 'addPlayer'
  | 'groundPos'
  | 'rebucket'
  | 'setPlayerLevel'
  | 'setSpec'
  | 'dungeonFinderSetRoles'
  | 'dungeonFinderListingCreate'
  | 'dungeonFinderInfoFor'
  | 'dungeonFinderApply'
  | 'dungeonFinderQueueJoin'
>;

export function seedDungeonFinderDev(
  host: FinderDevHost,
  ctx: SimContext,
  mode: 'queue' | 'raid' | 'board',
  pid?: number,
): { spawned: number; note: 'ok' | 'needRoles' | 'noneEligible' } {
  const r = ctx.resolve(pid);
  if (!r) return { spawned: 0, note: 'noneEligible' };
  const id = r.meta.entityId;
  const level = host.entities.get(id)?.level ?? 1;
  let spawnSeq = 0;
  const spawnBot = (cls: PlayerClass, role: Role, baseName: string): number => {
    let name = baseName;
    for (let n = 2; ; n++) {
      const taken = [...host.players.values()].some(
        (m) => m.name.toLowerCase() === name.toLowerCase(),
      );
      if (!taken) break;
      name = `${baseName}${n}`;
    }
    const botPid = host.addPlayer(cls, name, { bot: true });
    const meta = host.players.get(botPid);
    if (meta) meta.isDevBot = true;
    spawnSeq++;
    const e = host.entities.get(botPid);
    const me = host.entities.get(id);
    if (e && me) {
      e.pos = host.groundPos(me.pos.x + 2 + spawnSeq, me.pos.z + 2 + (spawnSeq % 3));
      e.prevPos = { ...e.pos };
      host.rebucket(e);
    }
    host.setPlayerLevel(level, botPid);
    if (level >= FIRST_TALENT_LEVEL) {
      const spec = TALENTS[cls]?.specs.find((s) => s.role === role);
      if (spec) host.setSpec(spec.id, botPid);
    }
    host.dungeonFinderSetRoles([role], botPid);
    return botPid;
  };
  const inBand = (a: (typeof FINDER_ACTIVITIES)[number]) =>
    level >= a.minLevel && level <= a.maxLevel;
  const BOT_KITS: Record<Role, { cls: PlayerClass; name: string }> = {
    tank: { cls: 'warrior', name: 'Tankbot' },
    healer: { cls: 'priest', name: 'Healbot' },
    dps: { cls: 'mage', name: 'Dpsbot' },
  };

  if (mode === 'board') {
    const listable = FINDER_ACTIVITIES.filter(inBand);
    if (listable.length === 0) return { spawned: 0, note: 'noneEligible' };
    let spawned = 0;
    const lister1 = spawnBot('paladin', 'tank', 'Listerbot');
    spawned++;
    host.dungeonFinderListingCreate(listable[0].id, ['learning'], lister1);
    const lister2 = spawnBot('shaman', 'healer', 'Callerbot');
    spawned++;
    host.dungeonFinderListingCreate(
      (listable[1] ?? listable[0]).id,
      ['fast_run', 'full_clear'],
      lister2,
    );
    const mine = host.dungeonFinderInfoFor(id)?.myListing;
    if (mine) {
      const applicant = spawnBot('rogue', 'dps', 'Seekerbot');
      spawned++;
      host.dungeonFinderApply(mine.id, applicant);
    }
    return { spawned, note: 'ok' };
  }

  const size = mode === 'raid' ? 10 : 5;
  const activityIds = FINDER_ACTIVITIES.filter(
    (a) => a.autoQueue && a.size === size && inBand(a),
  ).map((a) => a.id);
  if (activityIds.length === 0) return { spawned: 0, note: 'noneEligible' };
  const myRoles = host.dungeonFinderInfoFor(id)?.roles ?? [];
  if (myRoles.length === 0) return { spawned: 0, note: 'needRoles' };
  const slots: Role[] =
    mode === 'raid'
      ? ['tank', 'tank', 'healer', 'healer', 'dps', 'dps', 'dps', 'dps', 'dps', 'dps']
      : ['tank', 'healer', 'dps', 'dps', 'dps'];
  // Leave exactly one slot open that the caller's first selected role fills.
  slots.splice(slots.indexOf(myRoles[0]), 1);
  let spawned = 0;
  for (const role of slots) {
    const kit = BOT_KITS[role];
    const botPid = spawnBot(kit.cls, role, kit.name);
    spawned++;
    host.dungeonFinderQueueJoin(activityIds, botPid);
  }
  return { spawned, note: 'ok' };
}
