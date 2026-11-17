import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds the chat tab as a static ES module (dist/chat.js + dist/chat.css).
// apps/drive-web/refresh_site.py copies dist/ into the Pages output under chat/,
// and template.html mounts it into #chat-root.
export default defineConfig({
  plugins: [react()],
  // Dev server only: serve the shared tokens.css from apps/drive-web (never copied into dist).
  publicDir: "../drive-web",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    copyPublicDir: false,
    cssCodeSplit: false,
    minify: true,
    rolldownOptions: { output: { minify: true } },
    lib: {
      entry: "src/main.tsx",
      formats: ["es"],
      fileName: () => "chat.js",
      cssFileName: "chat",
    },
  },
});
