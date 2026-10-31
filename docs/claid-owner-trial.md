# Private Claid trial

This is a restricted testing path, not production approval of a provider or a
replacement credit system. It uses existing owner authentication, jobs, output
checkpoints, image quotas, private storage, image content/download routes and
library/history. No database migration is needed. Unrequested prompt changes
are excluded.

## Activation

Only the existing `AI_CLAID_API_KEY` and one non-secret setting are needed:
`AI_CLAID_TRIAL_JSON`, a strict JSON object with `owner_id` (the exact account
UUID), `expires_at` (ISO timestamp no more than seven days ahead), and
`max_credits` (integer 3–6). Never put provider credentials in this JSON or in a
browser-prefixed variable. The operator prepared the target account's setting
privately; the owner confirmed saving it in Hostinger.

The existing `AI_PROCESSING_ENABLED`, `AI_MULTI_ENGINE_ENABLED`,
`AI_TOPAZ_ENABLED`, `AI_CLAID_ENABLED` and `BILLING_ENABLED` must remain off.
Normal OpenAI/Topaz/public processing remains unavailable. The trial policy is
checked server-side against the authenticated owner. Other accounts receive no
trial capabilities, and trial job/read/recovery endpoints deny them.

The existing editor displays a private Claid form only for the configured owner.
Modes keep the current photograph's original dimensions (up to the existing
25 MP bound):

- `enhance`: HDR lighting/colour adjustment, background removal false. No
  generative face, scene, polish or upscaling operation is included.
- `product_finish`: the fixed product HDR + white background operation. This is
  intentional background transformation, offered only in product mode.

The user explicitly consents to Claid and confirms the up-to-three-credit
reservation before submitting. Temporary provider output hosting is disclosed.
No guarantee of unchanged facial details, perfect product labels or recovered
missing information is made. API credits and SonkoFlow subscription units are
separate; this path does not create grants or charge a subscription allowance.

## Durable trial cap and failures

Each request conservatively reserves three API trial credits, with at most two
requests for a six-credit policy. The reservation uses a deterministic job UUID
for each owner/slot, keyed to `claid-owner-trial-v1`. Existing database primary
key and submission-key uniqueness enforce the cap across concurrent processes,
restarts, browser refreshes, configuration changes and redeploys. Slot identifiers
do not depend on expiration or arbitrary client IDs. Used slots, including failed
and uncertain attempts, are never recycled. Do not delete these ledger records
to make room for another test. Policy expiration disables new submissions but
still allows recovery of accepted output.

Submission keys are idempotent; changed inputs with the same key are rejected.
Provider calls have no automatic retries or cross-provider fallback. Admission
reserves a slot before processing. A lost acceptance or interrupted process keeps
the reservation; stale running jobs become uncertain rather than being replayed.
An accepted delivery URL is encrypted with the existing session-encryption key
and checkpointed before download. No plaintext signed output URL appears in job
responses/history/logs. Recovery can only download and persist that accepted
result, without another edit API call. The exact delivery hosts are enforced;
redirects and authenticated output downloads remain forbidden.

Existing SQL `processing_step` prepare/complete operations link a new generated
image to its source job; original objects are never overwritten. Output is
validated, metadata stripped, normalized losslessly, written, read back and
checksum-verified before completion. Storage failures retain the persisting
checkpoint for idempotent recovery. A server restart does not automatically
resume a remote request. The owner can recover a saved receipt explicitly.

Trial API-credit reservations are stored explicitly in job settings/price
snapshots. Actual credits are unknown until reconciled with the provider usage
page. Monetary costs remain null; no zero-dollar price or token estimate is
invented. A three-credit operation was observed for the earlier 9–36 MP Smart
Resize diagnostic; this private path uses distinct fixed lighting/background
operations, so their actual usage must be reviewed independently.

Remove `AI_CLAID_TRIAL_JSON` to disable the private form, or let it expire. Existing
saved outputs and history remain private and downloadable. Do not enable the
public engines or bypass their pricing/quality verification reports as part of
this trial.

## Validation

Local checks cover malformed/unsafe policy, owner isolation, consent/operation
validation, durable slot keys, safe receipt presentation, real PostgreSQL output
checkpoints/RLS, and browser submission/result/download/recovery on desktop,
tablet and mobile. Provider fixtures are local tests only. A real live-site
request is required to verify the full authenticated production-host path; record
its actual outcome separately before calling that path ready.
