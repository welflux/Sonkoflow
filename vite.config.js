import { defineConfig } from "vite";
export default defineConfig({
  build: {
    rollupOptions: {
      input: { marketing: "index.html", application: "app.html" },
    },
  },
  server: { proxy: { "/api": "http://127.0.0.1:3000" } },
});
