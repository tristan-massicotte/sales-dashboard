import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static build for GitHub Pages: relative asset paths, so it works under /<repo>/ as well as at a domain root.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1100,
    // MapLibre in its own file; Excel and PowerPoint libraries load only when their button is clicked.
    rollupOptions: { output: { manualChunks: { maplibre: ["maplibre-gl"] } } },
  },
});
