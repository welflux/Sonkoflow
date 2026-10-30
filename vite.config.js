import { defineConfig } from "vite";
import { featurePages } from "./content/seo-pages.mjs";
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        marketing: "index.html",
        ...Object.fromEntries(
          featurePages.map((page) => [page.slug, page.path.slice(1) + ".html"]),
        ),
        application: "app.html",
        pricing: "pricing.html",
        terms: "terms.html",
        privacy: "privacy.html",
        cookies: "cookies.html",
        legal: "legal.html",
      },
    },
  },
  server: { proxy: { "/api": "http://127.0.0.1:3000" } },
});
