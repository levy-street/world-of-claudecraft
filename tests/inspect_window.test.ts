// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerClass } from '../src/sim/types';
import { borderAccent, borderMotifPrimitives } from '../src/ui/deed_border_view';
import { deedName, deedTitleText } from '../src/ui/deed_i18n';
import { classColorCss } from '../src/ui/inspect_view';
import { type InspectEntity, InspectWindow } from '../src/ui/inspect_window';

// The inspect ("Profile") window painter is a DOM module. Most guards below are
// source scans, the char_window suite's shape: they pin the WCAG focus-trap the
// extraction ADDED (the old inline inspect path had none), the token/reuse
// discipline, and that the painter reaches Hud only through injected deps (no Hud
// import, no Sim reference). The last describe opts into happy-dom and drives the
// REAL painter, because a source scan cannot see which model field a template
// literal actually read.
//
// Under happy-dom import.meta.url is an http URL, so source is resolved from
// Vitest's injected filesystem dirname (same reason char_window.test.ts does).
const painter = readFileSync(join(__dirname, '../src/ui/inspect_window.ts'), 'utf8');
// Comment-stripped copy for the Curator scans below (the architecture-test rule):
// prose that NAMES a pinned literal must neither satisfy a positive pin nor trip
// a negative one. The doc comment beside the sigil <img> literally quotes alt=""
// while explaining why the sigil does NOT take it, which is exactly the trap.
const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('inspect_window: WCAG 2.2 AA focus trap (new to the extraction)', () => {
  it('marks #inspect-window a labelled dialog via the shared markDialogRoot helper', () => {
    // Same helper + pattern the other trapped windows use (leaderboard_window,
    // bank_window), keyed to the panel title span id.
    expect(painter).toContain('markDialogRoot');
    expect(painter).toContain("markDialogRoot(el, { labelledBy: 'inspect-window-title' })");
    expect(painter).toContain('id="inspect-window-title"');
  });

  it('captures the opener on open and restores focus to it on close', () => {
    expect(painter).toContain('this.deps.captureFocus()');
    expect(painter).toContain('this.deps.restoreFocus(this.openerFocus)');
    const close = painter.slice(painter.indexOf('close(): void {'));
    expect(close).toContain('this.deps.restoreFocus(this.openerFocus)');
  });

  it('applies the trap to BOTH the rich and the remote-profile paths', () => {
    const openInspect = painter.slice(painter.indexOf('openInspect('));
    const openRemote = painter.slice(painter.indexOf('openRemote('));
    expect(openInspect).toContain('markDialogRoot(el');
    expect(openRemote.slice(0, openRemote.indexOf('private '))).toContain('markDialogRoot(el');
  });
});

