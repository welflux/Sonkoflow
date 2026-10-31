# Claid portrait trial — 31 October 2026

Production remains disabled. The owner authorized use of Claid's free API
credits and selected an uploaded personal photograph for the first test.

The selected 2736 × 3648 original was read from private storage and verified
against its stored SHA-256. It was not overwritten. A local 1368 × 1824 copy was
prepared for a 2× smart-resize test back to the original dimensions, because 2×
upscaling the full original would exceed the existing 25 MP output limit. This
is a downsampled-input trial, not evidence of enhancement of the full original.

## Results and fix

- First submission: HTTP 422, no output obtained. The Claid multipart `data`
  field was encoded as a JSON Blob with a filename. Claid's schema requires a
  string form field, not an uploaded JSON file.
- The server adapter now sends JSON as a text field. The adapter version was
  advanced to `multi-engine-v2`, invalidating earlier verification attestations.
  A regression assertion checks that the field is a string. All 18 multi-engine
  unit tests and the production build passed after correction.
- One deliberate corrected submission received HTTP 200. Subsequent output
  download/validation did not complete. No validated edited image was saved.
  HTTP 200 alone does not establish successful output, identity preservation,
  end-to-end processing, settled cost or activation readiness.
- There were two API submissions in total: one rejected and one accepted at the
  HTTP level. Neither submission had automatic retries. No further processing
  request was made after the accepted request's output failure.
- The initial trial runner did not checkpoint the accepted response's delivery
  information before output validation. Its failure handler also did not retain
  the exact failure stage, so this attempt cannot distinguish download failure
  from URL, pixel or size validation failure. Those details cannot be recovered
  from the saved report. The private runner now checkpoints delivery information
  and downloaded bytes before validation, and records the failure stage for
  future recovery. This correction was not used to submit another request.
- The owner's expanded Claid usage screenshot subsequently confirmed one billed
  entry: `API realtime upscale smart resize 9-36MP: 3`, with a total of 3 trial
  credits used and 47/50 remaining. The screenshot provides account usage
  evidence, not a settled monetary invoice or a validated image output. The row
  contains no delivery URL or request identifier. Monetary costs remain unknown;
  do not approve the provider from this run.

## Subsequent authorized diagnostic and recovery

The owner explicitly approved one further diagnostic request at an expected
3 trial credits. That single request received HTTP 200 and reported 2736 × 3648
output pixels. Its private response checkpoint established the delivery URL was
on the exact first-party HTTPS host `dl.claid.ai`, whereas the adapter accepted
only the older documented Google Storage bucket. The strict URL check therefore
rejected the genuine result before downloading it.

The Claid allowlist now accepts `https://dl.claid.ai/` in addition to the existing
documented bucket. Credentials, nonstandard ports, HTTP, lookalike domains,
unapproved storage buckets and redirects remain rejected. Regression checks
exercise both Claid delivery locations and reject spoofed/unsafe URLs. All 18
adapter checks and the production build passed.

The existing result was downloaded with a GET only, with no authorization header
or redirects, and validated through the shared output validator. Recovery made
zero image-processing submissions. The saved lossless WebP is 2736 × 3648 pixels,
4,049,710 bytes, metadata stripped, and has a recorded SHA-256. Its private file
is `artifacts/engine-comparison/claid-portrait-trial/diagnostic-2-output.webp`.
The original remains unchanged. This establishes one successful isolated Claid
request, delivery and output-validation test, not the authenticated production
job/credit/history workflow or approval of all operations.

Visual inspection shows overall composition and background retained, with a
smoother appearance. It does not establish improved fine detail over the original
full-resolution photograph; some facial and fabric texture looks softened.
Identity/detail/naturalness approval remains pending, and the provider is not
approved for production. The output was generated from the downsampled test copy.

The first charged operation's 3 credits were confirmed by the owner's usage
screenshot. The second operation was authorized at the same dimensions and
expected 3-credit tier, but its actual account deduction has not been independently
confirmed. An expected balance of 44/50 is not recorded as an observed balance.
No paid-account monetary cost or invoice calibration is inferred from free credits.

## Remaining work

Review this downloaded result and the second account-usage entry before choosing
any further provider operations. Product/commercial comparisons, operation-specific
quality review, actual paid-rate calibration, authenticated staging workflow and
production verification gates remain outstanding. No further processing request
was submitted after the one approved diagnostic. Production remains disabled.

Private source material and operator evidence are under the Git-ignored
`artifacts/engine-comparison/claid-portrait-trial/` directory with restricted
file permissions. No API credentials or signed delivery URLs are included in
this document. No output was inserted into the customer's library, no customer
allowance was charged by these isolated operator calls, and no hosted migration,
billing activation, UI redesign or production deployment was performed.

Official upload contract:
<https://docs.claid.ai/image-editing-api/upload-api-reference.md>.
