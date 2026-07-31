/** Pure transform: three's vendored basis transcoder source in, the shipped
 *  eval-free (CSP-safe) source out. Throws when an embind site is missing or
 *  ambiguous, a dynamic-code marker survives, or the output does not parse. */
export declare function patchBasisTranscoderSource(source: string): string;

/** Behavior-shaped scan for dynamic-code use of the Function constructor. */
export declare const DYNAMIC_FUNCTION_CALL: RegExp;

/** Any eval reference at all (direct, indirect, or property form). */
export declare const EVAL_REFERENCE: RegExp;

/** Strip the WoC banner comment so the scans see only transcoder code. */
export declare function withoutBanner(source: string): string;

/** Path segments (join from the repo root) shared by the CLI and pin tests. */
export declare const VENDORED_TRANSCODER_DIR: readonly string[];
export declare const SHIPPED_TRANSCODER_DIR: readonly string[];
