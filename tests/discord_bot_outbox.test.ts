// The consolidated outbox poll: the breaker gate, the per-stream fan-out, the
// announce-then-mark ordering, the didWork signal that decides the cadence, and
// the channel routing the factory binds.
//
// All of it runs over the injected IO seam with plain closures, so there is no
// network, no Discord token and no clock. The two cases that need a clock drive
// the REAL LoopScheduler against tests/helpers/synthetic_clock.ts and assert the
// ABSOLUTE virtual time of each run: vitest fake timers are deliberately not
// used (see that helper's header), and a lower bound like `>= 3000` would also
// pass for a loop that waited ten minutes.
import { describe, expect, it } from 'vitest';
import type { ActivityItem, DailyRewardWinnersDay, RelayItem } from '../bot/logic';
import {
  ANNOUNCED_DAYS_MAX,
  freshOutboxPollState,
  OutboxChannelUnsetError,
  type OutboxIo,
  outboxIoFor,
  runOutboxPoll,
} from '../bot/outbox_consumer';
import type { BreakerState } from '../bot/rate_governor';
import { LoopScheduler, type SchedulerTimerHandle, type SchedulerTimers } from '../bot/scheduler';
import type { OutboxEnvelope, OutboxLinkChangeItem } from '../bot/server_client';
import { type SyntheticClock, syntheticClock } from './helpers/synthetic_clock';

function relayItem(commandId: string, characterName = 'Annthar'): RelayItem {
  return {
    commandId,
    tag: 'LFG',
    label: 'Looking for group',
    color: 0x3366cc,
    characterName,
    level: 18,
    className: 'warrior',
    realm: 'Eastbrook',
    zone: 'Deadmines',
    message: 'need two more',
    profileUrl: null,
    discordUserId: 'u1',
    discordUsername: 'ann',
    discordAvatar: null,
  };
}

function activityItem(name = 'Annthar'): ActivityItem {
  return {
    kind: 'levelup',
    realm: 'Eastbrook',
    profileUrl: null,
    level: 20,
    participants: [{ name, discordUserId: 'u1', discordAvatar: null }],
  };
}

function winnersDay(day: string): DailyRewardWinnersDay {
  return {
    day,
    taskName: 'gather',
    nextTaskName: 'delve',
    realm: 'Eastbrook',
    prizePoolUsd: 100,
    finalizedAt: null,
    payouts: [
      {
        day,
        rank: 1,
        username: 'ann',
        points: 42,
        prizePercent: 0.5,
        prizeUsd: 50,
        status: 'paid',
        txSignature: null,
      },
    ],
  };
}

function linkChange(discordUserId: string): OutboxLinkChangeItem {
  return {
    accountId: 7,
    kinds: ['link'],
    discordUserId,
    discordUsername: 'ann',
    discordAvatar: null,
  };
}

/** A full envelope with every stream empty, plus whatever the case fills in. */
function envelope(streams: Partial<OutboxEnvelope> = {}): OutboxEnvelope {
  return {
    relay: { items: [] },
    activity: { items: [] },
    winners: { days: [] },
    linkChanges: { items: [] },
    ...streams,
  };
}

interface Recorder {
  io: OutboxIo;
  /** Every IO call in order, so an ORDERING claim can be asserted by value. */
  calls: string[];
  relay: RelayItem[];
  activity: ActivityItem[];
  winners: DailyRewardWinnersDay[];
  marks: string[];
  links: OutboxLinkChangeItem[][];
  errors: { where: string; message: string }[];
}

/**
 * An IO seam of plain closures. Every failure mode is a caller-supplied
 * predicate rather than a flag, so a case can fail exactly one item of several
 * and prove the rest were still attempted.
 */
function recorder(
  options: {
    breaker?: BreakerState;
    drain?: () => Promise<OutboxEnvelope | null>;
    envelope?: OutboxEnvelope | null;
    failRelay?: (item: RelayItem) => boolean;
    failActivity?: (item: ActivityItem) => boolean;
    failWinners?: (day: DailyRewardWinnersDay) => boolean;
    markResult?: (day: string) => unknown;
  } = {},
): Recorder {
  const calls: string[] = [];
  const rec: Recorder = {
    calls,
    relay: [],
    activity: [],
    winners: [],
    marks: [],
    links: [],
    errors: [],
    io: {
      breakerState: () => options.breaker ?? 'closed',
      drain: async () => {
        calls.push('drain');
        if (options.drain) return options.drain();
        return options.envelope === undefined ? envelope() : options.envelope;
      },
      postRelay: async (item) => {
        calls.push(`relay:${item.commandId}`);
        rec.relay.push(item);
        if (options.failRelay?.(item)) throw new Error(`relay ${item.commandId} refused`);
      },
      postActivity: async (item) => {
        calls.push(`activity:${item.kind}`);
        rec.activity.push(item);
        if (options.failActivity?.(item)) throw new Error(`activity ${item.kind} refused`);
      },
      postWinnersDay: async (day) => {
        calls.push(`winners:${day.day}`);
        rec.winners.push(day);
        if (options.failWinners?.(day)) throw new Error(`winners ${day.day} refused`);
      },
      markWinnersDay: async (day) => {
        calls.push(`mark:${day}`);
        rec.marks.push(day);
        return options.markResult ? options.markResult(day) : { ok: true };
      },
      applyLinkChanges: (items) => {
        calls.push(`links:${items.length}`);
        rec.links.push([...items]);
      },
      onError: (error, where) => {
        rec.errors.push({ where, message: error instanceof Error ? error.message : String(error) });
      },
    },
  };
  return rec;
}

