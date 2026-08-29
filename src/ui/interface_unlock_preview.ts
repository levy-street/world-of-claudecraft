// Example content for the edit mode's force-shown placeholder frames: sample
// buff/debuff icons, sample party members, a sample pet and target, a filled
// cast bar and swing timer. While the interface is unlocked those frames are
// otherwise EMPTY dashed boxes (nothing is casting, no pet is out), and an
// empty box is hard to size honestly; the preview shows roughly what each
// frame looks like in play, so arranging it is done against real proportions.
//
// Pure overlay, by design: each sample is ONE absolutely positioned
// `.tf-preview` child appended to the frame element and removed on lock,
// never a write into the frame's own painter-managed nodes (the aura painter
// pools and reconciles its icon children; foreign nodes in that flow would
// corrupt its order). Pointer-inert via the edit mode's own descendant sweep.
// Deliberately unregistered in tests/architecture.test.ts: its module sweep
// holds this file to no browser globals, satisfied by the injected Document.

import { t } from './i18n';
import { iconDataUrl } from './icons';

/** Aura ids for the sample rows. Any id renders (icons.ts falls back by school
 *  and name), so these only need to LOOK like a plausible row. */
const PREVIEW_BUFFS = ['battle_shout', 'arcane_intellect', 'renew', 'blessing_of_might'];
const PREVIEW_DEBUFFS = ['rend', 'curse_of_agony', 'frostbite'];
const PREVIEW_ICON_SIZE = 24;
/** Sample fill fractions: mid-cast and mid-swing read as live bars. */
const PREVIEW_CAST_FRAC = 0.62;
const PREVIEW_SWING_FRAC = 0.45;

export class InterfaceUnlockPreview {
  private nodes: HTMLElement[] = [];

  constructor(
    private readonly doc: Document,
    /** Fills the party sample host with REAL party-frame rows (the Hud runs a
     *  second PartyFramesPainter instance over sample members), so the party
     *  placeholder is pixel-identical to a live party rather than an
     *  approximation. Optional so a host without the painter (tests) still
     *  gets the other samples. */
    private readonly buildPartySample?: (host: HTMLElement) => void,
  ) {}

  /** Mint the sample overlays (true) or remove them all (false). Rebuilding
   *  from scratch each flip keeps this idempotent and lets relocalize() ride
   *  the same call: the samples are a handful of cold nodes. */
  setActive(on: boolean): void {
    for (const node of this.nodes) node.remove();
    this.nodes = [];
    if (!on) return;
    this.mount('buff-bar', this.auraRow(PREVIEW_BUFFS));
    this.mount('debuff-bar', this.auraRow(PREVIEW_DEBUFFS));
    this.mount('party-frames', this.partyColumn());
    // The TARGET frame deliberately gets no sample: its placeholder already
    // shows the real frame chrome (portrait ring, bars), and a second set of
    // sample bars over it read as clutter (owner feedback).
    this.mount('pet-frame', this.unitSample(t('hudChrome.unitFrame.petLabel')));
    this.mount(
      'castbar',
      this.barSample(PREVIEW_CAST_FRAC, t('hudChrome.interfaceUnlock.previewSpell'), 'cast'),
    );
    this.mount('swingbar', this.barSample(PREVIEW_SWING_FRAC, '', 'swing'));
  }

  private mount(elementId: string, node: HTMLElement): void {
    const host = this.doc.getElementById(elementId);
    if (!host) return;
    host.appendChild(node);
    this.nodes.push(node);
  }

  private shell(extraClass: string): HTMLElement {
    const el = this.doc.createElement('div');
    el.className = `tf-preview ${extraClass}`;
    // Decorative sample content: never announced, never interactive.
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  private auraRow(ids: readonly string[]): HTMLElement {
    const row = this.shell('tf-preview-auras');
    for (const id of ids) {
      const icon = this.doc.createElement('img');
      icon.className = 'tf-preview-icon';
      icon.src = iconDataUrl('aura', id, PREVIEW_ICON_SIZE);
      icon.alt = '';
      row.appendChild(icon);
    }
    return row;
  }

  private unitRow(name: string): HTMLElement {
    const unit = this.doc.createElement('div');
    unit.className = 'tf-preview-unit';
    const portrait = this.doc.createElement('div');
    portrait.className = 'tf-preview-portrait';
    const bars = this.doc.createElement('div');
    bars.className = 'tf-preview-bars';
    const label = this.doc.createElement('span');
    label.className = 'tf-preview-name';
    label.textContent = name;
    const hp = this.doc.createElement('div');
    hp.className = 'tf-preview-hp';
    const mp = this.doc.createElement('div');
    mp.className = 'tf-preview-mp';
    bars.append(label, hp, mp);
    unit.append(portrait, bars);
    return unit;
  }

  private unitSample(name: string): HTMLElement {
    const shell = this.shell('tf-preview-unit-host');
    shell.appendChild(this.unitRow(name));
    return shell;
  }

  /** The party sample: a host the Hud fills with REAL party-frame rows via
   *  buildPartySample. In the layout flow (not an absolute overlay) so the
   *  force-shown #party-frames box grows to the rows' true size and the
   *  dashed outline stays an honest picture of a full group's footprint. */
  private partyColumn(): HTMLElement {
    const shell = this.shell('tf-preview-party');
    this.buildPartySample?.(shell);
    return shell;
  }

  private barSample(frac: number, label: string, variant: 'cast' | 'swing'): HTMLElement {
    const shell = this.shell(`tf-preview-bar tf-preview-bar-${variant}`);
    const fill = this.doc.createElement('div');
    fill.className = 'tf-preview-fill';
    fill.style.width = `${Math.round(frac * 100)}%`;
    shell.appendChild(fill);
    if (label) {
      const text = this.doc.createElement('span');
      text.className = 'tf-preview-bar-label';
      text.textContent = label;
      shell.appendChild(text);
    }
    return shell;
  }
}
