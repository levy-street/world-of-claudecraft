// Arena fight segmentation, driven purely by read-only state observation:
// open when a match reaches 'active', request close when it reaches 'over'.
// Closes are returned as intents (PendingClose) so the recorder can route the
// tick's events first; a match that vanishes from the map without reaching
// 'over' (teardown edge) closes as 'abandon' so no fight leaks open.
import type { FightOutcome, FightParticipant } from './contract';
import { OpenFight, type PendingClose } from './fights';
import type { ArenaMatchView, SegmenterHost } from './types';

export class ArenaSegmenter {
  private readonly tracked = new Map<number, OpenFight>();

  /** Called once per tick; appends opened fights and pending closes. */
  observe(host: SegmenterHost, tick: number, opened: OpenFight[], closing: PendingClose[]): void {
    if (!host.surfaceEnabled('arena')) return;
    const seen = new Set<number>();
    // The map is pid -> shared match object; both pids point at one match.
    for (const match of host.sim.arenaMatches.values()) {
      if (seen.has(match.id)) continue;
      seen.add(match.id);
      const fight = this.tracked.get(match.id);
      if (fight === undefined && match.state === 'active') {
        const openedFight = this.open(host, tick, match);
        if (openedFight !== null) opened.push(openedFight);
      } else if (fight !== undefined && match.state === 'over') {
        closing.push({ fight, outcome: outcomeOf(match) });
        this.tracked.delete(match.id);
      }
    }
    for (const [id, fight] of this.tracked) {
      if (!seen.has(id)) {
        closing.push({ fight, outcome: 'abandon' });
        this.tracked.delete(id);
      }
    }
  }

  private open(host: SegmenterHost, tick: number, match: ArenaMatchView): OpenFight | null {
    const participants: FightParticipant[] = [];
    for (const pid of match.teamA) {
      const p = host.resolveParticipant(pid);
      if (p !== null) participants.push({ ...p, team: 'a' });
    }
    for (const pid of match.teamB) {
      const p = host.resolveParticipant(pid);
      if (p !== null) participants.push({ ...p, team: 'b' });
    }
    if (participants.length === 0) return null;
    const fight = new OpenFight(
      {
        fightId: host.nextFightId(),
        surface: 'arena',
        key: `arena_${match.format}`,
        difficulty: null,
        segment: 'match',
        groupType: 'team',
        startedTick: tick,
        arena: {
          format: match.format,
          ratingA: match.ratingA,
          ratingB: match.ratingB,
          // Practice, fiesta, and yumi matches are recorded but flagged so
          // balance queries exclude them by default.
          practice: match.practice === true || match.fiesta != null || match.yumi != null,
        },
        participants,
      },
      host.sink,
      host.counters,
    );
    this.tracked.set(match.id, fight);
    return fight;
  }
}

/**
 * ArenaMatch stores no winner field, so the outcome is inferred from the
 * defeated set: a fully-defeated team lost. Neither team fully defeated at
 * 'over' (timeout, forfeit edge) records as a draw.
 */
function outcomeOf(match: ArenaMatchView): FightOutcome {
  const teamADown = match.teamA.length > 0 && match.teamA.every((pid) => match.defeated.has(pid));
  const teamBDown = match.teamB.length > 0 && match.teamB.every((pid) => match.defeated.has(pid));
  if (teamBDown && !teamADown) return 'win_a';
  if (teamADown && !teamBDown) return 'win_b';
  return 'draw';
}
