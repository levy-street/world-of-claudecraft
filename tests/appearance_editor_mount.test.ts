// @vitest-environment happy-dom
//
// The appearance editor mount (src/ui/appearance_editor_mount.ts) prefetches the WOC head
// files the face builder is about to show, since the head library streams file by file:
// the body type's default look the moment the builder opens, and every hairstyle (or facial
// hair) file of the CURRENT type when that category opens. It is also what tells the stage a
// character was CHOSEN (the creator draws full armor detail from then on): the player opening
// a face category or changing the look of the body on the stage, never the body type pick
// and never the host showing the panel again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const heads = vi.hoisted(() => ({
  looks: [] as unknown[][],
  slots: [] as unknown[][],
}));
vi.mock('../src/render/characters/woc_head_packs', () => ({
  prefetchWocHeadLook: vi.fn((...args: unknown[]) => {
    heads.looks.push(args);
    return false;
  }),
  prefetchWocHeadSlot: vi.fn((...args: unknown[]) => {
    heads.slots.push(args);
  }),
}));

import {
  type AppearanceCustomizer,
  mountAppearanceEditor,
} from '../src/ui/appearance_editor_mount';

let host: HTMLElement;
let editor: AppearanceCustomizer | null = null;

const tab = (cat: string) => host.querySelector<HTMLButtonElement>(`.whb-cat[data-cat="${cat}"]`)!;

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  host = document.getElementById('host')!;
  heads.looks.length = 0;
  heads.slots.length = 0;
});
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('the face builder mount prefetches its head files', () => {
  it("fetches the body type's default look at once, and a slot's files when its category opens", () => {
    editor = mountAppearanceEditor(host, 'warrior', {
      value: { gender: 'male' },
      onChange: () => {},
    });
    expect(heads.looks).toEqual([['a']]);
    expect(heads.slots).toEqual([]);
    tab('face').click();
    tab('eyesBrows').click();
    expect(heads.slots).toEqual([]); // those options all ride the core
    tab('hairstyle').click();
    expect(heads.slots).toEqual([['a', 'hair']]);
    tab('facialHair').click();
    expect(heads.slots).toEqual([
      ['a', 'hair'],
      ['a', 'beard'],
    ]);
  });

  it("follows the builder's CURRENT body type", () => {
    editor = mountAppearanceEditor(host, 'mage', {
      value: { gender: 'female' },
      onChange: () => {},
    });
    expect(heads.looks).toEqual([['b']]);
    tab('hairstyle').click();
    expect(heads.slots).toEqual([['b', 'hair']]);
    // switched to Type A inside the builder: the next open fetches Type A's files
    editor.set({ gender: 'male' });
    tab('facialHair').click();
    expect(heads.slots.at(-1)).toEqual(['a', 'beard']);
  });
});

describe('the face builder mount tells the stage when its character is chosen', () => {
  /** A stage that records what the mount tells it, in order; `change` is the host's own
   *  onChange (character creation stages the new look from it). */
  function staged(value: { gender: 'male' | 'female' }) {
    const calls: string[] = [];
    const stage = {
      setFocus: (focus: string) => calls.push(`focus:${focus}`),
      markChosen: () => calls.push('chosen'),
    };
    editor = mountAppearanceEditor(host, 'warrior', {
      value,
      stage: () => stage,
      onChange: (next) => calls.push(`change:${next.gender}`),
    });
    return calls;
  }
  /** A control the builder painted (the panel is redrawn on every pick: look it up fresh). */
  const control = <T extends Element>(selector: string): T => {
    const node = host.querySelector<T>(selector);
    if (!node) throw new Error(`the builder painted no ${selector}`);
    return node;
  };
  const option = (key: string) => control<HTMLButtonElement>(`.whb-opt[data-focus-key="${key}"]`);
  const unpicked = () => control<HTMLButtonElement>('.whb-panel .whb-opt:not(.sel)');
  const bodySize = () => control<HTMLInputElement>('.whb-panel input.whb-slider');

  it('says nothing at mount: the body tab is open and nobody acted', () => {
    expect(staged({ gender: 'male' })).toEqual([]);
  });

  it('marks it on opening a face category (the close-up), never on the body tab', () => {
    const calls = staged({ gender: 'male' });
    tab('hairstyle').click();
    expect(calls).toEqual(['focus:face', 'chosen']);
    calls.length = 0;
    tab('bodyType').click();
    expect(calls).toEqual(['focus:body']);
  });

  it('marks it on a look pick, after the host has staged that look', () => {
    const calls = staged({ gender: 'male' });
    tab('hairstyle').click();
    calls.length = 0;
    unpicked().click();
    expect(calls).toEqual(['change:male', 'chosen']);
  });

  it('marks it on the body size: the same body, worked on', () => {
    const calls = staged({ gender: 'male' });
    const size = bodySize();
    size.value = size.max;
    size.dispatchEvent(new Event('input'));
    expect(calls).toEqual(['change:male', 'chosen']);
  });

  it('does not mark the body type pick: that puts another body on the stage', () => {
    const calls = staged({ gender: 'male' });
    option('bodyType:female').click();
    expect(calls).toEqual(['change:female']);
    // ...and the look worked on next is the new body's
    calls.length = 0;
    option('bodyType:male').click();
    expect(calls).toEqual(['change:male']);
    const size = bodySize();
    size.value = size.min;
    size.dispatchEvent(new Event('input'));
    expect(calls).toEqual(['change:male', 'change:male', 'chosen']);
  });

  it('does not mark when the host shows the panel again, whatever body it hands in', () => {
    const calls = staged({ gender: 'male' });
    tab('hairstyle').click();
    calls.length = 0;
    // a class switch pokes set(): the camera's focus is re-asserted, nothing is chosen
    editor?.set({});
    expect(calls).toEqual(['focus:face']);
    // the host handed in the other body: a look pick on it is on the body that is there
    editor?.set({ gender: 'female' });
    calls.length = 0;
    unpicked().click();
    expect(calls).toEqual(['change:female', 'chosen']);
  });

  it.each([
    ['Randomize', 0],
    ['Reset', 1],
  ] as const)('marks it on %s: the look of the body on the stage, worked on', (_name, at) => {
    const calls = staged({ gender: 'female' });
    const button = host.querySelectorAll<HTMLButtonElement>('.whb-foot-btn')[at];
    if (!button) throw new Error('the builder painted no footer button');
    button.click();
    expect(calls).toEqual(['change:female', 'chosen']);
  });

  it('marks it on a colour swatch', () => {
    const calls = staged({ gender: 'male' });
    tab('skinTone').click();
    calls.length = 0;
    control<HTMLButtonElement>('.whb-panel .whb-sw:not(.sel)').click();
    expect(calls).toEqual(['change:male', 'chosen']);
  });
});
