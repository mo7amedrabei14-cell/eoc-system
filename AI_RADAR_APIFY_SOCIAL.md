# EOC AI Radar — Apify social collection

## What this change does
- Connects the existing AI Radar to the two configured Apify Actors: `topapi~facebook-search-posts-scraper` and `seemuapps~instagram-keyword-posts-scraper`.
- Uses high-signal incident-reporting phrases for social searches and then applies deterministic content validation; generic words alone are not sufficient for acceptance.
- Requests Facebook's full output form (`compact: false`) so returned rows retain the nested field shapes declared by the Actor's published output schema. This addresses the dataset-schema failure seen in the recorded run as a compatibility hypothesis; a live run is still needed to confirm the provider-side failure is resolved.
- Accepts a social post only when it has an explicit publication timestamp no older than 30 minutes, a usable post URL, and incident-specific evidence. Unknown timestamps, literary content, and metaphorical posts without factual context fail closed.
- Sends accepted posts into the existing multi-source deduplication, AI/fallback analysis, and EOC API flow.
- Limits collection to at most one chargeable result per 30-minute UTC slot across both platforms. The preferred platform alternates; the other is queried in the same slot only if the preferred Actor returns a confirmed empty/non-billable result.
- Uses the Apify API's `maxItems=1` per Actor request and `maxTotalChargeUsd=0.01` as a per-run charge guard. Facebook also has an Actor-level `maxItems=1` and monitor mode. Extra Instagram dataset rows, if returned despite the charge cap, are not forwarded; the newest timestamped matching row is selected.
- Stores the monthly and daily counters in an Apify named Key-Value Store, not on the ephemeral GitHub runner. The limits default to 1,000 chargeable result slots per UTC month and 50 per UTC day. With at most 48 half-hour slots in a day, the upper bound is 960 slots per 20 days, so 1,000 results last at least 20 days under normal scheduled operation. Low volume extends this further.

## Secret required
Repository **Settings → Secrets and variables → Actions → Secrets** must contain:
- `APIFY_API_TOKEN`: the Apify API token (already configured by the repository owner).

No token is embedded in source code or printed in logs. If Apify budget storage cannot be read or written, collection fails closed instead of risking unbounded spending.

## Frequency and limits
The scanner workflow is scheduled at `*/30 * * * *` (every 30 minutes) through GitHub Actions. Each run keeps the strict 30-minute post-freshness rule: older or undated posts are never passed to the EOC API. The Apify budget guard allows at most one chargeable result per 30-minute UTC slot across both platforms, with a daily cap of 50 and monthly cap of 1,000 as additional hard safety limits. Some matching posts may be missed during high-volume periods, and the scraper cannot promise to capture every public post.

The Actors' own keyword search and publication-date ranking can change. The filter in this repository is the final acceptance rule, but it cannot make posts appear in an Actor's returned dataset when that Actor does not return them.

## Validation
The branch-specific `apify_social_tests.yml` workflow runs offline unit tests only. It does not call Apify, Gemini, or EOC and does not consume credits. The production AI Radar workflow is intentionally schedule-only: manual dispatch and the legacy API trigger are disabled. Live authentication and end-to-end delivery have therefore not been verified by an on-demand production scan; do not temporarily enable one without accounting for Apify/Gemini usage and the possibility of writing real news records to EOC.

## Vercel safeguard
Both Vercel configuration files disable branch deployments for `feature/apify-social-radar-budget-2026-10-13` and `fix/osiris-real-incident-validation-2026-10-13` through `git.deploymentEnabled`. That branch-specific guard should be retained until the owner decides how to integrate the change; main-branch production settings are otherwise unchanged.


## Incident validation and budget protection (2026-10-13)
- Social search now uses high-signal event-report phrases rather than the entire generic incident keyword list; this is intended to reduce non-incident posts *before* Apify selects a billable dataset result.
- Facebook's exact-query filter remains enabled, and the 30-minute publication-age condition is unchanged. The Actor supports date/day filters rather than a documented exact 30-minute pre-filter, so strict age validation still happens immediately after retrieval; the one-result charge cap is retained to bound this residual risk.
- A deterministic local gate rejects explicit literary/poetic/fictional wording and figurative posts before deduplication and Gemini. Strongly evidenced incidents pass normally. If Apify has already returned a billable but underspecified incident-shaped post, it may pass to Gemini solely for an explicit `is_real_incident=true` decision; delivery still fails closed without that positive decision. The gate runs again immediately before the EOC API write.
- Gemini is asked to classify whether a candidate describes an actual, specific emergency event; an explicit negative decision blocks the write. If Gemini is unavailable, local validation remains mandatory.
- The Apify result cap, monthly/daily caps, reserved budget accounting, and no-concurrent-run protections are not relaxed. If a paid Actor nevertheless returns an irrelevant result, it is rejected rather than written as a false incident; the search is narrowed to reduce this case. A source-side scraper cannot prove semantic truth before it has returned a post, so this reduces—not mathematically eliminates—the risk of paying for a false positive.
- Added offline regression cases for literary posts, metaphorical language, concrete incidents, and explicit AI rejection. The workflow performs offline tests only and does not call Apify/Gemini/EOC.
