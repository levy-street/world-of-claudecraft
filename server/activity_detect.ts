// The tick's significant-activity chain: the per-event else-if body of
// GameServer.detectActivity (the max-level ding, rare drops, masterwork and
// legendary professions cards, the golden harvest, duel and arena results,
// and the daily-reward delve observers), extracted from server/game.ts as a
// move-not-rewrite (server/CLAUDE.md module-first; the monolith ratchet): arm
// bodies and comments are verbatim, `this.X` became `deps.X`, and the loop's
// `continue` became `return` (the chain was the last statement of the loop
// body, so the two are equivalent). game.ts keeps the thin per-event delegate
// inside its one observer pass, beside the deed fan-out, telemetry, and FTUE
// arms whose shared per-tick state stays there.
import { ITEMS } from '../src/sim/data';
import { MAX_LEVEL, type SimEvent } from '../src/sim/types';
import { emitCraftActivityCard } from './craft_activity';
import { dailyRewardService } from './daily_rewards';
import { enqueueActivity } from './discord_activity';
import { REALM } from './realm';

// The session slice the chain reads. GameServer's ClientSession satisfies it
// structurally; the generic keeps deps.sendDailyRewardPointsGained typed
// against the caller's own session type rather than this narrowed view.
export interface ActivityDetectSession {
  accountId: number;
  characterId: number;
  name: string;
}

export interface ActivityDetectDeps<S extends ActivityDetectSession> {
  clients: { get(pid: number): S | undefined };
  profileUrlFor(name: string): string | null;
  sessionByName(name: string): S | null;
  sendDailyRewardPointsGained(session: S, points: number): void;
}

