// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityView } from '../src/render/renderer';

interface StaticNameplateInvoker {
  setNameplateStatic(
    view: EntityView,
    name: string,
    color: string | null,
    hpDisplay: string,
    marker: string,
    markerClass: string,
    opacity: string,
    frame?: string,
    guild?: string,
    devOutline?: string | null,
    isAi?: boolean,
  ): void;
}

interface TitleNameplateInvoker {
  setNameplateTitle(view: EntityView, titleId: string | null | undefined): void;
}

function view(): EntityView {
  const div = () => document.createElement('div');
  return {
    nameEl: div(),
    hpBar: div(),
    markerEl: div(),
    nameplate: div(),
    guildEl: div(),
    aiEl: document.createElement('span'),
    titleEl: div(),
    nameplateSig: '',
    nameplateStaticName: '',
    nameplateStaticColor: null,
    nameplateStaticHpDisplay: '',
    nameplateStaticMarker: '',
    nameplateStaticMarkerClass: '',
    nameplateStaticOpacity: '',
    nameplateStaticFrame: '',
    nameplateStaticGuild: '',
    nameplateStaticDevOutline: null,
    nameplateStaticAi: false,
    nameplateStaticI18nRevision: 0,
    titleSig: '',
    nameplateTitleId: '',
    nameplateTitleI18nRevision: 0,
  } as unknown as EntityView;
}

async function pseudoPainter() {
  window.history.replaceState({}, '', '/?lang=en_XA');
  vi.resetModules();
  const [{ NameplatePainter }, i18n] = await Promise.all([
    import('../src/render/nameplate_painter'),
    import('../src/ui/i18n'),
  ]);
  return {
    painter: Object.create(NameplatePainter.prototype) as InstanceType<typeof NameplatePainter>,
    setLanguage: i18n.setLanguage,
  };
}

beforeEach(() => {
  window.history.replaceState({}, '', '/?lang=en_XA');
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.resetModules();
});

describe('nameplate language-only transitions', () => {
  it('repaints the localized AI tag when pseudo English changes to English', async () => {
    const { painter, setLanguage } = await pseudoPainter();
    const v = view();
    const staticPainter = painter as unknown as StaticNameplateInvoker;

    staticPainter.setNameplateStatic(
      v,
      'Streamer',
      '#fff',
      '',
      '',
      'np-marker',
      '1',
      '',
      '',
      null,
      true,
    );
    expect(v.aiEl.textContent).toBe('[[ÁÍ]]');

    setLanguage('en');
    staticPainter.setNameplateStatic(
      v,
      'Streamer',
      '#fff',
      '',
      '',
      'np-marker',
      '1',
      '',
      '',
      null,
      true,
    );

    expect(v.aiEl.textContent).toBe('[AI]');
  }, 30_000);

  it('repaints the deed title when only pseudo activation changes', async () => {
    const { painter, setLanguage } = await pseudoPainter();
    const v = view();
    const titlePainter = painter as unknown as TitleNameplateInvoker;

    titlePainter.setNameplateTitle(v, 'prog_veteran');
    expect(v.titleEl.textContent).toBe('[Ʋéţéŕáñ]');

    setLanguage('en');
    titlePainter.setNameplateTitle(v, 'prog_veteran');

    expect(v.titleEl.textContent).toBe('Veteran');
  }, 30_000);
});
