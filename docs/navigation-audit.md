# Navigation audit — 30 October 2026

## Findings and fixes

- Brand Studio's “Create brand profile” reset the inline editor but gave no directional feedback. It now scrolls to the form heading and focuses Brand name. Existing unsaved-change confirmation and save behavior remain intact; pressing this button does not persist a profile.
- Cross-page Batch history fragments did not scroll after the asynchronously rendered workspace became available. Private workspace section destinations are now resolved after the selected page finishes rendering. Unknown or malformed fragments are ignored. Account routes return before this handling, so OAuth and recovery fragments are unchanged.
- Project export links now target `#batch-history-section`, including the heading, rather than the inner results container.

## Coverage

`scripts/audit-public-links.mjs https://sonkoflow.com` performs GET-only checks. The live audit covered nine public/account shells, 223 internal link occurrences and 32 unique destinations, with no HTTP or fragment failures. Protected workspace redirects are accepted rather than reported as broken pages. The script does not submit forms, start sign-in, create accounts or follow external destinations.

Browser fixtures additionally inspect navigation on Projects, Production Hub, Image Library, Bulk Processing, Brand Studio, Plan & usage, Profile & account, and project detail. Links are checked against registered route shapes and public/local fragment targets. Cross-page history/upload destinations, malformed fragments, brand creation focus/discard behavior and project export links are exercised at desktop, tablet and mobile widths. All 21 focused checks passed without navigation-audit writes.

These checks cover navigation structure and exercised workflows, not the existence of every historical customer record or authorization for another user's assets. Private download streams remain protected by existing endpoints. Dashboard/account noindex directives, legal placeholders, authentication, processing and billing rules are unchanged.
