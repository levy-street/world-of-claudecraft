// The deepball match strip: score, clock, phase, the boost meter, and the two
// readouts a flier in a sphere cannot play without.
//
// A bout is unplayable without the first three facts: you cannot pace a burn you
// cannot see, and you cannot tell whether you are winning. The next two were
// learned the hard way. A 2.4-yard ball inside a 76-yard sphere is GONE the
// moment it leaves the screen, so the strip carries a MARKER that follows it and
// points at it when it is behind you. And momentum in the bell is long and
// frictionless, which means speed is the thing you are actually managing, so it
// is on the dial next to the charge.
//
// Deliberately a small self-contained DOM overlay rather than a slice of the main
// HUD: the arena is an offline event build, and threading a whole new panel
// through hud.ts's layout, i18n and mobile pages would cost far more than the
// strip is worth before the Vale Cup integration lands (docs/prd/deepglass.md
// section 8).
//
// Pure presentation. It reads a snapshot and never touches the sim.

import { DG_TEAM_NAME, dgTeamCss } from '../sim/deepglass/layout';

/** Where the Tidesow is on screen, as the renderer projected it. */
export interface DeepglassBallMark {
  /** Normalised screen position, 0..1 from the top-left. Already clamped to the
   *  viewport, so an off-screen ball lands on the edge nearest to it. */
  x: number;
  y: number;
  /** The ball is off screen (or behind the camera) and this is an edge pointer
   *  rather than a marker sitting on the ball. */
  edge: boolean;
  /** Which way the pointer should point, radians, screen space. */
  angle: number;
  /** Distance from the local player, yards. */
  dist: number;
}

/** Pad on the edge pointer, as a fraction of the half-viewport. */
const MARK_EDGE_X = 0.9;
const MARK_EDGE_Y = 0.86;
/** Past this in normalised device coords the ball counts as off screen. Inside
 *  the pad, so a marker never sits half under the HUD chrome. */
const MARK_ON_X = 0.97;
const MARK_ON_Y = 0.94;

/**
 * Turn a projected ball position into a marker.
 *
 * Pure, and separated from the projection on purpose: the renderer owns the
 * camera maths, and this, the part with the three cases and the sign trap, is
 * the part worth testing. `nx`/`ny` are normalised device coords (-1..1, y up)
 * and `nz` is the projected depth, which is greater than 1 when the ball is
 * BEHIND the camera. In that case the projection's sign has flipped, so the raw
 * coords would put the pointer on exactly the wrong edge; negating them is the
 * whole trick.
 */
export function ballMarkFromNdc(
  nx: number,
  ny: number,
  nz: number,
  dist: number,
): DeepglassBallMark {
  const behind = nz > 1;
  const x = behind ? -nx : nx;
  const y = behind ? -ny : ny;
  const edge = behind || Math.abs(x) > MARK_ON_X || Math.abs(y) > MARK_ON_Y;
  if (!edge) {
    return { x: (x + 1) / 2, y: (1 - y) / 2, edge: false, angle: 0, dist };
  }
  // Push the direction out to the edge of a padded box, so the pointer sits just
  // inside the viewport whatever the aspect ratio is.
  const len = Math.hypot(x, y) || 1;
  const ux = x / len;
  const uy = y / len;
  const limit = Math.min(
    MARK_EDGE_X / Math.max(1e-3, Math.abs(ux)),
    MARK_EDGE_Y / Math.max(1e-3, Math.abs(uy)),
  );
  return {
    x: (ux * limit + 1) / 2,
    y: (1 - uy * limit) / 2,
    edge: true,
    // Screen y grows downward, so the pointer's angle negates it.
    angle: Math.atan2(-uy, ux),
    dist,
  };
}

