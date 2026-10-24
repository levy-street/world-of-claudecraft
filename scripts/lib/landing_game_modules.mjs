// The home page's landing-first boot (src/ui/landing_first.ts) prefetches the game
// client once the page has loaded, without running it. The client is a dynamic import
// of the index.html entry (src/boot.ts), so its chunk URLs exist only in the bundle:
// the woc-landing-game-modules plugin (vite.config.ts) lists them into index.html as
// JSON with these helpers. Kept beside the plugin so tests import them directly.

/** Mirrors GAME_MODULES_ELEMENT_ID in src/ui/landing_first.ts (pinned by the test). */
export const GAME_MODULES_ELEMENT_ID = 'woc-game-modules';

const MAIN_ENTRY = /(^|\/)src\/main\.ts$/;
const DEPENDENCY = /(^|\/)node_modules\//;

function staticClosure(start, byName) {
  const seen = new Set();
  const stack = [start];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const dep of byName.get(file)?.imports ?? []) stack.push(dep);
  }
  return seen;
}

/**
 * The game client's chunk files: src/main.ts's chunk first, then every chunk it
 * statically imports, minus those the page's own entry chunk already loads. Throws if
 * the entry chunk statically reaches the client, which would put it back on the first
 * paint.
 */
export function gameModuleFiles(bundle, entryFileName) {
  const chunks = Object.values(bundle).filter((item) => item?.type === 'chunk');
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  // play.html also enters src/main.ts, so the bundler can place it in a shared chunk
  // with no facade (Vite 8 does): find the chunk by the modules it holds.
  const holdsMain = (chunk) =>
    [chunk.facadeModuleId, ...(chunk.moduleIds ?? [])].some((id) => {
      const path = String(id ?? '').replaceAll('\\', '/');
      return MAIN_ENTRY.test(path) && !DEPENDENCY.test(path);
    });
  const main = chunks.find(holdsMain);
  if (!main) return [];
  const loaded = entryFileName ? staticClosure(entryFileName, byName) : new Set();
  if (loaded.has(main.fileName)) {
    // The landing entry would download the whole client up front again.
    throw new Error(`${entryFileName} statically imports the game client (${main.fileName})`);
  }
  const rest = [...staticClosure(main.fileName, byName)]
    .filter((file) => file !== main.fileName && !loaded.has(file))
    .sort();
  return [main.fileName, ...rest];
}

/**
 * The client's chunks as `{ url, bytes }`, bytes being each chunk's size as served
 * uncompressed, which is what the landing reads off the response body to drive its
 * Play progress bar.
 */
export function gameModuleEntries(bundle, entryFileName, base = '/') {
  return gameModuleFiles(bundle, entryFileName).map((file) => ({
    url: base + file,
    bytes: Buffer.byteLength(bundle[file]?.code ?? ''),
  }));
}

/** index.html with the module list as a JSON block before </body>. */
export function injectGameModules(html, modules) {
  const json = JSON.stringify(modules).replaceAll('<', '\\u003c');
  const tag = `<script type="application/json" id="${GAME_MODULES_ELEMENT_ID}">${json}</script>`;
  return html.replace('</body>', `${tag}\n</body>`);
}
