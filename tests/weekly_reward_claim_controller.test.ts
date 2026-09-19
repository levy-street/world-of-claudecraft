// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyWeeklyRewards } from '../src/sim/weekly_rewards';
import type { PainterHostPresentation } from '../src/ui/painter_host';
import { WeeklyRewardClaimController } from '../src/ui/weekly_reward_claim_controller';
import { WEEKLY_REVEAL_DURATION_MS } from '../src/ui/weekly_vault_reveal_controller';
import type { IWorld } from '../src/world_api';

function setup(withPrompt = false) {
  const state = emptyWeeklyRewards(2000);
  state.vaults = [
    {
      resetAtMs: 1000,
      choices: [{ pool: 'raid' }, { pool: 'dungeon' }],
    },
  ];
  const info = { state, nowMs: 1000, canClaim: true, worldQuestsAvailable: false, readyWeeks: 1 };
  const claim = vi.fn();
  const open = vi.fn((key: string) => {
    const index = Number(key.split(':')[1]);
    const choice = state.vaults[0].choices[index];
    choice.itemId = ['orb_of_the_last_spring', 'boneguard_breastplate'][index];
    choice.opened = true;
    delete choice.opening;
  });
  const world = {
    weeklyRewardInfo: info,
    claimWeeklyReward: claim,
    openWeeklyReward: open,
  } as unknown as IWorld;
  const host = document.createElement('div');
  const progress = document.createElement('div');
  const root = document.createElement('div');
  root.id = 'bank-window';
  root.append(host, progress);
  document.body.append(root);
  if (withPrompt) {
    const stack = document.createElement('div');
    stack.id = 'prompt-stack';
    document.body.append(stack);
  }
  const controller = new WeeklyRewardClaimController({
    world: () => world,
    presentation: {
      itemIcon: () => '<img alt="">',
      attachTooltip: vi.fn(),
    } as unknown as PainterHostPresentation,
    onInventoryChanged: vi.fn(),
  });
  const render = () => controller.renderInto(host, progress);
  const click = (selector: string) => host.querySelector<HTMLButtonElement>(selector)!.click();
  const openAll = () => {
    click('.weekly-start-claim');
    for (let index = 0; index < state.vaults[0].choices.length; index++)
      click(`[data-focus-key="weekly-open:${index}"]`);
    vi.advanceTimersByTime(WEEKLY_REVEAL_DURATION_MS);
  };
  render();
  return { state, info, claim, open, host, progress, root, controller, render, click, openAll };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('completed-week claim flow', () => {
  it('requests unopened rewards without exposing loot and animates only after the saved item arrives', () => {
    const s = setup();
    s.open.mockImplementation(() => {
      s.state.vaults[0].choices[0].opening = true;
    });
    s.click('.weekly-start-claim');
    expect(s.host.querySelector('.vault-reveal-loot strong')).toBeNull();
    expect(s.host.textContent).not.toContain('Orb of the Last Spring');
    s.click('[data-focus-key="weekly-open:0"]');
    expect(s.open).toHaveBeenCalledExactlyOnceWith('1000:0');
    expect(s.host.querySelector('.vault-is-open')).toBeNull();
    expect(
      s.host.querySelector('[data-focus-key="weekly-open:0"]')!.getAttribute('aria-disabled'),
    ).toBe('true');
    expect(document.activeElement).toBe(s.host.querySelector('[data-focus-key="weekly-open:0"]'));
    s.click('[data-focus-key="weekly-open:0"]');
    expect(s.open).toHaveBeenCalledTimes(1);
    s.render();
    expect(s.host.querySelector('.weekly-start-claim')).toBeNull();
    vi.advanceTimersByTime(WEEKLY_REVEAL_DURATION_MS);
    expect(s.host.querySelector('.vault-is-revealed')).toBeNull();
    Object.assign(s.state.vaults[0].choices[0], {
      itemId: 'orb_of_the_last_spring',
      opened: true,
      opening: false,
    });
    s.render();
    expect(s.host.querySelector('.vault-is-open')).not.toBeNull();
    expect(s.host.querySelector('.vault-is-revealed')).toBeNull();
    vi.advanceTimersByTime(WEEKLY_REVEAL_DURATION_MS);
    expect(s.host.querySelectorAll('.vault-is-revealed')).toHaveLength(1);
    expect(document.activeElement).toBe(
      s.host.querySelector('[data-focus-key="weekly-inspect:0"]'),
    );
    s.click('.vault-reveal-loot');
    expect(s.host.querySelector('.weekly-confirm-panel')).toBeNull();
    expect(s.claim).not.toHaveBeenCalled();
  });

  it('allows another opening attempt after save failure and ignores detached opening buttons', () => {
    const s = setup();
    s.open.mockImplementation(() => {
      s.state.vaults[0].choices[0].opening = true;
    });
    s.click('.weekly-start-claim');
    const stale = s.host.querySelector<HTMLButtonElement>('[data-focus-key="weekly-open:0"]')!;
    stale.click();
    s.state.vaults[0].choices[0].opening = false;
    s.render();
    stale.click();
    expect(s.open).toHaveBeenCalledTimes(1);
    expect(
      s.host.querySelector<HTMLButtonElement>('[data-focus-key="weekly-open:0"]')!.disabled,
    ).toBe(false);
    s.click('[data-focus-key="weekly-open:0"]');
    expect(s.open).toHaveBeenCalledTimes(2);
    expect(s.host.querySelector('.vault-is-open')).toBeNull();
    s.controller.close();
    stale.click();
    expect(s.open).toHaveBeenCalledTimes(2);
  });

  it('restores saved opened items without another request and rejects old claim-sequence controls', () => {
    const s = setup();
    Object.assign(s.state.vaults[0].choices[0], { itemId: 'orb_of_the_last_spring', opened: true });
    s.render();
    s.click('.weekly-start-claim');
    expect(s.host.querySelectorAll('.vault-is-revealed')).toHaveLength(1);
    expect(s.open).not.toHaveBeenCalled();
    const stale = s.host.querySelector<HTMLButtonElement>('[data-focus-key="weekly-open:1"]')!;
    s.state.claimSequence++;
    stale.click();
    expect(s.open).not.toHaveBeenCalled();
    s.render();
    expect(s.host.querySelector('.weekly-start-claim')).not.toBeNull();
  });

  it('offers ready rewards on opening, survives repaint, and enters the earned vaults without claiming', () => {
    const s = setup(true);
    const prompt = document.querySelector<HTMLElement>('.weekly-ready-prompt')!;
    expect(prompt.getAttribute('role')).toBe('dialog');
    expect(s.root.inert).toBe(true);
    vi.advanceTimersByTime(0);
    expect(document.activeElement).toBe(prompt.querySelector('.weekly-ready-open'));
    s.render();
    expect(document.querySelector('.weekly-ready-prompt')).toBe(prompt);
    prompt.querySelector<HTMLButtonElement>('.weekly-ready-open')!.click();
    expect(prompt.isConnected).toBe(false);
    expect(s.root.inert).toBe(false);
    expect(s.progress.hidden).toBe(true);
    expect(s.host.querySelectorAll('.vault-reveal-trigger')).toHaveLength(2);
    expect(document.activeElement).toBe(s.host.querySelector('.vault-reveal-trigger'));
    expect(s.claim).not.toHaveBeenCalled();
    s.click('.weekly-return-progress');
    expect(document.querySelector('.weekly-ready-prompt')).toBeNull();
    s.controller.close();
    s.render();
    expect(document.querySelector('.weekly-ready-prompt')).not.toBeNull();
  });

  it('dismisses with Escape or Not now, returns focus, and does not repeat within the visit', () => {
    const s = setup(true);
    s.render();
    document
      .querySelector('.weekly-ready-open')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.weekly-ready-prompt')).toBeNull();
    expect(s.root.inert).toBe(false);
    expect(document.activeElement).toBe(s.host.querySelector('.weekly-start-claim'));
    s.render();
    expect(document.querySelector('.weekly-ready-prompt')).toBeNull();
    s.controller.close();
    s.render();
    document.querySelector<HTMLButtonElement>('.weekly-ready-cancel')!.click();
    expect(s.progress.hidden).toBe(false);
    expect(s.root.inert).toBe(false);
    expect(s.claim).not.toHaveBeenCalled();
  });

  it('cleans up the prompt on close or access loss and refuses stale prompt actions', () => {
    const s = setup(true);
    const open = document.querySelector<HTMLButtonElement>('.weekly-ready-open')!;
    s.controller.close();
    vi.advanceTimersByTime(0);
    expect(document.querySelector('.weekly-ready-prompt')).toBeNull();
    expect(s.root.inert).toBe(false);
    open.click();
    expect(s.host.querySelector('.vault-reveal-trigger')).toBeNull();
    s.render();
    s.info.canClaim = false;
    document.querySelector<HTMLButtonElement>('.weekly-ready-open')!.click();
    expect(s.host.querySelector('.vault-reveal-trigger')).toBeNull();
    expect(s.root.inert).toBe(false);
    expect(s.claim).not.toHaveBeenCalled();
  });

  it('does not offer an unfinished or empty reward week', () => {
    const s = setup(true);
    s.controller.close();
    s.info.nowMs = 999;
    s.render();
    expect(document.querySelector('.weekly-ready-prompt')).toBeNull();
    s.info.nowMs = 1000;
    s.render();
    expect(document.querySelector('.weekly-ready-prompt')).not.toBeNull();
    s.state.vaults = [];
    s.render();
    expect(document.querySelector('.weekly-ready-prompt')).toBeNull();
    expect(s.root.inert).toBe(false);
  });

  it('does not unlock a batch before its earning period has ended', () => {
    const s = setup();
    s.info.nowMs = 999;
    s.render();
    expect(s.host.hidden).toBe(true);
    expect(s.progress.hidden).toBe(false);
    expect(s.host.querySelector('.weekly-start-claim')).toBeNull();
    s.info.nowMs = 1000;
    s.render();
    expect(s.host.querySelector('.weekly-start-claim')?.textContent).toBe(
      "Claim last week's reward",
    );
    expect(s.host.querySelector('.vault-reveal-trigger')).toBeNull();
    expect(s.claim).not.toHaveBeenCalled();
  });

  it('keeps opened vaults visible, selects their loot only after all reveals, and requires confirmation', () => {
    const s = setup();
    s.click('.weekly-start-claim');
    s.click('.vault-reveal-trigger');
    vi.advanceTimersByTime(WEEKLY_REVEAL_DURATION_MS);
    s.click('.vault-reveal-loot');
    expect(s.host.querySelector('.weekly-confirm-panel')).toBeNull();
    expect(s.claim).not.toHaveBeenCalled();
    s.click('.vault-reveal-trigger:not(:disabled)');
    vi.advanceTimersByTime(WEEKLY_REVEAL_DURATION_MS - 1);
    s.click('.vault-reveal-loot');
    expect(s.host.querySelector('.weekly-confirm-panel')).toBeNull();
    vi.advanceTimersByTime(1);
    expect(s.host.querySelectorAll('.vault-is-revealed')).toHaveLength(2);
    expect(s.host.querySelector('.weekly-choices')).toBeNull();
    const loot = s.host.querySelector<HTMLButtonElement>('[data-focus-key="weekly-inspect:1"]')!;
    expect(loot.textContent).toContain('Boneguard Breastplate');
    expect(loot.getAttribute('aria-label')).toBe('Select Boneguard Breastplate');
    loot.click();
    expect(s.claim).not.toHaveBeenCalled();
    expect(s.host.querySelector('.weekly-confirm-panel')?.textContent).toContain(
      'Claim Boneguard Breastplate?',
    );
    s.click('.weekly-cancel-claim');
    expect(s.host.querySelectorAll('.vault-is-revealed')).toHaveLength(2);
    expect(document.activeElement).toBe(
      s.host.querySelector('[data-focus-key="weekly-inspect:1"]'),
    );
    // Detached loot controls cannot select again after a repaint.
    loot.click();
    expect(s.host.querySelector('.weekly-confirm-panel')).toBeNull();
    s.click('[data-focus-key="weekly-inspect:1"]');
    const confirm = s.host.querySelector<HTMLButtonElement>('.weekly-confirm')!;
    confirm.click();
    confirm.click();
    s.click('.weekly-confirm');
    expect(s.claim).toHaveBeenCalledExactlyOnceWith('1000:1');
    expect(s.state.vaults).toHaveLength(1);
    expect(s.host.textContent).toContain('Claim requested');
  });

  it('allows retry after refusal and only consumes a week when the host removes it', () => {
    const s = setup();
    s.openAll();
    s.click('.vault-reveal-loot');
    s.click('.weekly-confirm');
    s.click('.weekly-cancel-claim');
    expect(document.activeElement).toBe(s.host.querySelector('.vault-reveal-loot'));
    s.claim.mockImplementation(() => {
      s.state.vaults.shift();
      s.info.readyWeeks = 0;
    });
    s.click('.vault-reveal-loot');
    s.click('.weekly-confirm');
    expect(s.claim).toHaveBeenCalledTimes(2);
    expect(s.host.hidden).toBe(true);
    expect(s.progress.hidden).toBe(false);
  });

  it('rejects stale selection or confirmation after batch changes or keeper access is lost', () => {
    const s = setup();
    s.openAll();
    s.info.canClaim = false;
    s.click('.vault-reveal-loot');
    expect(s.host.querySelector('.weekly-confirm-panel')).toBeNull();
    expect(s.claim).not.toHaveBeenCalled();
    s.info.canClaim = true;
    s.click('.vault-reveal-loot');
    s.state.vaults[0].resetAtMs = 900;
    s.click('.weekly-confirm');
    expect(s.claim).not.toHaveBeenCalled();
    expect(s.host.querySelector('.weekly-start-claim')).not.toBeNull();
    expect(s.host.querySelector('.weekly-confirm')).toBeNull();
  });

  it('preserves completed reveals on repaint and cancels in-flight reveals on close', () => {
    const s = setup();
    s.click('.weekly-start-claim');
    s.click('.vault-reveal-trigger');
    vi.advanceTimersByTime(WEEKLY_REVEAL_DURATION_MS);
    s.render();
    expect(s.host.querySelectorAll('.vault-is-revealed')).toHaveLength(1);
    s.click('.vault-reveal-trigger:not(:disabled)');
    s.controller.close();
    vi.advanceTimersByTime(WEEKLY_REVEAL_DURATION_MS);
    s.render();
    expect(s.host.querySelector('.weekly-start-claim')).not.toBeNull();
    s.click('.weekly-start-claim');
    expect(s.host.querySelectorAll('.vault-is-revealed')).toHaveLength(2);
    expect(document.activeElement).toBe(
      s.host.querySelector('[data-focus-key="weekly-inspect:0"]'),
    );
    expect(s.host.querySelector('.weekly-choice')).toBeNull();
  });

  it('supports reduced motion with the same reveal and claim gates', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    const s = setup();
    s.click('.weekly-start-claim');
    for (let index = 0; index < s.state.vaults[0].choices.length; index++)
      s.click(`[data-focus-key="weekly-open:${index}"]`);
    expect(s.host.querySelectorAll('.vault-is-revealed')).toHaveLength(2);
    expect(s.host.querySelector('.weekly-choices')).toBeNull();
    expect(s.claim).not.toHaveBeenCalled();
  });

  it('starts the next saved week with unrevealed vaults after the host confirms a claim', () => {
    const s = setup();
    s.state.vaults.push({
      resetAtMs: 1001,
      choices: [{ pool: 'dungeon' }],
    });
    s.info.nowMs = 1001;
    s.openAll();
    s.claim.mockImplementation(() => {
      s.state.vaults.shift();
    });
    s.click('.vault-reveal-loot');
    s.click('.weekly-confirm');
    expect(s.host.querySelector('.weekly-start-claim')).not.toBeNull();
    s.click('.weekly-start-claim');
    expect(s.host.querySelectorAll('.vault-reveal-trigger')).toHaveLength(1);
    expect(s.host.querySelector('.weekly-choice')).toBeNull();
    expect(s.host.querySelector('.vault-is-revealed')).toBeNull();
  });
});
