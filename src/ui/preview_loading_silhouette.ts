// The 2D placeholder the launcher's character turntable shows while its 3D
// character is still loading: a brand-gold OUTLINE of a person, with a lighter
// gold sheen sweeping across INSIDE the shape (a skeleton-loading shimmer
// masked to the silhouette). It goes the moment the real character draws.
//
// Why a drawn person rather than a spinner or the class crest: on the launcher
// the stage IS the character, so a figure standing exactly where the model will
// appear says "your character goes here, it is on its way" with no layout
// change when it lands (the paperdoll's cold-open stand-in, preview_stand_in.ts,
// answers a different question: a sub-200 ms link on an already warm page).
//
// Contracts:
// - Structural seam. CharacterPreview declares its own copy of
//   PreviewLoadingLayer, so src/render never imports this module; main.ts hands
//   one in. The two shapes are what the camera frames: 'body' is the whole
//   figure (the turntable's full-body framing), 'bust' the head and shoulders
//   (its close framing). One layer serves one stage owner: hide() takes no
//   container, it takes the layer off wherever it sits.
// - Called every frame. The turntable's loop (CharacterPreview's
//   syncLoadingLayer) calls show() or hide() once per frame, so the repeat path
//   is the hot one: a steady frame (same container, shape and i18n revision)
//   returns before any DOM write, and a hidden layer's hide() does nothing.
//   Neither reads layout or allocates; DOM writes happen only on attach, a move,
//   a shape change, a language switch, or hide, and the only frame callbacks it
//   requests are the label fill's after an attach (below). Nothing is created
//   until the first show().
// - Accessibility. The layer is a polite role=status region whose only content
//   a screen reader reaches is the visually hidden t('auth.modelLoading') label;
//   the art is aria-hidden. Every attach puts the region in EMPTY and fills the
//   label two frames later, so the text lands as an update to a live region that
//   has already rendered (a region that arrives pre-filled is often not
//   announced). It sets no aria-busy: a busy container would hold back this
//   region and the stage's other live regions (the roster's name plate).
// - Tokens only. Every color (the outline, the faint inside fill, the sheen's
//   gradient stops) and the whole sweep animation live in src/styles/shell.css
//   ("character preview loading silhouette"); this module mints geometry and
//   ids only. data-shape on the root selects which of the two arts shows.
// - Unique ids. The clipPath and gradient ids carry a module counter suffix, so
//   two layers on one page (or one built per stage) never resolve each other's
//   url(#...) references.

import { getI18nRevision, t } from './i18n';

/** The 2D layer shown over the turntable while its character is still loading. */
export interface PreviewLoadingLayer {
  /** Show over `container` (appending it there, or moving it there from another container);
   *  `shape` is what the camera frames: the whole body, or the head and shoulders. Idempotent:
   *  a repeat call with the same container and shape writes nothing to the DOM. */
  show(container: HTMLElement, shape: 'body' | 'bust'): void;
  /** Remove it (a no-op when hidden). */
  hide(): void;
}

type PreviewLoadingShape = 'body' | 'bust';

/** The root class; the stylesheet section and the tests key on it. */
export const PREVIEW_LOADING_SILHOUETTE_CLASS = 'preview-loading-silhouette';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One step of a figure's right-hand outline: a cubic Bezier (two control
 *  points, then the end point) or a straight line to [x, y]. */
type OutlineStep =
  | readonly [x: number, y: number]
  | readonly [c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number];

/** A figure drawn symmetric BY CONSTRUCTION: only its right half is authored,
 *  from the top of the centre line round to where the outline meets the centre
 *  line again, and the left half is that run mirrored and walked back. */
interface FigureArt {
  /** viewBox width and height, in user units. */
  readonly w: number;
  readonly h: number;
  /** Where the outline leaves the centre line (the crown). */
  readonly start: readonly [x: number, y: number];
  readonly rightHalf: readonly OutlineStep[];
}

