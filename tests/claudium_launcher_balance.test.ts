// The Claudium launcher balance state machine (issues #2411, #2414), driven
// directly. Before the extraction this logic sat on the Hud coordinator, which
// nothing but src/main.ts constructs, so the only available pins were source-text
// matches on hud.ts: they could name the SHAPE of the code but never execute it, and
// the two bugs this file covers are both invisible to a shape pin.
//
//  - #2411: the read resolved and repainted whether or not the number had moved, so
//    an open bag with a moving purse paid a byte-identical footer rewrite (innerHTML
//    replace plus two listener re-binds, dropping focus off whichever launcher held
//    it) every time a paint crossed the throttle boundary.
//  - #2414: three of the four balance writes (the store snapshot, a store spend, the
//    Claudium window snapshot) never repainted at all, so buying an armory skin left
//    an open bag showing the pre-spend number.
//
// One changed-only converge inside set() fixes both, and every case below counts
// converge calls rather than inspecting anything, so a regression to an
// unconditional repaint (or to no repaint) is a failing count, not a prose review.
// The footer-level proof that a converge really is a narrow money-row paint (and an
// elided one really leaves the DOM alone) is in tests/bags_money_row_paint.test.ts.

import { describe, expect, it } from 'vitest';
import {
  CLAUDIUM_BALANCE_THROTTLE_MS,
  ClaudiumLauncherBalance,
} from '../src/ui/claudium_launcher_balance_core';

interface Harness {
  balance: ClaudiumLauncherBalance;
  /** How many times the display was told to converge. */
  converges(): number;
  /** How many reads were STARTED (not merely scheduled). */
  reads(): number;
  /** Resolve the oldest in-flight read with `value`. */
  resolve(value: number | null): Promise<void>;
  /** Reject the oldest in-flight read. */
  reject(): Promise<void>;
  advance(ms: number): void;
  setEnabled(on: boolean): void;
  /** Run `fn` inside the next converge callback, to exercise re-entry. */
  onConverge(fn: () => void): void;
}

function harness(opts: { enabled?: boolean } = {}): Harness {
  let clock = 1_000_000; // a non-zero start, so a zero stamp is never mistaken for now
  let enabled = opts.enabled ?? true;
  let converges = 0;
  let reads = 0;
  const inflight: Array<{ resolve(v: number | null): void; reject(): void }> = [];
  let reentry: (() => void) | null = null;
  const balance = new ClaudiumLauncherBalance({
    enabled: () => enabled,
    read: () => {
      reads++;
      return new Promise<number | null>((res, rej) => {
        inflight.push({ resolve: res, reject: () => rej(new Error('read failed')) });
      });
    },
    onChanged: () => {
      converges++;
      const fn = reentry;
      reentry = null;
      fn?.();
    },
    now: () => clock,
  });
  // Drain the whole .then -> .catch -> .finally chain, not just its first link: each
  // link is its own microtask, and stopping early would leave `pending` set and make
  // the next refresh look like the in-flight guard blocked it.
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  // Loud, not optional-chained: an elision case that never actually STARTED the read
  // it claims to elide would otherwise pass for the wrong reason, and a gate mutation
  // that stops the read entirely would look like a successful elision.
  const take = (): { resolve(v: number | null): void; reject(): void } => {
    const next = inflight.shift();
    if (!next) throw new Error('settled a read that was never started');
    return next;
  };
  return {
    balance,
    converges: () => converges,
    reads: () => reads,
    resolve: async (value) => {
      take().resolve(value);
      await settle();
    },
    reject: async () => {
      take().reject();
      await settle();
    },
    advance: (ms) => {
      clock += ms;
    },
    setEnabled: (on) => {
      enabled = on;
    },
    onConverge: (fn) => {
      reentry = fn;
    },
  };
}