describe('outbox poll breaker gate', () => {
  it('refuses to drain while the breaker is open or half-open', async () => {
    // Both non-closed states, because the half-open one is the trap: it looks
    // like recovery and it still REFUSES every non-essential createMessage, so
    // draining would pull items out of the server's queues and feed them
    // straight into refusals. A 200 is the outbox's only acknowledgement, so
    // those items would be delivered to nobody (ledger L9).
    for (const breaker of ['open', 'half-open'] as const) {
      const rec = recorder({
        breaker,
        envelope: envelope({ relay: { items: [relayItem('c1')] } }),
      });

      expect(await runOutboxPoll(rec.io)).toBe(false);
      // Not merely "posted nothing": the DRAIN itself must not have happened.
      expect(rec.calls).toEqual([]);
      expect(rec.relay).toEqual([]);
    }
  });

  it('drains normally once the breaker is closed', async () => {
    // The complement, and the one that fails if the gate is inverted or the
    // comparison is against the wrong literal. Without it the case above passes
    // for a poll that never drains at all.
    const rec = recorder({
      breaker: 'closed',
      envelope: envelope({ relay: { items: [relayItem('c1')] } }),
    });

    expect(await runOutboxPoll(rec.io)).toBe(true);
    expect(rec.calls).toEqual(['drain', 'links:0', 'relay:c1']);
  });
});

describe('outbox poll fan-out', () => {
  it('delivers each stream to its own handler, by value', async () => {
    const relay = relayItem('c1');
    const activity = activityItem();
    const day = winnersDay('2026-07-31');
    const link = linkChange('u9');
    const rec = recorder({
      envelope: envelope({
        relay: { items: [relay] },
        activity: { items: [activity] },
        winners: { days: [day] },
        linkChanges: { items: [link] },
      }),
    });

    expect(await runOutboxPoll(rec.io)).toBe(true);

    // Fresh expectation literals per stream, never the drained object compared
    // against itself: a fan-out that handed every stream the same list, or that
    // routed the activity item through postRelay, has to fail here.
    expect(rec.relay).toEqual([relayItem('c1')]);
    expect(rec.activity).toEqual([activityItem()]);
    expect(rec.winners).toEqual([winnersDay('2026-07-31')]);
    expect(rec.links).toEqual([[linkChange('u9')]]);
    expect(rec.marks).toEqual(['2026-07-31']);
  });

  it('keeps one refused item from costing the rest of the drain', async () => {
    // Three relay items with the MIDDLE one failing, so there is work left after
    // the failure: a loop that stopped at the first refusal would still pass a
    // case whose last item failed. The later streams have to survive it too,
    // since the drain has already consumed them and cannot hand them back.
    const rec = recorder({
      envelope: envelope({
        relay: { items: [relayItem('c1'), relayItem('c2'), relayItem('c3')] },
        activity: { items: [activityItem()] },
        linkChanges: { items: [linkChange('u9')] },
      }),
      failRelay: (item) => item.commandId === 'c2',
    });

    expect(await runOutboxPoll(rec.io)).toBe(true);
    expect(rec.calls).toEqual([
      'drain',
      'links:1',
      'relay:c1',
      'relay:c2',
      'relay:c3',
      'activity:levelup',
    ]);
    expect(rec.errors).toEqual([{ where: 'relay', message: 'relay c2 refused' }]);
  });

  it('applies the link changes even when every post was refused', async () => {
    // The sweep's belief update is pure and cannot fail, and it is the one thing
    // in the poll that must not be skipped on a bad Discord minute: it is what
    // tells the sweep which members moved, and the feed does not re-serve.
    const rec = recorder({
      envelope: envelope({
        relay: { items: [relayItem('c1')] },
        activity: { items: [activityItem()] },
        linkChanges: { items: [linkChange('u9')] },
      }),
      failRelay: () => true,
      failActivity: () => true,
    });

    expect(await runOutboxPoll(rec.io)).toBe(true);
    expect(rec.links).toEqual([[linkChange('u9')]]);
    expect(rec.errors.map((e) => e.where)).toEqual(['relay', 'activity']);
  });
});

