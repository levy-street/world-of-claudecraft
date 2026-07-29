// Character-creation appearance customizer for the modular character.
//
// A compact tabbed panel (Body / Face / Hair / Style) in the visual language of
// a AAA creator: stepper rows for the long style lists, centre-notched sliders
// for the morph pairs, switches for the boolean views, swatch strips for makeup
// and for the recolourable materials, each with an HSL wheel folded away behind
// a Custom chip for the colours no preset names. Owns all of its DOM
// and reports a normalized ModularAppearance on every change; the caller wires
// that to CharacterPreview.setModular so the turntable updates live.
// Persistence is the caller's job, this component is stateless across mounts
// apart from the value it is constructed with.
import {
  type ArmorSetId,
  BEARD_STYLES,
  type BeardStyle,
  BLUSH_SHADES,
  type BlushShade,
  BROW_STYLES,
  type BrowStyle,
  blushColor,
  DEFAULT_APPEARANCE,
  defaultLashes,
  EAR_STYLES,
  EARRING_MATERIAL_IDS,
  EARRING_STYLES,
  type EarringMaterial,
  type EarringStyle,
  type EarStyle,
  EYE_STYLES,
  type EyeStyle,
  earringSwatchHex,
  FACE_SLIDERS,
  type FaceSlider,
  type Gender,
  HAIR_STYLES,
  type HairStyle,
  hslToHex,
  LIP_SHADES,
  type LipShade,
  lipColor,
  MOUTH_STYLES,
  type ModularAppearance,
  type MouthStyle,
  normalizeAppearance,
  OUTFIT_COLORWAY_IDS,
  type OutfitColorway,
  outfitSwatchHexes,
  randomizeAppearance,
  SHADOW_SHADES,
  type ShadowShade,
  shadowColor,
} from '../render/characters/modular';
import type { TranslationKey } from './i18n';
import { t } from './i18n';

const HAIR_LABEL: Record<HairStyle, TranslationKey> = {
  bald: 'auth.hairBald',
  buzz: 'auth.hairBuzz',
  crew: 'auth.hairCrew',
  crewcut: 'auth.hairCrewcut',
  pixie: 'auth.hairPixie',
  sweptpixie: 'auth.hairSweptpixie',
  quiff: 'auth.hairQuiff',
  sidepart: 'auth.hairSidepart',
  messy: 'auth.hairMessy',
  curlycap: 'auth.hairCurlycap',
  pompadour: 'auth.hairPompadour',
  sweptback: 'auth.hairSweptback',
  fauxhawk: 'auth.hairFauxhawk',
  mohawk: 'auth.hairMohawk',
  topknot: 'auth.hairTopknot',
  warriorbraid: 'auth.hairWarriorbraid',
  highbun: 'auth.hairHighbun',
  lowbun: 'auth.hairLowbun',
  braidcrown: 'auth.hairBraidcrown',
  afro: 'auth.hairAfro',
  curlyafro: 'auth.hairCurlyafro',
  chinbob: 'auth.hairChinbob',
  bluntbangs: 'auth.hairBluntbangs',
  wavybob: 'auth.hairWavybob',
  asymbob: 'auth.hairAsymbob',
  curtains: 'auth.hairCurtains',
  highpony: 'auth.hairHighpony',
  sidepony: 'auth.hairSidepony',
  halfbun: 'auth.hairHalfbun',
  layered: 'auth.hairLayered',
  curls: 'auth.hairCurls',
  longwavy: 'auth.hairLongwavy',
  longcenterpart: 'auth.hairLongcenterpart',
  longpart: 'auth.hairLongpart',
  mullet: 'auth.hairMullet',
  twinbraids: 'auth.hairTwinbraids',
  lowpony: 'auth.hairLowpony',
  fantasybraid: 'auth.hairFantasybraid',
};

const OUTFIT_LABEL: Record<OutfitColorway, TranslationKey> = {
  classic: 'auth.outfitClassic',
  crimson: 'auth.outfitCrimson',
  ember: 'auth.outfitEmber',
  gold: 'auth.outfitGold',
  forest: 'auth.outfitForest',
  emerald: 'auth.outfitEmerald',
  teal: 'auth.outfitTeal',
  azure: 'auth.outfitAzure',
  royal: 'auth.outfitRoyal',
  violet: 'auth.outfitViolet',
  magenta: 'auth.outfitMagenta',
  rose: 'auth.outfitRose',
  onyx: 'auth.outfitOnyx',
  ivory: 'auth.outfitIvory',
  gilded: 'auth.outfitGilded',
  bonewrought: 'auth.outfitBonewrought',
  obsidian: 'auth.outfitObsidian',
  verdigris: 'auth.outfitVerdigris',
  bloodforged: 'auth.outfitBloodforged',
};

const BEARD_LABEL: Record<BeardStyle, TranslationKey> = {
  none: 'auth.beardNone',
  stubble: 'auth.beardStubble',
  scruff: 'auth.beardScruff',
  mutton: 'auth.beardMutton',
  goatee: 'auth.beardGoatee',
  chinpuff: 'auth.beardChinpuff',
  stache: 'auth.beardStache',
  horseshoe: 'auth.beardHorseshoe',
  shortbox: 'auth.beardShortbox',
  full: 'auth.beardFull',
  vikingb: 'auth.beardVikingb',
  wizard: 'auth.beardWizard',
  stubblebeard: 'auth.beardStubbleBeard',
};

