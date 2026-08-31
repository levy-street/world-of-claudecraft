import { DUNGEONS } from './data';
import { IGNIVAR_FORGE_APPROACH_ID, isIgnivarRaidRoom } from './ignivar_raid_ids';
import { resetRaidDevBot } from './raid_dev_bot';
import type { SimContext } from './sim_context';

const IGNIVAR_DUNGEON_ID = 'ignivar_raid_arena';
const IGNIVAR_DEV_BOT_COUNT = 9;
const IGNIVAR_DEV_POD_SIZE = 3;
const IGNIVAR_DEV_POD_CENTER_RADIUS = 25;
const IGNIVAR_DEV_POD_MEMBER_RADIUS = 2.8;
// Two bands of the ring are off limits: due north the boss waits on the
// central dais at IGNIVAR_BOSS_SPAWN_Z and every pod member must stay outside
// its automatic aggro radius (MAX_AGGRO_RADIUS) so forming the practice raid
// never pulls, and due south the pod would crowd the arena entry inside Brand
// range of an arriving tester. Math.PI / 6 is the widest remaining slot for
// the third pod: every pod pair stays 60+ degrees apart as seen from the
// boss, so no single frontal or skyfire cone can clip two pods at once.
const IGNIVAR_DEV_POD_ANGLES = [(7 * Math.PI) / 6, (11 * Math.PI) / 6, Math.PI / 6] as const;

export type IgnivarDevRaidResult =
  | { ok: true; allies: number; reused: boolean }
  | { ok: false; message: string };

const IGNIVAR_APPROACH_COLUMNS = [-8, 0, 8] as const;
const IGNIVAR_APPROACH_ROWS = [5, 9, 13] as const;

function botName(index: number): string {
  const pod = Math.floor(index / IGNIVAR_DEV_POD_SIZE) + 1;
  const member = (index % IGNIVAR_DEV_POD_SIZE) + 1;
  return `IgnivarG${pod}Bot${member}`;
}

function expectedBotNames(): string[] {
  return Array.from({ length: IGNIVAR_DEV_BOT_COUNT }, (_, index) => botName(index));
}

export type IgnivarDevRaidTravelRosterResult =
  | { ok: true; memberIds: number[] }
  | { ok: false; message: string };

/** Validates authority before a shortcut moves anyone between instances. */
export function ignivarDevRaidTravelRoster(
  ctx: SimContext,
  pid: number,
): IgnivarDevRaidTravelRosterResult {
  const party = ctx.partyOf(pid);
  if (!party) return { ok: true, memberIds: [pid] };
  const expectedLowerNames = new Set(expectedBotNames().map((name) => name.toLowerCase()));
  const sanctioned =
    party.raid &&
    party.leader === pid &&
    party.members.length === IGNIVAR_DEV_BOT_COUNT + 1 &&
    party.members.includes(pid) &&
    party.members.every((memberPid) => {
      if (memberPid === pid) return true;
      const meta = ctx.players.get(memberPid);
      return !!meta?.isDevBot && expectedLowerNames.has(meta.name.toLowerCase());
    });
  if (!sanctioned) {
    return {
      ok: false,
      message: 'Leave your current group before moving the Ignivar test raid.',
    };
  }
  return { ok: true, memberIds: [...party.members] };
}

/** Spreads the anchored practice roster behind the first trash pull. */
export function stageIgnivarDevRaidAtApproach(ctx: SimContext, pid: number): IgnivarDevRaidResult {
  const player = ctx.entities.get(pid);
  if (player?.kind !== 'player') return { ok: false, message: 'Player not found.' };
  const claimId = ctx.instanceClaimIdAt(player.pos);
  const instance = ctx.instances.find(
    (candidate) =>
      candidate.exitId === claimId &&
      candidate.partyKey !== null &&
      candidate.dungeonId === IGNIVAR_FORGE_APPROACH_ID,
  );
  if (!instance || instance.partyKey !== ctx.instanceKeyFor(pid)) {
    return { ok: false, message: 'Enter the Halls of the First Tempering first.' };
  }
  const party = ctx.partyOf(pid);
  if (!party?.raid || party.leader !== pid) {
    return { ok: false, message: 'The Ignivar practice raid is not available.' };
  }
  const entry = DUNGEONS[IGNIVAR_FORGE_APPROACH_ID]?.entry;
  if (!entry) return { ok: false, message: 'The Ignivar approach entry is unavailable.' };
  const origin = ctx.instanceOriginOf(instance);
  const stageX = origin.x + entry.x;
  const stageZ = origin.z + entry.z;
  const existingByName = new Map(
    [...ctx.players.values()].map((meta) => [meta.name.toLowerCase(), meta] as const),
  );
  const botPids = Array.from({ length: IGNIVAR_DEV_BOT_COUNT }, (_, index) =>
    existingByName.get(botName(index).toLowerCase()),
  );
  if (botPids.some((meta) => !meta?.isDevBot || !party.members.includes(meta.entityId))) {
    return { ok: false, message: 'The existing Ignivar test raid roster is incomplete.' };
  }
  for (let index = 0; index < botPids.length; index++) {
    const botPid = botPids[index]?.entityId;
    if (botPid === undefined) continue;
    const column = IGNIVAR_APPROACH_COLUMNS[index % IGNIVAR_APPROACH_COLUMNS.length];
    const row = IGNIVAR_APPROACH_ROWS[Math.floor(index / IGNIVAR_APPROACH_COLUMNS.length)];
    resetRaidDevBot(ctx, botPid, stageX + column, stageZ + row);
    instance.enteredBy.add(botPid);
  }
  return { ok: true, allies: IGNIVAR_DEV_BOT_COUNT, reused: true };
}