describe('outbox winners announce-then-mark', () => {
  it('announces BEFORE it marks', async () => {
    // The order is the whole at-least-once contract: the day stays unannounced
    // server-side until the mark lands, so marking first would make a day nobody
    // saw disappear. Asserted as an ordered call log rather than as two
    // presence checks, which would pass in either order.
    const rec = recorder({ envelope: envelope({ winners: { days: [winnersDay('2026-07-31')] } }) });

    await runOutboxPoll(rec.io);

    expect(rec.calls).toEqual(['drain', 'links:0', 'winners:2026-07-31', 'mark:2026-07-31']);
  });

  it('never marks a day whose announcement failed, and still handles the next one', async () => {
    // Two days with the FIRST failing, so a mark that WOULD have happened is the
    // thing being asserted absent: a case with only one failing day cannot tell
    // "skipped the mark" from "stopped the loop", and one that failed the LAST
    // day would pass with the skip deleted.
    const rec = recorder({
      envelope: envelope({
        winners: { days: [winnersDay('2026-07-30'), winnersDay('2026-07-31')] },
      }),
      failWinners: (day) => day.day === '2026-07-30',
    });

    expect(await runOutboxPoll(rec.io)).toBe(true);

    expect(rec.calls).toEqual([
      'drain',
      'links:0',
      'winners:2026-07-30',
      'winners:2026-07-31',
      'mark:2026-07-31',
    ]);
    // Exactly the second day, so the failed one is genuinely left for the server
    // to re-serve on the next poll.
    expect(rec.marks).toEqual(['2026-07-31']);
    expect(rec.errors).toEqual([{ where: 'winners', message: 'winners 2026-07-30 refused' }]);
  });

  it('reports a failed mark without retrying it in-run, and counts no progress', async () => {
    // ServerClient answers null for a failed call rather than throwing, so the
    // RETURN VALUE is the only signal there is; `undefined` counts too, since a
    // success envelope carrying no data comes back verbatim. Neither may be read
    // as a mark that landed, and neither may be retried here: the retry is the
    // same request that just failed, and the day is re-served next poll anyway.
    // No progress either: the mark is the event that stops the re-serve, so a
    // day whose mark keeps failing must decay the cadence, not hold it.
    for (const result of [null, undefined]) {
      const rec = recorder({
        envelope: envelope({ winners: { days: [winnersDay('2026-07-31')] } }),
        markResult: () => result,
      });

      expect(await runOutboxPoll(rec.io)).toBe(false);
      expect(rec.calls).toEqual(['drain', 'links:0', 'winners:2026-07-31', 'mark:2026-07-31']);
      expect(rec.errors).toEqual([
        { where: 'winners-mark', message: 'day 2026-07-31 was posted but not marked' },
      ]);
    }
  });

  it('never re-announces a day it already posted: the memo skips straight to the mark retry', async () => {
    // The item that can never succeed: a mark endpoint that keeps failing. The
    // server re-serves the day on every poll, and without the announced-days
    // memo each re-serve would duplicate the winners post in the channel (about
    // twenty a minute at the active cadence). With a shared state the re-served
    // day goes straight to the mark retry.
    const state = freshOutboxPollState();
    const days = { winners: { days: [winnersDay('2026-07-31')] } };
    const first = recorder({ envelope: envelope(days), markResult: () => null });
    expect(await runOutboxPoll(first.io, state)).toBe(false);
    expect(first.calls).toEqual(['drain', 'links:0', 'winners:2026-07-31', 'mark:2026-07-31']);

    const second = recorder({ envelope: envelope(days), markResult: () => null });
    expect(await runOutboxPoll(second.io, state)).toBe(false);
    // No winners post this time; only the mark was retried.
    expect(second.calls).toEqual(['drain', 'links:0', 'mark:2026-07-31']);

    // The retry that finally lands is progress, and it clears the memo entry,
    // so a future day with the same key (a fresh server row after an ops
    // reset) would be announced again rather than silently swallowed.
    const third = recorder({ envelope: envelope(days) });
    expect(await runOutboxPoll(third.io, state)).toBe(true);
    expect(third.calls).toEqual(['drain', 'links:0', 'mark:2026-07-31']);
    expect(state.announcedDays.size).toBe(0);
  });

  it('re-announces after a restart: the memo is process-local by design', async () => {
    // A fresh state per process is the documented at-least-once cost: the one
    // duplicate follows a restart, never a steady-state poll.
    const days = { winners: { days: [winnersDay('2026-07-31')] } };
    const first = recorder({ envelope: envelope(days), markResult: () => null });
    await runOutboxPoll(first.io, freshOutboxPollState());
    const second = recorder({ envelope: envelope(days), markResult: () => null });
    await runOutboxPoll(second.io, freshOutboxPollState());

    expect(first.winners.map((d) => d.day)).toEqual(['2026-07-31']);
    expect(second.winners.map((d) => d.day)).toEqual(['2026-07-31']);
  });

  it('bounds the announced-days memo AT its cap, evicting the oldest entry', async () => {
    // The bound is reached, not merely respected: one more day than the cap,
    // every mark failing, must leave exactly ANNOUNCED_DAYS_MAX entries with
    // the OLDEST evicted, so the memo can never grow for the life of a process
    // whose marks are broken. The evicted day's observable consequence is a
    // re-announce on its next re-serve; the survivors skip theirs.
    const state = freshOutboxPollState();
    const dayKeys = Array.from({ length: ANNOUNCED_DAYS_MAX + 1 }, (_, i) => {
      return `2026-06-${String(i + 1).padStart(2, '0')}`;
    });
    const rec = recorder({
      envelope: envelope({ winners: { days: dayKeys.map((d) => winnersDay(d)) } }),
      markResult: () => null,
    });
    await runOutboxPoll(rec.io, state);

    expect(state.announcedDays.size).toBe(ANNOUNCED_DAYS_MAX);
    expect([...state.announcedDays]).toEqual(dayKeys.slice(1));
    expect(state.announcedDays.has(dayKeys[0])).toBe(false);
  });

  it('survives a mark that REJECTS, so the link changes still land', async () => {
    // The wired client answers nullish rather than rejecting, so this arm is
    // defensive. It is worth having because of what an escaping throw would
    // skip: the remaining winner days, and (before the apply moved ahead of the
    // posts) the link-change beliefs; the apply-first order is pinned by the
    // ordered call logs above, this arm keeps the catch honest.
    const rec = recorder({
      envelope: envelope({
        winners: { days: [winnersDay('2026-07-31')] },
        linkChanges: { items: [linkChange('u9')] },
      }),
      markResult: () => {
        throw new Error('mark exploded');
      },
    });

    expect(await runOutboxPoll(rec.io)).toBe(true);
    expect(rec.errors).toEqual([{ where: 'winners-mark', message: 'mark exploded' }]);
    expect(rec.links).toEqual([[linkChange('u9')]]);
  });

  it('says nothing when the mark succeeded', async () => {
    // The complement of the case above: a truthy answer is a landed mark, and
    // reporting it would turn every ordinary announcement into an error line.
    const rec = recorder({
      envelope: envelope({ winners: { days: [winnersDay('2026-07-31')] } }),
      markResult: () => ({ ok: true }),
    });

    await runOutboxPoll(rec.io);
    expect(rec.errors).toEqual([]);
  });
});

