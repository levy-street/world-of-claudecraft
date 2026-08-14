// @vitest-environment jsdom
//
// The creator's Share tab: the design code mirrors the current look, Copy
// falls back to select-and-keystroke where the clipboard is unavailable, and
// Import replaces every changeable feature while keeping the body.
import { describe, expect, it } from 'vitest';
import { encodeDesignCode } from '../src/render/characters/design_code_core';
import { DEFAULT_APPEARANCE, type ModularAppearance } from '../src/render/characters/modular';
import { mountAppearanceCustomizer } from '../src/ui/appearance_customizer';

function mount(value?: Partial<ModularAppearance>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let last: ModularAppearance | null = null;
  const ui = mountAppearanceCustomizer(host, {
    value: value ?? null,
    onChange: (v) => {
      last = v;
    },
  });
  const shareTab = [...host.querySelectorAll<HTMLButtonElement>('.ac-tab')].find(
    (b) => b.textContent === 'Share',
  );
  if (!shareTab) throw new Error('no Share tab');
  shareTab.click();
  const code = host.querySelector('textarea.ac-code') as HTMLTextAreaElement;
  const status = host.querySelector('.ac-share-status') as HTMLElement;
  const button = (label: string) => {
    const b = [...host.querySelectorAll<HTMLButtonElement>('.ac-share-btn')].find(
      (x) => x.textContent === label,
    );
    if (!b) throw new Error(`no ${label} button`);
    return b;
  };
  return {
    host,
    ui,
    code,
    status,
    importBtn: button('Import'),
    copyBtn: button('Copy code'),
    changed: () => last,
    destroy: () => {
      ui.destroy();
      host.remove();
    },
  };
}

describe('creator share tab: export', () => {
  it('mirrors the current look as a design code and tracks edits', () => {
    const m = mount();
    expect(m.code.value).toBe(encodeDesignCode(DEFAULT_APPEARANCE));
    expect(m.code.value).toContain('body=male');
    m.ui.set({ hair: 'mohawk', gender: 'female' });
    expect(m.code.value).toContain('hair=mohawk');
    expect(m.code.value).toContain('body=female');
    m.destroy();
  });

  it('leaves a paste in progress alone while the box has focus', () => {
    const m = mount();
    m.code.focus();
    m.code.value = 'WOC1; hair=mohawk';
    m.ui.set({ beard: 'full' });
    expect(m.code.value).toBe('WOC1; hair=mohawk');
    m.destroy();
  });

  it('selects the code for a manual copy when no clipboard API exists', () => {
    // jsdom ships no navigator.clipboard, which IS the fallback environment
    const m = mount();
    m.copyBtn.click();
    expect(document.activeElement).toBe(m.code);
    // informational, not an error: the copy is one keystroke away
    expect(m.status.classList.contains('err')).toBe(false);
    expect(m.status.textContent).toBe(
      'Automatic copy is blocked here. The code is selected, copy it with your keyboard.',
    );
    m.destroy();
  });

  const withClipboard = (writeText: (text: string) => Promise<void>, run: () => Promise<void>) => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    return run().finally(() => {
      // biome-ignore lint/performance/noDelete: restoring jsdom's clipboard-free default
      delete (navigator as { clipboard?: unknown }).clipboard;
    });
  };

  it('reports success through the async clipboard API and copies the mirrored code', async () => {
    const copied: string[] = [];
    await withClipboard(
      (text) => {
        copied.push(text);
        return Promise.resolve();
      },
      async () => {
        const m = mount();
        m.copyBtn.click();
        await new Promise((r) => setTimeout(r, 0));
        expect(copied).toEqual([encodeDesignCode(DEFAULT_APPEARANCE)]);
        expect(m.status.classList.contains('err')).toBe(false);
        expect(m.status.textContent).toBe('Design code copied.');
        m.destroy();
      },
    );
  });

  it('falls back to select-and-keystroke when the clipboard write is denied', async () => {
    await withClipboard(
      () => Promise.reject(new Error('denied')),
      async () => {
        const m = mount();
        m.copyBtn.click();
        await new Promise((r) => setTimeout(r, 0));
        expect(document.activeElement).toBe(m.code);
        expect(m.status.classList.contains('err')).toBe(false);
        expect(m.status.textContent).not.toBe('');
        m.destroy();
      },
    );
  });

  it('copies the live look when the box was emptied', async () => {
    const copied: string[] = [];
    await withClipboard(
      (text) => {
        copied.push(text);
        return Promise.resolve();
      },
      async () => {
        const m = mount();
        m.code.value = '   ';
        m.copyBtn.click();
        await new Promise((r) => setTimeout(r, 0));
        expect(copied).toEqual([encodeDesignCode(DEFAULT_APPEARANCE)]);
        m.destroy();
      },
    );
  });
});

