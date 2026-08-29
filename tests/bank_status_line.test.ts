// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { appendBankStatusLine, type BankStatusAnnouncementState } from '../src/ui/bank_status_line';

const options = (
  text: string,
  isCurrent: () => boolean = () => true,
): Parameters<typeof appendBankStatusLine>[2] => ({
  text,
  visibleClass: 'test-purchase-status',
  liveDataAttribute: 'data-test-purchase-live',
  isCurrent,
});

describe('appendBankStatusLine', () => {
  it('mounts visible copy synchronously and publishes through an initially empty polite region', async () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const state: BankStatusAnnouncementState = { announcedText: null };
    const nodes = appendBankStatusLine(parent, state, options('Updated price'));

    expect(nodes.visible.className).toBe('bank-status test-purchase-status');
    expect(nodes.visible.textContent).toBe('Updated price');
    expect(nodes.visible.hasAttribute('role')).toBe(false);
    expect(nodes.visible.hasAttribute('aria-live')).toBe(false);
    expect(nodes.live.textContent).toBe('');
    expect(nodes.live.getAttribute('data-test-purchase-live')).toBe('');
    expect(nodes.live.getAttribute('role')).toBe('status');
    expect(nodes.live.getAttribute('aria-live')).toBe('polite');
    expect(nodes.live.getAttribute('aria-atomic')).toBe('true');

    await Promise.resolve();
    expect(nodes.live.textContent).toBe('Updated price');
    expect(state.announcedText).toBe('Updated price');
  });

  it.each([
    {
      name: 'connected but no longer current',
      invalidate: (nodes: ReturnType<typeof appendBankStatusLine>, current: { value: boolean }) => {
        current.value = false;
        expect(nodes.live.isConnected).toBe(true);
      },
    },
    {
      name: 'detached but still current',
      invalidate: (nodes: ReturnType<typeof appendBankStatusLine>, current: { value: boolean }) => {
        nodes.live.remove();
        expect(current.value).toBe(true);
      },
    },
  ])('suppresses publication when $name', async ({ invalidate }) => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const state: BankStatusAnnouncementState = { announcedText: null };
    const current = { value: true };
    const nodes = appendBankStatusLine(
      parent,
      state,
      options('Updated price', () => current.value),
    );
    invalidate(nodes, current);

    await Promise.resolve();
    expect(nodes.live.textContent).toBe('');
    expect(state.announcedText).toBeNull();
  });

  it('suppresses a repeated localized value and reannounces when that value changes', async () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const state: BankStatusAnnouncementState = { announcedText: 'Updated price' };

    const repeated = appendBankStatusLine(parent, state, options('Updated price'));
    await Promise.resolve();
    expect(repeated.live.textContent).toBe('');

    const translated = appendBankStatusLine(parent, state, options('Precio actualizado'));
    expect(translated.live.textContent).toBe('');
    await Promise.resolve();
    expect(translated.live.textContent).toBe('Precio actualizado');
    expect(state.announcedText).toBe('Precio actualizado');
  });
});
