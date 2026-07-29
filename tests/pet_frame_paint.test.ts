// The pet frame end to end: pet_frame_view's descriptor -> the shared unit_frame
// core -> a real UnitFramePainter over the pet element set, driven through the
// PainterHost write-elision facet.
//
// The core's own derivation is covered by pet_frame_view.test.ts; what this pins is
// the part only the assembled chain can show: that the pet instance's element set
// (no resource group, no absorb overlay, stateClasses on) turns a live/dead/absent
// pet into the right DOM, and that a pet whose health has not moved costs ZERO
// writes on the next frame, which is what lets the frame paint on the frame band.

import { describe, expect, it } from 'vitest';
import { makeWriterFacet } from '../src/ui/painter_host';
import { type PetFrameUnit, petFrameDescriptorInto } from '../src/ui/pet_frame_view';
import {
  newUnitFrameBuffer,
  type UnitFrameDescriptor,
  unitFrameViewInto,
} from '../src/ui/unit_frame';
import { UnitFramePainter } from '../src/ui/unit_frame_painter';

const DEAD_TEXT = 'Dead';

function fakeEl() {
  const classes: Record<string, boolean> = {};
  const node = {
    textContent: '',
    style: { display: '', width: '', transform: '', setProperty(): void {} },
    classList: {
      toggle(cls: string, on: boolean): void {
        classes[cls] = on;
      },
    },
    setAttribute(): void {},
  };
  return { node, classes, el: node as unknown as HTMLElement };
}

function harness() {
  const counts = { writes: 0, skips: 0 };
  const facet = makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    () => {
      counts.writes++;
    },
    () => {
      counts.skips++;
    },
  );
  const frame = fakeEl();
  const level = fakeEl();
  const hpFill = fakeEl();
  const hpText = fakeEl();
  const name = fakeEl();
  // The pet instance exactly as hud.ts builds it: name + level + hp, NO resource
  // group and NO absorb overlay, with the dead/out-of-range state classes on.
  const painter = new UnitFramePainter(
    facet,
    {
      frame: frame.el,
      name: name.el,
      level: level.el,
      hpFill: hpFill.el,
      hpText: hpText.el,
    },
    { shownDisplay: 'flex', stateClasses: true, repaintPortrait: () => portraits.push(1) },
  );
  const portraits: number[] = [];
  const descriptor: UnitFrameDescriptor = {
    present: false,
    hpFrac: 0,
    hpText: '',
    resourceKind: 'none',
    resFrac: 0,
    resText: '',
    levelText: null,
    name: '',
    portraitKey: '',
    absorb: null,
    dead: false,
    outOfRange: false,
  };
  const buffer = newUnitFrameBuffer();
  const paint = (pet: PetFrameUnit | null): void => {
    painter.paint(unitFrameViewInto(buffer, petFrameDescriptorInto(descriptor, pet, DEAD_TEXT)));
  };
  return { paint, frame, level, hpFill, hpText, name, counts, portraits };
}

function pet(over: Partial<PetFrameUnit> = {}): PetFrameUnit {
  return {
    id: 42,
    kind: 'mob',
    ownerId: 7,
    templateId: 'wolf',
    name: 'Fang',
    hp: 300,
    maxHp: 400,
    dead: false,
    ...over,
  };
}

describe('pet frame paint chain', () => {
  it('shows the frame and writes name, health bar, and health text for a live pet', () => {
    const h = harness();
    h.paint(pet());
    expect(h.frame.node.style.display).toBe('flex');
    expect(h.name.node.textContent).toBe('Fang');
    expect(h.hpFill.node.style.transform).toBe('scaleX(0.75)');
    expect(h.hpText.node.textContent).toBe('300 / 400');
  });

  it('hides the frame when the player has no pet', () => {
    const h = harness();
    h.paint(pet());
    h.paint(null);
    expect(h.frame.node.style.display).toBe('none');
  });

  it('leaves the level chip blank rather than restating the owner level', () => {
    const h = harness();
    h.paint(pet());
    expect(h.level.node.textContent).toBe('');
  });

  it('marks a dead pet with the dead class and the localized dead text', () => {
    const h = harness();
    h.paint(pet({ dead: true, hp: 0 }));
    expect(h.frame.classes.dead).toBe(true);
    expect(h.hpText.node.textContent).toBe(DEAD_TEXT);
    // Still shown: selecting a dead pet is how the revive path stays reachable.
    expect(h.frame.node.style.display).toBe('flex');
  });

  it('clears the dead class once the pet is revived', () => {
    const h = harness();
    h.paint(pet({ dead: true, hp: 0 }));
    h.paint(pet({ hp: 120 }));
    expect(h.frame.classes.dead).toBe(false);
  });

  it('never marks the pet out of range: the owner pet always heels into view', () => {
    const h = harness();
    h.paint(pet());
    expect(h.frame.classes.oor).toBe(false);
  });

  it('elides every write on an unchanged frame, so a steady pet costs no DOM work', () => {
    const h = harness();
    const steady = pet();
    h.paint(steady);
    const afterFirst = h.counts.writes;
    expect(afterFirst).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) h.paint(steady);
    expect(h.counts.writes).toBe(afterFirst);
    expect(h.counts.skips).toBeGreaterThan(0);
  });

  it('writes again as soon as the pet actually takes damage', () => {
    const h = harness();
    h.paint(pet());
    const afterFirst = h.counts.writes;
    h.paint(pet({ hp: 200 }));
    expect(h.counts.writes).toBeGreaterThan(afterFirst);
    expect(h.hpText.node.textContent).toBe('200 / 400');
  });

  it('repaints the portrait on a pet SWAP but not on the same pet taking damage', () => {
    const h = harness();
    h.paint(pet());
    expect(h.portraits).toHaveLength(1);
    h.paint(pet({ hp: 10 }));
    expect(h.portraits).toHaveLength(1);
    h.paint(pet({ id: 99, name: 'Shade' }));
    expect(h.portraits).toHaveLength(2);
  });

  it('repaints the portrait when the same pet is re-summoned after being absent', () => {
    const h = harness();
    h.paint(pet());
    h.paint(null);
    h.paint(pet());
    expect(h.portraits).toHaveLength(2);
  });
});
