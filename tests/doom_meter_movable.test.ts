// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { createDoomMeter } from '../src/ui/hud/warlock/doom_meter';
import type { MovableFrameConfig } from '../src/ui/movable_frame';
import type { PainterHostWriters } from '../src/ui/painter_host';

function writers(): PainterHostWriters {
  return {
    setText: (element, value) => {
      element.textContent = value;
    },
    setDisplay: (element, value) => {
      element.style.display = value;
    },
    setTransform: (element, value) => {
      element.style.transform = value;
    },
    setWidth: (element, value) => {
      element.style.width = value;
    },
    setStyleProp: (element, property, value) => {
      element.style.setProperty(property, value);
    },
    toggleClass: (element, className, enabled) => {
      element.classList.toggle(className, enabled);
    },
    setAttr: (element, attribute, value) => {
      element.setAttribute(attribute, value);
    },
  };
}

function elementById(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

describe('Affliction resource block movement', () => {
  it('moves Condemnation and Fate Threads as one persisted frame', () => {
    document.body.innerHTML = '<div id="ui"></div><div id="stock"><div id="before"></div></div>';
    const detachedParent = elementById('ui');
    const stockParent = elementById('stock');
    const before = elementById('before');
    const moverConfigs: MovableFrameConfig[] = [];
    const mover = {
      relocalize: vi.fn(),
      reapplyPosition: vi.fn(),
      reset: vi.fn(),
    };

    const meter = createDoomMeter(
      document,
      stockParent,
      before,
      writers(),
      {
        label: () => 'Condemnation',
        formatCount: String,
        formatEmptyStatus: (value, max) => `${value}/${max}`,
        formatStatus: (value, max) => `${value}/${max}`,
        fateThreadsLabel: () => 'Fate Threads',
        formatFateThreadsStatus: (value, max) => `${value}/${max}`,
      },
      {
        detachedParent,
        isMobileLayout: () => false,
        createMover: (config) => {
          moverConfigs.push(config);
          return mover;
        },
      },
    );

    expect(moverConfigs).toHaveLength(1);
    const [config] = moverConfigs;
    if (!config) throw new Error('Doom meter did not create its mover');
    expect(config.frame.querySelector('#warlock-doom')).not.toBeNull();
    expect(config.frame.querySelector('.warlock-fate-threads')).not.toBeNull();
    expect(config.frame.querySelectorAll('.warlock-fate-thread')).toHaveLength(3);
    expect(config.storageKey).toBe('woc_warlock_doom_frame_pos');

    config.onPositioned?.(true);
    expect(config.frame.parentElement).toBe(detachedParent);
    expect(config.frame.classList.contains('doom-detached')).toBe(true);

    config.onPositioned?.(false);
    expect(config.frame.parentElement).toBe(stockParent);
    expect(config.frame.nextElementSibling).toBe(before);
    expect(config.frame.classList.contains('doom-detached')).toBe(false);

    meter.relocalize();
    meter.reapplyPosition();
    meter.resetPosition();
    expect(mover.relocalize).toHaveBeenCalledOnce();
    expect(mover.reapplyPosition).toHaveBeenCalledOnce();
    expect(mover.reset).toHaveBeenCalledOnce();
  });
});