export function detectActivityEvent<S extends ActivityDetectSession>(
  ev: SimEvent,
  now: number,
  deps: ActivityDetectDeps<S>,
): void {
  if (ev.type === 'levelup' && ev.level === MAX_LEVEL && ev.pid !== undefined) {
    const s = deps.clients.get(ev.pid);
    if (!s) return;
    enqueueActivity(
      {
        kind: 'levelup',
        accountIds: [s.accountId],
        names: [s.name],
        realm: REALM,
        profileUrl: deps.profileUrlFor(s.name),
        level: ev.level,
      },
      `levelup:${s.accountId}`,
      now,
    );
  } else if (
    (ev.type === 'lootRoll' || ev.type === 'masterLoot') &&
    (ev.quality === 'epic' || ev.quality === 'legendary')
  ) {
    // A genuinely rare item dropped (roll-worthy); one card per drop (rollId).
    const s = ev.pid !== undefined ? deps.clients.get(ev.pid) : undefined;
    enqueueActivity(
      {
        kind: 'rareloot',
        accountIds: s ? [s.accountId] : [],
        names: s ? [s.name] : [],
        realm: REALM,
        profileUrl: s ? deps.profileUrlFor(s.name) : null,
        itemName: ev.itemName,
        quality: ev.quality,
      },
      `rareloot:${ev.rollId}`,
      now,
    );
  } else if (ev.type === 'masterwork' && ev.pid !== undefined) {
    // A masterwork proc: the professions moment the rareloot arm above
    // cannot see (a craft fires no loot roll). The dedupe/opt-out/release
    // body lives in server/craft_activity.ts (shared with the legendary
    // arm below). Bots have no session, so deps.clients.get filters them.
    const s = deps.clients.get(ev.pid);
    if (!s) return;
    emitCraftActivityCard({
      kind: 'masterwork',
      accountId: s.accountId,
      name: s.name,
      itemName: ITEMS[ev.itemId]?.name ?? ev.itemId,
      realm: REALM,
      now,
      profileUrlFor: (n) => deps.profileUrlFor(n),
    });
  } else if (ev.type === 'legendaryForged' && ev.pid !== undefined) {
    // The orange promotion (Masterwrought phase 13), at masterwork parity:
    // the PERSONAL event only (legendaryForgedZone copies never card, the
    // masterworkZone rule). itemName is the PLAYER-CHOSEN name: data only.
    const s = deps.clients.get(ev.pid);
    if (!s) return;
    emitCraftActivityCard({
      kind: 'legendary',
      accountId: s.accountId,
      name: s.name,
      itemName: ev.name,
      realm: REALM,
      now,
      profileUrlFor: (n) => deps.profileUrlFor(n),
    });
  } else if (
    ev.type === 'gatherRareEvent' &&
    ev.flavor === 'golden_harvest' &&
    ev.pid === ev.finderPid
  ) {
    // The farming zone celebration (announceGatherRareEvent fans one pid-scoped
    // copy per zone player): only the FINDER's own copy cards, so the emit
    // fires once per harvest however many players share the zone. Ore/wood/
    // herb flavors deliberately never card (the two-card ruling). Bots have no
    // session, so deps.clients.get filters them.
    const s = deps.clients.get(ev.finderPid);
    if (!s) return;
    emitCraftActivityCard({
      kind: 'golden_harvest',
      accountId: s.accountId,
      name: s.name,
      itemName: ITEMS[ev.itemId]?.name ?? ev.itemId,
      realm: REALM,
      now,
      profileUrlFor: (n) => deps.profileUrlFor(n),
    });
  } else if (ev.type === 'duelEnd') {
    const w = deps.sessionByName(ev.winnerName);
    const l = deps.sessionByName(ev.loserName);
    const accountIds: number[] = [];
    const names: string[] = [];
    if (w) {
      accountIds.push(w.accountId);
      names.push(w.name);
    }
    if (l) {
      accountIds.push(l.accountId);
      names.push(l.name);
    }
    enqueueActivity(
      {
        kind: 'duel',
        accountIds,
        names,
        realm: REALM,
        profileUrl: deps.profileUrlFor(ev.winnerName),
        winnerName: ev.winnerName,
        loserName: ev.loserName,
      },
      `duel:${ev.winnerName}:${ev.loserName}`,
      now,
    );
  } else if (ev.type === 'arenaEnd' && !ev.draw && ev.pid !== undefined) {
    const s = deps.clients.get(ev.pid);
    if (!s) return;
    void dailyRewardService
      .recordArenaResult(s.accountId, {
        won: ev.won,
        format: ev.format,
        ratingBefore: ev.ratingBefore,
        ratingAfter: ev.ratingAfter,
      })
      .then((points) => {
        if (points > 0) deps.sendDailyRewardPointsGained(s, points);
      })
      .catch((err) => console.error('daily reward arena task failed:', err));
    if (!ev.won) return;
    enqueueActivity(
      {
        kind: 'arena',
        accountIds: [s.accountId],
        names: [s.name],
        realm: REALM,
        profileUrl: deps.profileUrlFor(s.name),
        ratingDelta: ev.ratingAfter - ev.ratingBefore,
      },
      `arena:${s.accountId}:${ev.ratingAfter}`,
      now,
    );
  } else if (ev.type === 'delveObjectiveComplete' && ev.pid !== undefined) {
    const s = deps.clients.get(ev.pid);
    if (!s) return;
    void dailyRewardService
      .recordDelveClear(s.accountId, s.characterId, ev.delveId, ev.tierId)
      .then((points) => {
        if (points > 0) deps.sendDailyRewardPointsGained(s, points);
      })
      .catch((err) => console.error('daily reward delve task failed:', err));
  } else if (ev.type === 'delveChestLoot' && ev.pid !== undefined) {
    const s = deps.clients.get(ev.pid);
    if (!s) return;
    void dailyRewardService
      .recordDelveChestOpen(
        s.accountId,
        s.characterId,
        ev.delveId,
        ev.tierId,
        ev.lootTier,
        ev.bountiful,
      )
      .then((points) => {
        if (points > 0) deps.sendDailyRewardPointsGained(s, points);
      })
      .catch((err) => console.error('daily reward delve chest task failed:', err));
  }
}