export interface DeepglassHudSnapshot {
  phase: 'countdown' | 'active' | 'goal' | 'over';
  /** Seconds left on the countdown / celebration / aftermath, if any. */
  timer: number;
  /** Elapsed play, seconds. */
  clock: number;
  matchLength: number;
  scoreA: number;
  scoreB: number;
  /** 0..1 boost charge for the local player. */
  charge: number;
  boosting: boolean;
  overburn: boolean;
  /** Which side the local player is on, for highlighting. */
  team: 'A' | 'B' | null;
  lastGoalBy: 'A' | 'B' | null;
  /** The powerup in the local player's one slot, if any. */
  powerup: 'zap' | 'overburn' | null;
  /** Seconds until the local player respawns after a Zap Shot, 0 when alive.
   *  While > 0 the HUD greys the whole screen (the demo's death view). */
  dead: number;
  /** Who zapped them, for the card. */
  zappedBy: string | null;
  /** The local player's speed, yd/s, and the cruise/boost figures it reads
   *  against, the dial is a fraction, and the fraction is what tells you
   *  whether a burn is still buying anything. */
  speed: number;
  cruise: number;
  topSpeed: number;
  /** Dash is available (charge and cooldown both allow it). */
  dashReady: boolean;
  /** Air-braking right now. */
  braking: boolean;
  /** Where the ball is on screen, or null when it should not be marked. */
  ball: DeepglassBallMark | null;
  /** Who scored the last goal, and who set it up. Names, already resolved. */
  scorer: string | null;
  assist: string | null;
  ownGoal: boolean;
  /** Sudden death: the clock has run out level and the next goal wins. */
  overtime: boolean;
}

/**
 * The keys the hint strip advertises, resolved from the player's LIVE bindings.
 *
 * Injected rather than imported: the Keybinds instance is per character and
 * owned by main.ts. Read every frame (cheap, and only written to the DOM when
 * the composed line changes) so a rebind is reflected immediately, this strip
 * has already shipped a lie once, telling everyone to press SPACE for the whole
 * of the first pass after the burners had moved to F.
 */
export interface DeepglassHintKeys {
  boost: string;
  up: string;
  down: string;
  brake: string;
}

const FALLBACK_HINT_KEYS: DeepglassHintKeys = {
  boost: 'F',
  up: 'Space',
  down: 'Ctrl',
  brake: 'S',
};

let readHintKeys: (() => DeepglassHintKeys) | null = null;
let lastHintLine = '';

/** Install (or clear) the live binding reader. */
export function setDeepglassHintKeys(read: (() => DeepglassHintKeys) | null): void {
  readHintKeys = read;
  lastHintLine = '';
}

const ROOT_ID = 'deepglass-hud';

