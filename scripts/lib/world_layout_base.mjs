/** Compile from canonical content even when an earlier generated layout is installed. */
export function canonicalWorldLayoutBase() {
  return {
    name: 'canonical-world-layout-base',
    setup(plugin) {
      plugin.onLoad({ filter: /[\\/]sim[\\/]world_layout[\\/]active\.ts$/ }, () => ({
        contents:
          'export const WORLD_LAYOUT = { version: 1, buildings: {}, npcs: {}, camps: [], groundObjects: {}, objectMoves: {} };',
        loader: 'ts',
      }));
    },
  };
}
