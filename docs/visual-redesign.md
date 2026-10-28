# Visual redesign — 28 October 2026

## Audit

The previous marketing page repeated one serum image throughout, used very small supporting text and labels, substituted symbols for portrait photography, and repeated similar section structures. Its account/upload availability copy had fallen behind the implemented workspace. Account pages, projects, and galleries used a separate visual system.

Direct live-site access from the cloud executor is blocked by its outbound domain policy (proxy CONNECT 403, not an application response). The audit used the current deployed source revision, bb780f1, and its local production build. The owner's earlier live `/api/health` screenshot established that the existing Hostinger backend was running.

## Implemented

- Complete landing-page redesign: navigation, layered hero, commercial portfolio, actual-workspace introduction, interiors, planned Brand Studio, planned batch workflow, portraits, current upload workflow, interactive color study, pricing availability, FAQ, final call to action, and footer.
- Shared design tokens, self-hosted Manrope typeface, readable responsive hierarchy, consistent vector symbols, focus states, forms, buttons, borders, and surfaces across marketing and the application.
- Original concept imagery covering footwear, apparel/accessories, watches, glassware/bottles, furniture, skincare, professional portraits, and an older diverse creative team. Images are explicitly illustrative, never represented as customer work or SONKOFLOW processing results.
- Coordinated headline/image entrances, scroll-triggered text and image reveals, restrained hover treatments, and dialog/form feedback. Reduced motion and static content without JavaScript are supported.
- Sign-in, sign-up, confirmation, recovery/reset, account profile, project list, empty states, upload form, and stored-image gallery restyled.
- Functional single-image drag-and-drop with local selection preview, validation feedback, submission feedback, and accessible stored-image preview dialog. Escape closes the dialog and returns keyboard focus; download and deletion continue to use existing endpoints.
- Existing upload request IDs, security boundaries, authentication endpoints, database/storage implementation, and environment configuration retained. No migrations, backend changes, new AI processing, paid plans, fabricated results, testimonials, or statistics.

## Verification

- Production Vite build and TypeScript compilation.
- 21 existing backend/security/database/proxy tests.
- 15 landing browser checks across desktop (1440 px), tablet (820 px), and mobile (390 px): assets, anchor targets, account links, reveal completion, overflow, menu/Escape, keyboard comparison, FAQ, reduced motion, and no-JavaScript fallback.
- 14 application browser checks on desktop and mobile: account navigation, real unconfigured-service errors, protected redirects, project creation/navigation, drop/select upload presentation, image preview/download/deletion controls, invalid file feedback, safe filename rendering, and profile save feedback.
- The application workflow presentation tests use explicitly mocked API fixtures; they do not establish new live Supabase or production authentication results. Existing hosted-service results remain documented separately in `phase-1-verification.md`.
- Additional local axe-core WCAG 2 A/AA and 2.1 AA scans: landing and sign-in plus existing account/workspace routes and image dialog, including 320 px layouts. No detected violations after corrections. This is automated evidence, not a claim of complete accessibility certification.
- Manual screenshot review of the full landing page, account form, project view, and gallery at desktop and mobile sizes. No horizontal overflow or missing showcase assets in the final responsive review.

## Release boundary

Push to the existing `main` branch for the GitHub-connected Hostinger Node.js site, `lightskyblue-weasel-658319.hostingersite.com`. No environment-variable edits, migrations, or manual redeployment are required for this source update. Remote Git revision can be verified here; completion of Hostinger's build and the live rendered redesign cannot be independently checked while the cloud destination policy blocks this hostname and no authenticated Hostinger connector is available.

This visual update does not close the remaining Phase 1 hosted account/email checks.
