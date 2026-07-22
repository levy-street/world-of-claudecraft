// @vitest-environment jsdom

// The HUD render sink for the four Professions 2.0 Phase 14 text-free
// SimEvents (profTrendNudge, profTierTutorial, attuned, attunedZone). The sim
// emits ids and names only; handleProfessionEvent must resolve the LOCALIZED
// archetype title and master name (never leak the raw pairId, whose '+'
// separator is the wire spelling, not player copy) and execute exactly the
// plan's one render action per arm: a chat line, the tutorial panel, or the
// celebration banner family (banner + polite announcer + one achievement
// cue). Exercised via a bare Hud prototype (the profession_tutorial_window /
// hud_confirm_gates precedent) since handleProfessionEvent is private.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import { ARCHETYPE_PAIR_TARGETS } from '../src/sim/professions/archetype';
import { archetypeTitleText } from '../src/ui/char_window';
import { tEntity } from '../src/ui/entity_i18n';
import { Hud } from '../src/ui/hud';
import { t } from '../src/ui/i18n';
import {
  attunementMasterForPair,
  type ProfessionEventInput,
} from '../src/ui/profession_event_lines_core';

// jsdom ships no matchMedia; the handler reads only `.matches` to derive the
// reduced-motion flag. A never-matching stub keeps motion on (the desktop
// default the attuned banner assertion below relies on).
window.matchMedia = ((query: string) =>
  ({ matches: false, media: query }) as MediaQueryList) as typeof window.matchMedia;

interface ProfessionEventHarness {
  log: ReturnType<typeof vi.fn>;
  showBanner: ReturnType<typeof vi.fn>;
  combatAnnouncer: { push: ReturnType<typeof vi.fn> };
  openProfessionTutorial: ReturnType<typeof vi.fn>;
  handleProfessionEvent(ev: ProfessionEventInput): void;
}

function makeHud(): ProfessionEventHarness {
  const hud = Object.create(Hud.prototype) as unknown as ProfessionEventHarness;
  hud.log = vi.fn();
  hud.showBanner = vi.fn();
  hud.combatAnnouncer = { push: vi.fn() };
  // Instance stub shadows the private prototype method: the tierTutorial arm
  // only has to ROUTE here; the panel itself is pinned in
  // profession_tutorial_window.test.ts.
  hud.openProfessionTutorial = vi.fn();
  return hud;
}