const EARRING_LABEL: Record<EarringStyle, TranslationKey> = {
  none: 'auth.earNone',
  stud: 'auth.earStud',
  hoop: 'auth.earHoop',
  bone: 'auth.earBone',
  bonehoop: 'auth.earBonehoop',
  moon: 'auth.earMoon',
  moonstar: 'auth.earMoonstar',
  feather: 'auth.earFeather',
  runic: 'auth.earRunic',
  cuff: 'auth.earCuff',
  chain: 'auth.earChain',
  septum: 'auth.earSeptum',
  warden: 'auth.earWarden',
};

const EARRING_MATERIAL_LABEL: Record<EarringMaterial, TranslationKey> = {
  default: 'auth.jewelDefault',
  gold: 'auth.jewelGold',
  silver: 'auth.jewelSilver',
  bone: 'auth.jewelBone',
  iron: 'auth.jewelIron',
  copper: 'auth.jewelCopper',
  bronze: 'auth.jewelBronze',
  obsidian: 'auth.jewelObsidian',
  jade: 'auth.jewelJade',
  amethyst: 'auth.jewelAmethyst',
  ruby: 'auth.jewelRuby',
  pearl: 'auth.jewelPearl',
  turquoise: 'auth.jewelTurquoise',
};

const FACE_LABEL: Record<FaceSlider, TranslationKey> = {
  nose: 'auth.faceNose',
  eyes: 'auth.faceEyes',
  ears: 'auth.faceEars',
  jaw: 'auth.faceJaw',
  brow: 'auth.faceBrow',
  cheeks: 'auth.faceCheeks',
  chin: 'auth.faceChin',
  smirk: 'auth.faceSmirk',
};

// No BODY_LABEL / body rows here on purpose. Body proportions are an AUTHORING
// concern, not a player one: they are sculpted once in the Fit Studio
// (scripts/asset_pipeline fit) and baked into the shipped body, and the game's
// creator must not offer a second, contradictory set of them. `BodyShape` stays
// in the appearance model, the data and its morphs are untouched, and the
// auth.body* strings stay in the catalog, so the row set can come back without
// re-authoring anything if that decision ever changes.

const EYE_LABEL: Record<EyeStyle, TranslationKey> = {
  round: 'auth.eyeRound',
  almond: 'auth.eyeAlmond',
  narrow: 'auth.eyeNarrow',
  wide: 'auth.eyeWide',
  sharp: 'auth.eyeSharp',
  droopy: 'auth.eyeDroopy',
  sleepy: 'auth.eyeSleepy',
  wideset: 'auth.eyeWideset',
  cat: 'auth.eyeCat',
  doe: 'auth.eyeDoe',
};

const EAR_LABEL: Record<EarStyle, TranslationKey> = {
  round: 'auth.earRound',
  pointed: 'auth.earPointed',
  small: 'auth.earSmall',
  wide: 'auth.earWide',
};

const MOUTH_LABEL: Record<MouthStyle, TranslationKey> = {
  neutral: 'auth.mouthNeutral',
  lips: 'auth.mouthLips',
  smile: 'auth.mouthSmile',
  frown: 'auth.mouthFrown',
  wide: 'auth.mouthWide',
  pout: 'auth.mouthPout',
  grin: 'auth.mouthGrin',
  open: 'auth.mouthOpen',
  awe: 'auth.mouthAwe',
};

const BROW_LABEL: Record<BrowStyle, TranslationKey> = {
  none: 'auth.browNone',
  soft: 'auth.browSoft',
  thick: 'auth.browThick',
  angled: 'auth.browAngled',
  flat: 'auth.browFlat',
  arched: 'auth.browArched',
  thin: 'auth.browThin',
  bushy: 'auth.browBushy',
  worried: 'auth.browWorried',
  sharp: 'auth.browSharp',
  round: 'auth.browRound',
};

const LIP_LABEL: Record<LipShade, TranslationKey> = {
  none: 'auth.makeupNone',
  rose: 'auth.shadeRose',
  coral: 'auth.shadeCoral',
  ruby: 'auth.shadeRuby',
  berry: 'auth.shadeBerry',
  plum: 'auth.shadePlum',
  nude: 'auth.shadeNude',
};

const BLUSH_LABEL: Record<BlushShade, TranslationKey> = {
  none: 'auth.makeupNone',
  peach: 'auth.shadePeach',
  rose: 'auth.shadeRose',
  warm: 'auth.shadeWarm',
  mauve: 'auth.shadeMauve',
};

const SHADOW_LABEL: Record<ShadowShade, TranslationKey> = {
  none: 'auth.makeupNone',
  smoke: 'auth.shadeSmoke',
  bronze: 'auth.shadeBronze',
  plum: 'auth.shadePlum',
  teal: 'auth.shadeTeal',
  rose: 'auth.shadeRose',
};

/** Wheel bitmap size in CSS px; the canvas is drawn once at 2x for crispness. */
const WHEEL_PX = 64;

/** A colour preset: the same (hue°, saturation, lightness) triple the wheel
 *  writes, so picking a swatch and picking by hand produce identical values,
 *  a preset is a shortcut, never a separate kind of colour. */
type ColorPreset = readonly [h: number, s: number, l: number];

/** Skin ladder, fair → deep. Every entry sits in the warm 18 to 34° band because
 *  that is where the skin material reads as skin; the wheel behind Custom still
 *  reaches everything else for anyone who wants it. */
const SKIN_PRESETS: readonly ColorPreset[] = [
  [28, 0.4, 0.86],
  [27, 0.45, 0.78],
  // DEFAULT_APPEARANCE's skin, to the digit: a character nobody has touched yet
  // must light a named swatch rather than Custom. Same for the entries flagged
  // below in the hair, lash and eye runs.
  [27, 0.46, 0.68],
  [25, 0.46, 0.62],
  [33, 0.36, 0.54],
  [24, 0.5, 0.47],
  [22, 0.52, 0.39],
  [20, 0.52, 0.3],
  [19, 0.48, 0.22],
  [18, 0.42, 0.15],
];

