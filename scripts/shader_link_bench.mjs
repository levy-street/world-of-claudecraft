// Shader link bench: what ONE cold link of each harvested program costs on THIS
// machine's real WebGL backend, measured in the browser that pays it.
//
// Input: a corpus folder written by scripts/shader_harvest.mjs. For every
// program, a scratch WebGL2 context (the corpus context's attributes and
// extension list, because both shape ANGLE's translation and the browser's
// program key) compiles the two texts, links, and blocks on LINK_STATUS, so
// the wall time is the whole job the player waits for: GLSL to backend source
// (HLSL on Windows D3D11), the backend compile of both stages, the link, the
// driver. Programs run one at a time, never in parallel.
//
// Every repetition salts both texts with a unique trailing comment. The
// browser's program cache and ANGLE's blob cache key on the source text, so a
// salted program is always a miss there. The GPU DRIVER's own cache sits after
// the backend compile and may still hit on a repeat (the compiled bytecode is
// identical), so the report keeps the first repetition apart from the later
// ones: the gap between them is the driver's share, the later ones are the
// backend compile alone.
//
//   node scripts/shader_link_bench.mjs --corpus tmp/shader-harvest-<id>
//   node scripts/shader_link_bench.mjs --corpus <dir> --angle d3d11 --reps 3
//
// Flags: --corpus <dir> (required), --reps <n> (default 3), --limit <n> (first n
// programs, a smoke), --angle <backend>, --headless, --port <n> (default 5189),
// --out <dir> (default <corpus>/link-bench-<id>), --draw (after each link, draw
// one triangle with the program and read a pixel back, timed apart: a backend
// that defers work past LINK_STATUS, ANGLE Vulkan's pipeline creation or ANGLE
// D3D11's draw-time variants, pays it there, and a link-only figure hides it). BROWSER_PATH overrides the
// browser. Runs on Windows, Linux and macOS; no dev server, no game.
//
// Output: results.json (every timing, link status, the GL strings of the
// machine) and report.md (distribution, ranked programs, share held by the top
// of the ranking). Pure report logic: scripts/lib/shader_link_bench_report.mjs.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findBrowserPath } from './browser_path_resolve.mjs';
import { renderLinkBenchReport } from './lib/shader_link_bench_report.mjs';

function parseArgs(argv) {
  const args = {
    corpus: null,
    reps: 3,
    limit: 0,
    angle: null,
    headless: false,
    port: 5189,
    out: null,
    draw: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--corpus') args.corpus = next();
    else if (a === '--reps') args.reps = Number(next());
    else if (a === '--limit') args.limit = Number(next());
    else if (a === '--angle') args.angle = next();
    else if (a === '--headless') args.headless = true;
    else if (a === '--port') args.port = Number(next());
    else if (a === '--out') args.out = next();
    else if (a === '--draw') args.draw = true;
    else throw new Error(`unknown flag ${a}`);
  }
  if (!args.corpus) throw new Error('--corpus <dir> is required');
  return args;
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>shader link bench</title>
<body style="font:14px monospace;background:#111;color:#ddd"><pre id="log">starting</pre>`;

function serveCorpus(corpusDir, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE);
      return;
    }
    const file = path.normalize(path.join(corpusDir, url.pathname));
    if (!file.startsWith(path.resolve(corpusDir)) || !fs.existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// Runs in the page. One program, `reps` salted cold links, each on the shared
// scratch context.
async function benchProgram({ program, reps, runId, contextAttributes, extensions, draw }) {
  if (!window.__linkBench) window.__linkBench = {};
  const state = window.__linkBench;
  if (!state.gl) {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const gl = canvas.getContext('webgl2', contextAttributes ?? undefined);
    if (!gl) return { error: 'no webgl2 context' };
    for (const name of extensions ?? []) gl.getExtension(name);
    state.gl = gl;
    state.texts = new Map();
    state.pixel = new Uint8Array(4);
    state.samplerTypes = new Set([
      gl.SAMPLER_2D,
      gl.SAMPLER_3D,
      gl.SAMPLER_CUBE,
      gl.SAMPLER_2D_SHADOW,
      gl.SAMPLER_2D_ARRAY,
      gl.SAMPLER_2D_ARRAY_SHADOW,
      gl.SAMPLER_CUBE_SHADOW,
      gl.INT_SAMPLER_2D,
      gl.INT_SAMPLER_3D,
      gl.INT_SAMPLER_CUBE,
      gl.INT_SAMPLER_2D_ARRAY,
      gl.UNSIGNED_INT_SAMPLER_2D,
      gl.UNSIGNED_INT_SAMPLER_3D,
      gl.UNSIGNED_INT_SAMPLER_CUBE,
      gl.UNSIGNED_INT_SAMPLER_2D_ARRAY,
    ]);
  }
  const gl = state.gl;
  if (gl.isContextLost()) return { error: 'context lost' };
  const load = async (hash, stage) => {
    const key = `${hash}.${stage}`;
    if (!state.texts.has(key)) {
      state.texts.set(key, await (await fetch(`/shaders/${key}.glsl`)).text());
    }
    return state.texts.get(key);
  };
  const vertexText = await load(program.vertexHash, 'vert');
  const fragmentText = await load(program.fragmentHash, 'frag');
  const runs = [];
  for (let rep = 0; rep < reps; rep++) {
    const salt = `\n// link-bench ${runId} ${program.hash} ${rep}\n`;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    const prog = gl.createProgram();
    gl.shaderSource(vs, vertexText + salt);
    gl.shaderSource(fs, fragmentText + salt);
    const t0 = performance.now();
    gl.compileShader(vs);
    gl.compileShader(fs);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    if (program.index0) gl.bindAttribLocation(prog, 0, program.index0);
    gl.linkProgram(prog);
    // Blocks until the backend finished the whole job.
    const ok = gl.getProgramParameter(prog, gl.LINK_STATUS);
    const ms = performance.now() - t0;
    const run = { ms, ok: !!ok };
    if (!ok) {
      run.log = String(
        gl.getProgramInfoLog(prog) || gl.getShaderInfoLog(vs) || gl.getShaderInfoLog(fs) || '',
      ).slice(0, 400);
    }
    if (ok && draw) {
      // No buffers, no textures: constant attributes and incomplete samplers
      // are legal, and the point is only to make the backend build whatever it
      // postponed. readPixels blocks until the GPU process has done it.
      // WebGL refuses a draw when two sampler TYPES share a texture unit, and
      // every sampler defaults to unit 0: give each type its own unit.
      gl.useProgram(prog);
      const unitOfType = new Map();
      const uniformCount = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let u = 0; u < uniformCount; u++) {
        const info = gl.getActiveUniform(prog, u);
        if (!info || !state.samplerTypes.has(info.type)) continue;
        if (!unitOfType.has(info.type)) unitOfType.set(info.type, unitOfType.size);
        const location = gl.getUniformLocation(prog, info.name);
        if (location)
          gl.uniform1iv(location, new Int32Array(info.size).fill(unitOfType.get(info.type)));
      }
      const t1 = performance.now();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, state.pixel);
      run.drawMs = performance.now() - t1;
      run.drawError = gl.getError();
      gl.useProgram(null);
    }
    runs.push(run);
    gl.deleteProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    // Let the page breathe so the browser never flags it unresponsive.
    await new Promise((r) => setTimeout(r, 0));
  }
  return { runs };
}

