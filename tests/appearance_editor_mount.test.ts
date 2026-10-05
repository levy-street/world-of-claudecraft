// @vitest-environment happy-dom
//
// The appearance editor mount (src/ui/appearance_editor_mount.ts) prefetches the WOC head
// files the face builder is about to show, since the head library streams file by file:
// the body type's default look the moment the builder opens, and every hairstyle (or facial
// hair) file of the CURRENT type when that category opens.
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