/** Hair: the natural run first (black → platinum, with the reds where a real
 *  head keeps them), then four dye/fantasy tones, because this is a world with
 *  mages in it. */
const HAIR_PRESETS: readonly ColorPreset[] = [
  [26, 0.1, 0.06],
  [26, 0.42, 0.15],
  [26, 0.5, 0.24], // the default hair (and lash) colour
  [20, 0.55, 0.34],
  [14, 0.6, 0.33],
  [22, 0.75, 0.43],
  [38, 0.5, 0.52],
  [44, 0.62, 0.66],
  [46, 0.24, 0.8],
  [40, 0.05, 0.72],
  [355, 0.62, 0.4],
  [285, 0.45, 0.45],
  [215, 0.55, 0.45],
  [150, 0.45, 0.38],
];

/** Eyes: the six colours human eyes actually come in, then the four a
 *  warlock's might. Kept dark enough that the iris still reads against the
 *  sclera at portrait size. */
const EYE_PRESETS: readonly ColorPreset[] = [
  [26, 0.45, 0.14],
  [28, 0.42, 0.18], // the default eye colour
  [36, 0.65, 0.33],
  [45, 0.45, 0.3],
  [120, 0.4, 0.28],
  [160, 0.45, 0.32],
  [210, 0.55, 0.4],
  [205, 0.32, 0.6],
  [215, 0.08, 0.45],
  [280, 0.45, 0.38],
  [355, 0.55, 0.35],
];

/** Lashes are hair, so this is the hair run trimmed to the shades a lash is
 *  ever actually seen in. */
const LASH_PRESETS: readonly ColorPreset[] = [
  [26, 0.1, 0.06],
  [26, 0.42, 0.15],
  [26, 0.5, 0.24], // the default lash colour, matching the hair run
  [14, 0.6, 0.33],
  [38, 0.5, 0.52],
  [44, 0.62, 0.66],
  [40, 0.05, 0.72],
  [40, 0.04, 0.9],
];

/** Whether a stored colour IS a preset, within a tolerance that survives the
 *  float round-trip through storage. Hue is compared the short way around the
 *  circle, and skipped entirely for greys, at zero saturation every hue is the
 *  same colour, so comparing it would strand a grey on Custom. */
function matchesPreset(p: ColorPreset, h: number, s: number, l: number): boolean {
  if (Math.abs(p[1] - s) > 0.02 || Math.abs(p[2] - l) > 0.02) return false;
  if (p[1] < 0.06 && s < 0.06) return true;
  // +540 keeps the dividend positive for every legal hue pair, so the JS `%`
  // sign rule never bites; the -180 recentres it to a signed shortest arc.
  return Math.abs(((p[0] - h + 540) % 360) - 180) < 2;
}

/** Mount counter, so the two creator surfaces (online + offline) can both hold
 *  a panel without their tab/tabpanel ids colliding. */
let mountSeq = 0;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A 16x16 stroke icon from path data. Drawn inline so the panel ships no
 *  image assets and the glyphs recolour with `currentColor`. */
function icon(...paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.6');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
  }
  return svg;
}

/** The randomize die: outline plus four pips (pips are filled dots). */
function diceIcon(): SVGSVGElement {
  const svg = icon(
    'M3.4 2.2h9.2a1.2 1.2 0 0 1 1.2 1.2v9.2a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2V3.4a1.2 1.2 0 0 1 1.2-1.2Z',
  );
  for (const [cx, cy] of [
    [5.5, 5.5],
    [10.5, 5.5],
    [5.5, 10.5],
    [10.5, 10.5],
  ]) {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(cy));
    dot.setAttribute('r', '1.05');
    dot.setAttribute('fill', 'currentColor');
    dot.setAttribute('stroke', 'none');
    svg.appendChild(dot);
  }
  return svg;
}

function resetIcon(): SVGSVGElement {
  return icon('M3.2 2.8v3.6h3.6', 'M3.6 6.2a5 5 0 1 1-.4 3.4');
}

