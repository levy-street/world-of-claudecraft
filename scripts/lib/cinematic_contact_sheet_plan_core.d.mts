export interface ContactSheetShot {
  readonly kind: string;
  readonly subjectRef?: string;
  readonly target?: string;
  readonly actorId?: string;
  readonly lookAt?: { readonly kind: string; readonly actorId?: string };
}

export type ContactSheetTimelineOp = {
  readonly at: number;
  readonly kind: string;
  readonly shot?: ContactSheetShot;
  readonly key?: string;
  readonly dur?: number;
  readonly speakerActorId?: string;
  readonly target?: string;
  readonly cue?: string;
};

export interface ContactSheetPlanInput {
  readonly sceneId: string;
  readonly seed: string | number;
  readonly duration: number;
  readonly ops: readonly ContactSheetTimelineOp[];
}

export interface ContactSheetStillPlan {
  readonly index: number;
  readonly file: string;
  readonly targetTime: number;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly reasons: readonly string[];
  readonly expectedSubjects: readonly string[];
  readonly expectedTextKeys: readonly string[];
}

export interface ContactSheetPlan {
  readonly sceneId: string;
  readonly seed: string | number;
  readonly duration: number;
  readonly stills: readonly ContactSheetStillPlan[];
}

export function contactSheetIntentAt(
  timeline: readonly ContactSheetTimelineOp[],
  time: number,
): Pick<ContactSheetStillPlan, 'expectedSubjects' | 'expectedTextKeys'>;
export function formatContactSheetSeconds(seconds: number): string;
export function planContactSheet(input: ContactSheetPlanInput): ContactSheetPlan;