// A front-facing standing adventurer, about seven and a half heads tall: head,
// neck, the trapezius slope into broad shoulders, arms hanging a little away
// from the body, the torso narrowing to the waist and out to the hips, legs
// slightly apart and simple boots. Soles at y=237 of 240; the stylesheet places
// the box so they land where the model's feet stand.
const BODY_ART: FigureArt = {
  w: 100,
  h: 240,
  start: [50, 4],
  rightHalf: [
    // head: crown round to the cheek, then the jaw tucking into the neck
    [56.6, 4, 61.6, 9.4, 61.6, 16.8],
    [61.6, 23.6, 59.8, 29.2, 56.8, 32.4],
    [55.6, 33.7, 55.3, 35.6, 55.4, 38],
    // neck flaring into the trapezius, out to the shoulder cap
    [55.6, 41, 57.8, 43, 61.8, 44.4],
    [67, 46.2, 74.6, 46.6, 78.8, 49.4],
    [82.8, 52, 84.6, 56.6, 84.7, 62],
    // the arm's outer edge: upper arm, elbow, a forearm angled a touch outward
    [84.9, 72.4, 85, 85, 85.2, 96.4],
    [85.5, 107, 86.8, 117, 87.2, 127],
    [87.8, 133, 89.2, 138.6, 88.4, 144.2],
    // the hand's rounded end, then back up the arm's inner edge to a rounded armpit
    [87.6, 149.6, 82.2, 152, 80.4, 147.4],
    [79.4, 144, 79.2, 135.6, 79.4, 128.4],
    [79, 118.4, 77.2, 108, 76.2, 97.6],
    [75.4, 87, 75, 77, 74.4, 71.6],
    [74, 69, 72.4, 68.4, 71.8, 71.4],
    // the torso's side: chest, waist, hip
    [70.8, 80, 67, 90, 66.8, 101],
    [66.6, 109.6, 69.2, 117.4, 69.4, 126.6],
    // the leg's outer edge: thigh, knee, calf, ankle
    [69.6, 141, 67, 160, 65, 175.4],
    [64.2, 182, 66, 189, 65.8, 196],
    [65.6, 204.4, 63.2, 211, 63, 218],
    // the boot: a slight flare over the instep, a rounded toe, a flat sole
    [62.8, 223, 65.6, 226.6, 66.4, 230.8],
    [67, 234.4, 66.4, 237, 63, 237],
    [54.4, 237],
    // the leg's inner edge back up to the crotch
    [53.6, 237, 53.4, 234.6, 53.6, 231],
    [53.8, 226, 54.6, 222, 54.4, 216],
    [54.2, 208, 52.8, 202, 53, 194],
    [53.2, 186, 53, 180, 52.8, 174],
    [52.4, 160, 51.4, 146, 51, 140],
    [50.7, 136.4, 50.5, 134.4, 50, 134.4],
  ],
};

// Head and shoulders, cut flat across the upper chest (the bottom edge of the
// box sits on the bottom edge of the stage): head, neck, the trapezius slope
// out to rounded shoulder caps and the upper arms running down to the cut.
const BUST_ART: FigureArt = {
  w: 200,
  h: 170,
  start: [100, 4],
  rightHalf: [
    // head: crown to the widest of the cranium, cheek, then the jaw corner
    [114.4, 4, 126, 15.6, 126, 31.4],
    [126, 44.6, 123.8, 54, 118.6, 60.6],
    [115.8, 64, 113.6, 66.4, 113.4, 70.4],
    // neck flaring into the trapezius, out to the shoulder
    [113.2, 75.4, 113.4, 80.2, 117.6, 83],
    [124.2, 87.4, 146, 89.6, 160.4, 94],
    // the shoulder cap rounding down into the upper arm, down to the cut
    [173.4, 98.4, 180.6, 107.4, 181.8, 121],
    [182.8, 133, 183.4, 151, 183.6, 170],
    [100, 170],
  ],
};

const ARTS: Readonly<Record<PreviewLoadingShape, FigureArt>> = { body: BODY_ART, bust: BUST_ART };

/** Two decimals at most, so a mirrored coordinate never prints float noise. */
function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Where an outline step ends. */
function stepEnd(step: OutlineStep): readonly [number, number] {
  return step.length === 2 ? step : [step[4], step[5]];
}

/** The closed outline path of a figure: its right half as authored, then the
 *  same run mirrored about the centre line and walked back to the crown. */
function figurePathData(art: FigureArt): string {
  const mirror = (x: number): string => num(art.w - x);
  const steps = art.rightHalf;
  const out = [`M${num(art.start[0])} ${num(art.start[1])}`];
  for (const step of steps) out.push(`${step.length === 2 ? 'L' : 'C'}${step.map(num).join(' ')}`);
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    // Walked backwards, each mirrored step runs to where the authored one began:
    // the previous step's end, or the crown for the first.
    const [fromX, fromY] = i > 0 ? stepEnd(steps[i - 1]) : art.start;
    if (step.length === 2) {
      out.push(`L${mirror(fromX)} ${num(fromY)}`);
    } else {
      const [c1x, c1y, c2x, c2y] = step;
      out.push(
        `C${mirror(c2x)} ${num(c2y)} ${mirror(c1x)} ${num(c1y)} ${mirror(fromX)} ${num(fromY)}`,
      );
    }
  }
  out.push('Z');
  return out.join('');
}

const PATH_DATA: Readonly<Record<PreviewLoadingShape, string>> = {
  body: figurePathData(BODY_ART),
  bust: figurePathData(BUST_ART),
};

// The sheen's gradient stops along the sweep rect's diagonal. The rect is three
// times the figure box (see buildArt), so the figure spans 1/3 to 2/3 of it; the
// band is the lighter gold between the two edge stops, and the stylesheet's
// keyframe slides the whole rect so the band crosses the figure corner to
// corner. Colors and opacities come from CSS through the stop classes.
const SHEEN_STOPS: readonly (readonly [offset: string, cls: string])[] = [
  ['0.45', 'pls-stop-edge'],
  ['0.5', 'pls-stop-core'],
  ['0.55', 'pls-stop-edge'],
];