describe('a resolved read converges the display only when the number MOVED (#2411)', () => {
  it('converges on the first balance, arriving from unknown', async () => {
    const h = harness();
    h.balance.refresh(true);
    await h.resolve(500);
    expect(h.balance.balance).toBe(500);
    expect(h.converges()).toBe(1);
  });

  it('does NOT converge when the read returns the value already displayed', async () => {
    const h = harness();
    h.balance.refresh(true);
    await h.resolve(500);
    expect(h.converges()).toBe(1);

    // The reported bug in two lines: the poll comes back with the same number.
    h.advance(CLAUDIUM_BALANCE_THROTTLE_MS);
    h.balance.refresh();
    await h.resolve(500);
    expect(h.converges()).toBe(1); // still one, not two
    expect(h.balance.balance).toBe(500);

    // And it stays elided across repeats: this is the case the 30s throttle turns
    // into a rewrite roughly twice a minute for as long as the purse keeps moving.
    for (let i = 0; i < 4; i++) {
      h.advance(CLAUDIUM_BALANCE_THROTTLE_MS);
      h.balance.refresh();
      await h.resolve(500);
    }
    expect(h.converges()).toBe(1);
  });

  it('converges again as soon as the number really does move', async () => {
    const h = harness();
    h.balance.refresh(true);
    await h.resolve(500);
    h.advance(CLAUDIUM_BALANCE_THROTTLE_MS);
    h.balance.refresh();
    await h.resolve(500); // elided
    h.advance(CLAUDIUM_BALANCE_THROTTLE_MS);
    h.balance.refresh();
    await h.resolve(420); // moved
    expect(h.converges()).toBe(2);
    expect(h.balance.balance).toBe(420);
  });

  it('treats a repeated unknown as unchanged, and a first unknown as a move', async () => {
    // Both directions of the null edge, because null is a real balance state here
    // (the launcher renders it as '--'), not merely an absence.
    const h = harness();
    h.balance.refresh(true);
    await h.resolve(null); // unknown -> unknown: nothing on screen changes
    expect(h.converges()).toBe(0);

    h.advance(CLAUDIUM_BALANCE_THROTTLE_MS);
    h.balance.refresh();
    await h.resolve(500);
    expect(h.converges()).toBe(1);

    h.advance(CLAUDIUM_BALANCE_THROTTLE_MS);
    h.balance.refresh();
    await h.resolve(null); // 500 -> unknown IS a visible change
    expect(h.converges()).toBe(2);
    expect(h.balance.balance).toBeNull();
  });

  it('exposes the new value BEFORE it converges, so the repaint paints it', async () => {
    // Ordering, not incidental: onChanged repaints a footer that reads .balance to
    // build the label. Converge first and the paint would render the old number and
    // then never be asked again.
    const h = harness();
    const seen: Array<number | null> = [];
    h.onConverge(() => seen.push(h.balance.balance));
    h.balance.refresh(true);
    await h.resolve(777);
    expect(seen).toEqual([777]);
  });
});

describe('every other balance write converges through the same seam (#2414)', () => {
  // The store snapshot, a store spend and the Claudium window snapshot all write a
  // balance the HUD learned without a launcher read. Each used to update the field
  // and stop there, which is why an armory-skin purchase left an open bag stale.
  it('a direct write converges when it moves the number', () => {
    const h = harness();
    h.balance.set(500);
    expect(h.converges()).toBe(1);
    h.balance.set(420); // the spend result
    expect(h.converges()).toBe(2);
    expect(h.balance.balance).toBe(420);
  });

  it('a direct write of the SAME number stays elided', () => {
    // Opening the store re-reads the balance and hands it over unchanged; that must
    // not cost a footer rewrite either.
    const h = harness();
    h.balance.set(500);
    h.balance.set(500);
    h.balance.set(500);
    expect(h.converges()).toBe(1);
  });

  it('defers the next unforced read, since a written balance is already fresh', () => {
    const h = harness();
    h.balance.set(500);
    h.balance.refresh();
    expect(h.reads()).toBe(0);
    h.advance(CLAUDIUM_BALANCE_THROTTLE_MS - 1);
    h.balance.refresh();
    expect(h.reads()).toBe(0);
    h.advance(1);
    h.balance.refresh();
    expect(h.reads()).toBe(1);
  });
});

describe('the re-entry guard (a converge repaints a surface that reads the label)', () => {
  it('a nested refresh from inside a direct write starts no read', () => {
    // The load-bearing ordering: set() stamps the throttle BEFORE calling onChanged.
    // On this path there is no read in flight, so the stamp is the ONLY thing
    // standing between a converge and a self-feeding read. Move the stamp below the
    // callback and this reds while every behavior test above stays green.
    const h = harness();
    h.onConverge(() => h.balance.refresh());
    h.balance.set(500);
    expect(h.converges()).toBe(1);
    expect(h.reads()).toBe(0);
  });

  it('a nested refresh from inside a read resolve starts no read', async () => {
    // Here the in-flight flag is the guard: it is still set inside .then, because
    // .finally has not run yet. Clearing it in .then instead would re-open the loop.
    const h = harness();
    h.onConverge(() => h.balance.refresh(true)); // forced: only `pending` can stop it
    h.balance.refresh(true);
    expect(h.reads()).toBe(1);
    await h.resolve(500);
    expect(h.converges()).toBe(1);
    expect(h.reads()).toBe(1);
  });

  it('releases the flag once the read settles, so the next refresh is not deadlocked', async () => {
    const h = harness();
    h.balance.refresh(true);
    await h.resolve(500);
    h.advance(CLAUDIUM_BALANCE_THROTTLE_MS);
    h.balance.refresh();
    expect(h.reads()).toBe(2);
  });

  it('releases the flag after a FAILED read too', async () => {
    const h = harness();
    h.balance.refresh(true);
    await h.reject();
    h.balance.refresh(true);
    expect(h.reads()).toBe(2);
  });
});

