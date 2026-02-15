import { defineConfig } from "tsup";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node18",
  platform: "node",
  outDir: "dist",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
  esbuildOptions(options) {
    options.external = [...(options.external ?? [])];
  },
});
