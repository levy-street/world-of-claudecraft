import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  encodeItemLink,
  encodeQuestLink,
  isLinkableId,
  parseChatSegments,
  tryEncodeItemLink,
  tryEncodeQuestLink,
} from '../src/ui/hud/quest/quest_link';

describe('quest_link', () => {
  it('encodes a questId into a token', () => {
    expect(encodeQuestLink('q_wolves')).toBe('[[q:q_wolves]]');
  });

  it('round-trips a single link embedded in text', () => {
    const text = `Check this out ${encodeQuestLink('q_wolves')}`;
    expect(parseChatSegments(text)).toEqual([
      { kind: 'text', value: 'Check this out ' },
      { kind: 'quest', questId: 'q_wolves' },
    ]);
  });

  it('parses multiple links with text between and after', () => {
    const text = `${encodeQuestLink('q_a')} and ${encodeQuestLink('q_b')} done`;
    expect(parseChatSegments(text)).toEqual([
      { kind: 'quest', questId: 'q_a' },
      { kind: 'text', value: ' and ' },
      { kind: 'quest', questId: 'q_b' },
      { kind: 'text', value: ' done' },
    ]);
  });

  it('returns plain text unchanged when there are no links', () => {
    expect(parseChatSegments('just talking')).toEqual([{ kind: 'text', value: 'just talking' }]);
  });

  it('treats malformed/empty tokens as plain text', () => {
    expect(parseChatSegments('[[q:]] [[q]] [[x:q_a]]')).toEqual([
      { kind: 'text', value: '[[q:]] [[q]] [[x:q_a]]' },
    ]);
  });

  it('handles empty string', () => {
    expect(parseChatSegments('')).toEqual([{ kind: 'text', value: '' }]);
  });

  it('encodes an itemId into a token', () => {
    expect(encodeItemLink('sword_iron')).toBe('[[i:sword_iron]]');
  });

  it('round-trips a single item link embedded in text', () => {
    const text = `Look at ${encodeItemLink('sword_iron')}!`;
    expect(parseChatSegments(text)).toEqual([
      { kind: 'text', value: 'Look at ' },
      { kind: 'item', itemId: 'sword_iron' },
      { kind: 'text', value: '!' },
    ]);
  });

  it('parses quest and item links mixed in one message', () => {
    const text = `${encodeQuestLink('q_a')} drops ${encodeItemLink('gem_ruby')}`;
    expect(parseChatSegments(text)).toEqual([
      { kind: 'quest', questId: 'q_a' },
      { kind: 'text', value: ' drops ' },
      { kind: 'item', itemId: 'gem_ruby' },
    ]);
  });

  it('treats an unknown link prefix as plain text', () => {
    expect(parseChatSegments('[[x:foo]] [[i:]]')).toEqual([
      { kind: 'text', value: '[[x:foo]] [[i:]]' },
    ]);
  });
});

// The charset cases every agreement sweep below runs, linkable and not. Shared
// so the predicate and both guarded encoders are bound to the SAME id set: an
// arm that only saw the linkable half would pass on an always-true guard.
const CHARSET_CASES = [
  'copper_ore',
  'ARCANE_dust_2',
  '_leading_underscore',
  '9',
  'odd-id',
  'odd.id',
  'odd id',
  'odd:id',
  'odd]]id',
  '',
];

describe('isLinkableId agrees with the parser it guards (#2430)', () => {
  // isLinkableId exists so a caller building a token from CONTENT DATA (the
  // grant lines, grant_line_view.ts) can fall back to a plain name instead of
  // shipping a token the parser will not match, which reaches the player as
  // literal "[[i:...]]" source text rather than being dropped. It lives beside
  // CHAT_LINK_RE so the two cannot drift, and this binds the predicate to the
  // PARSER's actual behavior rather than to a second copy of the charset.
  const parsesAsOneItemLink = (id: string): boolean => {
    const segments = parseChatSegments(encodeItemLink(id));
    return segments.length === 1 && segments[0].kind === 'item' && segments[0].itemId === id;
  };

  it.each(CHARSET_CASES)('%o: the predicate matches what the parser does', (id) => {
    expect(isLinkableId(id)).toBe(parsesAsOneItemLink(id));
  });

  it('rejects the shapes that would otherwise print as raw source text', () => {
    // Polarity, spelled out: at least one id must be linkable and at least one
    // must not, or an always-true (or always-false) predicate would satisfy the
    // agreement sweep above vacuously.
    expect(isLinkableId('copper_ore')).toBe(true);
    expect(isLinkableId('odd-id.with punctuation')).toBe(false);
  });
});

