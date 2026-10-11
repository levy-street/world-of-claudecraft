import type { ReferralCardsAction, ReferralCardsSnapshot } from '../../../sim/referral_contract';

export type {
  ReferralCardsAction,
  ReferralCardsSnapshot,
  ReferralLinkActionPayload,
  ReferralLinkSnapshot,
  ReferralNotice,
  ReferralUiReason,
} from '../../../sim/referral_contract';

export interface ReferralCardsHost {
  root: HTMLElement;
  launcher: HTMLButtonElement;
  extraLaunchers?: readonly HTMLButtonElement[];
  promptStack: HTMLElement;
  getSnapshot(): ReferralCardsSnapshot | null;
  send(action: ReferralCardsAction): void;
  beforeOpen?(): void;
  onSnapshotChange?(): void;
  /** Parent owns the shared FocusManager and cross-window coordination. */
  focusWindow(selector: string): void;
  onClose(): void;
}