describe('creator share tab: import', () => {
  it('applies a pasted code to every changeable feature and reports success', () => {
    const m = mount();
    m.code.value = 'WOC1; body=female; hair=mohawk; skin=200/80/50; lips=ruby';
    m.importBtn.click();
    const a = m.changed();
    expect(a).not.toBeNull();
    expect(a!.gender).toBe('female');
    expect(a!.hair).toBe('mohawk');
    expect(a!.skinHue).toBe(200);
    expect(a!.lipstick).toBe('ruby');
    // the female standard fills the unstated lash field
    expect(a!.lashes).toBe(true);
    expect(m.status.classList.contains('err')).toBe(false);
    expect(m.status.textContent).toBe('Design imported.');
    // the box re-mirrors the normalized code, proof the paste was read
    expect(m.code.value).toBe(encodeDesignCode(a!));
    m.destroy();
  });

  it('re-mirrors the canonical code even while the box still holds focus', () => {
    // Clicking a button does not move focus in jsdom, which is exactly the
    // case the import handler must own: sync()'s paste guard skips a focused
    // textarea, so relying on it would leave the raw pasted text in a box
    // that claims to show the imported look.
    const m = mount();
    m.code.focus();
    m.code.value = 'WOC1; hair=mohawk';
    m.importBtn.click();
    const a = m.changed();
    if (!a) throw new Error('no change emitted');
    expect(document.activeElement).toBe(m.code);
    expect(m.code.value).toBe(encodeDesignCode(a));
    m.destroy();
  });

  it('keeps the current body proportions across an import', () => {
    const shaped = {
      ...DEFAULT_APPEARANCE,
      body: { ...DEFAULT_APPEARANCE.body, shoulders: 0.5 },
    };
    const m = mount(shaped);
    m.code.value = 'WOC1; body=female; hair=mohawk';
    m.importBtn.click();
    expect(m.changed()?.body?.shoulders).toBe(0.5);
    m.destroy();
  });

  it('imports around unknown values with the partial notice', () => {
    const m = mount();
    m.code.value = 'WOC1; hair=mohawk; sparkle=9';
    m.importBtn.click();
    expect(m.changed()?.hair).toBe('mohawk');
    expect(m.status.classList.contains('err')).toBe(false);
    expect(m.status.textContent).toBe(
      'Design imported. Values this version does not know were skipped.',
    );
    m.destroy();
  });

  it('shows the partial notice when a value was coerced, not just when ignored', () => {
    const m = mount();
    m.code.value = 'WOC1; hair=notastyle';
    m.importBtn.click();
    expect(m.changed()?.hair).toBe(DEFAULT_APPEARANCE.hair);
    expect(m.status.classList.contains('err')).toBe(false);
    expect(m.status.textContent).toBe(
      'Design imported. Values this version does not know were skipped.',
    );
    m.destroy();
  });

  it('asks for a code when the box is empty', () => {
    const m = mount();
    m.code.value = '   ';
    m.importBtn.click();
    expect(m.changed()).toBeNull();
    expect(m.status.classList.contains('err')).toBe(true);
    expect(m.status.textContent).toBe('Paste a design code first.');
    m.destroy();
  });

  it('rejects a damaged code, says so, and changes nothing', () => {
    const m = mount();
    m.code.value = 'WOC1; skin=1/2';
    m.importBtn.click();
    expect(m.changed()).toBeNull();
    expect(m.status.classList.contains('err')).toBe(true);
    expect(m.status.textContent).toBe(
      'That design code is damaged. Copy the whole code and try again.',
    );
    m.destroy();
  });

  it('flags a code from a future format version', () => {
    const m = mount();
    m.code.value = 'WOC9; body=female';
    m.importBtn.click();
    expect(m.changed()).toBeNull();
    expect(m.status.textContent).toBe('That design code comes from a newer game version.');
    m.destroy();
  });
});
