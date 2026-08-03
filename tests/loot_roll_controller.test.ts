import { describe, expect, it, vi } from 'vitest';
import type {
  LootRollGroupStatus,
  LootRollPrompt,
  MasterLootPrompt,
  SimEvent,
} from '../src/sim/types';
import { LootRollController } from '../src/ui/hud/loot/loot_roll_controller';
import { LOOT_ROLL_REGRACE_MS } from '../src/ui/hud/loot/loot_roll_reconcile';
import { makeWriterFacet } from '../src/ui/painter_host';
import type { IWorld } from '../src/world_api';
import { FakeDocument, FakeElement } from './helpers/fake_dom';

class LootElement extends FakeElement {
  override set innerHTML(value: string) {
    super.innerHTML = value;
    if (value.includes('class="loot-roll-item"')) {
      const item = this.ownerDocument.createElement('div');
      item.className = 'loot-roll-item';
      this.appendChild(item);
    }
    for (const choice of value.matchAll(/data-choice="(need|greed|pass)"/g)) {
      const button = this.ownerDocument.createElement('button');
      button.dataset.choice = choice[1];
      this.appendChild(button);
    }
    if (value.includes('class="ml-all"')) {
      const selectAll = this.ownerDocument.createElement('input');
      selectAll.className = 'ml-all';
      (selectAll as unknown as HTMLInputElement).checked = false;
      this.appendChild(selectAll);
    }
    for (const pick of value.matchAll(/class="ml-pick" value="(\d+)"/g)) {
      const input = this.ownerDocument.createElement('input');
      input.className = 'ml-pick';
      input.value = pick[1];
      (input as unknown as HTMLInputElement).checked = false;
      this.appendChild(input);
    }
    if (value.includes('class="loot-roll-btn assign ml-roll"')) {
      const button = this.ownerDocument.createElement('button');
      button.className = 'ml-roll';
      (button as unknown as HTMLButtonElement).disabled = true;
      this.appendChild(button);
    }
  }

  override get innerHTML(): string {
    return super.innerHTML;
  }

  override querySelectorAll<T extends Element = Element>(selector: string): T[] {
    if (selector === '[data-choice]') {
      return this.children.filter((child) => child.dataset.choice) as unknown as T[];
    }
    return super.querySelectorAll<T>(selector);
  }
}

class LootDocument extends FakeDocument {
  override createElement(tagName: string): LootElement {
    return new LootElement(tagName.toUpperCase(), this);
  }
}

const prompt = (rollId = 7): LootRollPrompt => ({
  rollId,
  itemId: 'greyjaw_hide_boots',
  itemName: 'Greyjaw Hide Boots',
  quality: 'uncommon',
  expiresAt: 60_000,
});

const rollEvent = (rollId = 7): Extract<SimEvent, { type: 'lootRoll' }> => ({
  type: 'lootRoll',
  ...prompt(rollId),
});

// The master-looter reconcile surface (IWorld.activeMasterLootRolls): the same
// prompt fields plus the roll's CURRENT candidate roster.
const masterPrompt = (
  candidates: { pid: number; name: string }[] = [
    { pid: 2, name: 'Aki' },
    { pid: 3, name: 'Bex' },
  ],
  rollId = 7,
): MasterLootPrompt => ({ ...prompt(rollId), candidates });

