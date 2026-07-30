export interface ContactSheetRenderedFrame {
  readonly file: string;
  readonly targetTime: number;
  readonly measuredTime: number | null;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly reasons: readonly string[];
  readonly expectedSubjects: readonly string[];
  readonly expectedTextKeys: readonly string[];
}

export interface ContactSheetHtmlInput {
  readonly sceneId: string;
  readonly seed: string | number;
  readonly frames: readonly ContactSheetRenderedFrame[];
}

export function renderContactSheetHtml(input: ContactSheetHtmlInput): string;
