// @vitest-environment happy-dom
//
// The edit mode's placeholder samples (src/ui/interface_unlock_preview.ts):
// what mounts where when the interface unlocks, and that the whole overlay
// set is removed on lock. The pet action bar's sample must carry the
// CLASS-specific command icons the host resolves (petBarPreviewIconIds) with
// kind 'ability' (they are commands, not auras), and the pet FRAME gets no
// sample at all: its placeholder already shows the real unit-frame chrome,
// and the old generic portrait/hp/mp mock read as a second fake frame
// (owner feedback). Icon rendering itself is icons.ts's (mocked here: the
// procedural path needs a real canvas).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InterfaceUnlockPreview } from '../src/ui/interface_unlock_preview';

vi.mock('../src/ui/icons', () => ({
  iconDataUrl: (kind: string, id: string, size: number) => `stub:${kind}:${id}:${size}`,
}));

const HOST_IDS = [
  'buff-bar',
  'debuff-bar',
  'party-frames',
  'petbar',
  'pet-frame',
  'castbar',
  'swingbar',
];

beforeEach(() => {
  document.body.innerHTML = HOST_IDS.map((id) => `<div id="${id}"></div>`).join('');
});

const previews = (id: string) => [...document.querySelectorAll(`#${id} .tf-preview`)];

describe('InterfaceUnlockPreview', () => {
  it('mounts the class-true pet bar sample as ABILITY icons, and none on the pet frame', () => {
    const petIcons = ['pet_attack', 'pet_growl', 'pet_feed', 'pet_defensive'];
    const preview = new InterfaceUnlockPreview(document, undefined, () => petIcons);
    preview.setActive(true);

    const [row] = previews('petbar');
    expect(row).toBeTruthy();
    const srcs = [...(row as HTMLElement).querySelectorAll('img')].map((img) =>
      img.getAttribute('src'),
    );
    expect(srcs).toEqual(petIcons.map((id) => `stub:ability:${id}:24`));
    // The pet unit frame keeps only its real chrome.
    expect(previews('pet-frame')).toEqual([]);
  });

  it('skips the pet bar sample when the host resolves no icons (petless class)', () => {
    const preview = new InterfaceUnlockPreview(document, undefined, () => []);
    preview.setActive(true);
    expect(previews('petbar')).toEqual([]);
    // The class-independent samples still mount.
    expect(previews('buff-bar')).toHaveLength(1);
    expect(previews('castbar')).toHaveLength(1);
  });

  it('aura rows sample with kind aura, and lock removes every overlay', () => {
    const built: HTMLElement[] = [];
    const preview = new InterfaceUnlockPreview(
      document,
      (host) => built.push(host),
      () => ['pet_attack'],
    );
    preview.setActive(true);

    const [buffRow] = previews('buff-bar');
    const buffSrc = (buffRow as HTMLElement).querySelector('img')?.getAttribute('src') ?? '';
    expect(buffSrc.startsWith('stub:aura:')).toBe(true);
    // The party sample host was handed to the injected row builder.
    expect(built).toHaveLength(1);
    // Every sample is aria-hidden decoration.
    for (const node of document.querySelectorAll('.tf-preview')) {
      expect(node.getAttribute('aria-hidden')).toBe('true');
    }

    preview.setActive(false);
    expect(document.querySelectorAll('.tf-preview')).toHaveLength(0);
  });
});
