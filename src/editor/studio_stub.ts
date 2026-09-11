// Public fallback for the `#studio` specifier (see ./studio_contract.ts). With no
// private Studio clone at src/studio/, the editor entry sees `null` here and boots
// the public map editor.

import type { StudioBoot } from './studio_contract';

export const studioBoot: StudioBoot | null = null;
