# Phase 1: production foundation readiness

Historical pre-implementation assessment. Superseded by [Phase 1 deployment and verification](phase-1-deployment.md): the local foundation is now implemented, with hosted service verification still outstanding. The observations below describe the project before that work, not its current implementation status.

## Observed project state

The existing application is a Vite static marketing page. There is no backend, authenticated application, account service, database schema, database migration runner, or private storage integration. Existing local changes from the landing-page task must be preserved.

The previous architecture recommendation was provisional, not a verified production architecture. Next.js/TypeScript, a relational database, private object storage, and durable jobs were proposed subject to Hostinger verification. This document does not select providers or replace that recommendation.

Current checks: the production marketing build succeeds and its 12 Playwright tests pass on desktop, tablet, and mobile. These checks do not validate authentication, authorization, persistence, or storage.

## Blocking information and access

1. Identify the intended Hostinger plan and site. Verify supported Node.js/framework versions, deployment/build/start commands, HTTPS and reverse-proxy behavior, port binding, resource and request limits, environment variables, outbound database connectivity, restart behavior, and logging. Worker capability must be recorded for later phases, without implementing workers now.
2. Identify the relational database engine/version, connection endpoint, TLS requirements, network access, database provisioning procedure, migration identity, restricted application identity, backups, and restoration process. Use a development database for destructive integration tests.
3. Identify the private persistent storage service and region, bucket/container, API/authentication mechanism, maximum object size, encryption/access policy, signed-access support, lifecycle/deletion behavior, and cost. Do not use the application filesystem as durable image storage.
4. Identify the authentication approach and transactional email delivery service with a verified sender and approved application origin. Signup verification and password recovery must be tested with actual delivery; console links and fabricated mail integrations are not production completion.
5. Supply credentials through secure environment settings only. No corresponding service bindings were present in the inspected runtime or configuration draft. Exact variable names and destination permissions should follow the selected providers; do not invent credentials or request unrelated OpenAI/payment keys for this phase.

No Hostinger MCP server is configured. An attempt to register https://mcp.hostinger.com failed because the managed MCP configuration filesystem is read-only. Connect and authenticate Hostinger through the client integration settings, or provide non-secret plan specifications and provisioned service details. Do not paste tokens or passwords into chat.

## Phase 1 implementation contract

Preserve the existing marketing page, global palette, typography direction, and 3px radius. Keep frontend views, authenticated server routes, validation, domain services, database access, storage access, and mail delivery separate. Introduce the application framework only after compatibility is established.

The authenticated application needs real signup, login, logout, session expiry/revocation, recovery, audience selection, profile management, project creation/listing, and private image upload/retrieval/deletion. No image generation, packs, Brand Studio, batch execution, subscriptions, or credit purchases are authorized.

### Data relationships to implement after engine selection

- Accounts: normalized unique email, password credential or external identity reference, verification state, lifecycle timestamps.
- Profiles: account relationship, display name, supported audience (e-commerce, professional, individual).
- Tenants/memberships: explicit authorization boundary and membership uniqueness if organizations are introduced. Otherwise account ownership is the tenant boundary; do not silently imply team access.
- Sessions: hashed opaque token or verified provider session, account relationship, expiry, revocation. Raw session/recovery tokens must never be stored in application logs.
- Verification/recovery tokens: hashed, purpose-bound, expiring, single-use, consumed atomically. Password reset invalidates existing sessions.
- Projects: ownership boundary, name, timestamps, lifecycle state.
- Image metadata: ownership and project relationships, non-predictable storage object key, original/generated role, validated media type, byte size, dimensions, checksum, storage/deletion state. Original filenames are untrusted display data, not storage paths.
- Processing-job records: ownership, project/input relationships, status and timestamps, unique submission identity. No processing API or artificial completed jobs in Phase 1.
- Usage records: ownership, integer units, operation reference, unique idempotency key, immutable audit timestamps. No fabricated credits or billable generation events.
- Security events and shared rate-limit records: bounded retention and minimized personal data; no secret values or photograph contents.

Use foreign keys, indexes, uniqueness and valid-state constraints. Ownership must remain consistent across related records, enforced through database policies/constraints and server-scoped queries as supported by the selected engine. SQL migrations cannot be finalized until the database engine is verified.

### Security acceptance checks

- Anonymous requests fail at protected server endpoints; frontend hiding alone never authorizes access.
- Two real test accounts cannot read, modify, attach, download, or delete one another's profiles, projects, images, jobs, or usage records, including guessed identifiers.
- Session cookies are HttpOnly, Secure in production, appropriately SameSite scoped, rotated on authentication, and invalidated on logout/reset. Validate request origin/CSRF for mutating cookie-authenticated requests.
- Email validation, bounded inputs, strong password handling, recovery anti-enumeration, and shared durable rate limits are tested. Recovery tokens expire and cannot be reused or raced successfully.
- Uploads are bounded by bytes and decoded pixels; inspect actual file signatures and decoded content, reject unsupported/corrupt files, normalize filenames, prevent executable content, and re-encode or strip sensitive metadata as appropriate. Define decompression-bomb and animated-image policies.
- Storage is private by default. Retrieval requires current ownership authorization; signed access has bounded expiry. Unauthorized access to raw storage keys fails.
- Upload/storage/database failure paths reconcile incomplete records and orphan objects. Deletion is repeatable and fails safely without silently abandoning private data.
- Error responses omit stack traces and sensitive infrastructure details; logs carry request identifiers without credentials, token-bearing URLs, or image bodies.
- Application credentials cannot migrate/drop schema or access another tenant outside the intended access model. Migration privileges are separate.

## Completion evidence required

Apply migrations to a real development database and verify constraints. Execute real storage round trips and unauthorized access tests against a private development bucket. Verify signup, session management, account recovery email delivery, project CRUD, image validation/retrieval/deletion, and tenant isolation. Run unit/integration/browser tests, type checks, dependency security checks, and production build. Record unrun or blocked checks separately from passes. Verify deployment compatibility and restart persistence before claiming production readiness.

No paid services, deployments, or changes to existing hosted data have been performed. Phase 1 remains the active scope once the missing prerequisites are supplied; no later-phase approval is being requested.
