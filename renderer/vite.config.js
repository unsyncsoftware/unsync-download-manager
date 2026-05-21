import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  base: "./",           // important: relative paths so Electron can load the file
  build: {
    outDir: path.resolve(__dirname, "../dist/renderer"),
    emptyOutDir: true,
  },
});
