import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  // Absolute, not relative ('./') -- this app has deep client-side routes
  // (e.g. /book/:slug) that Render's rewrite serves index.html for. A
  // relative base resolves asset URLs against the current path's depth, so
  // /book/gloss-nail-bar would look for its JS/CSS under /book/assets/
  // instead of /assets/ and 404 -- blank white page. Absolute base always
  // resolves from site root regardless of how deep the route is.
  base: '/',
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