describe('outbox poll didWork signal', () => {
  it('answers false for a failed poll and for an empty one', async () => {
    // Both are "no work", and they are different failures. A null drain means
    // the server preserved every stream, so backing off is right; an empty
    // envelope means there was genuinely nothing queued.
    const failed = recorder({ envelope: null });
    expect(await runOutboxPoll(failed.io)).toBe(false);
    expect(failed.calls).toEqual(['drain']);
    // Nothing is applied on a failed poll, not even an empty link-change list.
    expect(failed.links).toEqual([]);

    const empty = recorder({ envelope: envelope() });
    expect(await runOutboxPoll(empty.io)).toBe(false);
    expect(empty.calls).toEqual(['drain', 'links:0']);
  });

  it('treats an UNDEFINED drain like a failed poll rather than throwing', async () => {
    // ServerClient resolves undefined for a success envelope with no data field
    // (a proxy-trimmed body, an older build), and the types cannot see it. A
    // strict === null guard let that shape through to a TypeError on the first
    // property read, with the drain already consumed. Same contract as null:
    // nothing was observed, so nothing is posted, applied, or counted as work.
    const rec = recorder({
      drain: async () => undefined as unknown as OutboxEnvelope,
    });

    expect(await runOutboxPoll(rec.io)).toBe(false);
    expect(rec.calls).toEqual(['drain']);
    expect(rec.links).toEqual([]);
  });

  it('answers true for each stream ON ITS OWN', async () => {
    // One case per stream, because a didWork built from three of the four reads
    // as work-aware and silently backs the loop off to 15 seconds on the one it
    // forgot. The link-change stream is the likeliest omission: it posts nothing.
    const cases: { name: string; streams: Partial<OutboxEnvelope> }[] = [
      { name: 'relay', streams: { relay: { items: [relayItem('c1')] } } },
      { name: 'activity', streams: { activity: { items: [activityItem()] } } },
      { name: 'winners', streams: { winners: { days: [winnersDay('2026-07-31')] } } },
      { name: 'linkChanges', streams: { linkChanges: { items: [linkChange('u9')] } } },
    ];
    for (const oneCase of cases) {
      const rec = recorder({ envelope: envelope(oneCase.streams) });
      expect({ stream: oneCase.name, didWork: await runOutboxPoll(rec.io) }).toEqual({
        stream: oneCase.name,
        didWork: true,
      });
    }
  });

  it('counts a drain whose posts were ALL refused as work', async () => {
    // The signal is about what the drain CARRIED, not about what landed. Reading
    // it from the posts would back the cadence off to idle exactly while a
    // backlog is draining, which is the opposite of what it is for.
    const rec = recorder({
      envelope: envelope({
        relay: { items: [relayItem('c1')] },
        activity: { items: [activityItem()] },
      }),
      failRelay: () => true,
      failActivity: () => true,
    });

    expect(await runOutboxPoll(rec.io)).toBe(true);
  });

  it('backs off when the only stream is a winners day that cannot post', async () => {
    // The winners stream is a re-served READ, not a drained queue: the server
    // answers the SAME unannounced day on every poll until a mark lands. So a
    // day that cannot post (an unset channel, a durable 403) must read as no
    // work, or it pins the whole consolidated loop at the 3 s active cadence
    // for the life of the process. Found by the Phase 6 QA gate; the unset
    // daily-rewards channel is the common deployment, not a corner case.
    const unset = recorder({
      envelope: envelope({ winners: { days: [winnersDay('2026-07-31')] } }),
    });
    unset.io.postWinnersDay = async () => {
      throw new OutboxChannelUnsetError('dailyRewards');
    };
    expect(await runOutboxPoll(unset.io)).toBe(false);
    // The day was never marked, so the server keeps it; nothing is lost.
    expect(unset.marks).toEqual([]);

    // Same signal for an ordinary durable failure (a 403 on the channel). The
    // attempted-announce pin is what separates "backed off after trying" from
    // "stopped consuming the winners stream", which the unset-channel arm above
    // cannot see (its stub records nothing).
    const refused = recorder({
      envelope: envelope({ winners: { days: [winnersDay('2026-07-31')] } }),
      failWinners: () => true,
    });
    expect(await runOutboxPoll(refused.io)).toBe(false);
    expect(refused.winners.map((d) => d.day)).toEqual(['2026-07-31']);
    expect(refused.marks).toEqual([]);
  });

  it('counts winners progress by the MARK, never by the announce alone', async () => {
    // Progress is the mark, the event that stops the re-serve. An announced day
    // whose mark failed is re-served next poll, so counting the announce would
    // hold the fast cadence for as long as the mark endpoint stays broken (the
    // same unpostable-item shape the Phase 6 QA gate found on the post side).
    const rec = recorder({
      envelope: envelope({ winners: { days: [winnersDay('2026-07-31')] } }),
      markResult: () => null,
    });
    expect(await runOutboxPoll(rec.io)).toBe(false);
    expect(rec.winners.map((d) => d.day)).toEqual(['2026-07-31']);

    // A drained stream beside a failed winners day must still count: the two
    // signals stay independent.
    const mixed = recorder({
      envelope: envelope({
        relay: { items: [relayItem('c9')] },
        winners: { days: [winnersDay('2026-08-01')] },
      }),
      failWinners: () => true,
    });
    expect(await runOutboxPoll(mixed.io)).toBe(true);
    expect(mixed.relay.map((i) => i.commandId)).toEqual(['c9']);
  });

  it('tolerates a payload that omits a stream entirely', async () => {
    // Network input, whatever the types say: an older server build or a proxy
    // that trimmed the body would otherwise throw inside the loop, and by then
    // the drain has already consumed everything the server had.
    const rec = recorder({
      drain: async () => ({ relay: { items: [relayItem('c1')] } }) as unknown as OutboxEnvelope,
    });

    expect(await runOutboxPoll(rec.io)).toBe(true);
    expect(rec.calls).toEqual(['drain', 'links:0', 'relay:c1']);
  });
});

