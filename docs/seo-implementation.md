# Public SEO implementation — 30 October 2026

The two supplied strategy documents describe substantially the same scope. This implementation adapts them to the existing Vite/Express application and its implemented product capabilities. Public artwork, colors, account/OAuth/recovery behavior, billing activation and processing rules are preserved. The homepage now uses the requested “Every image. Made for sales.” headline with the existing italic typewriter treatment.

## Public search architecture

| Canonical path | Primary editorial target | Implemented workflow |
| --- | --- | --- |
| `/` | AI commercial image production; AI product photo editor | Reference editing, product packs, brand direction and review |
| `/features/bulk-image-processing` | Bulk AI image enhancement; batch product photo editing | Bounded product staging, shared outputs and allowance review |
| `/features/ecommerce-product-photography` | AI ecommerce product photography | Product enhancement and the five existing pack output types |
| `/features/portrait-enhancer` | Professional portrait enhancement | Uploaded-reference portrait editing |
| `/solutions/automation` | Product photography automation | Project organization, saved brand presets, batches and review |
| `/pricing` | SonkoFlow plans and processing allowances | Existing plan catalogue and activation information |

These are product-aligned editorial target phrases, not independently measured search-volume, competition or LTV data. No unsupported numerical research claims are presented as evidence.

## Delivery and metadata

Four feature pages are generated at build time from `content/seo-pages.mjs` by the `prebuild` script. Generated source HTML is ignored by Git, included as Vite entry points and served at explicit public routes. Every page contains meaningful HTML without requiring JavaScript or an authenticated API request. The existing homepage and pricing page have matching static metadata; no client-only title/canonical injection is required.

All six canonical marketing pages have unique titles/descriptions, a self-referencing HTTPS canonical, index/follow and large-preview directives, Open Graph/Twitter cards and JSON-LD. The schema describes the real software, publisher, website, page and feature-page breadcrumbs. The zero-price offer is specifically a free **workspace account**, with processing availability and allowances described; it is not a promise of free unlimited generation. No reviews, aggregate ratings, trained brand embeddings, instant rendering, parallel GPU controls or enterprise seat products are invented.

The sitemap uses the standard `http://www.sitemaps.org/schemas/sitemap/0.9` namespace and valid `https://sonkoflow.com/...` URLs, including pricing. Its last-modified date is the actual content-update date, not automatically advanced on every build. `robots.txt` points to `/sitemap.xml`, keeps public pages/assets crawlable and restricts actual app/account/API/config paths. Legal placeholders and private pages remain excluded from the sitemap.

Public footer and resource links connect the feature pages to the homepage, pricing and related workflows. Feature `.html` aliases and feature trailing slashes redirect permanently to the clean canonical route; homepage/pricing HTML aliases redirect similarly while retaining query parameters.

## Privacy and legacy indexing

`X-Robots-Tag: noindex, nofollow` supplements existing private/account and legal-placeholder HTML directives, including redirect/error responses. Authentication, ownership checks and private storage remain the security boundary. Robots exclusions are crawl instructions, not access control or a reliable removal mechanism by themselves.

No exact deprecated indexed URLs were supplied. Unverified paths such as `/dashboard`, `/projects`, `/image-library` and `/brand-studio` remain genuine 404 responses with noindex headers. They are deliberately not hidden from recrawling by robots rules, allowing search engines to see that the pages are missing. Existing customer data and private profile locations are not deleted. No speculative bulk 410 responses or unrelated redirects are installed.

Google controls recrawl, snippet refresh, cached-image refresh and removal timing. A deployment cannot force immediate deletion or establish a new ranking. The site owner can request indexing of deployed canonical pages in Search Console. Precise legacy/sensitive URLs should first be inventoried and mapped to a relevant permanent redirect, a real 404/410, or a crawlable noindex response as appropriate. Search Console temporary removals alone are not a permanent replacement for those responses. No Search Console actions were submitted in this task.

## Images and accessibility

Showcase assets were already compressed WebP. Existing photography and vector logos are retained. Responsive 640/1536-pixel variants are used where present, with concrete descriptive alt text and explicit dimensions. New pages label concept artwork accurately. Decorative graphics retain appropriate empty alt text; photographs are not moved into CSS to try to conceal them from crawlers.

## Validation

- Raw-response tests: real 200 pages, one H1, correct canonical and social metadata, parseable schema, sitemap/robots, canonical redirects, private noindex responses and genuine legacy 404s.
- Browser tests: desktop/tablet/mobile metadata, visible artwork, internal links, FAQ interaction, mobile navigation and pricing anchors.
- Homepage regression tests: existing imagery, tabs, menus, typography, stable animated headline, reduced motion and no-JavaScript access.
- Visual review: four feature pages and the updated homepage at 1440, 768, 390 and 320 pixels.
- `scripts/verify-seo.mjs`: read-only live response checks after publication. `scripts/audit-public-links.mjs` now includes the four feature routes.

JSON-LD is parsed and checked against the declared schema types/visible content locally; no external validator submission or Google rich-result eligibility is claimed. Authentication/origin and existing public-release checks are run after deployment.