/** Paint an HSL disc: hue around, saturation outward, at the given lightness. */
function paintWheel(canvas: HTMLCanvasElement, lightness: number): void {
  const dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  const size = Math.round(WHEEL_PX * dpr);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(size, size);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - r + 0.5;
      const dy = y - r + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;
      if (dist > r) {
        img.data[i + 3] = 0;
        continue;
      }
      const hue = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      const sat = Math.min(1, dist / r);
      const hex = hslToHex(hue, sat, lightness);
      img.data[i] = (hex >> 16) & 0xff;
      img.data[i + 1] = (hex >> 8) & 0xff;
      img.data[i + 2] = hex & 0xff;
      // feather the rim so the disc does not alias into a jagged circle
      img.data[i + 3] = dist > r - dpr ? Math.round((255 * (r - dist)) / dpr) : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export interface AppearanceCustomizerOptions {
  value?: Partial<ModularAppearance> | null;
  onChange(next: ModularAppearance): void;
  /** Whether the preview currently shows the set's helm. This is a view of the
   *  character, not a property OF the character, so it is not part of the
   *  appearance and is not persisted with it, the caller owns it. Omit the
   *  handler and the row is not drawn. */
  helm?: boolean;
  onHelm?(on: boolean): void;
  /** The armour set the outfit swatches preview against, a GETTER because the
   *  panel mounts once and survives class switches. Defaults to the knight kit
   *  when omitted. */
  armorSet?: () => ArmorSetId;
}

export interface AppearanceCustomizer {
  readonly value: ModularAppearance;
  set(next: Partial<ModularAppearance>): void;
  destroy(): void;
}

export function mountAppearanceCustomizer(
  host: HTMLElement,
  opts: AppearanceCustomizerOptions,
): AppearanceCustomizer {
  let value = normalizeAppearance(opts.value ?? DEFAULT_APPEARANCE);
  let helm = opts.helm ?? false;
  const uid = `ac${++mountSeq}`;
  const cleanups: (() => void)[] = [];
  host.textContent = '';
  host.classList.add('appearance-customizer');

  const emit = () => opts.onChange(value);
  /** Close callbacks for the custom-colour drawers, so opening one shuts the
   *  rest (see colorRow). */
  const drawerClosers: (() => void)[] = [];
  /** Repaint callbacks, one per control, so set() can push state back to the UI. */
  const syncers: (() => void)[] = [];
  const syncAll = () => {
    for (const s of syncers) s();
  };
  const on = <K extends keyof HTMLElementEventMap>(
    node: HTMLElement,
    type: K,
    fn: (ev: HTMLElementEventMap[K]) => void,
  ): void => {
    node.addEventListener(type, fn as EventListener);
    cleanups.push(() => node.removeEventListener(type, fn as EventListener));
  };

  // --- panel chrome: title, one-shot tools, tab rail, page host -----------
  //
  // The header carries the whole-look actions as icon buttons rather than
  // full-width rows: Randomize and Reset act on every control at once, so they
  // live with the panel title, not among the per-feature rows.
  const head = el('div', 'ac-head');
  head.appendChild(el('div', 'ac-title', t('auth.appearance')));
  const tools = el('div', 'ac-tools');
  head.appendChild(tools);
  host.appendChild(head);

  function tool(
    labelKey: TranslationKey,
    glyph: SVGSVGElement,
    run: () => void,
    shortKey: TranslationKey = labelKey,
  ): void {
    const btn = el('button', 'ac-tool');
    btn.type = 'button';
    btn.setAttribute('aria-label', t(labelKey));
    btn.title = t(labelKey);
    btn.appendChild(glyph);
    // The icon alone did not say what the button does (Troy, 2026-08-07): a
    // die and a circular arrow next to a panel title read as decoration.
    // The word rides beside the glyph; `shortKey` is the one-word form, with
    // the full phrase still on the tooltip and the aria-label.
    btn.appendChild(el('span', 'ac-tool-label', t(shortKey)));
    on(btn, 'click', () => {
      run();
      // a whole-look action can change every other control, so repaint all
      syncAll();
      emit();
    });
    tools.appendChild(btn);
  }

  tool(
    'auth.randomize',
    diceIcon(),
    () => {
      // randomizeAppearance rolls the body proportions too, that is the right
      // model-level behaviour and the Fit Studio wants it. In the game there is
      // no body row to see it on and no way to dial it back, so a rolled
      // silhouette would be an invisible, unfixable change: keep the body.
      value = { ...randomizeAppearance(value), body: value.body };
    },
    'auth.randomizeShort',
  );
  // Reset keeps the body selection, exactly like randomize: the doctrine is
  // "pick a body, then roll (or unroll) the rest". Lashes return to the
  // body's standard rather than DEFAULT_APPEARANCE's, which is male-shaped.
  tool(
    'auth.resetLook',
    resetIcon(),
    () => {
      value = normalizeAppearance({ gender: value.gender, lashes: defaultLashes(value.gender) });
    },
    'auth.resetShort',
  );

  const rail = el('div', 'ac-tabs');
  rail.setAttribute('role', 'tablist');
  rail.setAttribute('aria-label', t('auth.appearance'));
  const pagesHost = el('div', 'ac-pages');
  host.appendChild(rail);
  host.appendChild(pagesHost);

  const tabButtons: HTMLButtonElement[] = [];
  const tabPages: HTMLElement[] = [];

  function selectTab(idx: number, focus = false): void {
    for (let i = 0; i < tabButtons.length; i++) {
      const onTab = i === idx;
      tabButtons[i].classList.toggle('sel', onTab);
      tabButtons[i].setAttribute('aria-selected', onTab ? 'true' : 'false');
      // roving tabindex: one tab stop for the rail, arrows move within it
      tabButtons[i].tabIndex = onTab ? 0 : -1;
      tabPages[i].hidden = !onTab;
    }
    pagesHost.scrollTop = 0;
    if (focus) tabButtons[idx].focus();
  }

  function tabPage(labelKey: TranslationKey): HTMLElement {
    const idx = tabButtons.length;
    const btn = el('button', 'ac-tab', t(labelKey));
    btn.type = 'button';
    btn.id = `${uid}-tab-${idx}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    const page = el('div', 'ac-page');
    page.id = `${uid}-page-${idx}`;
    page.setAttribute('role', 'tabpanel');
    page.setAttribute('aria-labelledby', btn.id);
    btn.setAttribute('aria-controls', page.id);
    page.hidden = true;
    on(btn, 'click', () => selectTab(idx));
    on(btn, 'keydown', (ev) => {
      const n = tabButtons.length;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        selectTab((idx + 1) % n, true);
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        selectTab((idx - 1 + n) % n, true);
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        selectTab(0, true);
      } else if (ev.key === 'End') {
        ev.preventDefault();
        selectTab(n - 1, true);
      }
    });
    tabButtons.push(btn);
    tabPages.push(page);
    rail.appendChild(btn);
    pagesHost.appendChild(page);
    return page;
  }

  // --- row builders -------------------------------------------------------

  function row(page: HTMLElement, labelKey: TranslationKey | null, cls = ''): HTMLElement {
    const wrap = el('div', cls ? `ac-row ${cls}` : 'ac-row');
    if (labelKey !== null) wrap.appendChild(el('div', 'ac-label', t(labelKey)));
    page.appendChild(wrap);
    return wrap;
  }

  /** A faint rule between control families within one page. */
  function divider(page: HTMLElement): void {
    page.appendChild(el('div', 'ac-div'));
  }

  // Full-width segmented pair (the body picker). Two options with no label:
  // Male / Female reads instantly, and the tab already says "Body".
  function seg<T extends string>(
    page: HTMLElement,
    ariaKey: TranslationKey,
    options: readonly T[],
    labelFor: (o: T) => TranslationKey,
    get: () => T,
    set: (o: T) => void,
  ): void {
    const wrap = row(page, null, 'ac-r-full');
    const group = el('div', 'ac-seg');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', t(ariaKey));
    const buttons = new Map<T, HTMLButtonElement>();
    const sync = () => {
      for (const [key, btn] of buttons) {
        const onSeg = key === get();
        btn.classList.toggle('sel', onSeg);
        btn.setAttribute('aria-pressed', onSeg ? 'true' : 'false');
      }
    };
    for (const o of options) {
      const btn = el('button', 'ac-seg-btn', t(labelFor(o)));
      btn.type = 'button';
      btn.setAttribute('aria-pressed', 'false');
      on(btn, 'click', () => {
        set(o);
        sync();
        emit();
      });
      buttons.set(o, btn);
      group.appendChild(btn);
    }
    sync();
    syncers.push(sync);
    wrap.appendChild(group);
  }

  // The workhorse row: ‹ value › over a real <select>. The arrows cycle with
  // wraparound for one-handed browsing against the live preview; the select is
  // the same list as a popup for jumping straight to a named style, and it is
  // the control assistive tech and the keyboard land on, which is why the
  // arrow buttons are aria-hidden and out of the tab order rather than
  // labelled "previous/next".
  function stepper<T extends string>(
    page: HTMLElement,
    labelKey: TranslationKey,
    options: readonly T[],
    labelFor: (o: T) => TranslationKey,
    get: () => T,
    set: (o: T) => void,
  ): void {
    const wrap = row(page, labelKey);
    const cluster = el('div', 'ac-step');
    const prev = el('button', 'ac-step-btn');
    prev.type = 'button';
    prev.tabIndex = -1;
    prev.setAttribute('aria-hidden', 'true');
    prev.appendChild(icon('M9.8 3.4 5.2 8l4.6 4.6'));
    const sel = el('select', 'ac-step-value');
    sel.setAttribute('aria-label', t(labelKey));
    for (const o of options) {
      const opt = el('option', undefined, t(labelFor(o)));
      opt.value = o;
      sel.appendChild(opt);
    }
    const next = el('button', 'ac-step-btn');
    next.type = 'button';
    next.tabIndex = -1;
    next.setAttribute('aria-hidden', 'true');
    next.appendChild(icon('M6.2 3.4 10.8 8l-4.6 4.6'));
    const sync = () => {
      sel.value = get();
    };
    const step = (dir: 1 | -1) => {
      const i = options.indexOf(get());
      set(options[(i + dir + options.length) % options.length]);
      sync();
      emit();
    };
    on(prev, 'click', () => step(-1));
    on(next, 'click', () => step(1));
    on(sel, 'change', () => {
      set(sel.value as T);
      emit();
    });
    sync();
    syncers.push(sync);
    cluster.appendChild(prev);
    cluster.appendChild(sel);
    cluster.appendChild(next);
    wrap.appendChild(cluster);
  }

  // Morph slider, -1..1 with a drawn detent at the sculpted default. The value
  // drives a PAIR of morph targets (nose_up / nose_dn) because a morph
  // influence cannot go negative; morphInfluences() in modular.ts owns that
  // split. Double-click snaps back to 0, which is otherwise fiddly to hit
  // exactly on a continuous control.
  function slider(
    page: HTMLElement,
    labelKey: TranslationKey,
    get: () => number,
    set: (v: number) => void,
  ): void {
    const wrap = row(page, labelKey, 'ac-r-slide');
    const holder = el('div', 'ac-slide');
    const input = el('input', 'ac-slider');
    input.type = 'range';
    input.min = '-100';
    input.max = '100';
    input.step = '5';
    input.setAttribute('aria-label', t(labelKey));
    const sync = () => {
      input.value = String(Math.round(get() * 100));
    };
    on(input, 'input', () => {
      set(Number(input.value) / 100);
      emit();
    });
    on(input, 'dblclick', () => {
      set(0);
      sync();
      emit();
    });
    sync();
    syncers.push(sync);
    holder.appendChild(input);
    holder.appendChild(el('span', 'ac-notch'));
    wrap.appendChild(holder);
  }

  // On/off as a switch. `after` is what a flip triggers: appearance rows emit,
  // while the helm preview reports through its own handler because it is a view
  // of the character rather than part of the stored appearance.
  function switchRow(
    page: HTMLElement,
    labelKey: TranslationKey,
    get: () => boolean,
    set: (b: boolean) => void,
    after: () => void = emit,
  ): void {
    const wrap = row(page, labelKey);
    const btn = el('button', 'ac-switch');
    btn.type = 'button';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-label', t(labelKey));
    const sync = () => {
      btn.setAttribute('aria-checked', get() ? 'true' : 'false');
    };
    on(btn, 'click', () => {
      set(!get());
      sync();
      after();
    });
    sync();
    syncers.push(sync);
    wrap.appendChild(btn);
  }

  // Makeup swatch strip. Each chip carries the shade's own colour rather than
  // its name: "Berry" tells you nothing next to "Plum", and a swatch tells you
  // everything. `none` is drawn as an empty chip with a strike through it, so
  // OFF is a swatch too and the row needs no separate on/off control.
  // A chip's colour may be one hex (a flat swatch) or several (a material
  // colorway chip, drawn as a diagonal gradient of the treatments its rules
  // give the set's steel/trim/cloth, an honest multi-material preview).
  function chipBackground(hex: number | readonly number[]): string {
    const hexes = typeof hex === 'number' ? [hex] : hex;
    const css = hexes.map((x) => `#${x.toString(16).padStart(6, '0')}`);
    if (css.length === 1) return css[0];
    const stops = css.map((c, i) => {
      const a = Math.round((100 * i) / css.length);
      const b = Math.round((100 * (i + 1)) / css.length);
      return `${c} ${a}% ${b}%`;
    });
    return `linear-gradient(135deg, ${stops.join(', ')})`;
  }

  function swatches<T extends string>(
    page: HTMLElement,
    labelKey: TranslationKey,
    options: readonly T[],
    colorFor: (o: T) => number | readonly number[] | null,
    nameFor: (o: T) => TranslationKey,
    get: () => T,
    set: (o: T) => void,
  ): void {
    const wrap = row(page, labelKey);
    const group = el('div', 'ac-swatches');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', t(labelKey));
    const buttons = new Map<T, HTMLButtonElement>();
    const sync = () => {
      for (const [key, btn] of buttons) {
        const onSw = key === get();
        btn.classList.toggle('sel', onSw);
        btn.setAttribute('aria-pressed', onSw ? 'true' : 'false');
        // Repainted on every sync, not just at build: a chip's colour can
        // depend on live state outside the appearance (the outfit swatches
        // read the class kit, and the panel survives class switches).
        const hex = colorFor(key);
        if (hex !== null) {
          btn.style.background = chipBackground(hex);
        }
      }
    };
    for (const o of options) {
      const hex = colorFor(o);
      const btn = el('button', hex === null ? 'ac-mk-swatch ac-mk-none' : 'ac-mk-swatch');
      btn.type = 'button';
      // The colour is the label, so the NAME has to reach assistive tech some
      // other way, a chip with no text is a chip with no accessible name.
      btn.setAttribute('aria-label', t(nameFor(o)));
      btn.title = t(nameFor(o));
      btn.setAttribute('aria-pressed', 'false');
      if (hex !== null) {
        btn.style.background = chipBackground(hex);
      }
      on(btn, 'click', () => {
        set(o);
        sync();
        emit();
      });
      buttons.set(o, btn);
      group.appendChild(btn);
    }
    sync();
    syncers.push(sync);
    wrap.appendChild(group);
  }

  // --- colour row: preset swatches + a custom picker ----------------------
  //
  // Presets carry the row: a player picking hair colour wants "black" or
  // "auburn", and finding it should cost one click, not a hunt around a wheel
  // for the same shade everyone else already agreed on. The wheel is still
  // there for the player who wants a colour nobody agreed on, it just lives
  // behind the Custom chip instead of taking a third of the panel by default.
  //
  // The picker is an inline drawer rather than a floating popover on purpose:
  // the pages area scrolls and the panel is a fixed-width dock, so anything
  // absolutely positioned inside it either clips at the container edge or has
  // to be re-measured on every scroll. A drawer is correct at every width for
  // free, and it is what a menu opening off the chip should feel like anyway.
  function colorRow(
    page: HTMLElement,
    labelKey: TranslationKey,
    presets: readonly ColorPreset[],
    get: () => { h: number; s: number; l: number },
    set: (h: number, s: number, l: number) => void,
    lightMin: number,
  ): void {
    const wrap = el('div', 'ac-row ac-color');
    const headLine = el('div', 'ac-color-head');
    headLine.appendChild(el('div', 'ac-label', t(labelKey)));
    const chip = el('div', 'ac-chipdot');
    headLine.appendChild(chip);
    wrap.appendChild(headLine);

    const strip = el('div', 'ac-sw-strip');
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', t(labelKey));
    const swatches: HTMLButtonElement[] = [];
    presets.forEach((p, i) => {
      const btn = el('button', 'ac-sw');
      btn.type = 'button';
      // The colour is the label, so the name has to reach assistive tech some
      // other way. One parameterised string beats ~45 colour names nobody can
      // translate consistently ("auburn" has no clean Japanese equivalent).
      const name = t('auth.colorPresetAria', { label: t(labelKey), n: String(i + 1) });
      btn.setAttribute('aria-label', name);
      btn.title = name;
      btn.setAttribute('aria-pressed', 'false');
      btn.style.background = `#${hslToHex(p[0], p[1], p[2]).toString(16).padStart(6, '0')}`;
      on(btn, 'click', () => {
        set(p[0], p[1], p[2]);
        syncUi();
        emit();
      });
      swatches.push(btn);
      strip.appendChild(btn);
    });

    const custom = el('button', 'ac-sw ac-sw-custom');
    custom.type = 'button';
    custom.setAttribute('aria-label', t('auth.customColor'));
    custom.title = t('auth.customColor');
    custom.setAttribute('aria-expanded', 'false');
    strip.appendChild(custom);
    wrap.appendChild(strip);

    const body = el('div', 'ac-color-body ac-custom');
    body.hidden = true;
    const holder = el('div', 'ac-wheel-holder');
    const canvas = el('canvas', 'ac-wheel');
    canvas.style.width = `${WHEEL_PX}px`;
    canvas.style.height = `${WHEEL_PX}px`;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', t('auth.colorWheelAria', { label: t(labelKey) }));
    canvas.tabIndex = 0;
    const dot = el('div', 'ac-wheel-dot');
    holder.appendChild(canvas);
    holder.appendChild(dot);

    const slide = el('input', 'ac-slider');
    slide.type = 'range';
    slide.min = String(Math.round(lightMin * 100));
    slide.max = '95';
    slide.setAttribute('aria-label', t('auth.lightnessAria', { label: t(labelKey) }));

    const hex = (h: number, s: number, l: number) =>
      `#${hslToHex(h, s, l).toString(16).padStart(6, '0')}`;

    const syncUi = () => {
      const { h, s, l } = get();
      paintWheel(canvas, Math.max(0.25, Math.min(0.75, l)));
      const rad = (WHEEL_PX / 2) * Math.min(1, s);
      const ang = ((h - 90) * Math.PI) / 180;
      dot.style.left = `${WHEEL_PX / 2 + Math.cos(ang) * rad}px`;
      dot.style.top = `${WHEEL_PX / 2 + Math.sin(ang) * rad}px`;
      slide.value = String(Math.round(l * 100));
      // The track IS the legend: it runs this hue from its darkest legal value
      // to its lightest, left to right, so which end is which is a thing you
      // see rather than a caption you have to trust. (It replaces one that read
      // "Light / Dark" against a slider that ran dark → light.)
      slide.style.setProperty(
        '--ac-track',
        `linear-gradient(90deg, ${hex(h, s, lightMin)}, ${hex(h, s, 0.95)})`,
      );
      chip.style.background = hex(h, s, l);

      // Exactly one chip is lit: the preset you are on, or Custom when you are
      // on a colour no preset names.
      let onPreset = false;
      presets.forEach((p, i) => {
        const sel = matchesPreset(p, h, s, l);
        if (sel) onPreset = true;
        swatches[i].classList.toggle('sel', sel);
        swatches[i].setAttribute('aria-pressed', sel ? 'true' : 'false');
      });
      custom.classList.toggle('sel', !onPreset);
    };

    const pick = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const dx = ev.clientX - (r.left + r.width / 2);
      const dy = ev.clientY - (r.top + r.height / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hue = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      const sat = Math.min(1, dist / (r.width / 2));
      const { l } = get();
      set((hue + 360) % 360, sat, l);
      syncUi();
      emit();
    };
    on(canvas, 'pointerdown', (ev) => {
      canvas.setPointerCapture(ev.pointerId);
      pick(ev);
    });
    on(canvas, 'pointermove', (ev) => {
      if (ev.buttons & 1) pick(ev);
    });
    on(slide, 'input', () => {
      const { h, s } = get();
      set(h, s, Number(slide.value) / 100);
      syncUi();
      emit();
    });

    const right = el('div', 'ac-color-right');
    right.appendChild(slide);
    body.appendChild(holder);
    body.appendChild(right);
    wrap.appendChild(body);

    // One drawer open at a time: the Face tab carries two colour rows, and two
    // wheels open at once is the tall stack this redesign set out to kill.
    const close = () => {
      body.hidden = true;
      custom.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('open');
    };
    drawerClosers.push(close);
    on(custom, 'click', () => {
      const open = body.hidden;
      for (const c of drawerClosers) c();
      if (!open) return;
      body.hidden = false;
      custom.setAttribute('aria-expanded', 'true');
      wrap.classList.add('open');
      // The wheel paints from a zero-size canvas while hidden on some engines;
      // repaint now that it has a box.
      syncUi();
    });

    page.appendChild(wrap);
    syncUi();
    syncers.push(syncUi);
  }

  // --- pages --------------------------------------------------------------

  const pBody = tabPage('auth.body');
  const pFace = tabPage('auth.face');
  const pHair = tabPage('auth.hair');
  const pStyle = tabPage('auth.style');

  // Body: pick a body, tone it, then shape the silhouette.
  seg<Gender>(
    pBody,
    'auth.body',
    ['male', 'female'],
    (g) => (g === 'male' ? 'auth.genderMale' : 'auth.genderFemale'),
    () => value.gender,
    (g) => {
      // Lashes follow the body. They are the female standard and off on the
      // male, and a stored appearance carries whatever the LAST body wanted,
      // so without this, switching to female leaves her without them and the
      // "standard" is only true of a character created from scratch. The
      // switch on the Face tab still overrides it either way.
      value = { ...value, gender: g, lashes: defaultLashes(g) };
    },
  );
  colorRow(
    pBody,
    'auth.skinTone',
    SKIN_PRESETS,
    () => ({ h: value.skinHue, s: value.skinSat, l: value.skinLight }),
    (h, s, l) => {
      value = { ...value, skinHue: h, skinSat: s, skinLight: l };
    },
    0.12,
  );

  // Face: the feature pickers first (they change the read of the face most),
  // then the sculpt sliders as the fine-tune pass.
  stepper<EyeStyle>(
    pFace,
    'auth.eyeShape',
    EYE_STYLES,
    (e) => EYE_LABEL[e],
    () => value.eyeShape,
    (e) => {
      value = { ...value, eyeShape: e };
    },
  );
  colorRow(
    pFace,
    'auth.eyeColor',
    EYE_PRESETS,
    () => ({ h: value.eyeHue, s: value.eyeSat, l: value.eyeLight }),
    (h, s, l) => {
      value = { ...value, eyeHue: h, eyeSat: s, eyeLight: l };
    },
    0.03,
  );
  stepper<BrowStyle>(
    pFace,
    'auth.brows',
    BROW_STYLES,
    (b) => BROW_LABEL[b],
    () => value.brows,
    (b) => {
      value = { ...value, brows: b };
    },
  );
  stepper<MouthStyle>(
    pFace,
    'auth.mouth',
    MOUTH_STYLES,
    (m) => MOUTH_LABEL[m],
    () => value.mouth,
    (m) => {
      value = { ...value, mouth: m };
    },
  );
  stepper<EarStyle>(
    pFace,
    'auth.earShape',
    EAR_STYLES,
    (e) => EAR_LABEL[e],
    () => value.ears,
    (e) => {
      value = { ...value, ears: e };
    },
  );
  switchRow(
    pFace,
    'auth.lashes',
    () => value.lashes,
    (b) => {
      value = { ...value, lashes: b };
    },
  );
  colorRow(
    pFace,
    'auth.lashColor',
    LASH_PRESETS,
    () => ({ h: value.lashHue, s: value.lashSat, l: value.lashLight }),
    (h, s, l) => {
      value = { ...value, lashHue: h, lashSat: s, lashLight: l };
    },
    0.02,
  );
  divider(pFace);
  for (const key of FACE_SLIDERS) {
    slider(
      pFace,
      FACE_LABEL[key],
      () => value.face?.[key] ?? 0,
      (v) => {
        value = { ...value, face: { ...value.face, [key]: v } };
      },
    );
  }

  // Hair: style, its colour, and the beard (which shares the hair colour).
  stepper<HairStyle>(
    pHair,
    'auth.hair',
    HAIR_STYLES,
    (h) => HAIR_LABEL[h],
    () => value.hair,
    (h) => {
      value = { ...value, hair: h };
    },
  );
  colorRow(
    pHair,
    'auth.hairColor',
    HAIR_PRESETS,
    () => ({ h: value.hairHue, s: value.hairSat, l: value.hairLight }),
    (h, s, l) => {
      value = { ...value, hairHue: h, hairSat: s, hairLight: l };
    },
    0.02,
  );
  divider(pHair);
  stepper<BeardStyle>(
    pHair,
    'auth.beard',
    BEARD_STYLES,
    (b) => BEARD_LABEL[b],
    () => value.beard,
    (b) => {
      value = { ...value, beard: b };
    },
  );

  // Style: the finishing pass, the outfit's colorway, makeup applied to a
  // face rather than part of one, jewellery, and the helm view of the
  // finished look.
  //
  // The OUTFIT row leads the tab: it is the biggest visible change on the
  // page. Chips preview against the caller's live armour set (the class kit
  // in creation), so the same "crimson" chip leans knight-red on a knight and
  // dyes through the druid's leaf band on a druid.
  const armorSetNow = () => opts.armorSet?.() ?? 'knight';
  swatches<OutfitColorway>(
    pStyle,
    'auth.outfit',
    OUTFIT_COLORWAY_IDS,
    (c) => outfitSwatchHexes(armorSetNow(), c),
    (c) => OUTFIT_LABEL[c],
    () => value.outfit,
    (c) => {
      value = { ...value, outfit: c };
    },
  );
  divider(pStyle);
  swatches<LipShade>(
    pStyle,
    'auth.lipstick',
    LIP_SHADES,
    (s) => lipColor(s),
    (s) => LIP_LABEL[s],
    () => value.lipstick,
    (s) => {
      value = { ...value, lipstick: s };
    },
  );
  swatches<BlushShade>(
    pStyle,
    'auth.blush',
    BLUSH_SHADES,
    (s) => blushColor(s),
    (s) => BLUSH_LABEL[s],
    () => value.blush,
    (s) => {
      value = { ...value, blush: s };
    },
  );
  swatches<ShadowShade>(
    pStyle,
    'auth.eyeshadow',
    SHADOW_SHADES,
    (s) => shadowColor(s),
    (s) => SHADOW_LABEL[s],
    () => value.eyeshadow,
    (s) => {
      value = { ...value, eyeshadow: s };
    },
  );
  divider(pStyle);
  stepper<EarringStyle>(
    pStyle,
    'auth.earrings',
    EARRING_STYLES,
    (e) => EARRING_LABEL[e],
    () => value.earrings,
    (e) => {
      value = { ...value, earrings: e };
    },
  );
  // What the worn set is MADE of, the Fit Studio's designer-side preset list,
  // handed to the player. `default` is the authored atlas ride and leads the
  // row as the no-choice chip, the same shape the makeup rows use for 'none'.
  swatches<EarringMaterial>(
    pStyle,
    'auth.jewelMaterial',
    EARRING_MATERIAL_IDS,
    (m) => earringSwatchHex(m),
    (m) => EARRING_MATERIAL_LABEL[m],
    () => value.earringMaterial,
    (m) => {
      value = { ...value, earringMaterial: m };
    },
  );
  if (opts.onHelm) {
    const onHelm = opts.onHelm;
    switchRow(
      pStyle,
      'auth.helmPreview',
      () => helm,
      (b) => {
        helm = b;
      },
      () => onHelm(helm),
    );
  }

  selectTab(0);

  return {
    get value() {
      return value;
    },
    set(next) {
      value = normalizeAppearance({ ...value, ...next });
      syncAll();
      emit();
    },
    destroy() {
      for (const c of cleanups) c();
      cleanups.length = 0;
      host.textContent = '';
      host.classList.remove('appearance-customizer');
    },
  };
}