function css(): string {
  return `
#${ROOT_ID}{position:absolute;top:8px;left:50%;transform:translateX(-50%);
 z-index:40;pointer-events:none;font-family:inherit;text-align:center;
 text-shadow:0 2px 6px rgba(0,0,0,.85);color:#eaf6ff}
#${ROOT_ID} .dg-score{display:flex;align-items:center;gap:14px;justify-content:center;
 background:rgba(8,20,30,.62);border:1px solid rgba(127,230,255,.35);border-radius:12px;
 padding:6px 18px;backdrop-filter:blur(3px)}
#${ROOT_ID} .dg-n{font-size:26px;font-weight:500;min-width:1.4em}
#${ROOT_ID} .dg-a{color:${dgTeamCss('A')}}
#${ROOT_ID} .dg-b{color:${dgTeamCss('B')}}
#${ROOT_ID} .dg-mine{text-decoration:underline;text-underline-offset:4px}
#${ROOT_ID} .dg-clock{font-size:15px;opacity:.85;min-width:3.6em}
#${ROOT_ID} .dg-clock.ot{color:#ffd166;letter-spacing:.08em}
#${ROOT_ID} .dg-phase{margin-top:5px;font-size:19px;letter-spacing:.16em;
 text-transform:uppercase;color:#ffe6a8;min-height:1.2em}
#${ROOT_ID} .dg-credit{font-size:13px;letter-spacing:.06em;color:#dff3ff;min-height:1.1em;
 opacity:0;transition:opacity .15s linear}
#${ROOT_ID} .dg-credit.on{opacity:.92}
#${ROOT_ID} .dg-credit b{color:#ffe6a8;font-weight:500}
#${ROOT_ID} .dg-bars{display:flex;gap:8px;justify-content:center;margin-top:7px}
#${ROOT_ID} .dg-boost{width:150px;height:9px;border-radius:5px;
 background:rgba(4,12,18,.72);border:1px solid rgba(127,230,255,.3);overflow:hidden}
#${ROOT_ID} .dg-boost i{display:block;height:100%;width:0;border-radius:4px;
 background:#6fe3c0;transition:width .06s linear}
#${ROOT_ID} .dg-boost.burn i{background:#ffd166}
#${ROOT_ID} .dg-boost.over i{background:#ff9de2}
#${ROOT_ID} .dg-boost.spent i{background:#7c5a5a}
/* The speed dial. The cruise mark is a hairline at the unboosted cap, so the
   bar reads as "how much of this is the burners" at a glance. */
#${ROOT_ID} .dg-speed{position:relative;width:96px;height:9px;border-radius:5px;
 background:rgba(4,12,18,.72);border:1px solid rgba(127,230,255,.3);overflow:hidden}
#${ROOT_ID} .dg-speed i{display:block;height:100%;width:0;border-radius:4px;
 background:#9ad9ff;transition:width .08s linear}
#${ROOT_ID} .dg-speed.fast i{background:#fff1c0}
#${ROOT_ID} .dg-speed.brake i{background:#ff9b8a}
#${ROOT_ID} .dg-speed u{position:absolute;top:0;bottom:0;width:1px;
 background:rgba(255,255,255,.5)}
#${ROOT_ID} .dg-dash{margin-top:5px;font-size:11px;letter-spacing:.14em;
 text-transform:uppercase;opacity:.28;transition:opacity .1s linear}
#${ROOT_ID} .dg-dash.ready{opacity:.8;color:#bff3ff}
#${ROOT_ID} .dg-power{margin-top:6px;font-size:13px;letter-spacing:.1em;
 text-transform:uppercase;min-height:1.2em;opacity:0;transition:opacity .12s linear}
#${ROOT_ID} .dg-power.held{opacity:1}
#${ROOT_ID} .dg-power.zap{color:#8ee8ff}
#${ROOT_ID} .dg-power.overburn{color:#ff9de2}
#${ROOT_ID} .dg-hint{margin-top:4px;font-size:12px;opacity:.6}
/* The ball marker lives OUTSIDE the strip's centred column so it can sit
   anywhere on the viewport. */
/* FIXED, and positioned in PERCENTAGES. Both matter: fixed resolves the
   percentages against the viewport rather than against whatever height body
   happens to have, and percentages avoid reading window.innerWidth, which an
   offscreen/automated context reports as 0, parking the marker in the corner. */
#${ROOT_ID}-ball{position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;
 z-index:39;pointer-events:none;display:none;will-change:left,top}
#${ROOT_ID}-ball svg{width:100%;height:100%;overflow:visible;
 filter:drop-shadow(0 1px 3px rgba(0,0,0,.9))}
#${ROOT_ID}-ball .ring{fill:none;stroke:#ffe6a8;stroke-width:2;opacity:.9}
#${ROOT_ID}-ball .arrow{fill:#ffe6a8;opacity:.95}
#${ROOT_ID}-ball .far{display:none}
#${ROOT_ID}-ball.edge .ring{display:none}
#${ROOT_ID}-ball.edge .far{display:block}
#${ROOT_ID}-ball .tag{position:absolute;left:50%;top:100%;transform:translateX(-50%);
 font-size:10px;letter-spacing:.08em;color:#ffe6a8;text-shadow:0 1px 3px rgba(0,0,0,.9);
 white-space:nowrap}

/* Demolished: the whole view goes grey until the respawn (Rocket League's demo
   death view). A backdrop filter rather than a post pass, so every graphics
   tier gets it, including the ones with no composer. */
#${ROOT_ID}-dead{position:fixed;inset:0;z-index:38;pointer-events:none;display:none;
 backdrop-filter:grayscale(1) brightness(.72);-webkit-backdrop-filter:grayscale(1) brightness(.72);
 background:rgba(20,28,36,.18)}
#${ROOT_ID}-dead .word{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);
 font-size:34px;letter-spacing:.3em;text-transform:uppercase;color:#f3f7ff;
 text-shadow:0 2px 12px rgba(0,0,0,.9)}
#${ROOT_ID}-dead .sub{position:absolute;left:50%;top:38%;transform:translate(-50%,28px);
 font-size:15px;letter-spacing:.12em;color:#cfe3ff;text-shadow:0 1px 6px rgba(0,0,0,.9);
 white-space:nowrap}`;
}

interface Nodes {
  root: HTMLElement;
  a: HTMLElement;
  b: HTMLElement;
  clock: HTMLElement;
  phase: HTMLElement;
  credit: HTMLElement;
  boost: HTMLElement;
  fill: HTMLElement;
  speed: HTMLElement;
  speedFill: HTMLElement;
  cruiseMark: HTMLElement;
  dash: HTMLElement;
  power: HTMLElement;
  hint: HTMLElement;
  hintKeys: HTMLElement;
  ball: HTMLElement;
  ballRot: HTMLElement;
  ballTag: HTMLElement;
  dead: HTMLElement;
  deadSub: HTMLElement;
}

let nodes: Nodes | null = null;