describe('the guarded encoders return null exactly when the parser would balk (#2459)', () => {
  // tryEncode* is the form every production encode site uses, so the thing that
  // has to hold is stronger than "it agrees with isLinkableId": a non-null
  // return must ROUND-TRIP through the real parser, and a null must be the only
  // outcome for an id that would not. Binding to parseChatSegments (not to the
  // predicate) is what keeps a future charset edit from quietly widening one
  // side of the pair.
  // Whether the PARSER keeps a raw token for this id, asked of the parser
  // itself. Deliberately not a JSON-text comparison: that would be sensitive to
  // the order parseChatSegments happens to build its segment properties in, and
  // a behavior-preserving reorder there would red every case here.
  const parserKeeps = (id: string, kind: 'item' | 'quest'): boolean => {
    const segments = parseChatSegments(kind === 'item' ? encodeItemLink(id) : encodeQuestLink(id));
    return segments.length === 1 && segments[0].kind === kind;
  };

  it.each(CHARSET_CASES)('%o: tryEncodeItemLink matches the parser', (id) => {
    const token = tryEncodeItemLink(id);
    expect(token !== null).toBe(parserKeeps(id, 'item'));
    if (token !== null) expect(parseChatSegments(token)).toEqual([{ kind: 'item', itemId: id }]);
  });

  it.each(CHARSET_CASES)('%o: tryEncodeQuestLink matches the parser', (id) => {
    const token = tryEncodeQuestLink(id);
    expect(token !== null).toBe(parserKeeps(id, 'quest'));
    if (token !== null) expect(parseChatSegments(token)).toEqual([{ kind: 'quest', questId: id }]);
  });

  it('emits the same token the raw encoder does for an id it accepts', () => {
    // The guard must not change the wire shape of a link that works today, or
    // every shipped item and quest link would move.
    expect(tryEncodeItemLink('sword_iron')).toBe(encodeItemLink('sword_iron'));
    expect(tryEncodeQuestLink('q_wolves')).toBe(encodeQuestLink('q_wolves'));
  });

  it('returns null, not a doomed token, for the punctuated shapes', () => {
    // Polarity again: an always-null pair would satisfy the sweeps above only
    // if isLinkableId were also always false, but pinning both ends here means
    // neither can drift alone.
    expect(tryEncodeItemLink('odd-id.with punctuation')).toBeNull();
    expect(tryEncodeQuestLink('q-odd.quest')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The structural half of #2459: routing today's four call sites through the
// guard is worth little if the fifth one can skip it. A reviewer cannot see
// from chat_window_controller.ts that the raw encoders are off limits, so the
// rule is pinned here rather than left to the doc comment.
//
// KNOWN GAP, recorded as a ruling rather than an oversight: src/sim/loot/
// loot_roll.ts builds seven item tokens with template literals and is NOT
// covered. It cannot be: tests/architecture.test.ts forbids src/sim from
// importing src/ui, and #2459 requires the charset live in exactly one place,
// beside the parser. Moving it into src/sim to share it would trade this gap
// for a worse one (the predicate and the regex could then drift). Those ids
// come from mob loot tables, the same content-bounded exposure the client
// sites had. src/sim is therefore the ONE directory the token-construction arm
// below excludes, and it excludes nothing else: every other tree under src/ can
// import this module, so every other tree is swept.
// ---------------------------------------------------------------------------

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const QUEST_LINK_FILE = 'src/ui/hud/quest/quest_link.ts';

// Mirrors the stripComments precedent in tests/architecture.test.ts: blank
// block comments (preserving line count), then line comments, keeping the '//'
// inside a "://" URL. Load-bearing in BOTH directions here. Without it, this
// file's own prose naming the encoders would report phantom offenders, and a
// call commented out rather than deleted would keep the sweep green.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    // The generated locale bundles are ~40MB of data-as-code that can never
    // reference a function; skipping them keeps the sweep fast (the same
    // exclusion tests/i18n_extra_tables.test.ts makes).
    if (name === 'i18n.resolved.generated') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const posixRel = (file: string): string => relative(repoRoot, file).replaceAll('\\', '/');

// A reference to a RAW encoder BY NAME, wherever it appears: an import clause,
// a re-export, or `ql.encodeItemLink(...)` off a namespace import. Name-based
// rather than specifier-based on purpose: src/ui/hud/quest/index.ts re-exports
// this module with `export *`, so a scan keyed on the import path would miss
// `import { encodeItemLink } from '../quest'`. The capital E keeps the guarded
// tryEncodeItemLink / tryEncodeQuestLink from matching.
const RAW_ENCODER_RE = /\b(?:encodeItemLink|encodeQuestLink)\b/;

// A token being BUILT, which is how a call site would bypass the module
// altogether rather than by importing from it. Two ways to mint one inline: a
// template interpolation, and an id concatenated onto the prefix. Narrow on
// purpose either way, since the character after the prefix has to be `${` or a
// closing quote followed by `+`: hud.ts's `text.includes('[[i:')` READS a token
// rather than minting one and must stay allowed. What it still does not claim
// to catch is a prefix hoisted into a named constant and concatenated later.
const HAND_ROLLED_TOKEN_RE = /\[\[[qi]:(?:\$\{|['"`]\s*\+)/;

function offenders(files: string[], re: RegExp): string[] {
  const found: string[] = [];
  for (const file of files) {
    const rel = posixRel(file);
    if (rel === QUEST_LINK_FILE) continue;
    if (re.test(stripComments(readFileSync(file, 'utf8')))) found.push(rel);
  }
  return found.sort();
}

describe('no call site can encode a chat link without the charset guard (#2459)', () => {
  const srcFiles = walk(join(repoRoot, 'src'));
  // Everything the guard can actually reach: all of src minus src/sim, the one
  // gap the header records. Derived by filtering the single walk rather than by
  // listing client directories, because an allowlist would have left src/main.ts,
  // src/admin, src/guide, src/editor and src/world_api unswept and would need
  // editing again the next time a top-level client directory appears.
  const guardableFiles = srcFiles.filter((f) => !posixRel(f).startsWith('src/sim/'));

  it('actually found the trees it claims to sweep', () => {
    // A walk that silently returned nothing would make both sweeps below pass
    // for the wrong reason.
    expect(srcFiles.length).toBeGreaterThan(500);
    expect(guardableFiles.length).toBeGreaterThan(200);
    expect(srcFiles.map(posixRel)).toContain(QUEST_LINK_FILE);
    expect(guardableFiles.map(posixRel)).toContain('src/ui/hud/chat/chat_window_controller.ts');
    // The trees an allowlist of client directories would have missed.
    expect(guardableFiles.map(posixRel)).toContain('src/main.ts');
    expect(guardableFiles.map(posixRel)).toContain('src/guide/app.ts');
  });

  it('excludes src/sim from the token arm, and excludes nothing else', () => {
    // Both directions of the one documented gap. Drop the filter and the arm
    // reds on loot_roll.ts instead of on a real offender; widen it past src/sim
    // and a whole tree stops being swept with nothing to say so.
    expect(srcFiles.map(posixRel)).toContain('src/sim/loot/loot_roll.ts');
    expect(guardableFiles.map(posixRel)).not.toContain('src/sim/loot/loot_roll.ts');
    const excluded = srcFiles.filter((f) => !guardableFiles.includes(f)).map(posixRel);
    expect(excluded.every((rel) => rel.startsWith('src/sim/'))).toBe(true);
    expect(excluded.length).toBeGreaterThan(0);
  });

  it('leaves the raw encoders referenced only by the module that owns them', () => {
    expect(
      offenders(srcFiles, RAW_ENCODER_RE),
      `use tryEncodeItemLink / tryEncodeQuestLink instead: the raw encoders skip the id\n` +
        `charset check and ship literal "[[i:...]]" source text to the player`,
    ).toEqual([]);
  });

  it('lets nothing outside src/sim hand-roll a token instead of asking the encoder', () => {
    expect(
      offenders(guardableFiles, HAND_ROLLED_TOKEN_RE),
      `build chat links with tryEncodeItemLink / tryEncodeQuestLink, never by interpolating\n` +
        `or concatenating an id onto "[[i:" yourself`,
    ).toEqual([]);
  });

  it('keeps both matchers and the comment stripper sharp', () => {
    // Teeth, following tests/architecture.test.ts: a regex typo here would make
    // the two sweeps above vacuously green, and they are the whole point.
    expect(RAW_ENCODER_RE.test("import { encodeItemLink } from '../quest/quest_link';")).toBe(true);
    expect(RAW_ENCODER_RE.test("export { encodeQuestLink } from './quest_link';")).toBe(true);
    expect(RAW_ENCODER_RE.test('return ql.encodeItemLink(itemId);')).toBe(true);
    // The guarded pair must NOT trip it, or every real call site is an offender.
    expect(RAW_ENCODER_RE.test('const token = tryEncodeItemLink(itemId);')).toBe(false);
    expect(RAW_ENCODER_RE.test('const token = tryEncodeQuestLink(questId);')).toBe(false);

    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the source literally contains this template expression
    expect(HAND_ROLLED_TOKEN_RE.test('text: `Rolling for [[i:${itemId}]].`')).toBe(true);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the source literally contains this template expression
    expect(HAND_ROLLED_TOKEN_RE.test('const raw = `[[q:${questId}]]`;')).toBe(true);
    // The concatenated form mints exactly the same doomed token, in either quote.
    expect(HAND_ROLLED_TOKEN_RE.test("const raw = '[[i:' + itemId + ']]';")).toBe(true);
    expect(HAND_ROLLED_TOKEN_RE.test('const raw = "[[q:" + questId + "]]";')).toBe(true);
    // hud.ts's detection read is not a producer and must stay allowed. Neither
    // is a bare prefix constant: the arm keys on the '+' that follows the quote,
    // so a read stays green whether or not anything trails it.
    expect(HAND_ROLLED_TOKEN_RE.test("if (text.includes('[[i:')) {")).toBe(false);
    expect(HAND_ROLLED_TOKEN_RE.test("const isLink = text.startsWith('[[q:') && ok;")).toBe(false);

    // The stripper itself: a prose mention must not read as a call, and a
    // commented-out call must not hide one.
    expect(RAW_ENCODER_RE.test(stripComments('// never call encodeItemLink here'))).toBe(false);
    expect(RAW_ENCODER_RE.test(stripComments('/* encodeQuestLink is raw */'))).toBe(false);
    expect(RAW_ENCODER_RE.test(stripComments('const t = encodeItemLink(id); // raw'))).toBe(true);
    expect(stripComments("const url = 'https://example.com/a';")).toContain('https://');
  });
});
