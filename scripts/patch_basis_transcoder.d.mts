/** Pure transform: three's vendored basis transcoder source in, the shipped
 *  eval-free (CSP-safe) source out. Throws when an embind site is missing or a
 *  dynamic-code marker survives. */
export declare function patchBasisTranscoderSource(source: string): string;
