// Shader ablation corpus: prices ONE ingredient of a program at a time.
//
// The Windows link bench showed the compile cost moving in steps (Lambert,
// Standard, Standard with shadows and reflections, Standard with the worn stone
// layer) without saying which ingredient owns each step. This script takes a
// harvested corpus, samples Standard programs of one profile, and writes a new
// corpus holding each sampled program as a baseline plus one text-level variant
// per ablation (scripts/lib/shader_ablation_transforms.mjs). The link bench runs
// on it unchanged and its report pairs every variant with its own baseline.
//
//   node scripts/shader_ablation_corpus.mjs --corpus tmp/shader-harvest-<id>
//   node scripts/shader_link_bench.mjs --corpus tmp/shader-harvest-<id>/ablation
//
// Flags: --corpus <dir> (required), --profile <name> (default ultra),
// --sample <n> (programs per group, default 40), --out <dir> (default
// <corpus>/ablation).

import fs from 'node:fs';
import path from 'node:path';
import { ABLATIONS, pickPrograms } from './lib/shader_ablation_transforms.mjs';
import { textHash } from './lib/shader_harvest_corpus.mjs';

function parseArgs(argv) {
  const args = { corpus: null, profile: 'ultra', sample: 40, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--corpus') args.corpus = next();
    else if (a === '--profile') args.profile = next();
    else if (a === '--sample') args.sample = Number(next());
    else if (a === '--out') args.out = next();
    else throw new Error(`unknown flag ${a}`);
  }
  if (!args.corpus) throw new Error('--corpus <dir> is required');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpusDir = path.resolve(args.corpus);
  const outDir = args.out ? path.resolve(args.out) : path.join(corpusDir, 'ablation');
  const corpus = JSON.parse(fs.readFileSync(path.join(corpusDir, 'corpus.json'), 'utf8'));
  const read = (hash, stage) =>
    fs.readFileSync(path.join(corpusDir, 'shaders', `${hash}.${stage}.glsl`), 'utf8');
  const standard = corpus.programs.filter((p) => p.kind === 'STANDARD' && p.seen?.[args.profile]);
  const isWorn = (p) => read(p.fragmentHash, 'frag').includes('float wornTriR(');
  const groups = [
    ...pickPrograms(standard, isWorn, args.sample).map((p) => ({ p, group: 'worn' })),
    ...pickPrograms(standard, (p) => !isWorn(p), args.sample).map((p) => ({ p, group: 'plain' })),
  ];

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'shaders'), { recursive: true });
  const written = new Set();
  const write = (text, stage) => {
    const hash = textHash(text);
    if (!written.has(`${hash}.${stage}`)) {
      fs.writeFileSync(path.join(outDir, 'shaders', `${hash}.${stage}.glsl`), text);
      written.add(`${hash}.${stage}`);
    }
    return hash;
  };
  const programs = [];
  const counts = {};
  for (const { p, group } of groups) {
    const source = { vertex: read(p.vertexHash, 'vert'), fragment: read(p.fragmentHash, 'frag') };
    const variants = [['baseline', source]];
    for (const [name, transform] of Object.entries(ABLATIONS)) {
      const out = transform(source);
      if (out) variants.push([name, out]);
    }
    for (const [variant, texts] of variants) {
      counts[variant] = (counts[variant] ?? 0) + 1;
      programs.push({
        hash: `${p.hash}-${variant}`,
        base: p.hash,
        variant,
        group,
        name: p.name,
        kind: variant,
        vertexHash: write(texts.vertex, 'vert'),
        fragmentHash: write(texts.fragment, 'frag'),
        index0: p.index0,
        seen: { [args.profile]: p.seen[args.profile] },
      });
    }
  }
  const index = {
    gitSha: corpus.gitSha,
    createdAt: new Date().toISOString(),
    ablationOf: path.basename(corpusDir),
    profile: args.profile,
    runs: corpus.runs,
    programCount: programs.length,
    shaderCount: written.size,
    programs,
  };
  fs.writeFileSync(path.join(outDir, 'corpus.json'), JSON.stringify(index, null, 1));
  process.stdout.write(`ablation corpus: ${programs.length} programs in ${outDir}\n`);
  for (const [variant, n] of Object.entries(counts)) process.stdout.write(`  ${variant}: ${n}\n`);
}

main();