function machineInfo() {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return { error: 'no webgl2' };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    version: gl.getParameter(gl.VERSION),
    glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    parallelCompile: !!gl.getExtension('KHR_parallel_shader_compile'),
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
  };
}

/** The world renderer's context: the one with the most extensions enabled. */
function worldContext(corpus) {
  const contexts = corpus.runs?.flatMap((r) => r.contexts ?? []) ?? [];
  return contexts.reduce(
    (best, c) => ((c.extensions?.length ?? 0) > (best?.extensions?.length ?? -1) ? c : best),
    null,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpusDir = path.resolve(args.corpus);
  const corpus = JSON.parse(fs.readFileSync(path.join(corpusDir, 'corpus.json'), 'utf8'));
  const programs = args.limit ? corpus.programs.slice(0, args.limit) : corpus.programs;
  const browserPath = findBrowserPath();
  if (!browserPath) throw new Error('No Chrome/Chromium found; set BROWSER_PATH');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = args.out ?? path.join(corpusDir, `link-bench-${runId}`);
  fs.mkdirSync(outDir, { recursive: true });
  const context = worldContext(corpus);
  const server = await serveCorpus(corpusDir, args.port);
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: args.headless ? 'new' : false,
      userDataDir: path.join(outDir, 'chrome-profile'),
      args: [
        '--ignore-gpu-blocklist',
        '--enable-gpu',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        ...(args.angle ? [`--use-angle=${args.angle}`] : []),
      ],
      protocolTimeout: 600_000,
    });
    const [page] = await browser.pages();
    await page.goto(`http://127.0.0.1:${args.port}/`, { waitUntil: 'domcontentloaded' });
    const machine = await page.evaluate(machineInfo);
    process.stdout.write(`machine: ${machine.renderer}\n`);
    const results = [];
    const startedAt = Date.now();
    for (let i = 0; i < programs.length; i++) {
      const program = programs[i];
      const outcome = await page.evaluate(benchProgram, {
        program,
        reps: args.reps,
        runId,
        contextAttributes: context?.attributes ?? null,
        extensions: context?.extensions ?? [],
        draw: args.draw,
      });
      results.push({
        hash: program.hash,
        base: program.base,
        variant: program.variant,
        group: program.group,
        name: program.name,
        kind: program.kind,
        vertexHash: program.vertexHash,
        fragmentHash: program.fragmentHash,
        profiles: Object.keys(program.seen ?? {}),
        firstStep: Object.values(program.seen ?? {})[0]?.steps?.[0] ?? '',
        ...outcome,
      });
      if (outcome.error) throw new Error(`program ${program.hash}: ${outcome.error}`);
      if ((i + 1) % 25 === 0 || i + 1 === programs.length) {
        const first = outcome.runs?.[0]?.ms ?? 0;
        process.stdout.write(
          `${i + 1}/${programs.length} (last first-link ${first.toFixed(0)} ms)\n`,
        );
        await page
          .evaluate(
            (text) => {
              document.getElementById('log').textContent = text;
            },
            `${i + 1}/${programs.length}`,
          )
          .catch(() => undefined);
      }
    }
    const payload = {
      runId,
      corpus: {
        gitSha: corpus.gitSha,
        createdAt: corpus.createdAt,
        programCount: corpus.programCount,
      },
      browser: await browser.version().catch(() => 'unknown'),
      angle: args.angle ?? 'default',
      reps: args.reps,
      draw: args.draw,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      machine,
      context: context ? { attributes: context.attributes, extensions: context.extensions } : null,
      results,
    };
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(payload, null, 1));
    fs.writeFileSync(path.join(outDir, 'report.md'), renderLinkBenchReport(payload));
    process.stdout.write(`report: ${path.join(outDir, 'report.md')}\n`);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    server.close();
    fs.rmSync(path.join(outDir, 'chrome-profile'), { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
