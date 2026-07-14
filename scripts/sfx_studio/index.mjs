import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSfxStudio } from './server.mjs';

export { collectSfxCatalog } from './catalog.mjs';
export { buildFfmpegArgs, buildFfmpegGraph, defaultProject, normalizeProject } from './project.mjs';
export { startSfxStudio } from './server.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const portIndex = process.argv.indexOf('--port');
  const requestedPort = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 5181;
  if (!Number.isSafeInteger(requestedPort) || requestedPort < 1 || requestedPort > 65_535) {
    throw new Error('--port must be an integer from 1 to 65535');
  }
  const running = await startSfxStudio({ port: requestedPort });
  console.log(`SFX Studio serving at ${running.url}`);
  console.log(`  drafts, sources, previews, and versions: ${running.workspace}`);
  console.log('  Audio publish, playback mix, and production export stay separate and atomic.');
}