describe('outbox channel routing', () => {
  interface Sent {
    channelId: string;
    payload: Record<string, unknown>;
  }

  function factoryIo(
    channels: { relay: string; activity: string; dailyRewards: string },
    drained: OutboxEnvelope,
  ): {
    io: OutboxIo;
    sent: Sent[];
    marks: string[];
    missing: string[];
    errors: string[];
  } {
    const sent: Sent[] = [];
    const marks: string[] = [];
    const missing: string[] = [];
    const errors: string[] = [];
    const io = outboxIoFor({
      createMessage: async (channelId, payload) => {
        sent.push({ channelId, payload });
      },
      markDailyRewardWinners: async (day) => {
        marks.push(day);
        return { ok: true };
      },
      channels,
      gameUrl: 'https://game.test',
      breakerState: () => 'closed',
      drain: async () => drained,
      applyLinkChanges: () => {},
      onError: (_error, where) => errors.push(where),
      onMissingChannel: (channel) => missing.push(channel),
    });
    return { io, sent, marks, missing, errors };
  }

  const CHANNELS = { relay: 'relay-1', activity: 'activity-1', dailyRewards: 'daily-1' };

  it('sends each stream to its OWN channel, shaped by its OWN builder', async () => {
    // The one mutation this exists for is a swapped channel id, which type-checks
    // and deploys and would put the activity feed in the relay channel. Every id
    // is distinct, so the swap cannot pass, and each payload is asserted through
    // a value only its own builder produces (the relay respond link carries the
    // game URL and the character name; the activity title carries the level; the
    // winners title carries the day), so a swapped builder fails too.
    const wired = factoryIo(
      CHANNELS,
      envelope({
        relay: { items: [relayItem('c1', 'Annthar')] },
        activity: { items: [activityItem('Annthar')] },
        winners: { days: [winnersDay('2026-07-31')] },
      }),
    );

    await runOutboxPoll(wired.io);

    expect(wired.sent.map((s) => s.channelId)).toEqual(['relay-1', 'activity-1', 'daily-1']);

    const relayPayload = wired.sent[0].payload;
    expect(relayPayload.content).toBe('<@u1>');
    const row = (relayPayload.components as { components: { url: string }[] }[])[0];
    expect(row.components[0].url).toBe('https://game.test/?lfg=Annthar&c=c1');

    const activityEmbed = (wired.sent[1].payload.embeds as { title: string }[])[0];
    expect(activityEmbed.title).toBe('Annthar hit level 20!');

    const winnersEmbed = (
      wired.sent[2].payload.embeds as { title: string; description: string }[]
    )[0];
    expect(winnersEmbed.title).toBe('Top 1 Winners - 2026-07-31');

    expect(wired.marks).toEqual(['2026-07-31']);
  });

  it('drops an unknown-kind activity item at the io seam, never posting an empty embed', async () => {
    // buildActivityMessage answers null for a kind this build does not know (a
    // newer server mid-deploy), and postActivity drops the null SILENTLY by
    // design: the feed is at-most-once, so a drop loses a card, never state.
    // The known item in the same batch still posts, so the drop is per item.
    const wired = factoryIo(
      CHANNELS,
      envelope({
        activity: {
          items: [{ ...activityItem('Annthar'), kind: 'parade' as never }, activityItem('Bessa')],
        },
      }),
    );
    await runOutboxPoll(wired.io);
    expect(wired.sent.map((s) => s.channelId)).toEqual(['activity-1']);
    const embed = (wired.sent[0].payload.embeds as { title: string }[])[0];
    expect(embed.title).toBe('Bessa hit level 20!');
    expect(wired.errors).toEqual([]);

    // The drop precedes the channel gate: with the activity channel UNSET, an
    // unknown-kind item must fire neither the once-per-channel notice nor the
    // per-item error report (a known item there does both, pinned elsewhere).
    const unset = factoryIo(
      { ...CHANNELS, activity: '' },
      envelope({
        activity: { items: [{ ...activityItem('Annthar'), kind: 'parade' as never }] },
      }),
    );
    await runOutboxPoll(unset.io);
    expect(unset.sent).toEqual([]);
    expect(unset.missing).toEqual([]);
    expect(unset.errors).toEqual([]);
  });

  it('marks the announced day through the server client, by day string', async () => {
    const wired = factoryIo(CHANNELS, envelope({ winners: { days: [winnersDay('2026-07-30')] } }));
    await runOutboxPoll(wired.io);
    expect(wired.marks).toEqual(['2026-07-30']);
  });

  it('skips a stream whose channel is unset, reporting it exactly once', async () => {
    // An unset channel must not become a POST to `/channels//messages`: that is a
    // 404 per item against the governor's invalid-request breaker. It reports
    // once per channel rather than once per poll, or a deployment that never set
    // one would log a line every 3 seconds for the life of the process.
    const wired = factoryIo(
      { relay: '', activity: '', dailyRewards: '' },
      envelope({
        relay: { items: [relayItem('c1'), relayItem('c2')] },
        activity: { items: [activityItem()] },
        winners: { days: [winnersDay('2026-07-31')] },
      }),
    );

    await runOutboxPoll(wired.io);
    await runOutboxPoll(wired.io);

    expect(wired.sent).toEqual([]);
    expect(wired.missing).toEqual(['relay', 'activity', 'dailyRewards']);
    // The day is NOT marked: there was nowhere to announce it, so it stays
    // unannounced and the server re-serves it once a channel is configured.
    expect(wired.marks).toEqual([]);
    // And the unset channel is not re-reported through onError either, which is
    // what would restore the per-poll log line by another door.
    expect(wired.errors).toEqual([]);
  });

  it('posts the streams whose channel IS set while skipping the one that is not', async () => {
    // The complement: an unset daily-rewards channel is the common deployment,
    // and it must not take the relay and activity feeds down with it.
    const wired = factoryIo(
      { ...CHANNELS, dailyRewards: '' },
      envelope({
        relay: { items: [relayItem('c1')] },
        activity: { items: [activityItem()] },
        winners: { days: [winnersDay('2026-07-31')] },
      }),
    );

    await runOutboxPoll(wired.io);

    expect(wired.sent.map((s) => s.channelId)).toEqual(['relay-1', 'activity-1']);
    expect(wired.missing).toEqual(['dailyRewards']);
    expect(wired.marks).toEqual([]);
  });

  it('throws OutboxChannelUnsetError rather than resolving, so nothing reads it as sent', async () => {
    // Stated directly on the seam, because the whole no-mark behavior above
    // depends on it: a post that resolved quietly would be indistinguishable
    // from a successful announcement and the day would be marked.
    const wired = factoryIo({ relay: '', activity: '', dailyRewards: '' }, envelope());
    await expect(wired.io.postRelay(relayItem('c1'))).rejects.toBeInstanceOf(
      OutboxChannelUnsetError,
    );
  });
});