// A wave-one pair with a seated anchor master (content/zone1.ts
// q_prof_attune_smith), so the trendNudge master arm has a real name to
// resolve.
const MASTER_PAIR = 'weaponcrafting+armorcrafting';
const MASTER_NPC_ID = 'forgemistress_darva';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Hud.handleProfessionEvent', () => {
  it('profTrendNudge logs the localized master line: archetype title + master name, no raw pairId', () => {
    const hud = makeHud();
    hud.handleProfessionEvent({ type: 'profTrendNudge', pairId: MASTER_PAIR });

    expect(hud.log).toHaveBeenCalledTimes(1);
    const line = hud.log.mock.calls[0][0] as string;
    const archetype = archetypeTitleText(MASTER_PAIR);
    const master = tEntity({ kind: 'npc', id: MASTER_NPC_ID, field: 'name' });
    // Guard: the entity catalog resolves a real display name, so the contains
    // assertions below cannot be satisfied by an id-echo fallback.
    expect(master).not.toBe(MASTER_NPC_ID);
    expect(line).toBe(t('hudChrome.crafting.trendNudge', { archetype, master }));
    expect(line).toContain(archetype);
    expect(line).toContain(master);
    // The raw pair id is wire spelling: its '+' separator never reaches chat.
    expect(line).not.toContain(MASTER_PAIR);
    expect(line).not.toContain('+');
    expect(hud.showBanner).not.toHaveBeenCalled();
    expect(hud.openProfessionTutorial).not.toHaveBeenCalled();
  });

  it('profTrendNudge falls to the noMaster line for a ring pair without a seated master', () => {
    // Derived, not hand-picked: any ring pair outside the four wave-one
    // archetypes has no attunement quest, hence no master to name. If a later
    // phase seats all ten masters this find() comes up empty and the arm
    // becomes dead code, which this guard would surface.
    const pair = ARCHETYPE_PAIR_TARGETS.find((p) => attunementMasterForPair(p) === null);
    expect(pair).toBeTruthy();

    const hud = makeHud();
    hud.handleProfessionEvent({ type: 'profTrendNudge', pairId: pair as string });

    expect(hud.log).toHaveBeenCalledTimes(1);
    const line = hud.log.mock.calls[0][0] as string;
    expect(line).toBe(
      t('hudChrome.crafting.trendNudgeNoMaster', { archetype: archetypeTitleText(pair as string) }),
    );
    expect(line).not.toContain('+');
  });

  it('attunedZone logs the celebrant name with the localized archetype title, never the raw pairId', () => {
    const hud = makeHud();
    hud.handleProfessionEvent({
      type: 'attunedZone',
      celebrantName: 'Torvald',
      pairId: 'alchemy+cooking',
    });

    expect(hud.log).toHaveBeenCalledTimes(1);
    const line = hud.log.mock.calls[0][0] as string;
    expect(line).toContain('Torvald');
    expect(line).toContain(archetypeTitleText('alchemy+cooking'));
    expect(line).not.toContain('alchemy+cooking');
    expect(line).not.toContain('+');
    // A zone broadcast is a chat line only: no banner, no cue for recipients
    // (the masterworkZone precedent).
    expect(hud.showBanner).not.toHaveBeenCalled();
  });

  it('attuned fires the celebration family: banner + polite announcer + one achievement cue, localized', () => {
    const achievement = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    const hud = makeHud();
    hud.handleProfessionEvent({ type: 'attuned', pairId: 'leatherworking+tailoring' });

    expect(hud.showBanner).toHaveBeenCalledTimes(1);
    const [text, motion] = hud.showBanner.mock.calls[0] as [string, boolean];
    expect(text).toBe(
      t('hudChrome.crafting.attunedBanner', {
        title: archetypeTitleText('leatherworking+tailoring'),
      }),
    );
    expect(text).not.toContain('+');
    // jsdom's matchMedia never matches prefers-reduced-motion, so the plan
    // keeps motion on; information (text, announcer, cue) is never gated.
    expect(motion).toBe(true);
    expect(hud.combatAnnouncer.push).toHaveBeenCalledTimes(1);
    expect(hud.combatAnnouncer.push.mock.calls[0][0]).toBe(text);
    expect(achievement).toHaveBeenCalledTimes(1);
    expect(hud.log).not.toHaveBeenCalled();
  });

  it('profTierTutorial routes to openProfessionTutorial and does nothing else', () => {
    const hud = makeHud();
    hud.handleProfessionEvent({ type: 'profTierTutorial' });

    expect(hud.openProfessionTutorial).toHaveBeenCalledTimes(1);
    expect(hud.log).not.toHaveBeenCalled();
    expect(hud.showBanner).not.toHaveBeenCalled();
  });
});

// No test instantiates the full Hud event loop, so the sim-event switch wiring
// is held by a source pin (the craft_celebration_view.test.ts precedent): all
// four Phase 14 event types must fall through to the ONE handler above, so a
// new arm cannot silently drop one of them.
describe('sim-event switch routing (source pin)', () => {
  // join(process.cwd()) rather than import.meta.url: under jsdom the module
  // URL is not a file: scheme (the confirm_dialog_key_activation precedent).
  const hudSource = readFileSync(join(process.cwd(), 'src/ui/hud.ts'), 'utf8');

  it('all four SimEvent types route to handleProfessionEvent', () => {
    expect(hudSource).toMatch(
      /case 'profTrendNudge':\n\s*case 'profTierTutorial':\n\s*case 'attuned':\n\s*case 'attunedZone':(?:\n\s*\/\/[^\n]*)*\n\s*this\.handleProfessionEvent\(ev\);/,
    );
  });
});
