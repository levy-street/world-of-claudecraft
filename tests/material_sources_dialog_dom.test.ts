// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import {
  closeMaterialSourcesDialog,
  closeMaterialSourcesDialogForOwner,
  MaterialSourcesDialog,
  openMaterialSourcesDialog,
} from '../src/ui/material_sources_dialog';

const composition = [
  {
    source: { gatherer: { kind: 'character' as const, id: 11, name: 'Ana' } },
    count: 2,
  },
];

afterEach(() => {
  closeMaterialSourcesDialog(false);
  document.body.innerHTML = '';
});

describe('material source prompt lifecycle', () => {
  it('contains modal keys and clears inert and modal state on Escape', () => {
    document.body.innerHTML =
      '<div id="prompt-stack"></div><section class="window"><button id="opener">Sources</button></section>';
    const opener = document.getElementById('opener') as HTMLButtonElement;
    const backingWindow = opener.closest('.window') as HTMLElement;
    const dialog = new MaterialSourcesDialog();
    let leaked = 0;
    const countGameKey = (event: Event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Enter' || key === ' ' || key === 'Escape') leaked++;
    };
    globalThis.addEventListener('keydown', countGameKey);

    try {
      dialog.open({ itemName: 'Copper Ore', sources: composition, opener, onConfirm: () => {} });
      const root = document.getElementById('material-sources-dialog') as HTMLElement;
      const input = root.querySelector('input') as HTMLInputElement;
      expect(root.getAttribute('role')).toBe('dialog');
      expect(root.getAttribute('aria-modal')).toBe('true');
      expect(backingWindow.inert).toBe(true);
      expect(document.activeElement).toBe(input);
      const close = root.querySelector('[data-material-sources-close]') as HTMLButtonElement;
      const cancel = root.querySelector('.material-sources-cancel') as HTMLButtonElement;
      cancel.focus();
      cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(close);
      input.focus();

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
      expect(leaked).toBe(0);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(leaked).toBe(0);
      expect(backingWindow.inert).toBe(false);
      expect(document.getElementById('material-sources-dialog')).toBeNull();
      expect(root.hasAttribute('aria-modal')).toBe(false);
      expect(document.activeElement).toBe(opener);
    } finally {
      globalThis.removeEventListener('keydown', countGameKey);
      dialog.close(false);
    }
  });

  it('keeps a repainted opener owner and ignores unrelated window teardown', () => {
    document.body.innerHTML =
      '<div id="prompt-stack"></div>' +
      '<section id="owner" class="window"><button id="opener">Sources</button></section>' +
      '<section id="other" class="window"><button id="sentinel">Elsewhere</button></section>';
    const owner = document.getElementById('owner') as HTMLElement;
    const other = document.getElementById('other') as HTMLElement;
    const opener = document.getElementById('opener') as HTMLButtonElement;

    openMaterialSourcesDialog({ itemName: 'Copper Ore', sources: composition, opener });
    const dialogRoot = document.getElementById('material-sources-dialog') as HTMLElement;
    const replacementClose = document.createElement('button');
    replacementClose.dataset.close = '';
    owner.replaceChildren(replacementClose);

    expect(closeMaterialSourcesDialogForOwner(other)).toBe(false);
    expect(document.getElementById('material-sources-dialog')).toBe(dialogRoot);
    expect(owner.inert).toBe(true);
    const sentinel = document.getElementById('sentinel') as HTMLButtonElement;
    sentinel.focus();
    expect(closeMaterialSourcesDialogForOwner(owner)).toBe(true);
    expect(document.getElementById('material-sources-dialog')).toBeNull();
    expect(owner.inert).toBe(false);
    expect(dialogRoot.hasAttribute('aria-modal')).toBe(false);
    expect(document.activeElement).toBe(sentinel);
    expect(document.activeElement).not.toBe(replacementClose);
  });

  it('returns focus to a stable owner control on Escape after repaint detached the opener', () => {
    document.body.innerHTML =
      '<div id="prompt-stack"></div>' +
      '<section id="owner" class="window"><button id="opener">Sources</button></section>';
    const owner = document.getElementById('owner') as HTMLElement;
    const opener = document.getElementById('opener') as HTMLButtonElement;

    openMaterialSourcesDialog({ itemName: 'Copper Ore', sources: composition, opener });
    const root = document.getElementById('material-sources-dialog') as HTMLElement;
    const replacementClose = document.createElement('button');
    replacementClose.dataset.close = '';
    owner.replaceChildren(replacementClose);
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.getElementById('material-sources-dialog')).toBeNull();
    expect(document.activeElement).toBe(replacementClose);
  });

  it('inerts every associated owner and restores each prior state on owner close', () => {
    document.body.innerHTML =
      '<div id="prompt-stack"></div>' +
      '<section id="bags" class="window"><button id="opener">Sources</button></section>' +
      '<section id="bank-window" class="window"></section>' +
      '<section id="already-inert" class="window"></section>';
    const bags = document.getElementById('bags') as HTMLElement;
    const bank = document.getElementById('bank-window') as HTMLElement;
    const alreadyInert = document.getElementById('already-inert') as HTMLElement;
    const opener = document.getElementById('opener') as HTMLButtonElement;
    alreadyInert.inert = true;

    openMaterialSourcesDialog({
      itemName: 'Copper Ore',
      sources: composition,
      opener,
      associatedOwners: [bank, alreadyInert],
      onConfirm: () => {},
    });

    expect(bags.inert).toBe(true);
    expect(bank.inert).toBe(true);
    expect(alreadyInert.inert).toBe(true);
    expect(closeMaterialSourcesDialogForOwner(bank)).toBe(true);
    expect(document.getElementById('material-sources-dialog')).toBeNull();
    expect(bags.inert).toBe(false);
    expect(bank.inert).toBe(false);
    expect(alreadyInert.inert).toBe(true);
  });

  it('restores associated owners before replacing the open dialog', () => {
    document.body.innerHTML =
      '<div id="prompt-stack"></div>' +
      '<section id="first" class="window"><button id="first-opener">Sources</button></section>' +
      '<section id="first-associated" class="window"></section>' +
      '<section id="second" class="window"><button id="second-opener">Sources</button></section>' +
      '<section id="second-associated" class="window"></section>';
    const first = document.getElementById('first') as HTMLElement;
    const firstAssociated = document.getElementById('first-associated') as HTMLElement;
    const second = document.getElementById('second') as HTMLElement;
    const secondAssociated = document.getElementById('second-associated') as HTMLElement;

    openMaterialSourcesDialog({
      itemName: 'Copper Ore',
      sources: composition,
      opener: document.getElementById('first-opener'),
      associatedOwners: [firstAssociated],
    });
    expect(first.inert).toBe(true);
    expect(firstAssociated.inert).toBe(true);

    openMaterialSourcesDialog({
      itemName: 'Tin Ore',
      sources: composition,
      opener: document.getElementById('second-opener'),
      associatedOwners: [secondAssociated],
    });
    expect(first.inert).toBe(false);
    expect(firstAssociated.inert).toBe(false);
    expect(second.inert).toBe(true);
    expect(secondAssociated.inert).toBe(true);

    closeMaterialSourcesDialog(false);
    expect(second.inert).toBe(false);
    expect(secondAssociated.inert).toBe(false);
  });

  it('restores associated owners and confirms only once after an owner repaint', () => {
    document.body.innerHTML =
      '<div id="prompt-stack"></div>' +
      '<section id="bags" class="window"><button id="opener">Sources</button></section>' +
      '<section id="bank-window" class="window"></section>';
    const bags = document.getElementById('bags') as HTMLElement;
    const bank = document.getElementById('bank-window') as HTMLElement;
    const opener = document.getElementById('opener') as HTMLButtonElement;
    let confirms = 0;

    openMaterialSourcesDialog({
      itemName: 'Copper Ore',
      sources: composition,
      opener,
      associatedOwners: [bank],
      onConfirm: () => confirms++,
    });
    const root = document.getElementById('material-sources-dialog') as HTMLElement;
    const input = root.querySelector('input') as HTMLInputElement;
    const increase = root.querySelector('[data-material-source-increase]') as HTMLButtonElement;
    const confirm = root.querySelector('.material-sources-confirm') as HTMLButtonElement;
    increase.focus();
    increase.click();
    expect(input.value).toBe('1');
    expect(input.getAttribute('aria-live')).toBe('polite');
    bags.replaceChildren(document.createElement('div'));

    confirm.click();
    confirm.click();
    expect(confirms).toBe(1);
    expect(document.getElementById('material-sources-dialog')).toBeNull();
    expect(bags.inert).toBe(false);
    expect(bank.inert).toBe(false);
  });
});
