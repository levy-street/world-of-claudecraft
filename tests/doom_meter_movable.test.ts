// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { createDoomMeter } from '../src/ui/hud/warlock/doom_meter';
import { HUD_FRAME_SPECS } from '../src/ui/interface_unlock_core';
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
      if (value === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, value);
    },
  };
}

function elementById(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

describe('Affliction resource block movement', () => {
  it('mints the frame the doomMeter registry row governs, with the legacy storage key', () => {
    document.body.innerHTML = '<div id="ui"></div><div id="stock"><div id="before"></div></div>';
    const stockParent = elementById('stock');
    const before = elementById('before');

    createDoomMeter(document, stockParent, before, writers(), {
      label: () => 'Condemnation',
      formatCount: String,
      formatEmptyStatus: (value, max) => `${value}/${max}`,
      formatStatus: (value, max) => `${value}/${max}`,
      fateThreadsLabel: () => 'Fate Threads',
      formatFateThreadsStatus: (value, max) => `${value}/${max}`,
    });

    // Movement, hide and resize come from the "Unlock interface" registry
    // (HUD_FRAME_SPECS row 'doomMeter'), not a private mover, so the two
    // sides must agree on the element id, and the row must keep the storage
    // key the pre-registry mover persisted under (player layout data) plus
    // the #ui re-home its transformed #actionbar-stack ancestor demands.
    const spec = HUD_FRAME_SPECS.find((s) => s.id === 'doomMeter');
    if (!spec) throw new Error('doomMeter registry row is gone');
    const frame = document.getElementById(spec.elementId);
    expect(frame).not.toBeNull();
    expect(frame?.parentElement).toBe(stockParent);
    expect(frame?.nextElementSibling).toBe(before);
    expect(spec.storageKey).toBe('woc_warlock_doom_frame_pos');
    expect(spec.detachToUiRoot).toBe(true);

    // Condemnation and the Fate Threads pips ride the one frame, so a drag
    // moves them together.
    expect(frame?.querySelector('#warlock-doom')).not.toBeNull();
    expect(frame?.querySelector('.warlock-fate-threads')).not.toBeNull();
    expect(frame?.querySelectorAll('.warlock-fate-thread')).toHaveLength(3);
  });
});
