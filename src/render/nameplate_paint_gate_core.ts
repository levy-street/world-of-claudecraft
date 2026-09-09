// The repaint gate for the ONE full-viewport nameplate canvas.
//
// The plate layer is a second full-screen surface: the painter used to clear and
// repaint all of it every frame, at min(devicePixelRatio, 2), whatever the world
// was doing. On a 1440p panel that is a full-screen clear, paint and composite
// 60 times a second for a scene whose plates often did not move a pixel. The
// per-tier cadence knob (ui_tier_knobs.nameplateIntervalSec) only throttles how
// often the CONTENT is re-resolved; the surface was repainted regardless.
//
// This is the decision half, pure and DOM-free: given the frame's viewport, the
// surface pixel ratio, a style revision, and the DECLUTTERED anchor plus drawn
// state of every plate about to be drawn, it answers whether that frame differs
// from the last one actually painted. A frame that does not differ is skipped
// whole, and a frame that does is painted in full.
//
// Fairness (docs/design/graphics-settings-fairness.md): nothing here delays or
// hides information. A plate that MOVES is different, so it repaints on the very
// frame it moves; an HP, cast, selection, threat, content or opacity change is
// different, so it repaints too. The only thing skipped is a repaint that would
// have produced the same pixels. The one bounded tolerance is sub-pixel anchor
// motion (below NAMEPLATE_ANCHOR_EPSILON_PX), which cannot change the drawn
// image: the recorded anchor is the PAINTED one, never the latest, so drift
// accumulates against it and crosses the threshold instead of being reset away.

/** Anchor motion under this many CSS pixels cannot change the drawn plate. */
export const NAMEPLATE_ANCHOR_EPSILON_PX = 0.5;

/** One badge as the gate compares it (nameplate_canvas.NameplateBadge). */
export interface NameplatePaintBadge {
  readonly url: string;
  readonly size: number;
  readonly circular?: boolean;
  readonly border?: string;
  readonly glow?: string;
}

/** One dot-row slot as the gate compares it (nameplate_dots_core.NameplateDotSlot). */
export interface NameplatePaintDotSlot {
  readonly iconUrl: string;
  readonly school: string;
  readonly fraction: number;
  readonly remaining: number;
  readonly duration: number;
  readonly timeText: string;
}

/** The drawn dot-row plan as the gate compares it (nameplate_dots_core.NameplateDotsPlan). */
export interface NameplatePaintDots {
  readonly slots: readonly NameplatePaintDotSlot[];
  readonly count: number;
  readonly scale: number;
}

/** Every field of a plate's canvas state the drawing code reads. Structural on
 *  purpose: nameplate_canvas.NameplateCanvasState satisfies it, and this module
 *  never imports that DOM-bound file. Adding a drawn field to the state means
 *  adding it here, or a change to it will not repaint. */
export interface NameplatePaintFields {
  readonly name: string;
  readonly nameColor: string;
  readonly level: string;
  readonly levelColor: string;
  readonly guild: string;
  readonly guildLabel: string;
  readonly guildTier: number;
  readonly title: string;
  readonly border: string;
  readonly marker: string;
  readonly markerTone: string;
  readonly hpVisible: boolean;
  readonly hpFill: number;
  readonly castVisible: boolean;
  readonly castFill: number;
  readonly castChannel: boolean;
  readonly castLabel: string;
  readonly currentTarget: boolean;
  readonly hostile: boolean;
  readonly deadEnemy: boolean;
  readonly myPet: boolean;
  readonly friendlyPet: boolean;
  readonly threat: boolean;
  readonly opacity: number;
  readonly frame: string;
  readonly comboPips: number;
  readonly dots: NameplatePaintDots;
  readonly aiLabel: string;
  readonly cheaterLabel: string;
  readonly devOutline: string | null;
  readonly badges: readonly NameplatePaintBadge[];
  readonly raidMarkerUrl: string;
  readonly emoteIconUrl: string;
  readonly emoteLabel: string;
}

interface PlateRecord {
  pass: number;
  sx: number;
  sy: number;
  name: string;
  nameColor: string;
  level: string;
  levelColor: string;
  guild: string;
  guildLabel: string;
  guildTier: number;
  title: string;
  border: string;
  marker: string;
  markerTone: string;
  hpVisible: boolean;
  hpFill: number;
  castVisible: boolean;
  castFill: number;
  castChannel: boolean;
  castLabel: string;
  currentTarget: boolean;
  hostile: boolean;
  deadEnemy: boolean;
  myPet: boolean;
  friendlyPet: boolean;
  threat: boolean;
  opacity: number;
  frame: string;
  comboPips: number;
  dotCount: number;
  dotScale: number;
  dotIconUrls: string[];
  dotSchools: string[];
  dotFractions: number[];
  dotRemaining: number[];
  dotDurations: number[];
  dotTimeTexts: string[];
  aiLabel: string;
  cheaterLabel: string;
  devOutline: string | null;
  raidMarkerUrl: string;
  emoteIconUrl: string;
  emoteLabel: string;
  badgeCount: number;
  badgeUrls: string[];
  badgeSizes: number[];
  badgeCircular: boolean[];
  badgeBorders: (string | undefined)[];
  badgeGlows: (string | undefined)[];
}