/** Module counter: the id suffix that keeps every layer's url(#...) its own. */
let silhouetteSeq = 0;

function svgEl<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
}

/** One shape's art: the clip and gradient defs, the clipped sheen rect, then the
 *  outline (stroke plus the faint inside fill) drawn last so it stays crisp. */
function buildArt(doc: Document, shape: PreviewLoadingShape, seq: number): SVGSVGElement {
  const art = ARTS[shape];
  const d = PATH_DATA[shape];
  const clipId = `pls-clip-${shape}-${seq}`;
  const sheenId = `pls-sheen-${shape}-${seq}`;
  const svg = svgEl(doc, 'svg', {
    class: `pls-art pls-art-${shape}`,
    viewBox: `0 0 ${art.w} ${art.h}`,
    // Bottom-anchored: on a stage too narrow for the box, the figure shrinks
    // in place with its feet (or the chest cut) still on the same line.
    preserveAspectRatio: 'xMidYMax meet',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const defs = svgEl(doc, 'defs', {});
  const clip = svgEl(doc, 'clipPath', { id: clipId });
  clip.appendChild(svgEl(doc, 'path', { d }));
  const gradient = svgEl(doc, 'linearGradient', {
    id: sheenId,
    x1: '0',
    y1: '0',
    x2: '1',
    y2: '1',
  });
  for (const [offset, cls] of SHEEN_STOPS) {
    gradient.appendChild(svgEl(doc, 'stop', { offset, class: cls }));
  }
  defs.append(clip, gradient);
  // The clip sits on a STILL group: only the rect inside it moves, so the
  // mask stays on the figure while the band slides through it.
  const clipped = svgEl(doc, 'g', { 'clip-path': `url(#${clipId})` });
  clipped.appendChild(
    svgEl(doc, 'rect', {
      class: 'pls-sheen',
      x: String(-art.w),
      y: String(-art.h),
      width: String(art.w * 3),
      height: String(art.h * 3),
      fill: `url(#${sheenId})`,
    }),
  );
  svg.append(defs, clipped, svgEl(doc, 'path', { class: 'pls-outline', d }));
  return svg;
}

/**
 * Build the loading layer. Nothing touches the DOM until the first show(); the
 * node it builds then is reused across hides, shows and container moves.
 */
export function createPreviewLoadingSilhouette(doc: Document = document): PreviewLoadingLayer {
  let root: HTMLElement | null = null;
  let label: HTMLElement | null = null;
  /** The container the layer currently sits in (null while hidden). */
  let host: HTMLElement | null = null;
  let shownShape: PreviewLoadingShape | null = null;
  /** The i18n revision the label was filled under (-1: empty, not filled yet). */
  let labelRevision = -1;
  /** Bumped by every attach and by hide, so a fill scheduled for an earlier
   *  attach finds itself stale and does nothing. */
  let fillToken = 0;
  let fillPending = false;

  const build = (): HTMLElement => {
    const seq = ++silhouetteSeq;
    const el = doc.createElement('div');
    el.className = PREVIEW_LOADING_SILHOUETTE_CLASS;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.append(buildArt(doc, 'body', seq), buildArt(doc, 'bust', seq));
    const text = doc.createElement('span');
    text.className = 'visually-hidden';
    el.appendChild(text);
    label = text;
    return el;
  };

  /** Resolve the label now. The revision is latched BEFORE t(): were t() to
   *  throw (a release build with this key still pending), it throws once. */
  const fillLabel = (): void => {
    fillPending = false;
    labelRevision = getI18nRevision();
    if (label) label.textContent = t('auth.modelLoading');
  };

  /** Fill the label once the empty region has rendered: two frames on, so a
   *  frame boundary passes whether show() ran inside a frame callback (the
   *  turntable's loop) or outside one. A document with no window renders
   *  nothing to announce, so it fills at once. */
  const scheduleFill = (): void => {
    const token = ++fillToken;
    const win = doc.defaultView;
    if (!win) {
      fillLabel();
      return;
    }
    fillPending = true;
    win.requestAnimationFrame(() => {
      if (token !== fillToken) return;
      win.requestAnimationFrame(() => {
        if (token === fillToken) fillLabel();
      });
    });
  };

  return {
    show(container, shape) {
      const layer = root ?? build();
      root = layer;
      const attached = host === container && layer.parentNode === container;
      const revision = getI18nRevision();
      if (attached && shownShape === shape && (fillPending || labelRevision === revision)) return;
      if (shownShape !== shape) {
        layer.dataset.shape = shape;
        shownShape = shape;
      }
      if (!attached) {
        // Every attach starts the region empty and fills it once it has rendered.
        if (label?.textContent) label.textContent = '';
        labelRevision = -1;
        container.appendChild(layer);
        host = container;
        scheduleFill();
        return;
      }
      // Attached, filled under an older revision: a language switch while it shows.
      if (!fillPending && labelRevision !== revision) fillLabel();
    },
    hide() {
      if (!root || !host) return;
      fillToken++;
      fillPending = false;
      root.remove();
      host = null;
    },
  };
}
