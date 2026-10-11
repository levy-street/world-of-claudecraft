// The Node side of the shader harvest: turns what the page hook drained into
// the corpus the Windows compile bench reads. Pure (no fs, no browser), so
// tests/shader_harvest_corpus.test.ts imports it directly.
//
// Identity is a hash of the TEXT, never three's program cache key: terrain,
// far terrain and the blade carpet bake JS values into their GLSL under one
// key, and the global ShaderChunk patches change every program's text under
// every key. A program is (vertex text, fragment text, location-0 attribute);
// a shader is one text. The bench prices shaders, the report ranks programs.

import { createHash } from 'node:crypto';

export function textHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function programHash(vertex, fragment, index0) {
  return textHash(`${vertex}\u0000${fragment}\u0000${index0}`);
}

/** The lighting model a three built-in declares at the top of its fragment. */
export function materialKindOf(fragment) {
  return (
    /#define (STANDARD|PHYSICAL|LAMBERT|PHONG|TOON|MATCAP|DEPTH_PACKING|DISTANCE)\b/.exec(
      fragment,
    )?.[1] ?? ''
  );
}

/** three writes `#define SHADER_NAME <name>` into both stages. */
export function shaderNameOf(text) {
  return /#define SHADER_NAME (\S+)/.exec(text)?.[1] ?? '';
}

export function createCorpus() {
  return { programs: new Map(), shaders: new Map(), byPageKey: new Map() };
}

/**
 * Fold one profile's drain into the corpus. `drain` is the page hook's
 * `drain()` result; `profile` tags where each program was met. Returns the
 * count of programs the corpus had never seen under any profile.
 */
export function foldDrain(corpus, profile, drain) {
  let added = 0;
  const pageKeys = corpus.byPageKey.get(profile) ?? new Map();
  corpus.byPageKey.set(profile, pageKeys);
  for (const p of drain.programs) {
    const hash = programHash(p.vertex, p.fragment, p.index0);
    pageKeys.set(p.key, hash);
    const vertexHash = textHash(p.vertex);
    const fragmentHash = textHash(p.fragment);
    if (!corpus.shaders.has(vertexHash))
      corpus.shaders.set(vertexHash, { hash: vertexHash, stage: 'vert', text: p.vertex });
    if (!corpus.shaders.has(fragmentHash))
      corpus.shaders.set(fragmentHash, { hash: fragmentHash, stage: 'frag', text: p.fragment });
    if (!corpus.programs.has(hash)) {
      added += 1;
      corpus.programs.set(hash, {
        hash,
        name: shaderNameOf(p.fragment) || shaderNameOf(p.vertex),
        kind: materialKindOf(p.fragment),
        vertexHash,
        fragmentHash,
        index0: p.index0,
        seen: {},
      });
    }
  }
  for (const m of drain.meta) {
    const hash = pageKeys.get(m.key);
    const program = hash ? corpus.programs.get(hash) : null;
    if (!program) continue;
    program.seen[profile] = { links: m.links, steps: m.steps, contexts: m.contexts };
  }
  return added;
}

/** The JSON index written beside the shader files. */
export function corpusIndex(corpus, header) {
  const programs = [...corpus.programs.values()].sort((a, b) => a.hash.localeCompare(b.hash));
  const shaders = [...corpus.shaders.values()]
    .map((s) => ({ hash: s.hash, stage: s.stage, bytes: Buffer.byteLength(s.text) }))
    .sort((a, b) => a.hash.localeCompare(b.hash));
  return {
    ...header,
    programCount: programs.length,
    shaderCount: shaders.length,
    programs,
    shaders,
  };
}

/**
 * The static completeness check: every authored shader site must leave a
 * token of ITS OWN in at least one harvested text. `sites` is
 * [{ file, tokens }]. A token several files declare (uTime, uColor) proves
 * nothing about any of them, so only tokens unique to one file count:
 * `unseen` lists the files whose own tokens were never harvested (named
 * holes), `undetermined` the files that declare no token of their own.
 */
export function classifySites(corpus, sites) {
  const owners = new Map();
  for (const site of sites) {
    for (const token of site.tokens) owners.set(token, (owners.get(token) ?? 0) + 1);
  }
  const texts = [...corpus.shaders.values()].map((s) => s.text);
  const seen = [];
  const unseen = [];
  const undetermined = [];
  for (const site of sites) {
    const own = site.tokens.filter((token) => owners.get(token) === 1);
    if (!own.length) {
      if (site.tokens.length) undetermined.push({ ...site, own });
      continue;
    }
    const hit = own.some((token) => texts.some((text) => text.includes(token)));
    (hit ? seen : unseen).push({ ...site, own });
  }
  return { seen, unseen, undetermined };
}

/**
 * Distinctive tokens of one source file: the uniform, varying and attribute
 * names it declares inside GLSL strings. three's own names are dropped so a
 * stock material never counts as a sighting of our file.
 */
export function shaderTokensOf(source) {
  const tokens = new Set();
  // The trailing `;` or `[` keeps prose out: a comment saying "in their own"
  // is not a declaration.
  const re =
    /\b(?:uniform|varying|attribute|in|out)\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+(\w+)\s*[;[]/g;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    if (THREE_STOCK_NAMES.has(name)) continue;
    if (name.length < 5) continue;
    tokens.add(name);
  }
  return [...tokens];
}

const THREE_STOCK_NAMES = new Set([
  'position',
  'normal',
  'color',
  'diffuse',
  'opacity',
  'emissive',
  'roughness',
  'metalness',
  'modelMatrix',
  'viewMatrix',
  'projectionMatrix',
  'modelViewMatrix',
  'normalMatrix',
  'cameraPosition',
  'instanceMatrix',
  'instanceColor',
  'vColor',
  'vNormal',
  'vViewPosition',
  'vWorldPosition',
  'tDiffuse',
  'resolution',
]);
