// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReferralCard } from '../src/sim/referral_cards';
import type { ReferralCardsSnapshot } from '../src/ui/hud/referral_cards';
import { ReferralCardsController } from '../src/ui/hud/referral_cards';
import { createReferralCardsHud } from '../src/ui/hud/referral_cards/referral_cards_hud_controller';
import { referralCardStrings } from '../src/ui/i18n.catalog/referral_cards';
import type { IWorld } from '../src/world_api';

vi.mock('../src/ui/i18n', () => ({
  t: (key: string, values: Record<string, string> = {}) => {
    let value: unknown = referralCardStrings;
    for (const part of key.replace(/^referralCards\./, '').split('.'))
      value = (value as Record<string, unknown>)[part];
    if (typeof value !== 'string') throw new Error(`Missing test translation: ${key}`);
    return value.replace(/\{([^}]+)\}/g, (_, name) => values[name] ?? `{${name}}`);
  },
  formatNumber: (value: number) => String(value),
}));

function setup() {
  document.body.innerHTML =
    '<button id="launcher"></button><div id="root"></div><div id="prompt-stack"></div>';
  const card = createReferralCard(8, 10, 20);
  card.status = 'active';
  Object.assign(card.participants[0], { characterId: 100, characterName: 'Aster' });
  Object.assign(card.participants[1], { characterId: 200, characterName: 'Briar' });
  let snapshot: ReferralCardsSnapshot = {
    revision: 1,
    accountId: 10,
    characterId: 100,
    characterName: 'Aster',
    inviteUrl: 'https://example.test/?ref=abc',
    links: [{ card, friendName: 'Briar', canMove: false, summonRemainingSeconds: 0 }],
    completedFriends: 0,
    rewardedTiers: [],
    notices: [],
  };
  const root = document.getElementById('root')!;
  const launcher = document.getElementById('launcher') as HTMLButtonElement;
  const send = vi.fn();
  const focusWindow = vi.fn();
  const controller = new ReferralCardsController({
    root,
    launcher,
    promptStack: document.getElementById('prompt-stack')!,
    getSnapshot: () => snapshot,
    send,
    focusWindow,
    onClose: vi.fn(),
  });
  return {
    controller,
    root,
    launcher,
    send,
    card,
    snapshot,
    replace: (next: ReferralCardsSnapshot) => {
      snapshot = next;
      controller.update();
    },
  };
}

function clickText(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (row) => row.textContent === text,
  );
  expect(button, text).toBeDefined();
  button!.click();
}

beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('referral card controller', () => {
  it('expires the visible summon cooldown without another server revision', () => {
    vi.useFakeTimers();
    try {
      const f = setup();
      f.snapshot.links[0].summonRemainingSeconds = 1800;
      f.controller.update();
      f.controller.open();
      const summon = () =>
        f.root.querySelector<HTMLButtonElement>('[data-referral-action="summon"]');
      expect(summon()?.disabled).toBe(true);
      vi.advanceTimersByTime(1_799_000);
      expect(summon()?.disabled).toBe(true);
      vi.advanceTimersByTime(1_000);
      expect(summon()?.disabled).toBe(false);
      expect(f.send).not.toHaveBeenCalled();
      f.controller.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
  it('warns when Fogbinder is earned before opening the card without redeeming', () => {
    const f = setup();
    f.controller.update();
    f.card.participants[0].credited = 7;
    f.card.participants[0].redeemed = 3;
    f.replace({ ...f.snapshot, revision: 2 });
    expect(document.querySelector('.referral-prompt')?.textContent).toContain('permanently locks');
    expect(f.controller.isOpen()).toBe(false);
    expect(f.send).not.toHaveBeenCalled();
    clickText('Yes, I understand');
    expect(f.controller.isOpen()).toBe(true);
    expect(f.send).not.toHaveBeenCalled();
    expect(document.querySelector('.referral-prompt')).toBeNull();
    f.replace({ ...f.snapshot, revision: 3 });
    expect(document.querySelector('.referral-prompt')).toBeNull();
  });
  it('composes the live launcher, IWorld commands, and shared window focus lifecycle', () => {
    const { snapshot } = setup();
    document.body.innerHTML =
      '<div id="ui"><button id="mm-social"></button><div id="prompt-stack"></div></div>';
    const opener = document.getElementById('mm-social');
    const send = vi.fn();
    const captureFocus = vi.fn(() => opener);
    const restoreFocus = vi.fn();
    const closeOthers = vi.fn();
    const snapshotChanged = vi.fn();
    const world = {
      referralCardsSnapshot: () => snapshot,
      referralCardsAction: send,
    } as unknown as IWorld;
    const controller = createReferralCardsHud({
      world: () => world,
      focus: { captureFocus, restoreFocus },
      focusFirst: (root) => root.querySelector<HTMLButtonElement>('button')?.focus(),
      closeOthers,
      visibilityChanged: vi.fn(),
      snapshotChanged,
    });
    const launcher = document.getElementById('mm-referral-cards') as HTMLButtonElement;
    expect(launcher.hidden).toBe(true);
    // The mobile tray can become available after HUD construction.
    document
      .getElementById('ui')!
      .insertAdjacentHTML('beforeend', '<div id="mobile-extra-grid"></div>');
    controller.update();
    expect(launcher.hidden).toBe(false);
    const mobile = document.getElementById('mobile-referral-cards') as HTMLButtonElement;
    expect(mobile.hidden).toBe(false);
    expect(mobile.textContent).toContain('Stamp cards');
    expect(snapshotChanged).toHaveBeenCalledTimes(1);
    launcher.click();
    expect(controller.isOpen()).toBe(true);
    expect(send).toHaveBeenCalledWith({ type: 'page' });
    expect(document.activeElement?.closest('#referral-cards-window')).not.toBeNull();
    expect(captureFocus).toHaveBeenCalledTimes(1);
    expect(closeOthers).toHaveBeenCalledTimes(1);
    clickText('Summon bound friend');
    expect(send).toHaveBeenLastCalledWith({ type: 'summon', linkId: 8, expectedRevision: 0 });
    controller.close();
    expect(restoreFocus).toHaveBeenCalledWith(opener);
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    document.body.classList.add('mobile-more-open');
    // A second finger must work while the first is steering the game joystick.
    mobile.dispatchEvent(
      new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 2, isPrimary: false }),
    );
    mobile.dispatchEvent(
      new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 2, isPrimary: false }),
    );
    expect(controller.isOpen()).toBe(true);
    expect(document.body.classList.contains('mobile-more-open')).toBe(false);
    mobile.click(); // The browser's compatibility click must not toggle it closed.
    expect(controller.isOpen()).toBe(true);
    expect(mobile.getAttribute('aria-expanded')).toBe('true');
    controller.destroy();
    mobile.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 3 }));
    mobile.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 3 }));
    expect(controller.isOpen()).toBe(false);
  });
  it('answers a summon only after explicit consent and supports bounded page navigation', () => {
    const f = setup();
    f.replace({
      ...f.snapshot,
      revision: 2,
      nextCursor: 8,
      notices: [{ id: 'summon-1', type: 'summon', requestId: 'request-1', friendName: 'Briar' }],
    });
    expect(f.send).toHaveBeenCalledWith({ type: 'acknowledgeNotice', noticeId: 'summon-1' });
    expect(f.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'answerSummon' }));
    clickText('Accept');
    expect(f.send).toHaveBeenLastCalledWith({
      type: 'answerSummon',
      requestId: 'request-1',
      accept: true,
    });
    f.controller.open();
    clickText('More cards');
    expect(f.send).toHaveBeenLastCalledWith({ type: 'page', after: 8 });
    clickText('First page');
    expect(f.send).toHaveBeenLastCalledWith({ type: 'page' });
  });

  it('drops stale confirmation prompts when the authoritative card changes', () => {
    const f = setup();
    f.card.lockConfirmation = { accountId: 10, revision: 0, stage: 1 };
    f.controller.update();
    expect(document.querySelector('.referral-prompt')).not.toBeNull();
    const card = { ...f.card, revision: 1, lockConfirmation: undefined };
    f.replace({ ...f.snapshot, revision: 2, links: [{ ...f.snapshot.links[0], card }] });
    expect(document.querySelector('.referral-prompt')).toBeNull();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('shows escaped participants and all rewards, with no claim on opening', () => {
    const f = setup();
    f.card.participants[1].characterName = '<img src=x onerror=alert(1)>';
    f.controller.open();
    expect(f.root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(f.root.querySelector('img')).toBeNull();
    expect(f.root.querySelectorAll('.referral-stamp')).toHaveLength(5);
    expect(f.root.querySelectorAll('.referral-stamp [role="tooltip"]')).toHaveLength(5);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.root.getAttribute('aria-labelledby')).toBe('referral-cards-title');
  });

  it('keeps rewards server-authoritative and sends the captured revision on explicit redemption', () => {
    const f = setup();
    f.card.participants[0].credited = 1;
    f.controller.open();
    expect(f.launcher.classList.contains('referral-reward-ready')).toBe(true);
    expect(f.send).not.toHaveBeenCalled();
    clickText('Redeem reward');
    expect(f.send).toHaveBeenLastCalledWith({
      type: 'redeem',
      linkId: 8,
      expectedRevision: 0,
      milestone: 'tutorial',
    });
    expect(f.card.participants[0].redeemed).toBe(0);
    expect(f.root.textContent).toContain('Earned');
  });

  it('waits for a stamp animation before enabling redemption', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList);
    let finish!: () => void;
    const animation = {
      cancel: vi.fn(),
      finished: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    };
    vi.stubGlobal('Animation', class {});
    const original = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = vi.fn().mockReturnValue(animation);
    try {
      const f = setup();
      f.card.participants[0].credited = 1;
      f.controller.open();
      const button = f.root.querySelector<HTMLButtonElement>('[data-referral-action="redeem"]')!;
      expect(button.disabled).toBe(true);
      finish();
      await Promise.resolve();
      expect(
        f.root.querySelector<HTMLButtonElement>('[data-referral-action="redeem"]')!.disabled,
      ).toBe(false);
      expect(f.send).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.animate = original;
      vi.unstubAllGlobals();
    }
  });

  it('requires two distinct server-confirmed Fogbinder acknowledgements before a lock claim', () => {
    const f = setup();
    Object.assign(f.card.participants[0], { credited: 7, redeemed: 3 });
    f.controller.open();
    clickText('Redeem reward');
    expect(f.send).toHaveBeenLastCalledWith({
      type: 'redeem',
      milestone: 'fogbinder',
      linkId: 8,
      expectedRevision: 0,
    });
    f.card.revision = 1;
    f.card.lockConfirmation = { accountId: 10, revision: 1, stage: 1 };
    f.replace({ ...f.snapshot, revision: 2 });
    clickText('Yes, I understand');
    expect(f.send).toHaveBeenLastCalledWith({
      type: 'redeem',
      milestone: 'fogbinder',
      confirmation: 'understand',
      linkId: 8,
      expectedRevision: 1,
    });
    expect(document.body.textContent).not.toContain('Are you sure? Redeem');
    f.card.revision = 2;
    f.card.lockConfirmation = { accountId: 10, revision: 2, stage: 2 };
    f.replace({ ...f.snapshot, revision: 3 });
    clickText('Yes, lock this card');
    expect(f.send).toHaveBeenLastCalledWith({
      type: 'redeem',
      milestone: 'fogbinder',
      confirmation: 'confirm',
      linkId: 8,
      expectedRevision: 2,
    });
    expect(f.card.participants[0].locked).toBe(false);
  });

  it('confirms declines, explains the manual retry, and does not repeat a consumed notice', () => {
    const f = setup();
    f.card.status = 'pending';
    f.replace({ ...f.snapshot, notices: [{ id: 'start-1', type: 'start', linkId: 8 }] });
    clickText('Decline');
    expect(f.send).toHaveBeenLastCalledWith({
      type: 'respond',
      accept: false,
      linkId: 8,
      expectedRevision: 0,
    });
    f.card.declineAccountId = 10;
    f.card.revision = 1;
    f.replace({ ...f.snapshot, revision: 2 });
    expect(document.body.textContent).toContain('Are you sure you want to decline?');
    clickText('Decline');
    expect(f.send).toHaveBeenLastCalledWith({
      type: 'respond',
      accept: false,
      confirmDecline: true,
      linkId: 8,
      expectedRevision: 1,
    });
    delete f.card.declineAccountId;
    f.replace({ ...f.snapshot, revision: 3, notices: [{ id: 'declined-1', type: 'declined' }] });
    expect(document.body.textContent).toContain('You can start from the stamp card menu');
    clickText('OK');
    f.controller.update();
    expect(document.querySelector('.referral-prompt')).toBeNull();
  });

  it('shows eligibility reasons without sending an invalid start and confirms reward transfers', () => {
    const f = setup();
    f.card.status = 'idle';
    f.snapshot.links[0].startReason = 'newAccountsOnly';
    f.controller.open();
    clickText('Start a card');
    expect(document.body.textContent).toContain('Existing accounts cannot be bound.');
    expect(f.send).not.toHaveBeenCalled();
    clickText('OK');
    f.card.status = 'active';
    f.snapshot.links[0].canMove = true;
    f.replace({ ...f.snapshot, revision: 2, characterId: 101, characterName: 'Cedar' });
    clickText('Move card to this character');
    expect(document.body.textContent).toContain('Those rewards will be removed from Aster.');
    clickText('Yes, move my card');
    expect(f.send).toHaveBeenLastCalledWith({
      type: 'move',
      characterId: 101,
      linkId: 8,
      expectedRevision: 0,
    });
    expect(f.card.participants[0].characterId).toBe(100);
  });

  it('does no DOM work on an unchanged cadence and repaints once for a language refresh', () => {
    const f = setup();
    f.controller.open();
    const before = f.root.firstElementChild;
    const query = vi.spyOn(f.root, 'querySelectorAll');
    const attr = vi.spyOn(f.launcher, 'setAttribute');
    f.controller.update();
    f.controller.update();
    expect(query).not.toHaveBeenCalled();
    expect(attr).not.toHaveBeenCalled();
    expect(f.root.firstElementChild).toBe(before);
    f.controller.relocalize();
    const after = f.root.firstElementChild;
    expect(after).not.toBe(before);
    f.controller.update();
    expect(f.root.firstElementChild).toBe(after);
  });

  it('tears down active prompts without leaving the window inert', () => {
    const f = setup();
    f.controller.open();
    f.replace({
      ...f.snapshot,
      revision: 2,
      notices: [{ id: 'reason-1', type: 'reason', reason: 'notTogether' }],
    });
    expect(f.root.inert).toBe(true);
    f.controller.destroy();
    expect(f.root.inert).toBe(false);
    expect(document.querySelector('.referral-prompt')).toBeNull();
    expect(f.root.hidden).toBe(true);
  });
});