function badgesDiffer(record: PlateRecord, badges: readonly NameplatePaintBadge[]): boolean {
  if (record.badgeCount !== badges.length) return true;
  for (let i = 0; i < badges.length; i++) {
    const badge = badges[i];
    if (
      record.badgeUrls[i] !== badge.url ||
      record.badgeSizes[i] !== badge.size ||
      record.badgeCircular[i] !== (badge.circular === true) ||
      record.badgeBorders[i] !== badge.border ||
      record.badgeGlows[i] !== badge.glow
    ) {
      return true;
    }
  }
  return false;
}

function dotsDiffer(record: PlateRecord, dots: NameplatePaintDots): boolean {
  if (record.dotCount !== dots.count || record.dotScale !== dots.scale) return true;
  for (let i = 0; i < dots.count; i++) {
    const slot = dots.slots[i];
    if (
      record.dotIconUrls[i] !== slot.iconUrl ||
      record.dotSchools[i] !== slot.school ||
      record.dotFractions[i] !== slot.fraction ||
      record.dotRemaining[i] !== slot.remaining ||
      record.dotDurations[i] !== slot.duration ||
      record.dotTimeTexts[i] !== slot.timeText
    ) {
      return true;
    }
  }
  return false;
}

function plateDiffers(
  record: PlateRecord,
  sx: number,
  sy: number,
  f: NameplatePaintFields,
): boolean {
  return (
    Math.abs(record.sx - sx) >= NAMEPLATE_ANCHOR_EPSILON_PX ||
    Math.abs(record.sy - sy) >= NAMEPLATE_ANCHOR_EPSILON_PX ||
    record.name !== f.name ||
    record.nameColor !== f.nameColor ||
    record.level !== f.level ||
    record.levelColor !== f.levelColor ||
    record.guild !== f.guild ||
    record.guildLabel !== f.guildLabel ||
    record.guildTier !== f.guildTier ||
    record.title !== f.title ||
    record.border !== f.border ||
    record.marker !== f.marker ||
    record.markerTone !== f.markerTone ||
    record.hpVisible !== f.hpVisible ||
    record.hpFill !== f.hpFill ||
    record.castVisible !== f.castVisible ||
    record.castFill !== f.castFill ||
    record.castChannel !== f.castChannel ||
    record.castLabel !== f.castLabel ||
    record.currentTarget !== f.currentTarget ||
    record.hostile !== f.hostile ||
    record.deadEnemy !== f.deadEnemy ||
    record.myPet !== f.myPet ||
    record.friendlyPet !== f.friendlyPet ||
    record.threat !== f.threat ||
    record.opacity !== f.opacity ||
    record.frame !== f.frame ||
    record.comboPips !== f.comboPips ||
    dotsDiffer(record, f.dots) ||
    record.aiLabel !== f.aiLabel ||
    record.cheaterLabel !== f.cheaterLabel ||
    record.devOutline !== f.devOutline ||
    record.raidMarkerUrl !== f.raidMarkerUrl ||
    record.emoteIconUrl !== f.emoteIconUrl ||
    record.emoteLabel !== f.emoteLabel ||
    badgesDiffer(record, f.badges)
  );
}

function writePlate(
  record: PlateRecord,
  pass: number,
  sx: number,
  sy: number,
  f: NameplatePaintFields,
): void {
  record.pass = pass;
  record.sx = sx;
  record.sy = sy;
  record.name = f.name;
  record.nameColor = f.nameColor;
  record.level = f.level;
  record.levelColor = f.levelColor;
  record.guild = f.guild;
  record.guildLabel = f.guildLabel;
  record.guildTier = f.guildTier;
  record.title = f.title;
  record.border = f.border;
  record.marker = f.marker;
  record.markerTone = f.markerTone;
  record.hpVisible = f.hpVisible;
  record.hpFill = f.hpFill;
  record.castVisible = f.castVisible;
  record.castFill = f.castFill;
  record.castChannel = f.castChannel;
  record.castLabel = f.castLabel;
  record.currentTarget = f.currentTarget;
  record.hostile = f.hostile;
  record.deadEnemy = f.deadEnemy;
  record.myPet = f.myPet;
  record.friendlyPet = f.friendlyPet;
  record.threat = f.threat;
  record.opacity = f.opacity;
  record.frame = f.frame;
  record.comboPips = f.comboPips;
  record.dotCount = f.dots.count;
  record.dotScale = f.dots.scale;
  for (let i = 0; i < f.dots.count; i++) {
    const slot = f.dots.slots[i];
    record.dotIconUrls[i] = slot.iconUrl;
    record.dotSchools[i] = slot.school;
    record.dotFractions[i] = slot.fraction;
    record.dotRemaining[i] = slot.remaining;
    record.dotDurations[i] = slot.duration;
    record.dotTimeTexts[i] = slot.timeText;
  }
  record.aiLabel = f.aiLabel;
  record.cheaterLabel = f.cheaterLabel;
  record.devOutline = f.devOutline;
  record.raidMarkerUrl = f.raidMarkerUrl;
  record.emoteIconUrl = f.emoteIconUrl;
  record.emoteLabel = f.emoteLabel;
  record.badgeCount = f.badges.length;
  for (let i = 0; i < f.badges.length; i++) {
    const badge = f.badges[i];
    record.badgeUrls[i] = badge.url;
    record.badgeSizes[i] = badge.size;
    record.badgeCircular[i] = badge.circular === true;
    record.badgeBorders[i] = badge.border;
    record.badgeGlows[i] = badge.glow;
  }
}

