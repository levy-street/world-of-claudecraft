import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GATHERING_PROFESSION_IDS } from '../src/sim/content/professions';
import type { GatheringProficiencyRow } from '../src/ui/gathering_view';
import { professionSurfaceRefreshSig } from '../src/ui/profession_identity_view';
import type { CraftingIdentityView } from '../src/world_api/professions';

function identity(overrides: Partial<CraftingIdentityView> = {}): CraftingIdentityView {
  return {
    version: 1,
    synced: true,
    craftSkills: { weaponcrafting: 75, armorcrafting: 50 },
    activeArchetype: 'weaponcrafting',
    pairedMajor: 'armorcrafting',
    hobbyCraft: 'jewelcrafting',
    attunedPairs: ['weaponcrafting+armorcrafting', 'engineering+alchemy'],
    switchCount: 0,
    amendsProgress: 0,
    amendsRequired: 5,
    knownRecipes: ['copper_sword', 'iron_helm'],
    ...overrides,
  };
}

// The rows arrive in the fixed GATHERING_PROFESSION_IDS order from
// buildGatheringProficiencyRows; deriving the fixture from the SAME sim list
// keeps the per-row coverage below growing with any future fifth profession.
function gathering(values: Partial<Record<string, number>> = {}): GatheringProficiencyRow[] {
  return GATHERING_PROFESSION_IDS.map((professionId) => ({
    professionId,
    value: values[professionId] ?? 0,
  }));
}

describe('professionSurfaceRefreshSig', () => {
  it('is stable for equivalent set and record ordering', () => {
    const a = identity();
    const b = identity({
      craftSkills: { armorcrafting: 50, weaponcrafting: 75 },
      attunedPairs: ['engineering+alchemy', 'weaponcrafting+armorcrafting'],
      knownRecipes: ['iron_helm', 'copper_sword'],
    });
    expect(professionSurfaceRefreshSig(b, gathering())).toBe(
      professionSurfaceRefreshSig(a, gathering()),
    );
  });

  it('moves for every identity dimension painted by Character or Crafting', () => {
    const base = identity();
    const baseSig = professionSurfaceRefreshSig(base, gathering());
    const changed = [
      identity({ synced: false }),
      identity({ activeArchetype: 'engineering' }),
      identity({ pairedMajor: 'alchemy' }),
      identity({ hobbyCraft: 'cooking' }),
      identity({ attunedPairs: ['weaponcrafting+armorcrafting'] }),
      identity({ switchCount: 1 }),
      identity({ amendsProgress: 1 }),
      identity({ amendsRequired: 8 }),
      identity({ craftSkills: { weaponcrafting: 76, armorcrafting: 50 } }),
      identity({ knownRecipes: ['copper_sword', 'iron_helm', 'silver_ring'] }),
    ];
    expect(changed.map((next) => professionSurfaceRefreshSig(next, gathering()))).not.toContain(
      baseSig,
    );
  });

  it('moves for every gathering proficiency row on the same Character surface', () => {
    const base = professionSurfaceRefreshSig(identity(), gathering());
    for (const professionId of GATHERING_PROFESSION_IDS) {
      expect(
        professionSurfaceRefreshSig(identity(), gathering({ [professionId]: 25 })),
        `${professionId} proficiency must claim a repaint edge`,
      ).not.toBe(base);
    }
  });

  it('detects the delayed online snapshot rather than the preceding stale event state', () => {
    const stale = identity();
    let last = professionSurfaceRefreshSig(stale, gathering());
    const changed = (next: CraftingIdentityView, rows = gathering()): boolean => {
      const sig = professionSurfaceRefreshSig(next, rows);
      if (sig === last) return false;
      last = sig;
      return true;
    };

    // An attuned event can drain before cprof. The stale mirror does not claim
    // a repaint edge; the later snapshot does, and subsequent polls elide.
    expect(changed(stale)).toBe(false);
    const returned = identity({
      activeArchetype: 'engineering',
      pairedMajor: 'alchemy',
      hobbyCraft: 'cooking',
      attunedPairs: ['weaponcrafting+armorcrafting', 'engineering+alchemy'],
      switchCount: 1,
    });
    expect(changed(returned)).toBe(true);
    expect(changed(returned)).toBe(false);

    // A late gathering snapshot converges through the identical edge, and
    // subsequent identical polls elide again.
    expect(changed(returned, gathering({ fishing: 40 }))).toBe(true);
    expect(changed(returned, gathering({ fishing: 40 }))).toBe(false);
  });
});

describe('Hud profession-surface convergence wiring', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
  const methodStart = hud.indexOf('private refreshOpenProfessionSurfacesIfChanged(): void');
  const method = hud.slice(methodStart, hud.indexOf('\n  }', methodStart) + 4);

  it('refreshes both cold surfaces from the identity signature on the slow band', () => {
    expect(hud).toContain('if (slowHud) this.refreshOpenProfessionSurfacesIfChanged();');
    // The exact call shape, not three loose substrings: both facets must feed
    // the ONE signature call, so a refactor that decouples an argument from
    // the call while keeping the names in the method body still fails here.
    expect(method).toContain(
      'professionSurfaceRefreshSig(\n' +
        '      this.sim.craftingIdentity,\n' +
        '      buildGatheringProficiencyRows(this.sim),\n' +
        '    )',
    );
    expect(method).toContain('this.charWindow.renderIfOpen()');
    expect(method).toContain("$('#crafting-window').style.display === 'flex'");
    expect(method).toContain('this.renderCrafting()');
  });

  it('also probes immediately for a personal attunement without wiring the bystander arm', () => {
    const personalStart = hud.indexOf("case 'attunement': {");
    const personal = hud.slice(personalStart, hud.indexOf('\n      }', personalStart));
    const bystanderStart = hud.indexOf("case 'attunedZone':");
    const bystander = hud.slice(bystanderStart, hud.indexOf('break;', bystanderStart));
    expect(personal).toContain('this.refreshOpenProfessionSurfacesIfChanged()');
    expect(bystander).not.toContain('this.refreshOpenProfessionSurfacesIfChanged()');
  });

  it('watches the gossip intro hint on the same slow band and attunement probe', () => {
    // The open gossip dialog's intro hint row is the one identity-driven quest
    // surface: the online cprof mirror can land after it opened, so it rides
    // the same two convergence edges as the profession windows.
    expect(hud).toContain('if (slowHud) this.questDialog.refreshIfChanged();');
    const personalStart = hud.indexOf("case 'attunement': {");
    const personal = hud.slice(personalStart, hud.indexOf('\n      }', personalStart));
    expect(personal).toContain('this.questDialog.refreshIfChanged()');
  });
});