describe('the read gates', () => {
  it('never reads while one is in flight, forced or not', () => {
    const h = harness();
    h.balance.refresh(true);
    h.balance.refresh(true);
    h.balance.refresh();
    expect(h.reads()).toBe(1);
  });

  it('lets a cold unforced read through, since nothing has been written yet', () => {
    // The boot shape: the launcher label is painted before any balance exists, and
    // that first paint is what starts the read. A throttle measured from a zero
    // stamp must not swallow it.
    const h = harness();
    h.balance.refresh();
    expect(h.reads()).toBe(1);
  });

  it('measures the throttle from the last write, to the millisecond', async () => {
    const h = harness();
    h.balance.refresh(true);
    await h.resolve(500);
    h.advance(CLAUDIUM_BALANCE_THROTTLE_MS - 1);
    h.balance.refresh();
    expect(h.reads()).toBe(1); // one millisecond short
    h.advance(1);
    h.balance.refresh();
    expect(h.reads()).toBe(2);
  });

  it('force bypasses the throttle but not the in-flight guard', async () => {
    const h = harness();
    h.balance.refresh(true);
    await h.resolve(500);
    h.balance.refresh(); // throttled
    expect(h.reads()).toBe(1);
    h.balance.refresh(true); // forced through
    expect(h.reads()).toBe(2);
    h.balance.refresh(true); // but a read is in flight
    expect(h.reads()).toBe(2);
  });

  it('reads nothing at all while the economy hooks are absent', async () => {
    const h = harness({ enabled: false });
    h.balance.refresh(true);
    h.balance.refresh();
    expect(h.reads()).toBe(0);
    expect(h.converges()).toBe(0);
    // Enabled is checked BEFORE read(), so the offline client never even builds a
    // request it would have to discard.
    h.setEnabled(true);
    h.balance.refresh(true);
    expect(h.reads()).toBe(1);
    await h.resolve(500);
    expect(h.converges()).toBe(1);
  });

  it('pins the throttle floor at 30s', () => {
    expect(CLAUDIUM_BALANCE_THROTTLE_MS).toBe(30_000);
  });
});

describe('stale responses and reset', () => {
  it('drops a response that reset() invalidated, value and converge alike', async () => {
    // attachClaudium re-arms for a fresh set of hooks (a new session or character).
    // A response still in the air belongs to the old one and must not be shown.
    const h = harness();
    h.balance.refresh(true);
    h.balance.reset();
    await h.resolve(999);
    expect(h.balance.balance).toBeNull();
    expect(h.converges()).toBe(0);
  });

  it('drops a stale FAILURE too, rather than blanking a fresh balance', async () => {
    const h = harness();
    h.balance.refresh(true); // read A
    h.balance.reset();
    h.balance.set(500); // the fresh session's balance
    expect(h.converges()).toBe(1);
    await h.reject(); // A fails, late
    expect(h.balance.balance).toBe(500);
    expect(h.converges()).toBe(1);
  });

  it('reset() clears the value and the throttle without converging', () => {
    const h = harness();
    h.balance.set(500);
    expect(h.converges()).toBe(1);
    h.balance.reset();
    expect(h.balance.balance).toBeNull();
    expect(h.converges()).toBe(1); // the caller follows with a forced read
    h.balance.refresh(); // unforced, and NOT throttled: the stamp was cleared
    expect(h.reads()).toBe(1);
  });

  it('lets a read started after reset() through, in flight or not', async () => {
    const h = harness();
    h.balance.refresh(true); // read A, abandoned
    h.balance.reset(); // clears `pending` so the new session can read at once
    h.balance.refresh(true); // read B
    expect(h.reads()).toBe(2);
    await h.resolve(999); // A resolves first, and is stale
    expect(h.balance.balance).toBeNull();
    await h.resolve(600); // B is current
    expect(h.balance.balance).toBe(600);
    expect(h.converges()).toBe(1);
  });

  it('does not let a stale read release the CURRENT read in flight', async () => {
    // The `seq === this.seq` guard on the pending clear, which only an overlapping
    // pair can observe: A is abandoned by reset(), B is started, then A settles. If
    // the finally arm cleared the flag unconditionally, A's settle would hand B's
    // in-flight slot away and the next refresh would fire a third request against an
    // endpoint that already has one open.
    const h = harness();
    h.balance.refresh(true); // A
    h.balance.reset();
    h.balance.refresh(true); // B, the current read
    await h.resolve(999); // A settles, stale
    h.balance.refresh(true); // forced, so only the in-flight flag can stop it
    expect(h.reads()).toBe(2);
  });
});