describe('inspect_window: thin painter, deps-only Hud access', () => {
  it('imports no Sim / Hud / render layer and no Three', () => {
    expect(painter).not.toMatch(/from\s+['"]\.\.\/render\//);
    expect(painter).not.toMatch(/from\s+['"]three['"]/);
    expect(painter).not.toMatch(/\bCharacterPreview\b/);
    expect(painter).not.toMatch(/from\s+['"]\.\/hud['"]/);
  });

  it('mounts the shared turntable through a dep, never constructing it here', () => {
    expect(painter).toContain('this.deps.mountPreview(');
  });

  it('feeds the inspected entity weapon skin to the turntable mount (Armory cosmetics)', () => {
    // The wire wsk field is the SERVER-resolved active skin the world renders
    // for that player; the inspect paperdoll must pass it through or a
    // purchased skin silently vanishes on inspect.
    expect(painter).toContain('weaponSkinId: e.weaponSkinId ?? null');
  });

  it('feeds the entity skin catalog to the pure core and the turntable mount (mech rigs)', () => {
    // Remote entities carry skinCatalog on the wire (the `cat` identity field); the
    // mount must see it or a mech-cosmetic player renders as a class rig wearing a
    // mech-catalog skin INDEX (the wrong skin entirely).
    expect(painter).toContain("skinCatalog: e.skinCatalog ?? 'class'");
    expect(painter).toContain('skinCatalog: model.skinCatalog');
  });

  it('reuses the shared socket-row family and quality-glow helper (no forked copies)', () => {
    expect(painter).toContain("row.className = 'equip-slot'");
    expect(painter).toContain('qualityGlowShadow(qColor)');
    expect(painter).toContain("from './quality_glow'");
    // Gear + badge decisions come from the pure inspect_view core.
    expect(painter).toContain('buildInspectView(');
    expect(painter).toContain('buildInspectRemoteView(');
  });

  it('carries no raw color literal (quality/class colors come from data + helpers)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to data/CSS: ${hex.join(', ')}`).toEqual([]);
  });
});

describe('inspect_window: the Curator standing surfaces', () => {
  it('renders the sigil badge AFTER the three older ones, in the same card', () => {
    // Array/append ORDER is a contract here: the four badge rows are string
    // concatenation inside one honor rail, so the sigil landing before devHtml
    // would silently re-rank the collection. Pin the sequence, not just presence.
    const card = code.slice(code.indexOf('const honorHtml ='));
    const order = [
      'this.holderHtml(model.badges.holder)',
      'this.discordHtml(model.badges.discord)',
      'this.devHtml(model.badges.dev)',
      'this.curatorHtml(model.badges.curator)',
    ].map((call) => card.indexOf(call));
    for (const [i, at] of order.entries()) expect(at, `missing call ${i}`).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('reuses the shared .inspect-holder badge family for the sigil (no bespoke row)', () => {
    const curator = code.slice(code.indexOf('private curatorHtml('));
    const body = curator.slice(0, curator.indexOf('private holderHtml('));
    expect(body).toContain('<div class="inspect-holder">');
    expect(body).toContain('inspect-holder-text');
    expect(body).toContain('inspect-holder-name');
    // The art + class + glow all come from the sigil module, never inline here.
    expect(body).toContain('curatorSigilBadgeClass()');
    expect(body).toContain('curatorSigilDataUrl()');
    expect(body).toContain('--curator-glow:${CURATOR_SIGIL_GLOW}');
  });

  it('gives the sigil art alt="" and puts sigilCaption on the VISIBLE sub-line', () => {
    // Moved at Phase 20 QA, and the cause is a11y, not a rename: the row already
    // prints the rung name and a sub-line, so a localized alt on the art made a
    // screen reader announce the same row three times. alt="" matches the three
    // sibling tier badges, and the key keeps naming what the picture is as the
    // sub-line, which labels it for every reader at once. The sub used to repeat
    // hudChrome.reliquary.title ("The Reliquary"), naming the surface rather
    // than the honor. Scanned comment-stripped, so the doc comment beside the
    // img (which quotes alt="" while explaining it) satisfies nothing here.
    //
    // The key was sigilAria until the same QA round renamed it: once the string
    // stopped being alt text, the *Aria suffix declared the wrong render sink to
    // every translator reading the catalog. Both spellings are pinned, so a
    // half-finished revert cannot leave the painter reading a key the catalog no
    // longer carries.
    const curator = code.slice(code.indexOf('private curatorHtml('));
    const body = curator.slice(0, curator.indexOf('private holderHtml('));
    expect(body).toContain('alt=""');
    expect(body).not.toContain('alt="${esc(t(\'hudChrome.reliquary.sigilCaption\'))}"');
    expect(body).toContain(
      '<div class="inspect-holder-sub">${esc(t(\'hudChrome.reliquary.sigilCaption\'))}</div>',
    );
    // Rename-residue negative, decisive only as a PAIR: the caption-div
    // positive above is the control proving this slice sees the live row.
    expect(body).not.toContain('sigilAria');
    // The key it replaced must be gone from this row, or both would render.
    expect(body).not.toContain("t('hudChrome.reliquary.title')");
  });

  it('every Curator string goes through t(), with numbers through formatNumber', () => {
    const line = code.slice(code.indexOf('private curatorLineHtml('));
    const body = line.slice(0, line.indexOf('private curatorHtml('));
    expect(body).toContain("t('hudChrome.reliquary.charCompletion'");
    expect(body).toContain("t('hudChrome.reliquary.charCompletionLabel')");
    expect(body).toContain('curatorRankNameKey(curator.rank)');
    expect(body).toContain('formatNumber(curator.owned');
    expect(body).toContain('formatNumber(curator.total');
  });

  it('both Curator surfaces early-return on a null model (fail closed)', () => {
    for (const method of [
      'private curatorLineHtml(',
      'private curatorHtml(',
      'private borderAttrs(',
    ]) {
      const at = code.indexOf(method);
      expect(at, method).toBeGreaterThan(-1);
      expect(code.slice(at, at + 260)).toMatch(/if \(!(curator|border)\) return '';/);
    }
  });

  it('E51: writes the banner accent through the canonical heraldry style helper', () => {
    // One convention across the two surfaces: tests/deed_border_accent.test.ts
    // pins these literals against the unit_frame_painter constants, so a rename
    // there cannot leave this card writing properties no stylesheet reads.
    const at = code.indexOf('private borderAttrs(');
    const body = code.slice(at, code.indexOf('private curatorLineHtml('));
    expect(body).toMatch(/\$\{DEED_HERALDRY_ATTR\}="\$\{esc\(border\.slug\)\}"/);
    expect(body).toMatch(/\$\{DEED_HERALDRY_MOTIF_ATTR\}="\$\{border\.motif\}"/);
    expect(body).toContain('esc(deedHeraldryStyle(border))');
  });

  it('feeds the entity border and Curator standing into the pure core', () => {
    expect(code).toContain('border: e.border ?? null');
    expect(code).toContain('curatorRank: e.curatorRank ?? 0');
    expect(code).toContain("relicsOwned: typeof e.relicsOwned === 'number' ? e.relicsOwned : null");
    expect(code).toContain("relicsTotal: typeof e.relicsTotal === 'number' ? e.relicsTotal : null");
    // Self-inspect standing is a PARAMETER, never an InspectEntity field: the
    // entity mirrors the wire and this standing never crosses the wire.
    expect(code).toContain('selfStanding: selfStanding ?? null');
    expect(code).not.toContain('e.selfStanding');
  });

  it('Hud supplies the live standing ONLY for the local player', () => {
    // The painter cannot enforce this: it takes whatever standing it is handed.
    // Dropping the pid gate is silent and severe, and no behavioral arm catches
    // it (the window never learns whose entity it drew), so the call site is
    // pinned here beside the parameter it feeds. Handing every inspected player
    // the viewer's own standing would print YOUR relic count on THEIR card.
    const hud = readFileSync(join(__dirname, '../src/ui/hud.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const at = hud.indexOf('openInspect(pid: number): void {');
    expect(at, 'Hud.openInspect is missing').toBeGreaterThan(-1);
    const body = hud.slice(at, at + 520);
    expect(body).toContain('pid === this.sim.playerId ? selfCuratorStanding(this.sim) : null');
    // And the standing itself still comes from the character sheet's own model,
    // so the card and the sheet cannot print different numbers for the same
    // player. The three-line adapter moved out of Hud at Phase 20 QA (it needed
    // nothing of Hud's, only the world seam reliquary_sheet_view.ts already
    // defines), so what is pinned here is the named import Hud composes ...
    expect(hud).toMatch(
      /import \{[^}]*\bselfCuratorStanding\b[^}]*\} from '\.\/reliquary_sheet_view';/,
    );
    // ... and, in the module that now owns it, that the standing is built from
    // the sheet model rather than a second derivation.
    const sheetView = readFileSync(join(__dirname, '../src/ui/reliquary_sheet_view.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const selfAt = sheetView.indexOf('export function selfCuratorStanding(');
    expect(selfAt, 'selfCuratorStanding is missing').toBeGreaterThan(-1);
    expect(sheetView.slice(selfAt, selfAt + 320)).toContain('buildReliquarySheetModel(world)');
  });

  it('leaves the out-of-range remote card flairless (no sigil, no standing, no accent)', () => {
    const remote = code.slice(code.indexOf('openRemote('));
    const body = remote.slice(0, remote.indexOf('private buildSlotRow('));
    for (const token of [
      'curatorHtml',
      'curatorLineHtml',
      'borderAttrs',
      'data-border',
      'deed-heraldry',
    ]) {
      expect(body, `the remote card must not paint ${token}`).not.toContain(token);
    }
    expect(body).toContain('class="inspect-card inspect-card-remote"');
  });

  it('the Reliquary line joins the .inspect-meta pill family, and CSS reaches it', () => {
    // Class presence proves only that the painter wrote the hook. The line
    // wears the family class itself (.inspect-meta), so the pill chrome
    // reaches it by construction, and that base rule is the reach pin. The
    // modifier is a semantic hook by DESIGN, not an override: an earlier
    // revision shipped a .inspect-meta.inspect-reliquary rule that repeated
    // the base color byte for byte (a dead declaration certified by this very
    // test), so the negative bound below keeps a repainted override from
    // coming back without the comment above it being rewritten on purpose.
    const line = code.slice(code.indexOf('private curatorLineHtml('));
    const body = line.slice(0, line.indexOf('private curatorHtml('));
    expect(body).toContain('class="inspect-meta inspect-reliquary"');
    const shell = readFileSync(join(__dirname, '../src/styles/shell.css'), 'utf8');
    // Positive controls: the base family rule exists and carries the pill
    // chrome the standing line inherits.
    expect(shell).toMatch(/\n {2}\.inspect-meta \{[^}]*display: inline-block;/);
    expect(shell).toMatch(/\n {2}\.inspect-meta \{[^}]*color: var\(--color-text-muted\);/);
    // The semantic hook stays rule-free (occurrence bound, not a bare
    // negative: the two positive matches above prove this scan sees the file).
    expect(shell.match(/\.inspect-meta\.inspect-reliquary\s*\{/g) ?? []).toHaveLength(0);
  });

  it('E52: keeps the forged face compact and its attached deed tab below 18 percent of the stage', () => {
    const shell = readFileSync(join(__dirname, '../src/styles/shell.css'), 'utf8');
    const banner = shell.match(/\n {2}\.inspect-heraldry-banner \{([^}]*)\}/)?.[1];
    const face = shell.match(/\n {2}\.inspect-heraldry-face \{([^}]*)\}/)?.[1];
    const seal = shell.match(
      /\n {2}\.inspect-heraldry-banner \.deed-heraldry-seal \{([^}]*)\}/,
    )?.[1];
    const deed = shell.match(/\n {2}\.inspect-heraldry-deed \{([^}]*)\}/)?.[1];
    const honors = shell.match(/\n {2}\.inspect-honor-rail \{([^}]*)\}/)?.[1];
    const stage = shell.match(/\n {2}#inspect-window \.inspect-model-panel \{([^}]*)\}/)?.[1];
    expect(banner, 'inspect heraldry banner rule missing').toBeTruthy();
    expect(face, 'inspect heraldry face rule missing').toBeTruthy();
    expect(banner).toContain('width: min(100%, 580px);');
    expect(banner).toContain('height: 72px;');
    expect(face).toContain('height: 60px;');
    expect(seal).toContain('top: 30px;');
    expect(seal).toContain('left: 0;');
    expect(seal).toContain('width: 64px;');
    expect(seal).toContain('height: 64px;');
    expect(deed).toContain('height: 18px;');
    expect(deed).toContain('max-width: 260px;');
    expect(honors).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 300px));',
    );
    expect(honors).toContain('justify-content: center;');
    expect(stage).toContain('min-height: 400px;');
    const mantleHeight = Number(banner?.match(/height:\s*(\d+)px/)?.[1]);
    const faceHeight = Number(face?.match(/height:\s*(\d+)px/)?.[1]);
    const stageHeight = Number(stage?.match(/min-height:\s*(\d+)px/)?.[1]);
    expect(faceHeight).toBeLessThanOrEqual(stageHeight * 0.15);
    expect(mantleHeight).toBeLessThanOrEqual(stageHeight * 0.18);
  });
});

// The ONE behavioral arm in a file of source scrapes. It exists because every
// pin above is satisfied by the painter's TEXT: a template literal that read the
// wrong model field (model.badges.curator where model.curator belongs, an entity
// field the pure core no longer resolves) keeps every literal intact and every
// scan green while the card renders the wrong thing, or nothing. Driving the real
// painter over two entity shapes is what catches that class of wiring bug.
describe('inspect_window: the real painter over a Sim-shaped and a ranked entity', () => {
  const baseEntity: InspectEntity = {
    templateId: 'warrior' as PlayerClass,
    name: 'Aurelia',
    level: 60,
    equippedItems: {},
    equippedInstances: {},
  };

  // happy-dom has no working 2D context, and the card paints twelve empty gear
  // slots through the procedural icon compose path. Only RASTERIZATION is faked
  // (the tests/profession_icons.test.ts idiom): every ctx member is an absorbing
  // function, so a genuinely broken painter still throws through the stub. The
  // canvas is patched per created element rather than by replacing `document`,
  // because the whole point of this describe is to keep the real DOM.
  const STUB_DATA_URL = 'data:image/png;base64,c3R1Yg==';
  const fakeCtx = (): CanvasRenderingContext2D => {
    const gradient = { addColorStop: () => {} };
    const target: Record<string | symbol, unknown> = {};
    return new Proxy(target, {
      get: (t, prop) => {
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient')
          return () => gradient;
        if (prop in t) return t[prop];
        return () => {};
      },
      set: (t, prop, value) => {
        t[prop] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  };

  afterEach(() => vi.restoreAllMocks());

  const openWith = (
    e: InspectEntity,
    selfStanding?: { curatorRank: number; owned: number; total: number } | null,
    showDevBadges = false,
  ): HTMLElement => {
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'canvas') {
        (el as HTMLCanvasElement).getContext = (() => fakeCtx()) as never;
        (el as HTMLCanvasElement).toDataURL = () => STUB_DATA_URL;
      }
      return el;
    });
    const root = realCreate('div');
    document.body.appendChild(root);
    const win = new InspectWindow({
      root: () => root,
      closeOthers: vi.fn(),
      hideTooltip: vi.fn(),
      captureFocus: () => null,
      restoreFocus: vi.fn(),
      slotName: (slot) => slot,
      showDevBadges: () => showDevBadges,
      mountPreview: vi.fn(),
      // A real data URL, not '': an empty-string src resolves against the
      // document URL in happy-dom and fetches. NOTE the honest scope: this
      // stub is the FILLED-slot resolver and these fixtures equip nothing, so
      // it guards future filled-slot fixtures; the suite's residual
      // localhost fetch noise comes from other asset-path srcs and is a
      // recorded hygiene follow-up, not this line.
      itemIcon: () => STUB_DATA_URL,
      moneyHtml: () => '',
      itemTooltip: () => '',
      attachTooltip: vi.fn(),
    });
    win.openInspect(e, 1_700_000_000_000, selfStanding);
    return root;
  };

  it('renders NO Reliquary line and NO sigil for an entity with no curator fields', () => {
    // The offline / pre-Curator shape: the fields are absent entirely, not zero.
    // This is the arm that fails if the painter ever reads a field the core no
    // longer gates, because then an unranked player grows a standing row.
    const root = openWith(baseEntity);
    expect(root.querySelector('.inspect-reliquary')).toBeNull();
    expect(root.querySelector('.inspect-curator-halo')).toBeNull();
    // The card itself still painted, so the absence above is a real gate and not
    // a render that never happened.
    expect(root.querySelector('.inspect-name')?.textContent).toBe('Aurelia');
  });

  it('renders BOTH the line and the sigil for a rank-5 entity', () => {
    const root = openWith({
      ...baseEntity,
      curatorRank: 5,
      relicsOwned: 287,
      relicsTotal: 300,
    });
    const line = root.querySelector('.inspect-reliquary');
    expect(line, 'the rank-5 entity must paint a Reliquary line').not.toBeNull();
    // The PAIR has to reach the DOM, not just the row: a line built from the
    // wrong model field would render the label with empty numbers.
    expect(line?.textContent).toContain('287');
    expect(line?.textContent).toContain('300');
    const sigil = root.querySelector('img.inspect-curator-halo');
    expect(sigil, 'the rank-5 entity must wear the sigil').not.toBeNull();
    // The a11y shape from the fix above, asserted on the rendered node rather
    // than the source: silent art, the honor named on the visible sub-line.
    expect(sigil?.getAttribute('alt')).toBe('');
    const sub = root.querySelector('.inspect-holder .inspect-holder-sub');
    expect(sub?.textContent?.length, 'the sigil row needs its visible sub-line').toBeGreaterThan(0);
  });

  it('E51: renders the seal banner with real name, title, and localized granting deed', () => {
    const root = openWith({
      ...baseEntity,
      border: 'col_reliquary_rank_5',
      title: 'prog_veteran',
    });
    const banner = root.querySelector('.inspect-heraldry-banner');
    expect(banner, 'the accented card must paint a heraldry banner').not.toBeNull();
    // The SLUG, resolved from the deed id through deed_border_view's palette
    // gate, not the deed id itself: the stylesheet keys on the slug.
    expect(banner?.getAttribute('data-border')).toBe('reliquary_gilt');
    expect(banner?.getAttribute('data-motif')).toBe('vault');
    expect(banner?.getAttribute('style')).toContain('--border-accent-frame:#f4ca43;');
    expect(banner?.getAttribute('style')).toContain('--deed-heraldry-well:#14110c;');
    const face = banner?.querySelector('.inspect-heraldry-face');
    const seal = banner?.querySelector('.deed-heraldry-seal');
    const deedTab = banner?.querySelector('.inspect-heraldry-deed');
    expect(face?.getAttribute('data-border')).toBe('reliquary_gilt');
    expect(face?.getAttribute('data-motif')).toBe('vault');
    expect(seal).not.toBeNull();
    expect(face?.contains(seal ?? null)).toBe(false);
    expect(face?.parentElement).toBe(banner);
    expect(seal?.parentElement).toBe(banner);
    expect(face?.nextElementSibling).toBe(seal);
    expect(deedTab?.parentElement).toBe(banner);
    expect(face?.contains(deedTab ?? null)).toBe(false);
    expect(seal?.nextElementSibling).toBe(deedTab);
    expect(deedTab?.classList.contains('deed-heraldry-plaque-tab')).toBe(true);
    expect(deedTab?.getAttribute('data-border')).toBe('reliquary_gilt');
    expect(face?.querySelector('.deed-heraldry-pattern')).not.toBeNull();
    const accent = borderAccent('reliquary_gilt');
    expect(borderMotifPrimitives('vault')).toHaveLength(5);
    for (const path of banner?.querySelectorAll('path') ?? []) {
      expect(path.getAttribute('d')).toBe(accent?.motifPath);
    }
    expect(banner?.querySelector('.inspect-name')?.textContent).toBe('Aurelia');
    expect(banner?.querySelector('.inspect-title')?.textContent).toBe(
      deedTitleText('prog_veteran'),
    );
    expect(banner?.querySelector('.inspect-heraldry-deed')?.textContent).toBe(
      deedName('col_reliquary_rank_5'),
    );
  });

  it('composes standing and every earned honor into one stable ceremonial hierarchy', () => {
    const root = openWith(
      {
        ...baseEntity,
        border: 'col_reliquary_rank_5',
        curatorRank: 5,
        relicsOwned: 300,
        relicsTotal: 300,
        holderTier: 3,
        holderBalance: 4200,
        discordTier: 1,
        discordName: 'Aurelia',
        discordJoined: 1_699_000_000_000,
        devTier: 2,
        devMergedPrs: 17,
        githubLogin: 'aurelia',
      },
      null,
      true,
    );
    const standing = root.querySelector('.inspect-standing-row');
    const standingItems = [...(standing?.children ?? [])];
    expect(standingItems).toHaveLength(2);
    expect(standingItems[0]?.className).toBe('inspect-meta');
    expect(standingItems[0]?.textContent).toContain('60');
    expect(standingItems[1]?.classList.contains('inspect-reliquary')).toBe(true);
    expect(standingItems[1]?.textContent).toContain('300');
    const rail = root.querySelector('.inspect-honor-rail');
    const honors = [...root.querySelectorAll('.inspect-holder')];
    expect(honors).toHaveLength(4);
    expect(honors.every((honor) => honor.parentElement === rail)).toBe(true);
    const modelPanel = root.querySelector<HTMLElement>('.inspect-model-panel');
    expect(modelPanel?.style.getPropertyValue('--inspect-class-color')).toBe(
      classColorCss(baseEntity.templateId),
    );
  });

  it('keeps a bordered no-title long Unicode identity inside the fixed ceremonial face', () => {
    const name = 'Æthelflæd 星渡りの守護者 Zorya-of-the-Long-Road';
    const root = openWith({
      ...baseEntity,
      name,
      border: 'col_reliquary_rank_5',
      title: null,
    });
    const face = root.querySelector('.inspect-heraldry-face');
    const deedTab = root.querySelector('.inspect-heraldry-deed');
    expect(face?.querySelector('.inspect-name')?.textContent).toBe(name);
    expect(face?.querySelector('.inspect-title')).toBeNull();
    expect(face?.querySelector('.inspect-heraldry-deed')).toBeNull();
    expect(deedTab?.parentElement).toBe(root.querySelector('.inspect-heraldry-banner'));
    expect(deedTab?.textContent).toBe(deedName('col_reliquary_rank_5'));
    const shell = readFileSync(join(__dirname, '../src/styles/shell.css'), 'utf8');
    const nameRule = shell.match(/\n {2}\.inspect-heraldry-banner \.inspect-name \{([^}]*)\}/)?.[1];
    const deedRule = shell.match(/\n {2}\.inspect-heraldry-deed \{([^}]*)\}/)?.[1];
    expect(nameRule).toContain('overflow: hidden;');
    expect(nameRule).toContain('text-overflow: ellipsis;');
    expect(nameRule).toContain('white-space: nowrap;');
    expect(deedRule).toContain('overflow: hidden;');
    expect(deedRule).toContain('text-overflow: ellipsis;');
    expect(deedRule).toContain('white-space: nowrap;');
  });

  it('leaves a borderless card clean, with no empty heraldry shell', () => {
    // The stylesheet gates on :not([data-border='']), so an empty attribute
    // would still match the accent rules. Absence is the contract.
    const root = openWith(baseEntity);
    const name = root.querySelector('.inspect-name');
    expect(name?.textContent).toBe('Aurelia');
    expect(name?.hasAttribute('data-border')).toBe(false);
    expect(root.querySelector('.inspect-heraldry-banner')).toBeNull();
    expect(root.querySelector('.deed-heraldry-seal')).toBeNull();
    expect(root.querySelector('.deed-heraldry-pattern')).toBeNull();
    expect(root.querySelector('.inspect-heraldry-deed')).toBeNull();
  });

  it('renders a rank-4 entity WITHOUT the sigil but WITH the line', () => {
    // The boundary through the real painter: rank 4 is the rung that inherits
    // the honor if the gate ever slips by one, and the line must survive that.
    const root = openWith({
      ...baseEntity,
      curatorRank: 4,
      relicsOwned: 200,
      relicsTotal: 300,
    });
    expect(root.querySelector('.inspect-reliquary')).not.toBeNull();
    expect(root.querySelector('.inspect-curator-halo')).toBeNull();
  });

  it('paints SELF standing on an entity carrying none (the offline self-inspect fix)', () => {
    // End to end for fix 8: no wire fields at all, standing supplied as the
    // parameter, and the line plus the sigil come out of the real painter.
    const root = openWith(baseEntity, { curatorRank: 5, owned: 300, total: 300 });
    const line = root.querySelector('.inspect-reliquary');
    expect(line, 'self standing must produce the line with no wire fields').not.toBeNull();
    expect(line?.textContent).toContain('300');
    expect(root.querySelector('img.inspect-curator-halo')).not.toBeNull();
  });

  it('lets SELF standing override a stale broadcast on the rendered card', () => {
    const root = openWith(
      { ...baseEntity, curatorRank: 5, relicsOwned: 10, relicsTotal: 300 },
      { curatorRank: 2, owned: 30, total: 300 },
    );
    const line = root.querySelector('.inspect-reliquary');
    // The WHOLE pair, not a bare number: hudChrome.reliquary.charCompletion is
    // '{owned}/{total}' with no spaces, so a bare toContain('30') matches inside
    // the '300' total and a not.toContain('10 /') could never have matched
    // anything the painter writes. Both were tightened at Phase 20 QA.
    expect(line?.textContent).toContain('30/300');
    expect(line?.textContent, 'the stale broadcast count must not survive').not.toContain('10/300');
    expect(
      root.querySelector('.inspect-curator-halo'),
      'a live rank 2 must not wear the rank-5 sigil the stale wire claimed',
    ).toBeNull();
  });
});
