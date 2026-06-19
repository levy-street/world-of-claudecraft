// `naughty-words` (the LDNOOBW "List of Dirty, Naughty, Obscene, and Otherwise
// Bad Words") ships no types: its CommonJS index aggregates per-language JSON
// arrays keyed by ISO-639-1 code.
declare module 'naughty-words' {
  const words: Record<string, string[]>;
  export default words;
}
