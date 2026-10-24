export const GAME_MODULES_ELEMENT_ID: string;
export function gameModuleFiles(
  bundle: Record<
    string,
    { type?: string; fileName?: string; imports?: string[]; facadeModuleId?: string | null }
  >,
  entryFileName?: string,
): string[];
export function gameModuleEntries(
  bundle: Record<string, { code?: string } & Record<string, unknown>>,
  entryFileName?: string,
  base?: string,
): { url: string; bytes: number }[];
export function injectGameModules(html: string, modules: { url: string; bytes: number }[]): string;
