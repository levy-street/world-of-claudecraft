// Type declarations for the CommonJS shell-guard helpers (electron/shell_guards.cjs),
// which electron/main.cjs consumes at runtime and tests/electron_shell_guards.test.ts
// exercises directly. main.cjs itself runs outside tsc; these types serve the test.

export function deriveOrigin(urlString: string): string | null;
export function originAllowed(urlString: string, allowedOrigins: Iterable<string>): boolean;
export function appNavigationOrigins(
  appOrigin: string,
  devServerUrl: string | undefined,
): Set<string>;
export function navigationAllowed(
  url: string,
  isMainFrame: boolean,
  mainFrameOrigins: Iterable<string>,
  subframeOrigins?: Iterable<string>,
): boolean;
export function isTrustedSender(
  frame: { origin?: unknown; url?: unknown } | null | undefined,
  allowedOrigins: Iterable<string>,
): boolean;
export function isDevToolsToggleShortcut(
  input:
    | {
        type?: unknown;
        key?: unknown;
        code?: unknown;
        shift?: unknown;
        control?: unknown;
        alt?: unknown;
        meta?: unknown;
      }
    | null
    | undefined,
): boolean;
export function isSoftwareRenderer(
  status: { webgl?: unknown; webgl2?: unknown } | null | undefined,
): boolean;
export const ALLOWED_PERMISSIONS: Set<string>;
export const EMBEDDED_SUBFRAME_ORIGINS: Set<string>;
export const CSP_ORIGINS: {
  script: string[];
  connect: string[];
  img: string[];
  turnstile: string;
  fontsStyle: string;
  fontsFile: string;
};
export function extractInlineScriptHashes(html: string): string[];
export function buildContentSecurityPolicy(options?: {
  apiOrigin?: string;
  scriptHashes?: string[];
}): string;
export function withCspHeader(response: Response, csp: string): Response;