describe('outbox factory pass-through seams', () => {
  // Phase 6 QA: every routing test above runs the factory with a closed breaker
  // and no link changes, so a factory that HARDCODED breakerState to 'closed',
  // dropped applyLinkChanges, or swallowed onError passed the whole ladder while
  // production lost the breaker gate, the link-change feed, or the error log.
  // One arm per forwarded seam, each driven END TO END through runOutboxPoll.

  it('forwards breakerState, so an open breaker reaches the gate through the factory', async () => {
    let drains = 0;
    const io = outboxIoFor({
      createMessage: async () => {},
      markDailyRewardWinners: async () => ({ ok: true }),
      channels: { relay: 'r', activity: 'a', dailyRewards: 'd' },
      gameUrl: 'https://game.test',
      breakerState: () => 'open',
      drain: async () => {
        drains++;
        return envelope({ relay: { items: [relayItem('c1')] } });
      },
      applyLinkChanges: () => {},
    });

    expect(await runOutboxPoll(io)).toBe(false);
    // Not merely "posted nothing": the drain itself never happened, which only
    // holds if the factory handed the REAL breaker thunk through.
    expect(drains).toBe(0);
  });

  it('forwards applyLinkChanges, so drained items reach the sweep through the factory', async () => {
    const applied: OutboxLinkChangeItem[][] = [];
    const io = outboxIoFor({
      createMessage: async () => {},
      markDailyRewardWinners: async () => ({ ok: true }),
      channels: { relay: 'r', activity: 'a', dailyRewards: 'd' },
      gameUrl: 'https://game.test',
      breakerState: () => 'closed',
      drain: async () => envelope({ linkChanges: { items: [linkChange('u9')] } }),
      applyLinkChanges: (items) => applied.push([...items]),
    });

    expect(await runOutboxPoll(io)).toBe(true);
    expect(applied).toEqual([[linkChange('u9')]]);
  });

  it('forwards onError, so a failed post reaches the log through the factory', async () => {
    const errors: string[] = [];
    const io = outboxIoFor({
      createMessage: async () => {
        throw new Error('post refused');
      },
      markDailyRewardWinners: async () => ({ ok: true }),
      channels: { relay: 'r', activity: 'a', dailyRewards: 'd' },
      gameUrl: 'https://game.test',
      breakerState: () => 'closed',
      drain: async () => envelope({ relay: { items: [relayItem('c1')] } }),
      applyLinkChanges: () => {},
      onError: (_error, where) => errors.push(where),
    });

    expect(await runOutboxPoll(io)).toBe(true);
    expect(errors).toEqual(['relay']);
  });
});

