// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({
  audio: { click: vi.fn() },
}));
vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitUpdate: vi.fn(),
  onPortraitsReady: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  portraitsReady: vi.fn(() => false),
  visualPortraitDataUrl: vi.fn(),
}));
vi.mock('../src/ui/icons', () => ({
  iconDataUrl: (kind: string, id: string) => `mock:${kind}:${id}`,
  QUALITY_COLOR: {},
  raidMarkerDataUrl: vi.fn(() => ''),
  // hud.ts dereferences these two at MODULE scope (createAuraIconResolver's
  // call site), not just inside a method, so a mock missing either throws
  // "No export is defined" the instant hud.ts is imported, before any test
  // body runs. The other three are only read inside methods this suite never
  // calls, but are stubbed too so a future call path does not repeat the hunt.
  abilityImageUrl: vi.fn(() => null),
  cachedProceduralIconDataUrl: vi.fn((kind: string, id: string) => `mock:${kind}:${id}`),
  hasAbilityIconIdentity: vi.fn(() => false),
  hasAuraRecipe: vi.fn(() => false),
  proceduralIconDataUrl: vi.fn((kind: string, id: string) => `mock:${kind}:${id}`),
}));

import { Hud } from '../src/ui/hud';

type PetTemplateId = 'emberkin' | 'gloomshade';

interface PetBarHarness {
  sim: {
    cfg: { playerClass: 'warlock' };
    entities: Map<number, Record<string, unknown>>;
    playerId: number;
    petSpecialCommandsSupported: boolean;
    petAttack: ReturnType<typeof vi.fn>;
    petSpecial: ReturnType<typeof vi.fn>;
    petTaunt: ReturnType<typeof vi.fn>;
    healPet: ReturnType<typeof vi.fn>;
    setPetAutoSpecial: ReturnType<typeof vi.fn>;
    setPetAutoTaunt: ReturnType<typeof vi.fn>;
    setPetMode: ReturnType<typeof vi.fn>;
  };
  lastPetPresent: boolean;
  lastPetBarSig: string;
  pendingPetFeed: boolean;
  petModeMenuOpen: boolean;
  peekGuard: { consume(): boolean };
  attachTooltip(): void;
  hideTooltip(): void;
  renderPetBar(pet: unknown): void;
}

function pointerEvent(type: string): Event {
  const event = new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 });
  Object.defineProperties(event, {
    pointerId: { value: 7 },
    pointerType: { value: 'touch' },
  });
  return event;
}

function makeHud(
  templateId: PetTemplateId,
  capability = true,
  petState: { petSkillTimer?: number; petAutoSkill?: boolean } = {},
): PetBarHarness {
  const hud = Object.create(Hud.prototype) as unknown as PetBarHarness;
  const owner = { id: 1, kind: 'player', ownerId: null, auras: [] };
  const pet = {
    id: 2,
    kind: 'mob',
    ownerId: 1,
    templateId,
    dead: false,
    auras: [],
    hp: 100,
    maxHp: 100,
    petMode: 'defensive',
    petTauntTimer: 0,
    petAutoTaunt: true,
    petSkillTimer: 0,
    petAutoSkill: true,
    ...petState,
  };
  hud.sim = {
    cfg: { playerClass: 'warlock' },
    entities: new Map<number, Record<string, unknown>>([
      [1, owner],
      [2, pet],
    ]),
    playerId: 1,
    petSpecialCommandsSupported: capability,
    petAttack: vi.fn(),
    petSpecial: vi.fn(),
    petTaunt: vi.fn(),
    healPet: vi.fn(),
    setPetAutoSpecial: vi.fn(),
    setPetAutoTaunt: vi.fn(),
    setPetMode: vi.fn(),
  };
  hud.lastPetPresent = false;
  hud.lastPetBarSig = '';
  hud.pendingPetFeed = false;
  hud.petModeMenuOpen = false;
  hud.peekGuard = { consume: () => false };
  hud.attachTooltip = vi.fn();
  hud.hideTooltip = vi.fn();
  return hud;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="petbar"></div>';
});

afterEach(() => {
  vi.useRealTimers();
  document.body.className = '';
});

