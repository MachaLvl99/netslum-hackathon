import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lynx-js/rspeedy";
import { pluginReactLynx } from "@lynx-js/react-rsbuild-plugin";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  source: { entry: { main: path.join(projectRoot, "src/index.tsx") } },
  output: {
    distPath: { root: path.join(projectRoot, "dist") },
    filename: "[name].[platform].bundle",
    cleanDistPath: true
  },
  environments: { web: {}, lynx: {} },
  plugins: [pluginReactLynx({ enableAccessibilityElement: true })]
});
