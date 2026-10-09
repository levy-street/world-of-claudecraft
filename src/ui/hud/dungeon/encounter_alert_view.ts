// The shared encounter alert family's view contract: the shape every
// dungeon's pure alert view (wildheart_alert_view.ts, sanctum_alert_view.ts)
// hands the one painter (encounter_alert_painter.ts). Each view narrows `kind`
// to its own kind list. Pure and DOM-free.

export interface EncounterAlertLive {
  visible: true;
  kind: string;
  title: string;
  line: string;
  /** The second line ('' when none). */
  hint: string;
  /** The key the hint names ('' on touch, when unbound, or no hint). */
  key: string;
  /** 0 to 1, or null when this alert carries no bar. */
  progress: number | null;
  progressAria: string;
  /** The words printed on the bar ('' when none). */
  barLabel?: string;
  /** A tap or click on the panel is an interact press. */
  pressable: boolean;
  buttonAria: string;
}

export interface EncounterAlertHidden {
  visible: false;
}

/** A painted alert: any family member's view. */
export type EncounterAlertView = EncounterAlertLive | EncounterAlertHidden;
