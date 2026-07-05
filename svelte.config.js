import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Svelte is used ONLY by the standalone admin dashboard SPA (src/admin/, the `admin`
// Vite entry). The game/guide/play entries contain no .svelte files. vitePreprocess
// enables <script lang="ts"> in components; svelte-check (npm run check:admin) type
// checks them since vite.config.ts / tsconfig do not.
export default {
  preprocess: vitePreprocess(),
};