describe('Hud Warlock pet signature bar', () => {
  it('shows Emberkin Felbolt as a damage active and never gives Emberkin Taunt', () => {
    const hud = makeHud('emberkin');
    hud.renderPetBar(hud.sim.entities.get(2) ?? null);

    const felbolt = document.querySelector<HTMLButtonElement>('[title="Felbolt"]');
    expect(felbolt).not.toBeNull();
    expect(document.querySelector('[title="Taunt"]')).toBeNull();
    expect(felbolt?.getAttribute('aria-description')).toBe(
      'Autocast on. Right-click, touch-hold, or press Shift+Enter to turn it off.',
    );
    expect(felbolt?.hasAttribute('aria-pressed')).toBe(false);

    felbolt?.click();
    expect(hud.sim.petSpecial).toHaveBeenCalledTimes(1);

    felbolt?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(hud.sim.setPetAutoSpecial).toHaveBeenCalledWith(false);

    felbolt?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
    );
    expect(hud.sim.setPetAutoSpecial).toHaveBeenCalledTimes(2);
    felbolt?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        repeat: true,
        bubbles: true,
      }),
    );
    expect(hud.sim.setPetAutoSpecial).toHaveBeenCalledTimes(2);
  });

  it('shows Gloomshade Chain and Taunt, including touch-hold autocast control', () => {
    vi.useFakeTimers();
    document.body.classList.add('mobile-touch');
    const hud = makeHud('gloomshade');
    hud.renderPetBar(hud.sim.entities.get(2) ?? null);

    const chain = document.querySelector<HTMLButtonElement>('[title="Abyssal Chain"]');
    expect(chain).not.toBeNull();
    expect(document.querySelector('[title="Taunt"]')).not.toBeNull();

    chain?.dispatchEvent(pointerEvent('pointerdown'));
    vi.advanceTimersByTime(2100);
    expect(hud.sim.setPetAutoSpecial).toHaveBeenCalledWith(false);
    chain?.dispatchEvent(pointerEvent('pointerup'));
    chain?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(hud.sim.petSpecial).not.toHaveBeenCalled();
  });

  it('renders cooldown as inert and toggles an initially disabled autocast on', () => {
    const hud = makeHud('emberkin', true, { petSkillTimer: 7.2, petAutoSkill: false });
    hud.renderPetBar(hud.sim.entities.get(2) ?? null);

    const felbolt = document.querySelector<HTMLButtonElement>('[title="Felbolt"]');
    expect(felbolt?.classList.contains('cooldown')).toBe(true);
    expect(felbolt?.querySelector('.cdtext')?.textContent).toBe('8');
    expect(felbolt?.getAttribute('aria-label')).toBe('Felbolt, 8 seconds remaining');
    expect(felbolt?.getAttribute('aria-description')).toBe(
      'Autocast off. Right-click, touch-hold, or press Shift+Enter to turn it on.',
    );

    felbolt?.click();
    expect(hud.sim.petSpecial).not.toHaveBeenCalled();
    felbolt?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(hud.sim.setPetAutoSpecial).toHaveBeenCalledWith(true);
  });

  it('fails closed and hides signature buttons without negotiated server support', () => {
    const emberkin = makeHud('emberkin', false);
    emberkin.renderPetBar(emberkin.sim.entities.get(2) ?? null);
    expect(document.querySelector('[title="Felbolt"]')).toBeNull();
    expect(document.querySelector('[title="Taunt"]')).toBeNull();

    document.body.innerHTML = '<div id="petbar"></div>';
    const gloomshade = makeHud('gloomshade', false);
    gloomshade.renderPetBar(gloomshade.sim.entities.get(2) ?? null);
    expect(document.querySelector('[title="Abyssal Chain"]')).toBeNull();
    expect(document.querySelector('[title="Taunt"]')).not.toBeNull();
  });

  it('restores the same action focus across a cooldown repaint', () => {
    const hud = makeHud('emberkin');
    hud.renderPetBar(hud.sim.entities.get(2) ?? null);
    const first = document.querySelector<HTMLButtonElement>('[title="Felbolt"]');
    first?.focus();

    const pet = hud.sim.entities.get(2);
    if (!pet) throw new Error('Missing pet fixture.');
    pet.petSkillTimer = 7.2;
    hud.renderPetBar(hud.sim.entities.get(2) ?? null);

    const replacement = document.querySelector<HTMLButtonElement>('[title="Felbolt"]');
    expect(document.activeElement).toBe(replacement);
    expect(replacement?.dataset.focusKey).toBe('emberkin_felbolt');
    expect(replacement?.dataset.suppressFocusTooltip).toBe('true');
  });

  it('keeps a non-colour autocast cue in forced-colors mode', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/hud.css'), 'utf8');
    const forcedColors = css.slice(
      css.indexOf('@media (forced-colors: active)', css.indexOf('.pet-btn.autocast')),
      css.indexOf('.pet-btn.cooldown', css.indexOf('.pet-btn.autocast')),
    );
    expect(forcedColors).toContain('.pet-btn.autocast');
    expect(forcedColors).toContain('outline: 3px double Highlight');
    expect(forcedColors).toContain('content: "↻"');
  });
});