/**
 * Builds a deterministic, non-offensive raid roster for a solo Ignivar tester.
 * Three spread pods keep every bot outside Brand of the Pyre range while each
 * pod's three members remain inside Shared Pyre range. The tester joins the
 * marked pod as its fourth soaker. On Heroic, Forge Chains links all ten raid
 * members into five proximity pairs; standing beside a bot makes it the
 * tester's likely partner.
 * Bots remain stationary and invulnerable.
 */
export function setupIgnivarDevRaid(ctx: SimContext, pid: number): IgnivarDevRaidResult {
  const player = ctx.entities.get(pid);
  if (player?.kind !== 'player') return { ok: false, message: 'Player not found.' };

  const claimId = ctx.instanceClaimIdAt(player.pos);
  const instance = ctx.instances.find(
    (candidate) =>
      candidate.exitId === claimId &&
      candidate.partyKey !== null &&
      candidate.dungeonId === IGNIVAR_DUNGEON_ID,
  );
  if (!instance) {
    return {
      ok: false,
      message: 'Enter the Ignivar arena first with /dev dungeon ignivar_raid_arena normal|heroic.',
    };
  }
  if (instance.partyKey !== ctx.instanceKeyFor(pid)) {
    return { ok: false, message: 'This live Ignivar claim belongs to another group.' };
  }
  const priorPartyKey = instance.partyKey;

  const expectedNames = expectedBotNames();
  const expectedLowerNames = new Set(expectedNames.map((name) => name.toLowerCase()));
  const existingByName = new Map(
    [...ctx.players.values()].map((meta) => [meta.name.toLowerCase(), meta] as const),
  );
  for (const name of expectedNames) {
    const existing = existingByName.get(name.toLowerCase());
    if (existing && !existing.isDevBot) {
      return { ok: false, message: `The name ${name} is already used by a real player.` };
    }
  }

  const currentParty = ctx.partyOf(pid);
  if (currentParty) {
    const isReusableRaid =
      currentParty.raid &&
      currentParty.leader === pid &&
      currentParty.members.length === IGNIVAR_DEV_BOT_COUNT + 1 &&
      currentParty.members.every((memberPid) => {
        if (memberPid === pid) return true;
        const meta = ctx.players.get(memberPid);
        return !!meta?.isDevBot && expectedLowerNames.has(meta.name.toLowerCase());
      });
    if (!isReusableRaid) {
      return {
        ok: false,
        message: 'Leave your current group before creating the Ignivar test raid.',
      };
    }
  }

  const botPids: number[] = [];
  let reused = true;
  for (const name of expectedNames) {
    const existing = existingByName.get(name.toLowerCase());
    if (existing) {
      const botParty = ctx.partyOf(existing.entityId);
      if (botParty && botParty !== currentParty) {
        return { ok: false, message: `${name} is already assigned to another group.` };
      }
      botPids.push(existing.entityId);
      continue;
    }
    if (currentParty) {
      return { ok: false, message: 'The existing Ignivar test raid roster is incomplete.' };
    }
    const botPid = ctx.spawnDevBot(name);
    if (botPid < 0) return { ok: false, message: `Could not create ${name}.` };
    reused = false;
    botPids.push(botPid);
  }

  let party = currentParty;
  if (!party) {
    const units = [pid, ...botPids].map((memberPid) => ({
      partyId: null,
      leaderPid: memberPid,
      members: [memberPid],
    }));
    party = ctx.formDungeonFinderGroup(units, { raid: true });
    if (!party) return { ok: false, message: 'Could not form the Ignivar test raid.' };
  }

  // The tester may have walked through earlier floors while solo. Once the dev
  // raid exists, transfer that whole live claim family to its authoritative
  // party key so backward portals can still find every previous floor.
  const partyKey = `party:${party.id}`;
  for (const claim of ctx.instances) {
    if (claim.partyKey === priorPartyKey && isIgnivarRaidRoom(claim.dungeonId)) {
      claim.partyKey = partyKey;
    }
  }
  instance.enteredBy.add(pid);
  const origin = ctx.instanceOriginOf(instance);

  for (let index = 0; index < botPids.length; index++) {
    const botPid = botPids[index];
    const podIndex = Math.floor(index / IGNIVAR_DEV_POD_SIZE);
    const memberIndex = index % IGNIVAR_DEV_POD_SIZE;
    const podAngle = IGNIVAR_DEV_POD_ANGLES[podIndex];
    const memberAngle = -Math.PI / 2 + (memberIndex / IGNIVAR_DEV_POD_SIZE) * Math.PI * 2;
    const podX = origin.x + Math.cos(podAngle) * IGNIVAR_DEV_POD_CENTER_RADIUS;
    const podZ = origin.z + Math.sin(podAngle) * IGNIVAR_DEV_POD_CENTER_RADIUS;
    resetRaidDevBot(
      ctx,
      botPid,
      podX + Math.cos(memberAngle) * IGNIVAR_DEV_POD_MEMBER_RADIUS,
      podZ + Math.sin(memberAngle) * IGNIVAR_DEV_POD_MEMBER_RADIUS,
    );
    instance.enteredBy.add(botPid);
  }

  return { ok: true, allies: botPids.length, reused };
}
