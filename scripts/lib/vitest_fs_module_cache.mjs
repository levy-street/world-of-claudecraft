import path from 'node:path';

function nonempty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeForCompare(value) {
  return path.resolve(value);
}

function isWithin(child, parent) {
  const rel = path.relative(normalizeForCompare(parent), normalizeForCompare(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Vitest 4.1's experimental fsModuleCache writes transient files under
 * node_modules. OSS Brain linked worktrees symlink node_modules back to the main
 * checkout, and the main checkout itself runs release gates under ORCH, so both
 * shapes can contend on the same experimental temp-file store.
 *
 * @param {string} rootPath
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function shouldDisableVitestFsModuleCache(rootPath, env = process.env) {
  const parts = normalizeForCompare(rootPath).split(path.sep);
  if (parts.includes('.wt')) return true;

  if (nonempty(env.ORCH) && isWithin(rootPath, env.ORCH)) return true;
  if (nonempty(env.GAME_REPO) && isWithin(rootPath, env.GAME_REPO)) return true;
  if (nonempty(env.RUN_DIR) && nonempty(env.WORKTREE) && isWithin(rootPath, env.WORKTREE))
    return true;

  return false;
}
