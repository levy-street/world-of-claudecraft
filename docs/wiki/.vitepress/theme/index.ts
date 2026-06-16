import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import CopyMarkdown from "./CopyMarkdown.vue";
import "./custom.css";

// Extend the default theme with a "Copy as Markdown (for agents)" affordance
// rendered just under each page title.
export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "doc-before": () => h(CopyMarkdown),
    });
  },
};
