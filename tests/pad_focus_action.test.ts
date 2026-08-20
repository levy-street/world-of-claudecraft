import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusedPadAction } from '../src/game/pad_focus_action';
import { hidePadMouse, updatePadMouse } from '../src/game/pad_mouse_cursor';

// Only what the reader touches: what has focus, and the two things it asks that
// element. jsdom is not a dependency here (tests/CLAUDE.md, "DOM in tests").
function row(attrs: { id?: string; draggable?: boolean }) {
  return {
    draggable: attrs.draggable ?? false,
    getAttribute: (name: string) => (name === 'data-ability-id' ? (attrs.id ?? null) : null),
    // The virtual pointer announces hover on whatever it moves onto, so a row it
    // can reach has to accept events and a class.
    dispatchEvent: () => true,
    classList: { add: () => {}, remove: () => {} },
    // The reader walks up to the draggable row; a row IS its own nearest match.
    closest: function (this: unknown, sel: string) {
      return sel === '[draggable="true"]' && (attrs.draggable ?? false) ? this : null;
    },
  };
}

const withFocus = (activeElement: unknown) => vi.stubGlobal('document', { activeElement });

afterEach(() => vi.unstubAllGlobals());

describe('focusedPadAction', () => {
  it('reads the ability off a focused spellbook row', () => {
    withFocus(row({ id: 'heroic_strike', draggable: true }));
    expect(focusedPadAction()).toEqual({ type: 'ability', id: 'heroic_strike' });
  });

  it('refuses a row the spellbook did not make draggable', () => {
    // draggable is set only where isAbilityActionBarEligible passed, so this is
    // how a passive stays off the bar without deciding eligibility a second time.
    withFocus(row({ id: 'toughness', draggable: false }));
    expect(focusedPadAction()).toBeNull();
  });

  it('ignores a draggable element carrying no ability', () => {
    withFocus(row({ draggable: true }));
    expect(focusedPadAction()).toBeNull();
  });

  it('answers null with nothing focused', () => {
    withFocus(null);
    expect(focusedPadAction()).toBeNull();
  });

  it('answers null with no DOM at all', () => {
    // The headless env server and unit stubs import this module too.
    vi.stubGlobal('document', undefined);
    expect(focusedPadAction()).toBeNull();
  });
});

describe('focusedPadAction with the virtual mouse', () => {
  it('reads the ability off the row the virtual pointer is OVER', () => {
    // The d-pad moves focus, but the virtual mouse only hovers. Reading focus
    // alone left a player steering the cursor onto a spell and finding that
    // picking it up did nothing.
    const spell = row({ id: 'rend', draggable: true });
    // elementFromPoint is what the pointer reads; nothing holds keyboard focus.
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
    vi.stubGlobal(
      'MouseEvent',
      class {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      },
    );
    vi.stubGlobal('document', {
      activeElement: null,
      body: { appendChild: () => {} },
      createElement: () => ({
        style: {},
        setAttribute: () => {},
        classList: { add: () => {}, remove: () => {} },
      }),
      elementFromPoint: () => spell,
    });
    updatePadMouse(1, 0, 0.1);
    expect(focusedPadAction()).toEqual({ type: 'ability', id: 'rend' });
    hidePadMouse();
  });
});

describe('focusedPadAction from a child of the row', () => {
  it('walks up to the draggable row', () => {
    // Focus lands on the spellbook's own +/- toggle as often as on the row, and a
    // strict check on the focused node alone made those presses do nothing.
    const spellRow = row({ id: 'thunder_clap', draggable: true });
    const toggle = {
      draggable: false,
      getAttribute: () => null,
      closest: (sel: string) => (sel === '[draggable="true"]' ? spellRow : null),
    };
    vi.stubGlobal('document', { activeElement: toggle, body: {} });
    expect(focusedPadAction()).toEqual({ type: 'ability', id: 'thunder_clap' });
  });
});

describe('focusedPadAction on the spellbook Attack row', () => {
  it('picks Attack up even though it carries no ability id', () => {
    // Attack is the action bar's fixed slot-0 toggle, not an ability, so the row
    // has no data-ability-id: its own toggle is what marks it. Without this the
    // pad could pick up every spell in the book except auto-attack.
    const attackRow = {
      draggable: true,
      getAttribute: () => null,
      closest: function (this: unknown, sel: string) {
        return sel === '[draggable="true"]' ? this : null;
      },
      querySelector: (sel: string) => (sel === '[data-attack-toggle]' ? {} : null),
    };
    vi.stubGlobal('document', { activeElement: attackRow, body: {} });
    expect(focusedPadAction()).toEqual({ type: 'ability', id: 'attack' });
  });

  it('does not mistake an ordinary row for Attack', () => {
    const plain = {
      draggable: true,
      getAttribute: () => null,
      closest: function (this: unknown, sel: string) {
        return sel === '[draggable="true"]' ? this : null;
      },
      querySelector: () => null,
    };
    vi.stubGlobal('document', { activeElement: plain, body: {} });
    expect(focusedPadAction()).toBeNull();
  });
});
