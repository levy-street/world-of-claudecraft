import { describe, expect, it, vi } from 'vitest';
import {
  type MobileMoreObserverFactory,
  watchMobileMoreState,
} from '../src/game/mobile_more_diagnostics';

describe('mobile More diagnostics observer', () => {
  it('reports every open and close transition regardless of which owner changes the class', () => {
    let open = false;
    let notify = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    const createObserver: MobileMoreObserverFactory = (callback) => {
      notify = () => callback([], {} as MutationObserver);
      return { observe, disconnect };
    };
    const target = {
      classList: { contains: () => open },
    } as unknown as HTMLElement;
    const states: boolean[] = [];

    const stop = watchMobileMoreState(target, (state) => states.push(state), createObserver);
    expect(observe).toHaveBeenCalledWith(target, {
      attributes: true,
      attributeFilter: ['class'],
    });

    open = true;
    notify();
    notify();
    open = false;
    notify();
    expect(states).toEqual([true, false]);

    stop();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