function harness() {
  const document = new LootDocument();
  const ui = document.element('ui');
  const root = document.element('loot-rolls') as LootElement;
  ui.appendChild(root);
  let now = 1_000;
  let open: LootRollPrompt[] = [];
  let masterOpen: MasterLootPrompt[] = [];
  let statuses: LootRollGroupStatus[] = [];
  const submitLootRoll = vi.fn();
  const assignMasterLoot = vi.fn();
  const writerCounts = { writes: 0, skips: 0 };
  // Retained so a test can read back the elided style props the painter wrote
  // (the timer fraction is only ever a CSS custom property).
  const stylePropCache = new Map<HTMLElement, Map<string, string>>();
  const writers = makeWriterFacet(
    new Map(),
    stylePropCache,
    new Map(),
    new Map(),
    () => writerCounts.writes++,
    () => writerCounts.skips++,
  );
  const world = {
    playerId: 2,
    activeLootRolls: () => open,
    activeMasterLootRolls: () => masterOpen,
    lootRollGroupStatus: () => statuses,
    submitLootRoll,
    assignMasterLoot,
  } as unknown as Pick<
    IWorld,
    | 'activeLootRolls'
    | 'activeMasterLootRolls'
    | 'assignMasterLoot'
    | 'lootRollGroupStatus'
    | 'playerId'
    | 'submitLootRoll'
  >;
  const controller = new LootRollController({
    document: document as unknown as Document,
    world: () => world,
    now: () => now,
    isMobileLayout: () => false,
    itemIcon: () => '<img class="test-item-icon">',
    itemTooltip: () => 'tooltip',
    attachTooltip: () => {},
    writers,
  });
  return {
    controller,
    root,
    submitLootRoll,
    assignMasterLoot,
    setOpen: (next: LootRollPrompt[]) => {
      open = next;
    },
    setMasterOpen: (next: MasterLootPrompt[]) => {
      masterOpen = next;
    },
    setStatuses: (next: LootRollGroupStatus[]) => {
      statuses = next;
    },
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
    writerCounts,
    timerFrac: (element: HTMLElement | null) =>
      element ? Number(stylePropCache.get(element)?.get('--loot-roll-frac')) : Number.NaN,
  };
}

