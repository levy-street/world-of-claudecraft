import type { SimContext } from './sim_context';

const IGNIVAR_DUNGEON_ID = 'ignivar_raid_arena';
const IGNIVAR_DEV_BOT_COUNT = 9;
const IGNIVAR_DEV_POD_SIZE = 3;
const IGNIVAR_DEV_POD_CENTER_RADIUS = 25;
const IGNIVAR_DEV_POD_MEMBER_RADIUS = 2.8;
const IGNIVAR_DEV_POD_ANGLES = [(7 * Math.PI) / 6, (11 * Math.PI) / 6, Math.PI / 2] as const;

export type IgnivarDevRaidResult =
  | { ok: true; allies: number; reused: boolean }
  | { ok: false; message: string };

function botName(index: number): string {
  const pod = Math.floor(index / IGNIVAR_DEV_POD_SIZE) + 1;
  const member = (index % IGNIVAR_DEV_POD_SIZE) + 1;
  return `IgnivarG${pod}Bot${member}`;
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

  const expectedNames = Array.from({ length: IGNIVAR_DEV_BOT_COUNT }, (_, index) => botName(index));
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

  // The tester claimed the room while solo. Once the dev raid exists, transfer
  // that same live claim to its authoritative party key so re-entry and cleanup
  // continue to resolve to the room already on screen.
  instance.partyKey = `party:${party.id}`;
  instance.enteredBy.add(pid);
  const origin = ctx.instanceOriginOf(instance);

  for (let index = 0; index < botPids.length; index++) {
    const botPid = botPids[index];
    ctx.setPlayerLevel(20, botPid);
    const botMeta = ctx.players.get(botPid);
    if (botMeta) botMeta.devAnchored = true;
    const bot = ctx.entities.get(botPid);
    if (!bot) continue;
    const podIndex = Math.floor(index / IGNIVAR_DEV_POD_SIZE);
    const memberIndex = index % IGNIVAR_DEV_POD_SIZE;
    const podAngle = IGNIVAR_DEV_POD_ANGLES[podIndex];
    const memberAngle = -Math.PI / 2 + (memberIndex / IGNIVAR_DEV_POD_SIZE) * Math.PI * 2;
    const podX = origin.x + Math.cos(podAngle) * IGNIVAR_DEV_POD_CENTER_RADIUS;
    const podZ = origin.z + Math.sin(podAngle) * IGNIVAR_DEV_POD_CENTER_RADIUS;
    bot.pos = ctx.groundPos(
      podX + Math.cos(memberAngle) * IGNIVAR_DEV_POD_MEMBER_RADIUS,
      podZ + Math.sin(memberAngle) * IGNIVAR_DEV_POD_MEMBER_RADIUS,
    );
    bot.prevPos = { ...bot.pos };
    bot.vx = 0;
    bot.vz = 0;
    bot.targetId = null;
    bot.autoAttack = false;
    bot.castingAbility = null;
    bot.castRemaining = 0;
    bot.castTotal = 0;
    bot.castTargetId = null;
    bot.castAim = null;
    bot.inCombat = false;
    bot.devGod = false;
    bot.profilerInvulnerable = true;
    bot.hp = bot.maxHp;
    bot.resource = bot.maxResource;
    ctx.rebucket(bot);
    instance.enteredBy.add(botPid);
  }

  return { ok: true, allies: botPids.length, reused };
}
