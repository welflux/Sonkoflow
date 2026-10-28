# SONKOFLOW

The review stack now includes [reference-image processing](docs/phase-2-processing.md), [product quality review](docs/phase-3-product-quality.md), [product image packs](docs/phase-4-product-packs.md), [Brand Studio](docs/phase-5-brand-studio.md), [bulk processing](docs/phase-6-bulk-processing.md), and [the image library](docs/phase-7-image-library.md). These additions reuse the Phase 1 Express/Supabase architecture. Production publication is on hold; API funding, pending hosted migrations, reviewed pack estimates and real-service validation remain activation requirements. See each phase document for implemented behavior and actual limitations.

The original Phase 1 notes below describe the earlier starting point.

Phase 1 implementation is now alongside the preserved marketing page. See [deployment and service setup](docs/phase-1-deployment.md) for the selected Express + Supabase + Resend architecture, exact configuration, migrations, checks, and unresolved production gates.

The foundation code is implemented and locally tested; hosted authentication, storage, and transactional email are **not yet verified**. Run `npm run dev:server` alongside Vite for the application, or `npm run build && npm start` for a production-style server.

## Original marketing site notes

A responsive, static pre-launch marketing page. Marketing concepts remain explicitly labeled. Account and private-original storage code now exists separately at `/account` and `/app`, pending real service configuration. AI processing and payments are not implemented.

## Development

Node.js 22.12+ (validated with Node 24) and npm are required.

```sh
npm ci --cache /workspace/.npm-cache
npm run dev
npm run build
npm run preview
```

`dist/` is the marketing/application frontend output and `build/` is the Node backend output. Static-only deployment serves marketing but cannot serve the Phase 1 application. Deploy the full application with the Node entry point as documented.

## Browser checks

```sh
npm test
```

Tests use `/usr/bin/chromium` by default. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to another installed Chromium executable if needed.

Checks cover desktop, tablet, and mobile layouts, asset loading, fragment destinations, runtime errors, availability disclosures, mobile menu, keyboard comparison control, FAQ, and reduced motion. Screenshots are written to ignored `test-results/`.

## Design and assets

The requested Sky, Sun, Ink, border, background, and 3px radius tokens are centralized in `src/style.css`. Arial/Helvetica are deliberate local system-font equivalents; no competitor font is claimed. No reference screenshot was supplied in the accessible project files.

`public/images/serum.webp` is original OpenAI-generated marketing concept artwork, optimized from the retained original in `/workspace/generated_images/`. It is not a SONKOFLOW processing result. Grayscale treatment and crops reuse the same image, with explicit disclosure. No third-party stock or competitor assets are bundled. Owner review of artwork and commercial use suitability is required before public launch.

Portrait sections use abstract typographic illustrations pending approved portrait photography; they do not imply fabricated customer results. The workspace is a labeled, non-interactive design concept. Only the comparison slider, navigation, and FAQs are interactive.

## Before public launch

Supply approved portrait and personal photography, support contact, legal business identity, privacy policy, and terms. No contact details, legal documents, pricing, free trial, customer endorsements, or integrations have been invented. Real application routes should replace pre-launch disclosures only as their functionality becomes available. Hostinger plan compatibility and deployment are not verified by this task. No analytics, cookies, forms, or image uploads are included.
