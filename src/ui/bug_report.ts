// Pure, host-agnostic helper for the bug-report feature so the metadata assembly
// is unit-testable without a DOM. The thin consumer is the hud form; the
// screenshot scaling math lives in src/render/screenshot.ts.

export interface BugReportMetaInput {
  build?: string;
  userAgent?: string;
  viewport?: { w: number; h: number; dpr?: number };
  zone?: string;
  level?: number;
  className?: string;
  cameraYaw?: number;
}

export interface BugReportMeta {
  build: string;
  userAgent: string;
  viewport: { w: number; h: number; dpr: number };
  zone: string;
  level: number;
  className: string;
  cameraYaw: number;
}

const STR_MAX = 512;

function clampStr(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, STR_MAX) : '';
}

function clampNum(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Build the auto-collected "anything else useful" metadata object stored as JSONB
// alongside the report. Clamps strings and coerces non-finite numbers so the
// payload is always well-formed regardless of what the caller scraped.
export function assembleBugReportMeta(input: BugReportMetaInput): BugReportMeta {
  return {
    build: clampStr(input.build),
    userAgent: clampStr(input.userAgent),
    viewport: {
      w: clampNum(input.viewport?.w),
      h: clampNum(input.viewport?.h),
      dpr: clampNum(input.viewport?.dpr) || 1,
    },
    zone: clampStr(input.zone),
    level: clampNum(input.level),
    className: clampStr(input.className),
    cameraYaw: clampNum(input.cameraYaw),
  };
}
