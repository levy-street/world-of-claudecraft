// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { Settings } from '../src/game/settings';
import {
  buildFerryBellHomeNote,
  buildFerryIslandArrivalNote,
} from '../src/ui/tutorial_greeting_view';
import { renderTutorialGreetingNote } from '../src/ui/tutorial_greeting_window';

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

it('lets the ferry arrival choose guidance without changing quest tracking', () => {
  const settings = new Settings();
  const onClose = vi.fn();
  expect(settings.get('eastbrookGuidance')).toBe(true);
  const el = renderTutorialGreetingNote(buildFerryBellHomeNote(), {
    onClose,
    onGuidanceChoice: (enabled) => settings.set('eastbrookGuidance', enabled),
  });
  expect(el.getAttribute('role')).toBe('dialog');
  expect(el.getAttribute('aria-modal')).toBe('true');
  // The guidance choice leads and the return-bell note follows, each its
  // own paragraph, so a misclicked ride still learns where the twin bell is.
  const paragraphs = [...el.querySelectorAll('.cd-para')].map((p) => p.textContent ?? '');
  expect(paragraphs).toHaveLength(2);
  expect(paragraphs[0]).toContain('Marshal Redbrook');
  expect(paragraphs[1]).toContain('Ravenpost');
  const off = el.querySelector<HTMLButtonElement>('[data-guidance="off"]');
  expect(off).not.toBeNull();
  off?.click();
  expect(settings.get('eastbrookGuidance')).toBe(false);
  expect(new Settings().get('eastbrookGuidance')).toBe(false);
  expect(onClose).toHaveBeenCalledOnce();
  expect(localStorage.getItem('woc_untracked_quests_warrior_Test')).toBeNull();

  const again = renderTutorialGreetingNote(buildFerryBellHomeNote(), {
    onClose,
    onGuidanceChoice: (enabled) => settings.set('eastbrookGuidance', enabled),
  });
  again.querySelector<HTMLButtonElement>('[data-guidance="on"]')?.click();
  expect(settings.get('eastbrookGuidance')).toBe(true);
});

it('keeps the island arrival as its original single-button welcome', () => {
  const onClose = vi.fn();
  const el = renderTutorialGreetingNote(buildFerryIslandArrivalNote(), { onClose });
  expect(el.querySelectorAll('button')).toHaveLength(1);
  el.querySelector<HTMLButtonElement>('[data-close]')?.click();
  expect(onClose).toHaveBeenCalledOnce();
});
