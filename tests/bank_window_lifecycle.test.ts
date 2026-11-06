// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/bags_window', () => ({ dismissBagPrompts: vi.fn() }));

import { dismissBagPrompts } from '../src/ui/bags_window';
import {
  closeBankBags,
  openBankCompanion,
  undockBagCompanions,
} from '../src/ui/bank_window_lifecycle';

afterEach(() => {
  document.body.className = '';
  vi.clearAllMocks();
});

describe('bank companion lifecycle', () => {
  it('undocks open mobile companions while preserving desktop offsets', () => {
    document.body.className = 'bank-open market-open';
    undockBagCompanions(true, true);
    expect(document.body.className).toBe('bank-open market-open');
    document.body.classList.add('mobile-touch');
    undockBagCompanions(true, false);
    expect(document.body.className).toBe('market-open mobile-touch');
    undockBagCompanions(false, true);
    expect(document.body.className).toBe('mobile-touch');
  });
  it('opens the bank with its docked bags companion', () => {
    // Menu consolidation step 7: the bank has one mode. The weekly rewards
    // sheet that borrowed #bank-window is the Rewards hub's Vault tab now.
    const bags = document.createElement('div');
    bags.style.display = 'none';
    const order: string[] = [];
    const bank = { open: () => order.push('open-bank') };
    openBankCompanion(bank, bags, () => order.push('render-bags'));
    expect(order).toEqual(['open-bank', 'render-bags']);
    expect(document.body.classList.contains('bank-open')).toBe(true);
    expect(bags.style.display).toBe('flex');
  });

  it('dismisses prompts and pet feeding before leaving mobile bags hidden and interactive', () => {
    const bags = document.createElement('div');
    bags.style.display = 'flex';
    bags.inert = true;
    document.body.className = 'mobile-touch bank-open';
    const cancel = vi.fn();
    const render = vi.fn();
    closeBankBags(bags, cancel, render);
    expect(dismissBagPrompts).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(render).not.toHaveBeenCalled();
    expect(bags.style.display).toBe('none');
    expect(bags.inert).toBe(false);
    expect(document.body.className).toBe('mobile-touch');
  });

  it('retains and refreshes desktop bags, but leaves already closed bags alone', () => {
    const bags = document.createElement('div');
    bags.style.display = 'flex';
    const cancel = vi.fn();
    const render = vi.fn();
    closeBankBags(bags, cancel, render);
    expect(render).toHaveBeenCalledOnce();
    expect(bags.style.display).toBe('flex');
    bags.style.display = 'none';
    closeBankBags(bags, cancel, render);
    expect(render).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    expect(dismissBagPrompts).not.toHaveBeenCalled();
  });
});
