# Terms & Conditions publication — 30 October 2026

The `/terms` placeholder is replaced with the user's supplied 24-section agreement. The original agreement is retained in `content/legal/terms-and-conditions.txt`, with only the two requested date placeholders replaced by **30 October 2026**. Display headings use sentence case; substantive wording, clause numbers, company details and contact information are preserved. Browser checks compare every supplied paragraph and clause against the rendered document.

The page has scoped styling using the existing Inter typography and navy, sky and orange design tokens. It includes legal-document navigation, desktop section navigation, a collapsible mobile index, reading-position indication, contact links and browser-native printing / saving as PDF. The full agreement is static HTML, readable without JavaScript. Print styles remove navigation without hiding agreement sections. Other legal pages and their shared stylesheet are unchanged.

The published page has its own canonical, description, social metadata and WebPage/BreadcrumbList structured data. Its publication and modification dates are 2026-10-30. Only `/terms` is released from the placeholder noindex header and added to the sitemap. Remaining legal placeholders stay noindex. Account, OAuth, recovery, billing and image-processing behavior are untouched.

Validation: production build and TypeScript; Terms browser checks on desktop, tablet, mobile and 320px without JavaScript; all 24 sections and source clauses preserved; anchor destinations, contact/policy links, print behavior and canonical/indexing tests. Visual previews and an A4 PDF were generated locally for review.