function mount(): Nodes | null {
  if (typeof document === 'undefined') return null;
  for (const id of [ROOT_ID, `${ROOT_ID}-ball`, `${ROOT_ID}-dead`]) {
    document.getElementById(id)?.remove();
  }
  const style = document.createElement('style');
  style.textContent = css();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.setAttribute('aria-live', 'polite');
  root.innerHTML =
    '<div class="dg-score"><span class="dg-n dg-a">0</span>' +
    '<span class="dg-clock">0:00</span>' +
    '<span class="dg-n dg-b">0</span></div>' +
    '<div class="dg-phase"></div>' +
    '<div class="dg-credit"></div>' +
    '<div class="dg-bars"><div class="dg-boost"><i></i></div>' +
    '<div class="dg-speed"><i></i><u></u></div></div>' +
    '<div class="dg-dash">Dash ready</div>' +
    '<div class="dg-power"></div>' +
    // Filled from the live bindings by syncHint() rather than written out here.
    // Hard-coding is what let this strip say SPACE for the whole of the first
    // pass, long after the burners had moved to F, so the honest reading of
    // "the jets do not fire" was that the HUD named the wrong key. Now it
    // cannot: it reads whatever the player actually has bound.
    '<div class="dg-hint"><span class="dg-keys"></span></div>';
  root.prepend(style);
  document.body.appendChild(root);

  // The marker. One SVG with both faces, a ring while the ball is on screen, a
  // pointer while it is not, so switching costs a class, not a rebuild.
  const ball = document.createElement('div');
  ball.id = `${ROOT_ID}-ball`;
  ball.innerHTML =
    '<div class="rot" style="width:100%;height:100%">' +
    '<svg viewBox="-17 -17 34 34" aria-hidden="true">' +
    '<circle class="ring" cx="0" cy="0" r="9"></circle>' +
    '<path class="far arrow" d="M 13 0 L 1 -7 L 4 0 L 1 7 Z"></path>' +
    '</svg></div><div class="tag"></div>';
  document.body.appendChild(ball);

  // The death view: one fixed layer over everything but the HUD.
  const dead = document.createElement('div');
  dead.id = `${ROOT_ID}-dead`;
  dead.innerHTML = '<div class="word">Demolished</div><div class="sub"></div>';
  document.body.appendChild(dead);

  return {
    root,
    a: root.querySelector('.dg-a') as HTMLElement,
    b: root.querySelector('.dg-b') as HTMLElement,
    clock: root.querySelector('.dg-clock') as HTMLElement,
    phase: root.querySelector('.dg-phase') as HTMLElement,
    credit: root.querySelector('.dg-credit') as HTMLElement,
    boost: root.querySelector('.dg-boost') as HTMLElement,
    fill: root.querySelector('.dg-boost i') as HTMLElement,
    speed: root.querySelector('.dg-speed') as HTMLElement,
    speedFill: root.querySelector('.dg-speed i') as HTMLElement,
    cruiseMark: root.querySelector('.dg-speed u') as HTMLElement,
    dash: root.querySelector('.dg-dash') as HTMLElement,
    power: root.querySelector('.dg-power') as HTMLElement,
    hint: root.querySelector('.dg-hint') as HTMLElement,
    hintKeys: root.querySelector('.dg-hint .dg-keys') as HTMLElement,
    ball,
    ballRot: ball.querySelector('.rot') as HTMLElement,
    ballTag: ball.querySelector('.tag') as HTMLElement,
    dead,
    deadSub: dead.querySelector('.sub') as HTMLElement,
  };
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function phaseLabel(s: DeepglassHudSnapshot): string {
  switch (s.phase) {
    case 'countdown':
      return Math.ceil(s.timer) > 0 ? String(Math.ceil(s.timer)) : 'Dive!';
    case 'goal':
      return s.lastGoalBy ? `Goal, ${DG_TEAM_NAME[s.lastGoalBy]}` : 'Goal';
    case 'over': {
      if (s.scoreA === s.scoreB) return 'Full time, drawn';
      return `Full time, ${DG_TEAM_NAME[s.scoreA > s.scoreB ? 'A' : 'B']}`;
    }
    default:
      return s.overtime ? 'Sudden death' : '';
  }
}

/** The line under the phase: who scored, and who made it. */
function creditLine(s: DeepglassHudSnapshot): string {
  if (s.phase !== 'goal' || !s.scorer) return '';
  if (s.ownGoal) return `<b>${escapeHtml(s.scorer)}</b>, own goal`;
  if (s.assist) return `<b>${escapeHtml(s.scorer)}</b> &middot; assist ${escapeHtml(s.assist)}`;
  return `<b>${escapeHtml(s.scorer)}</b>`;
}

function escapeHtml(raw: string): string {
  return raw.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** Draw the strip, or take it down when `snap` is null (no live bout). */
/**
 * Repaint the hint strip from the live bindings. Composed every frame but
 * written only when it actually changes, so a rebind lands immediately without
 * the strip touching the DOM sixty times a second.
 */
function syncHint(n: Nodes): void {
  const k = readHintKeys?.() ?? FALLBACK_HINT_KEYS;
  const line = `${k.boost} burners · ${k.up}/${k.down} trim · look to aim · click to dash · ${k.brake} brakes`;
  if (line !== lastHintLine) {
    lastHintLine = line;
    n.hintKeys.textContent = line;
  }
}

export function updateDeepglassHud(snap: DeepglassHudSnapshot | null): void {
  if (!snap) {
    if (nodes) {
      nodes.root.remove();
      nodes.ball.remove();
      nodes.dead.remove();
    }
    nodes = null;
    return;
  }
  if (!nodes) {
    nodes = mount();
    // A remount starts with an EMPTY hint strip, so the change-detection cache
    // has to forget what the old (now discarded) nodes were showing or the
    // strip stays blank for the rest of the session.
    lastHintLine = '';
  }
  if (!nodes) return;

  nodes.a.textContent = String(snap.scoreA);
  nodes.b.textContent = String(snap.scoreB);
  nodes.a.classList.toggle('dg-mine', snap.team === 'A');
  nodes.b.classList.toggle('dg-mine', snap.team === 'B');
  // Sudden death has no clock left to count down, so it says so instead of
  // sitting at 0:00 while play carries on.
  nodes.clock.textContent = snap.overtime
    ? 'GOLDEN'
    : mmss(Math.max(0, snap.matchLength - snap.clock));
  nodes.clock.classList.toggle('ot', snap.overtime);
  nodes.phase.textContent = phaseLabel(snap);

  const credit = creditLine(snap);
  nodes.credit.innerHTML = credit;
  nodes.credit.classList.toggle('on', credit !== '');

  const pct = Math.round(Math.max(0, Math.min(1, snap.charge)) * 100);
  nodes.fill.style.width = `${pct}%`;
  // The bar says the same thing the burners do (PRD section 5.2): lit, flooded,
  // or spent and refusing to relight.
  nodes.boost.classList.toggle('burn', snap.boosting && !snap.overburn);
  nodes.boost.classList.toggle('over', snap.overburn);
  nodes.boost.classList.toggle('spent', !snap.boosting && pct < 12);

  const top = Math.max(1, snap.topSpeed);
  nodes.speedFill.style.width = `${Math.round(Math.min(1, snap.speed / top) * 100)}%`;
  nodes.cruiseMark.style.left = `${Math.round((snap.cruise / top) * 100)}%`;
  nodes.speed.classList.toggle('fast', snap.speed > snap.cruise * 1.05);
  nodes.speed.classList.toggle('brake', snap.braking);
  syncHint(nodes);

  nodes.dash.classList.toggle('ready', snap.dashReady);
  nodes.power.classList.toggle('held', snap.powerup !== null);
  nodes.power.classList.toggle('zap', snap.powerup === 'zap');
  nodes.power.classList.toggle('overburn', snap.powerup === 'overburn');
  nodes.power.textContent =
    snap.powerup === 'zap' ? '4 · Zap Shot' : snap.powerup === 'overburn' ? '4 · Overburn' : '';

  drawBallMark(nodes, snap.ball);
  drawDead(nodes, snap);
}

function drawDead(n: Nodes, snap: DeepglassHudSnapshot): void {
  const on = snap.dead > 0;
  n.dead.style.display = on ? 'block' : 'none';
  if (!on) return;
  const by = snap.zappedBy ? `zapped by ${snap.zappedBy} · ` : '';
  n.deadSub.textContent = `${by}back at your goal in ${snap.dead.toFixed(1)}s`;
}

function drawBallMark(n: Nodes, mark: DeepglassBallMark | null): void {
  if (!mark) {
    n.ball.style.display = 'none';
    return;
  }
  n.ball.style.display = 'block';
  n.ball.classList.toggle('edge', mark.edge);
  n.ball.style.left = `${(mark.x * 100).toFixed(2)}%`;
  n.ball.style.top = `${(mark.y * 100).toFixed(2)}%`;
  n.ballRot.style.transform = mark.edge ? `rotate(${mark.angle}rad)` : '';
  n.ballTag.textContent = `${Math.round(mark.dist)} yd`;
}
