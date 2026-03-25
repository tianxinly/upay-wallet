import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["app/main/main.ts", "app/main/preload.ts"],
  format: ["cjs"],
  outDir: "electron-dist",
  target: "node18",
  clean: true,
  sourcemap: true,
  // 关键点：Electron 不能被打包进主进程产物
  external: ["electron"]
});