describe('LootRollController', () => {
  it('recovers a missed event from the authoritative mirror and retires it after resolution', () => {
    const test = harness();
    test.setOpen([prompt()]);

    test.controller.update(test.now());

    expect(test.root.style.display).toBe('flex');
    expect(test.root.querySelectorAll('.loot-roll')).toHaveLength(1);

    test.setOpen([]);
    test.controller.update(test.now());

    expect(test.root.style.display).toBe('none');
    expect(test.root.querySelectorAll('.loot-roll')).toHaveLength(0);
  });

  it('submits the selected choice and suppresses a stale mirror until the retry grace expires', () => {
    const test = harness();
    test.setOpen([prompt()]);
    test.controller.showRoll(rollEvent());
    const row = test.root.querySelector<HTMLElement>('.loot-roll') as unknown as LootElement | null;
    const buttons =
      (row?.querySelectorAll<HTMLElement>('[data-choice]') as unknown as LootElement[]) ?? [];
    const greed = buttons.find((button) => button.dataset.choice === 'greed');

    greed?.dispatchEvent(new Event('click'));

    expect(test.submitLootRoll).toHaveBeenCalledWith(7, 'greed');
    expect(test.root.style.display).toBe('none');

    test.controller.update(test.now());
    expect(test.root.style.display).toBe('none');

    test.advance(LOOT_ROLL_REGRACE_MS);
    test.controller.update(test.now());
    expect(test.root.style.display).toBe('flex');
  });

  it('replaces a master-loot prompt when the server converts the same roll to need-greed', () => {
    const test = harness();
    test.controller.showMasterRoll({
      type: 'masterLoot',
      ...prompt(),
      candidates: [
        { pid: 2, name: 'Aki' },
        { pid: 3, name: 'Bex' },
      ],
    });
    expect(test.root.querySelector('.master')).not.toBeNull();

    test.controller.showRoll(rollEvent());

    expect(test.root.querySelectorAll('.loot-roll')).toHaveLength(1);
    expect(test.root.querySelector('.master')).toBeNull();
  });

  it('sends exactly the checked master-loot candidate subset through IWorld', () => {
    const test = harness();
    test.controller.showMasterRoll({
      type: 'masterLoot',
      ...prompt(),
      candidates: [
        { pid: 2, name: 'Aki' },
        { pid: 3, name: 'Bex' },
        { pid: 4, name: 'Cai' },
      ],
    });
    const row = test.root.querySelector<HTMLElement>('.master') as unknown as LootElement | null;
    const picks = row?.querySelectorAll<HTMLInputElement>('.ml-pick') ?? [];
    picks[0].checked = true;
    picks[2].checked = true;
    picks[0].dispatchEvent(new Event('change'));

    row?.querySelector<HTMLButtonElement>('.ml-roll')?.dispatchEvent(new Event('click'));

    expect(test.assignMasterLoot).toHaveBeenCalledWith(7, [2, 4]);
    expect(test.root.style.display).toBe('none');
  });

  // #2526. assign() clears the row on a local intent, but the sim REFUSES an
  // assignment whose every named pid is no longer a candidate and deliberately
  // leaves the roll in its curate phase. Before the master-looter reconcile
  // surface existed, the transient masterLoot event was the only delivery of the
  // prompt, so that refusal stranded the looter until the 300s timeout.
  it('restores a refused master-loot assignment from the mirror once the grace expires', () => {
    const test = harness();
    test.setMasterOpen([masterPrompt()]);
    test.controller.showMasterRoll({ type: 'masterLoot', ...masterPrompt() });
    test.controller.update(test.now());
    expect(test.root.querySelector('.master')).not.toBeNull();

    const row = test.root.querySelector<HTMLElement>('.master') as unknown as LootElement | null;
    const picks = row?.querySelectorAll<HTMLInputElement>('.ml-pick') ?? [];
    picks[1].checked = true;
    picks[1].dispatchEvent(new Event('change'));
    row?.querySelector<HTMLButtonElement>('.ml-roll')?.dispatchEvent(new Event('click'));

    // The command went out and the row cleared optimistically.
    expect(test.assignMasterLoot).toHaveBeenCalledWith(7, [3]);
    expect(test.root.style.display).toBe('none');

    // The sim refused it, so the roll is STILL on the authoritative surface. The
    // grace keeps a normal (accepted) assignment from flashing its row back while
    // the round trip lands, so nothing returns yet.
    test.controller.update(test.now());
    expect(test.root.querySelector('.master')).toBeNull();

    test.advance(LOOT_ROLL_REGRACE_MS);
    test.controller.update(test.now());
    expect(test.root.querySelector('.master')).not.toBeNull();
    expect(test.root.style.display).toBe('flex');
  });

  it('rebuilds a restored master row from the current roster, not the consumed event', () => {
    const test = harness();
    // The looter saw three candidates when the roll opened.
    test.controller.showMasterRoll({
      type: 'masterLoot',
      ...masterPrompt([
        { pid: 2, name: 'Aki' },
        { pid: 3, name: 'Bex' },
        { pid: 4, name: 'Cai' },
      ]),
    });
    // Bex logged out mid-window, so the sim dropped her from the roll and refused
    // the assignment naming her. Restoring the row from the RETAINED EVENT would
    // re-offer her and the looter would be refused forever; it is rebuilt from the
    // surface instead.
    test.setMasterOpen([
      masterPrompt([
        { pid: 2, name: 'Aki' },
        { pid: 4, name: 'Cai' },
      ]),
    ]);
    const stale = test.root.querySelector<HTMLElement>('.master') as unknown as LootElement | null;
    const picks = stale?.querySelectorAll<HTMLInputElement>('.ml-pick') ?? [];
    expect(picks.map((pick) => pick.value)).toEqual(['2', '3', '4']);
    picks[1].checked = true;
    picks[1].dispatchEvent(new Event('change'));
    stale?.querySelector<HTMLButtonElement>('.ml-roll')?.dispatchEvent(new Event('click'));
    expect(test.assignMasterLoot).toHaveBeenCalledWith(7, [3]);

    test.advance(LOOT_ROLL_REGRACE_MS);
    test.controller.update(test.now());

    const fresh = test.root.querySelector<HTMLElement>('.master') as unknown as LootElement | null;
    expect(fresh).not.toBeNull();
    expect(
      (fresh?.querySelectorAll<HTMLInputElement>('.ml-pick') ?? []).map((p) => p.value),
    ).toEqual(['2', '4']);
  });

  it('shows a curate-phase master prompt whose event never arrived (reconnect)', () => {
    const test = harness();
    test.setMasterOpen([masterPrompt()]);

    test.controller.update(test.now());

    // Never dismissed, so no grace applies: the mirror alone restores the prompt.
    expect(test.root.querySelector('.master')).not.toBeNull();
    expect(test.root.style.display).toBe('flex');
  });

  it('retires a master row once the sim drops the roll from the surface', () => {
    const test = harness();
    test.setMasterOpen([masterPrompt()]);
    test.controller.update(test.now());
    expect(test.root.querySelector('.master')).not.toBeNull();

    test.setMasterOpen([]);
    test.controller.update(test.now());

    expect(test.root.querySelector('.master')).toBeNull();
    expect(test.root.style.display).toBe('none');
  });

  it('does not let an assignment suppress the need-greed prompt the same roll id becomes', () => {
    const test = harness();
    test.setMasterOpen([masterPrompt()]);
    test.controller.showMasterRoll({ type: 'masterLoot', ...masterPrompt() });
    const row = test.root.querySelector<HTMLElement>('.master') as unknown as LootElement | null;
    const picks = row?.querySelectorAll<HTMLInputElement>('.ml-pick') ?? [];
    for (const pick of picks) pick.checked = true;
    picks[0].dispatchEvent(new Event('change'));
    row?.querySelector<HTMLButtonElement>('.ml-roll')?.dispatchEvent(new Event('click'));
    expect(test.assignMasterLoot).toHaveBeenCalledWith(7, [2, 3]);

    // Two or more targets converts the roll in place: it KEEPS its id and comes
    // back as a need/greed prompt. A shared dismissed set would swallow it for the
    // whole grace window, so the master state is deliberately separate.
    test.setMasterOpen([]);
    test.setOpen([prompt()]);
    test.controller.update(test.now());

    expect(test.root.querySelector('.master')).toBeNull();
    expect(test.root.querySelectorAll('.loot-roll')).toHaveLength(1);
    // Not just "a row is present": it is the need/greed row, with live buttons.
    const reopened = test.root.querySelector<HTMLElement>(
      '.loot-roll',
    ) as unknown as LootElement | null;
    expect(
      (reopened?.querySelectorAll<HTMLElement>('[data-choice]') ?? []).map(
        (button) => button.dataset.choice,
      ),
    ).toEqual(['need', 'greed', 'pass']);
  });

  it('brings back the same-item master row closeForItem over-cleared, and only that one', () => {
    const test = harness();
    // Two corpses can drop the same item, so two master rolls can be open at once.
    // closeForItem matches on ITEM ID, not roll id, so resolving one clears both
    // rows. Only the resolved roll leaves the surface, so the survivor is restored
    // on the next frame; it was never a local intent, so no grace applies to it.
    test.controller.showMasterRoll({ type: 'masterLoot', ...masterPrompt(undefined, 7) });
    test.controller.showMasterRoll({ type: 'masterLoot', ...masterPrompt(undefined, 8) });
    expect(test.root.querySelectorAll('.master')).toHaveLength(2);

    test.controller.closeForItem('Aki assigned [[i:greyjaw_hide_boots]] to Bex.');
    expect(test.root.querySelectorAll('.master')).toHaveLength(0);

    test.setMasterOpen([masterPrompt(undefined, 8)]);
    test.controller.update(test.now());

    const restored = test.root.querySelectorAll<HTMLElement>('.master');
    expect(restored.map((row) => row.dataset.rollId)).toEqual(['8']);
  });

  it('resumes the restored row on its original clock instead of restarting the bar', () => {
    const test = harness();
    test.setMasterOpen([masterPrompt()]);
    test.controller.showMasterRoll({ type: 'masterLoot', ...masterPrompt() });
    // Four minutes into the five-minute curate window, the looter's assignment is
    // refused. The restored row must show the ~1 minute that is actually left, not
    // a fresh five.
    test.advance(240_000);
    test.controller.update(test.now());
    const row = test.root.querySelector<HTMLElement>('.master') as unknown as LootElement | null;
    const picks = row?.querySelectorAll<HTMLInputElement>('.ml-pick') ?? [];
    picks[1].checked = true;
    picks[1].dispatchEvent(new Event('change'));
    row?.querySelector<HTMLButtonElement>('.ml-roll')?.dispatchEvent(new Event('click'));

    test.advance(LOOT_ROLL_REGRACE_MS);
    test.controller.update(test.now());
    const restored = test.root.querySelector<HTMLElement>('.master');
    expect(restored).not.toBeNull();
    // 242s of a 300s window spent, so roughly a fifth of the bar is left. A
    // restarted clock would paint 1.000 here.
    const frac = test.timerFrac(restored);
    expect(frac).toBeGreaterThan(0.15);
    expect(frac).toBeLessThan(0.25);
  });

  it('refreshes a roster change on a row that is already up, keeping the selection', () => {
    const test = harness();
    const roster = [
      { pid: 2, name: 'Aki' },
      { pid: 3, name: 'Bex' },
      { pid: 4, name: 'Cai' },
    ];
    test.setMasterOpen([masterPrompt(roster)]);
    test.controller.showMasterRoll({ type: 'masterLoot', ...masterPrompt(roster) });
    const row = test.root.querySelector<HTMLElement>('.master') as unknown as LootElement | null;
    const picks = row?.querySelectorAll<HTMLInputElement>('.ml-pick') ?? [];
    picks[0].checked = true; // the looter is mid-selection on Aki
    picks[0].dispatchEvent(new Event('change'));

    // Bex logs out. The surface drops her immediately, and the row must follow it
    // WITHOUT a click, so the looter never gets the chance to be refused at all.
    test.setMasterOpen([masterPrompt([roster[0], roster[2]])]);
    test.controller.update(test.now());

    const fresh = test.root.querySelector<HTMLElement>('.master') as unknown as LootElement | null;
    const freshPicks = fresh?.querySelectorAll<HTMLInputElement>('.ml-pick') ?? [];
    expect(freshPicks.map((pick) => pick.value)).toEqual(['2', '4']);
    // The half-made selection survived the repaint, and the Roll button with it.
    expect(freshPicks.filter((pick) => pick.checked).map((pick) => pick.value)).toEqual(['2']);
    expect(fresh?.querySelector<HTMLButtonElement>('.ml-roll')?.disabled).toBe(false);
  });

  it('drops a departed pid from the carried selection rather than re-checking it', () => {
    const test = harness();
    const roster = [
      { pid: 2, name: 'Aki' },
      { pid: 3, name: 'Bex' },
    ];
    test.setMasterOpen([masterPrompt(roster)]);
    test.controller.showMasterRoll({ type: 'masterLoot', ...masterPrompt(roster) });
    const row = test.root.querySelector<HTMLElement>('.master') as unknown as LootElement | null;
    const picks = row?.querySelectorAll<HTMLInputElement>('.ml-pick') ?? [];
    picks[1].checked = true; // Bex is checked...
    picks[1].dispatchEvent(new Event('change'));

    test.setMasterOpen([masterPrompt([roster[0]])]); // ...and then Bex leaves
    test.controller.update(test.now());

    const fresh = test.root.querySelector<HTMLElement>('.master') as unknown as LootElement | null;
    const freshPicks = fresh?.querySelectorAll<HTMLInputElement>('.ml-pick') ?? [];
    expect(freshPicks.map((pick) => pick.value)).toEqual(['2']);
    expect(freshPicks.filter((pick) => pick.checked)).toHaveLength(0);
    // Nothing is selected any more, so the button goes back to disabled rather than
    // staying live over a selection that no longer exists.
    expect(fresh?.querySelector<HTMLButtonElement>('.ml-roll')?.disabled).toBe(true);
  });

  it('holds an event-shown master row that the mirror has not confirmed yet', () => {
    const test = harness();
    // The masterLoot event lands a frame or two before the roll reaches the mirror.
    // Retiring on "absent from the mirror" alone would kill the prompt instantly,
    // which is exactly what the confirmed set exists to prevent.
    test.controller.showMasterRoll({ type: 'masterLoot', ...masterPrompt() });
    test.setMasterOpen([]);

    test.controller.update(test.now());
    test.controller.update(test.now());
    expect(test.root.querySelector('.master')).not.toBeNull();

    // Once the mirror HAS confirmed it, a later absence is real and retires it.
    test.setMasterOpen([masterPrompt()]);
    test.controller.update(test.now());
    test.setMasterOpen([]);
    test.controller.update(test.now());
    expect(test.root.querySelector('.master')).toBeNull();
  });

  it('lets the local curate timer retire a master row, then recover it past the grace', () => {
    const test = harness();
    test.setMasterOpen([masterPrompt()]);
    test.controller.showMasterRoll({ type: 'masterLoot', ...masterPrompt() });
    test.controller.update(test.now());
    expect(test.root.querySelector('.master')).not.toBeNull();

    // The local 300s estimate of the sim's deadline runs out first (a lagging
    // server, or a client clock that ran fast). The row retires...
    test.advance(300_000);
    test.controller.update(test.now());
    expect(test.root.querySelector('.master')).toBeNull();

    // ...and stays retired through the grace, rather than re-flashing immediately.
    test.controller.update(test.now());
    expect(test.root.querySelector('.master')).toBeNull();

    // Past the grace, the still-open sim roll brings it back: the local clock was
    // only an estimate, and the sim is the authority on when the window closes.
    test.advance(LOOT_ROLL_REGRACE_MS);
    test.controller.update(test.now());
    expect(test.root.querySelector('.master')).not.toBeNull();

    // And it STAYS back. Restoring on the exhausted clock would re-expire the row
    // inside the same update() and leave the timer and the mirror handing the roll
    // back and forth once per grace period for as long as the sim holds it open.
    for (let i = 0; i < 5; i++) {
      test.advance(LOOT_ROLL_REGRACE_MS);
      test.controller.update(test.now());
      expect(test.root.querySelector('.master')).not.toBeNull();
    }
  });

  it('elides a repeated timer fraction while still writing real time progress', () => {
    const test = harness();
    test.setOpen([prompt()]);
    test.controller.showRoll(rollEvent());
    expect(test.writerCounts).toEqual({ writes: 1, skips: 0 });

    test.controller.update(test.now());
    test.controller.update(test.now());
    expect(test.writerCounts).toEqual({ writes: 1, skips: 2 });

    test.advance(1_000);
    test.controller.update(test.now());
    expect(test.writerCounts).toEqual({ writes: 2, skips: 2 });
  });

  it('a render throw is contained, never retried on identical data, and heals on the next change', () => {
    // The catch/finally contract at the status fingerprint commit: one throw
    // must not abort the update (the old shape ate every concurrent prompt),
    // identical data must not re-render (no per-frame throw storm on a
    // persistently-throwing host), and the NEXT data change must render
    // because the committed fingerprint differs.
    const test = harness();
    const status = (choice: 'need' | null): LootRollGroupStatus => ({
      rollId: 7,
      itemId: 'greyjaw_hide_boots',
      itemName: 'Greyjaw Hide Boots',
      quality: 'uncommon',
      expiresAt: 60_000,
      entries: [{ pid: 2, name: 'Aki', choice }],
    });
    const target = test.controller as unknown as { render: () => void };
    const real = target.render.bind(test.controller);
    const render = vi
      .spyOn(target, 'render')
      .mockImplementationOnce(() => {
        throw new Error('canvas exhausted');
      })
      .mockImplementation(real);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      test.setStatuses([status(null)]);
      test.controller.update(test.now());
      expect(render).toHaveBeenCalledTimes(1);
      expect(errors).toHaveBeenCalled();
      // Identical data: elided, not retried.
      test.controller.update(test.now());
      expect(render).toHaveBeenCalledTimes(1);
      // A real change renders again: the throw did not freeze the panel.
      test.setStatuses([status('need')]);
      test.controller.update(test.now());
      expect(render).toHaveBeenCalledTimes(2);
    } finally {
      errors.mockRestore();
      render.mockRestore();
    }
  });
});

describe('stale-client fallback wiring (source pins)', () => {
  // The suite's fixtures use real content ids, so the unknown-id fallback
  // arms never execute behaviorally here; these pins keep all three call
  // sites on the shared helper WITH the wire quality argument. Dropping the
  // second argument type-checks (the parameter defaults to 'common') and
  // would silently render an epic drop's fallback icon at common quality.
  it('routes all three fallback icons through unknownItemIconHtml with the wire quality', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../src/ui/hud/loot/loot_roll_controller.ts', import.meta.url),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const eventArms = code.split('unknownItemIconHtml(event.itemId, quality)').length - 1;
    const statusArms = code.split('unknownItemIconHtml(status.itemId, quality)').length - 1;
    expect(eventArms).toBe(2);
    expect(statusArms).toBe(1);
    // Total-count pin: a FOURTH call site added without the quality argument
    // would leave the two shape counts green; the total closes that door.
    expect(code.split('unknownItemIconHtml(').length - 1).toBe(3);
  });
});
