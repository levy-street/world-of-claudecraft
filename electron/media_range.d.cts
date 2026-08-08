// Type declarations for the CommonJS byte-range helpers (electron/media_range.cjs),
// which electron/main.cjs consumes at runtime and tests/electron_media_range.test.ts
// exercises directly. main.cjs itself runs outside tsc; these types serve the test.

export interface ByteRange {
  start: number;
  end: number;
}

export function isUnsatisfiableRange(rangeValue: unknown, size: number): boolean;
export function parseByteRange(rangeValue: unknown, size: number): ByteRange | null;
export function rangeContentType(filePath: string): string | null;
export function rangeResponseHeaders(
  range: ByteRange,
  size: number,
  contentType: string,
): Record<string, string>;
export function rangedFileResponse(
  filePath: string,
  rangeValue: string,
  extraHeaders?: Record<string, string>,
): Promise<Response | null>;