function newRecord(): PlateRecord {
  return {
    pass: -1,
    sx: Number.NaN,
    sy: Number.NaN,
    name: '',
    nameColor: '',
    level: '',
    levelColor: '',
    guild: '',
    guildLabel: '',
    guildTier: 0,
    title: '',
    border: '',
    marker: '',
    markerTone: '',
    hpVisible: false,
    hpFill: 0,
    castVisible: false,
    castFill: 0,
    castChannel: false,
    castLabel: '',
    currentTarget: false,
    hostile: false,
    deadEnemy: false,
    myPet: false,
    friendlyPet: false,
    threat: false,
    opacity: 0,
    frame: '',
    comboPips: 0,
    dotCount: -1,
    dotScale: 1,
    dotIconUrls: [],
    dotSchools: [],
    dotFractions: [],
    dotRemaining: [],
    dotDurations: [],
    dotTimeTexts: [],
    aiLabel: '',
    cheaterLabel: '',
    devOutline: null,
    raidMarkerUrl: '',
    emoteIconUrl: '',
    emoteLabel: '',
    badgeCount: -1,
    badgeUrls: [],
    badgeSizes: [],
    badgeCircular: [],
    badgeBorders: [],
    badgeGlows: [],
  };
}

/**
 * Frame-to-frame difference detector for the nameplate surface. Allocation-free
 * in the steady state: the per-plate records and the pending scratch are reused,
 * and only a plate that appears for the first time mints a record.
 *
 * Usage per pass: `beginPass`, then one `notePlate` per plate in DRAW order
 * (post-declutter, since decluttering is what moves an anchor), then
 * `needsPaint()`. Call `commit()` only on a pass that actually painted, so the
 * records always describe the pixels currently on screen.
 */
export class NameplatePaintGate {
  private readonly records = new Map<number, PlateRecord>();
  private readonly pendingIds: number[] = [];
  private readonly pendingX: number[] = [];
  private readonly pendingY: number[] = [];
  private readonly pendingFields: (NameplatePaintFields | null)[] = [];
  private pendingCount = 0;
  private pass = 0;
  private width = Number.NaN;
  private height = Number.NaN;
  private pixelRatio = Number.NaN;
  private styleRevision = -1;
  private changed = true;

  /** Open a pass. A viewport, surface-pixel-ratio or style-revision change (a
   *  font load, a forced-colors flip, a language switch) repaints on its own. */
  beginPass(width: number, height: number, pixelRatio: number, styleRevision: number): void {
    this.pass++;
    this.pendingCount = 0;
    this.changed =
      width !== this.width ||
      height !== this.height ||
      pixelRatio !== this.pixelRatio ||
      styleRevision !== this.styleRevision;
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    this.styleRevision = styleRevision;
  }

  /** Record one plate about to be drawn, at its final (decluttered) anchor. */
  notePlate(id: number, sx: number, sy: number, fields: NameplatePaintFields): void {
    const index = this.pendingCount++;
    this.pendingIds[index] = id;
    this.pendingX[index] = sx;
    this.pendingY[index] = sy;
    this.pendingFields[index] = fields;
    if (this.changed) return;
    const record = this.records.get(id);
    if (!record || plateDiffers(record, sx, sy, fields)) this.changed = true;
  }

  /** Whether this pass must repaint the surface. A plate that vanished shows up
   *  as a count mismatch: every noted plate matched a record, so equal counts
   *  and no per-plate difference means the exact same set. */
  needsPaint(): boolean {
    return this.changed || this.pendingCount !== this.records.size;
  }

  /** Adopt this pass as the painted one. Only call it after painting. */
  commit(): void {
    for (let i = 0; i < this.pendingCount; i++) {
      const id = this.pendingIds[i];
      const fields = this.pendingFields[i];
      if (!fields) continue;
      let record = this.records.get(id);
      if (!record) {
        record = newRecord();
        this.records.set(id, record);
      }
      writePlate(record, this.pass, this.pendingX[i], this.pendingY[i], fields);
    }
    for (const [id, record] of this.records) {
      if (record.pass !== this.pass) this.records.delete(id);
    }
    for (let i = 0; i < this.pendingCount; i++) this.pendingFields[i] = null;
    this.changed = false;
  }

  /** Force the next pass to repaint (a surface reset, a disposal, a rebuild). */
  invalidate(): void {
    this.records.clear();
    this.changed = true;
    this.width = Number.NaN;
    this.height = Number.NaN;
    this.pixelRatio = Number.NaN;
    this.styleRevision = -1;
  }
}