/** A SchedulerTimers backed entirely by virtual time (the scheduler suite's rig). */
function clockTimers(clock: SyntheticClock): SchedulerTimers {
  let nextId = 1;
  const cancelled = new Set<number>();
  return {
    setTimeout(cb: () => void, ms: number): SchedulerTimerHandle {
      const id = nextId++;
      void clock.sleep(ms).then(() => {
        if (!cancelled.has(id)) cb();
      });
      return id;
    },
    clearTimeout(handle: SchedulerTimerHandle): void {
      cancelled.add(handle as number);
    },
  };
}

/** The production cadence: 3 s active, decaying to 15 s idle. */
const OUTBOX_CADENCE = { activeMs: 3000, idleMs: 15_000 };

describe('outbox poll on the real scheduler', () => {
  /** A task running the real poll over a drain the test controls. */
  function outboxTask(
    clock: SyntheticClock,
    drain: () => Promise<OutboxEnvelope | null>,
  ): { runAt: number[]; task: ReturnType<LoopScheduler['add']> } {
    const runAt: number[] = [];
    // The band centre, so every delay is exactly the interval and these are
    // cadences rather than jittered samples of them.
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    const rec = recorder({ drain });
    const task = scheduler.add({
      name: 'outbox',
      cadence: OUTBOX_CADENCE,
      run: () => {
        runAt.push(clock.now());
        return runOutboxPoll(rec.io);
      },
    });
    return { runAt, task };
  }

  it('holds the 3 s cadence while every drain finds work', async () => {
    const clock = syntheticClock();
    const busy = envelope({ relay: { items: [relayItem('c1')] } });
    const { runAt, task } = outboxTask(clock, async () => busy);

    task.start();
    await clock.advanceTo(9000);
    // Exact absolute times, so a cadence that drifted or decayed fails.
    expect(runAt).toEqual([3000, 6000, 9000]);
    task.stop();
  });

  it('walks 3000 to 6000 to 12000 to the 15000 ceiling, then SNAPS back on one item', async () => {
    // The D1 backoff end to end, driven until the ceiling is actually REACHED
    // and held: a decay test that stops short of its clamp is constant-true and
    // would pass with the clamp deleted. The snap back is the other half, and it
    // is what makes the backoff safe: the first item after a quiet spell is
    // exactly the one a player is waiting on.
    const clock = syntheticClock();
    let work = false;
    const { runAt, task } = outboxTask(clock, async () =>
      work ? envelope({ relay: { items: [relayItem('c1')] } }) : envelope(),
    );

    task.start();
    await clock.advanceTo(3000);
    expect(runAt).toEqual([3000]);
    // Each empty run doubles the wait: +6000, +12000, then the ceiling.
    await clock.advanceTo(9000);
    await clock.advanceTo(21_000);
    await clock.advanceTo(36_000);
    expect(runAt).toEqual([3000, 9000, 21_000, 36_000]);
    // And it STAYS at 15000 rather than creeping past it.
    await clock.advanceTo(51_000);
    expect(runAt).toEqual([3000, 9000, 21_000, 36_000, 51_000]);

    // One item, and the very next delay is the active cadence again: the run at
    // 66000 is the one that finds it (still on the 15000 ceiling), and the one
    // after it lands 3000 later rather than 15000 later.
    work = true;
    await clock.advanceTo(66_000);
    expect(runAt).toEqual([3000, 9000, 21_000, 36_000, 51_000, 66_000]);
    await clock.advanceTo(69_000);
    expect(runAt).toEqual([3000, 9000, 21_000, 36_000, 51_000, 66_000, 69_000]);
    task.stop();
  });

  it('never runs a second poll beside one still in flight', async () => {
    // EXACTLY ONE LOOP, behaviorally. The scheduler owns the overlap guard, and
    // this is the pin that the outbox poll actually sits behind it: the drain's
    // deadline is 70 s, well past several idle windows, so a poll outliving its
    // own cadence is the ordinary case rather than the exotic one. A repeating
    // timer would have stacked twenty polls by the end of this.
    const clock = syntheticClock();
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = (): void => resolve();
    });
    let drains = 0;
    const { runAt, task } = outboxTask(clock, async () => {
      drains++;
      await held;
      return envelope();
    });

    task.start();
    await clock.advanceTo(3000);
    expect(drains).toBe(1);

    await clock.advanceTo(73_000);
    expect(drains).toBe(1);
    expect(runAt).toEqual([3000]);

    release();
    // The chain resumes only once the run SETTLES, from that moment: the run
    // found nothing, so the next delay is the decayed 6000.
    await clock.advanceTo(79_000);
    expect(drains).toBe(2);
    task.stop();
  });
});
