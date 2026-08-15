# Banner queueing (R38)

Status: shipped with the professions tuning packet's UX phase. The ruling
(R38, docs/design/professions-tuning-packet-review.md): banners QUEUE
instead of last-write-wins, about 2.5 seconds each, level-up first, then
deeds. The confirmed loss it closes: a fresh character's very first
level-up banner was replaced mid-flight by the First Steps deed banner
landing on the same tick.

## The model

One banner element, one scheduler (`src/ui/banner_queue.ts`, a pure core
the Hud drives with its own timers). Two behavior classes:

- **Celebrations** (`levelup`, `deed`): queue FIFO while a banner is live,
  each showing for its own duration (the 2600 ms default) with a short
  fade gap between. A `levelup` arrival files ahead of every queued `deed`
  but never ahead of an earlier queued `levelup`, and never preempts the
  banner already showing. The queue is bounded
  (`BANNER_QUEUE_LIMIT`); a full queue drops the incoming banner. That is
  safe because every celebration's durable record is its chat-log line and
  its polite live-region push, both emitted by the caller regardless of
  the banner; only the ornament is dropped, and deep celebration bursts
  only occur on the retro catch-up paths that deliberately draw no
  banners at all.

- **Ambient** (the default: zone names, mount prompts, race countdowns,
  the unstuck notice): current-state text, not history. An ambient
  arrival still REPLACES a live ambient banner immediately, the pre-R38
  behavior, which the race countdown depends on. While a celebration is
  live, ambient waits in a single latest-wins pending seat rather than a
  queue: replaying three stale countdown numbers after a deed banner
  would be worse than showing the newest once. The seat also AGES
  (`AMBIENT_MAX_DEFER_MS` in hud.ts, the QA refinement): parked behind
  one celebration an ambient is still fresh and replays; parked behind a
  celebration chain it is stale news and the advance chain drops it.

## Interactions kept honest

- `clearUnstuckBanner` purges queued unstuck entries and, when it clears
  the live banner, advances the queue so a waiting celebration still
  shows.
- `hideBannerImmediately` is an ambient TAKEOVER (the mount-race
  countdown claiming the slot), not a reset: it rides `hideLive`, which
  ends the live banner and drops the stale pending-ambient seat while
  every queued celebration survives to play afterwards. `clear()` stays
  the hard-reset primitive for a future teleport-style wipe.
- The duel and arena countdown arms lay a chat-log line exactly when
  their banner did NOT show immediately (parked or aged out behind a
  celebration), so a countdown compromised by a collision still leaves a
  durable record; an on-screen countdown logs nothing.
- The attunement banner rides the `deed` celebration class (its epic
  zone-broadcast log line was always the durable record; classed ambient
  it could vanish in the latest-wins seat behind a live level-up).
- Accessibility is unchanged: the banner div carries no live semantics;
  the polite `#combat-live` region push and the chat-log line stay the
  announced and durable records, emitted before the banner is scheduled.

## Rejected

- Queueing ambient banners FIFO: replays stale current-state text (zone
  names, countdown digits) after the queue drains.
- Preempting the live banner for a level-up: a banner that can vanish
  mid-read is the exact defect R38 exists to close.
- An unbounded queue: a burst would monopolize the slot for tens of
  seconds; the log is the record, the banner is the ornament.
