import { readFile, writeFile, mkdir } from "node:fs/promises";
import { featurePages, metadataFor, origin } from "../content/seo-pages.mjs";
const escape = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const home = await readFile(new URL("../index.html", import.meta.url), "utf8");
const header = home.match(
    /<header class="public-header">[\s\S]*?<\/header>/,
  )?.[0],
  footer = home.match(/<footer class="public-footer">[\s\S]*?<\/footer>/)?.[0];
if (!header || !footer)
  throw Error("The public header/footer templates are missing.");
for (const page of featurePages) {
  const related = featurePages.filter((p) => p.path !== page.path);
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="theme-color" content="#142f3e"/><title>${escape(page.title)}</title><meta name="description" content="${escape(page.description)}"/>${metadataFor(page)}<link rel="icon" href="/favicon.svg"/><link rel="preload" href="/fonts/inter-variable.woff2" as="font" type="font/woff2" crossorigin/><link rel="stylesheet" href="/src/design-system.css"/><link rel="stylesheet" href="/src/public.css"/><link rel="stylesheet" href="/src/feature-pages.css"/></head><body class="seo-feature-page"><a class="skip" href="#main">Skip to content</a>${header}<main id="main" tabindex="-1"><section class="seo-hero public-wrap"><div class="seo-hero-copy"><nav class="seo-breadcrumb" aria-label="Breadcrumb"><a href="/">SonkoFlow</a><span aria-hidden="true">/</span><span>${escape(page.eyebrow)}</span></nav><p class="public-eyebrow">${escape(page.eyebrow)}</p><h1>${escape(page.h1)}</h1><p class="seo-intro">${escape(page.intro)}</p><div class="public-actions"><a class="public-button" href="/account/signup">Create your workspace ↗</a><a class="public-text-link" href="${page.workflow}">${escape(page.cta)} ↗</a></div><p class="seo-availability">A workspace account is free. Image generation and purchasing depend on service activation, your plan and available processing allowance.</p></div><figure><img src="/images/${page.image}.webp" ${page.image === "serum" ? "" : `srcset="/images/${page.image}-small.webp 640w, /images/${page.image}.webp 1536w" sizes="(max-width: 800px) 92vw, 45vw"`} alt="${escape(page.alt)}" width="1536" height="1024" fetchpriority="high"/><figcaption>${escape(page.caption)}</figcaption></figure></section>
<section class="public-wrap seo-section" aria-labelledby="seo-capabilities"><p class="public-eyebrow">A WORKFLOW YOU CAN FOLLOW</p><h2 id="seo-capabilities">${escape(page.sectionTitle)}</h2><div class="seo-feature-grid">${page.cards.map(([title, copy], i) => `<article><span class="seo-step">0${i + 1}</span><h3>${escape(title)}</h3><p>${escape(copy)}</p></article>`).join("")}</div></section>
<section class="seo-detail" ${page.detailId ? `id="${page.detailId}"` : ""}><div class="public-wrap"><div><p class="public-eyebrow">KEEP THE ORIGINAL IN VIEW</p><h2>${escape(page.detailTitle)}</h2><a href="/pricing#plans">Compare plans and allowances ↗</a></div><div>${page.detail.map((p) => `<p>${escape(p)}</p>`).join("")}</div></div></section>
<section class="public-wrap seo-section seo-faq" aria-labelledby="seo-questions"><div><p class="public-eyebrow">BEFORE YOUR NEXT EDIT</p><h2 id="seo-questions">Questions about this workflow</h2></div><div>${page.faq.map(([q, a]) => `<details><summary>${escape(q)}</summary><p>${escape(a)}</p></details>`).join("")}</div></section>
<section class="public-wrap seo-section seo-related" aria-labelledby="seo-related-title"><h2 id="seo-related-title">Keep your production connected</h2><div>${related.map((p) => `<a href="${p.path}"><span>${escape(p.eyebrow)}</span><strong>${escape(p.sectionTitle)}</strong><span aria-hidden="true">↗</span></a>`).join("")}</div></section>
<section class="seo-final"><div class="public-wrap"><div><p class="public-eyebrow">YOUR ORIGINAL. YOUR DIRECTION.</p><h2>Bring your next photograph</h2><p>Explore the tools in Production Hub or organize a project before choosing an edit.</p></div><a class="public-button" href="/app/production-hub">Open Production Hub ↗</a></div></section></main>${footer}<script type="module" src="/src/public.js"></script></body></html>`;
  const file = new URL(".." + page.path + ".html", import.meta.url);
  await mkdir(new URL(".", file), { recursive: true });
  await writeFile(file, html);
}
console.log(
  `Generated ${featurePages.length} public feature pages for ${origin}.`,
);
