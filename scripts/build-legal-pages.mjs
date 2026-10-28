import { writeFile } from "node:fs/promises";
import { header, footer } from "./public-layout.mjs";
// Per the owner's instruction, reserve working destinations and titles only.
// Policy wording and business disclosures will be supplied in a later phase.
const pages = {
  terms: "Terms & Conditions",
  privacy: "Privacy Policy",
  cookies: "Cookie Policy",
  legal: "Legal Information",
};
for (const [slug, title] of Object.entries(pages))
  await writeFile(
    `${slug}.html`,
    `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} — SonkoFlow</title><meta name="description" content="SonkoFlow ${title}. Document content will be added in a later update."><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/src/design-system.css"><link rel="stylesheet" href="/src/public.css"><link rel="stylesheet" href="/src/legal.css"></head><body><a class="skip" href="#main">Skip to content</a>${header()}<main id="main" tabindex="-1" class="public-wrap legal-layout"><aside class="legal-sidebar"><p class="public-eyebrow">LEGAL & PRIVACY</p>${Object.entries(
      pages,
    )
      .map(
        ([id, name]) =>
          `<a href="/${id}" ${id === slug ? 'aria-current="page"' : ""}>${name}</a>`,
      )
      .join(
        "",
      )}</aside><article class="legal-article"><p class="public-eyebrow">SONKOFLOW</p><h1>${title}</h1><p class="legal-lead">The content for this document will be added in a later update.</p><div class="legal-review"><strong>Document not yet published.</strong> This destination is reserved for the completed SonkoFlow policy. It does not contain final legal terms or disclosures.</div><a class="public-button legal-home" href="/">Back to SonkoFlow <span aria-hidden="true"><svg class="public-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></a></article></main>${footer()}<script type="module" src="/src/public.js"></script></body></html>`,
  );