describe('a direct write overtakes a read already in the air', () => {
  // Both halves of the drop rule matter. A store spend or a Claudium window snapshot
  // can land while the footer paint's own read is still open, and that read is
  // answering the pre-spend question: letting it through would repaint the fresh
  // number and then revert it to the old one, which is #2414 back again inside the
  // width of one request.
  it('drops the older response instead of reverting the fresh balance', async () => {
    const h = harness();
    h.balance.set(500);
    h.advance(CLAUDIUM_BALANCE_THROTTLE_MS);
    h.balance.refresh(); // the footer paint's read, asking about 500
    h.balance.set(300); // the spend result lands first
    expect(h.converges()).toBe(2);

    await h.resolve(500); // the pre-spend answer, now obsolete
    expect(h.balance.balance).toBe(300);
    expect(h.converges()).toBe(2); // no third, reverting, repaint
  });

  it('drops an overtaken FAILURE too, rather than blanking the fresh balance', async () => {
    const h = harness();
    h.balance.set(500);
    h.advance(CLAUDIUM_BALANCE_THROTTLE_MS);
    h.balance.refresh();
    h.balance.set(300);
    await h.reject();
    expect(h.balance.balance).toBe(300);
    expect(h.converges()).toBe(2);
  });

  it('still releases the in-flight flag, so the next read is not locked out', async () => {
    const h = harness();
    h.balance.set(500);
    h.advance(CLAUDIUM_BALANCE_THROTTLE_MS);
    h.balance.refresh();
    h.balance.set(300);
    await h.resolve(500);
    h.balance.refresh(true);
    expect(h.reads()).toBe(2);
  });

  it('does not drop a resolve that only its OWN write follows', async () => {
    // The counter is captured before the request and compared before the resolve
    // writes, so a read never invalidates itself. Without this the elision would
    // become a total block and the balance would never update at all.
    const h = harness();
    h.balance.refresh(true);
    await h.resolve(500);
    expect(h.balance.balance).toBe(500);
    expect(h.converges()).toBe(1);
    h.advance(CLAUDIUM_BALANCE_THROTTLE_MS);
    h.balance.refresh();
    await h.resolve(420);
    expect(h.balance.balance).toBe(420);
    expect(h.converges()).toBe(2);
  });
});

describe('a failed read converges the display to unknown', () => {
  it('replaces a number nothing backs with the unknown state', async () => {
    // A deliberate change of behavior, and the reason the converge lives in set():
    // the field went null on a failed read before this too, so the stale number on
    // screen survived only until some unrelated repaint flipped it to '--'. One seam
    // means the display never disagrees with what the HUD believes.
    const h = harness();
    h.balance.refresh(true);
    await h.resolve(500);
    expect(h.converges()).toBe(1);

    h.advance(CLAUDIUM_BALANCE_THROTTLE_MS);
    h.balance.refresh();
    await h.reject();
    expect(h.balance.balance).toBeNull();
    expect(h.converges()).toBe(2);
  });

  it('stays silent when the balance was already unknown', async () => {
    const h = harness();
    h.balance.refresh(true);
    await h.reject();
    expect(h.converges()).toBe(0);
  });

  it('stamps the throttle on failure, so a broken endpoint is not hammered', async () => {
    const h = harness();
    h.balance.refresh(true);
    await h.reject();
    h.balance.refresh();
    expect(h.reads()).toBe(1);
    h.advance(CLAUDIUM_BALANCE_THROTTLE_MS);
    h.balance.refresh();
    expect(h.reads()).toBe(2);
  });
});

describe('the injected clock', () => {
  it('reads the clock per call rather than capturing it at construction', async () => {
    // The module takes its clock as a dep (no Date.now of its own: it is a registered
    // src/ui pure core, and the architecture guard enforces that). Calling the dep on
    // every gate check rather than caching a timestamp is what keeps the throttle
    // honest under a clock that moves, which is the whole point of injecting one.
    // Non-zero, so the blocked read below is attributable to the stamp the resolve
    // took rather than to lastWriteAt's zero sentinel happening to equal the clock.
    let clock = 1_000_000;
    let reads = 0;
    const balance = new ClaudiumLauncherBalance({
      enabled: () => true,
      read: () => {
        reads++;
        return Promise.resolve(500);
      },
      onChanged: () => {},
      now: () => clock,
    });
    balance.refresh(true);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(reads).toBe(1);

    balance.refresh(); // inside the window the resolve just stamped
    expect(reads).toBe(1);
    clock += CLAUDIUM_BALANCE_THROTTLE_MS;
    balance.refresh();
    expect(reads).toBe(2);
  });
});
