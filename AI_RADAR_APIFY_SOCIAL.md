# EOC AI Radar — Apify social collection

## What this change does
- Connects the existing AI Radar to the two configured Apify Actors: `topapi~facebook-search-posts-scraper` and `seemuapps~instagram-keyword-posts-scraper`.
- Searches with the same incident keywords used by the existing RSS/news scanner.
- Accepts a social post only when it has an explicit publication timestamp no older than 30 minutes, a matching keyword, and a usable post URL. Unknown timestamps fail closed.
- Sends accepted posts into the existing multi-source deduplication, AI/fallback analysis, and EOC API flow.
- Limits collection to at most one chargeable result per 30-minute UTC slot across both platforms. The preferred platform alternates; the other is queried in the same slot only if the preferred Actor returns a confirmed empty/non-billable result.
- Uses the Apify API's `maxItems=1` per Actor request and `maxTotalChargeUsd=0.01` as a per-run charge guard. Facebook also has an Actor-level `maxItems=1` and monitor mode. Extra Instagram dataset rows, if returned despite the charge cap, are not forwarded; the newest timestamped matching row is selected.
- Stores the monthly and daily counters in an Apify named Key-Value Store, not on the ephemeral GitHub runner. The limits default to 1,000 chargeable result slots per UTC month and 50 per UTC day. With at most 48 half-hour slots in a day, the upper bound is 960 slots per 20 days, so 1,000 results last at least 20 days under normal scheduled operation. Low volume extends this further.

## Secret required
Repository **Settings → Secrets and variables → Actions → Secrets** must contain:
- `APIFY_API_TOKEN`: the Apify API token (already configured by the repository owner).

No token is embedded in source code or printed in logs. If Apify budget storage cannot be read or written, collection fails closed instead of risking unbounded spending.

## Frequency and limits
The scanner workflow is scheduled at `*/30 * * * *` (every 30 minutes). The freshness test remains strict and is applied immediately after each Actor returns; older or undated posts are never passed to the EOC API. Because the result budget allows only one paid social result per half-hour slot across two platforms, some matching posts may be missed during periods of high volume. This is the deliberate trade-off for a predictable result budget; it does not promise to capture every public post.

The Actors' own keyword search and publication-date ranking can change. The filter in this repository is the final acceptance rule, but it cannot make posts appear in an Actor's returned dataset when that Actor does not return them.

## Validation
The branch-specific `apify_social_tests.yml` workflow runs offline unit tests only. It does not call Apify, Gemini, or EOC and does not consume credits. Live authentication and end-to-end delivery require a manually initiated production-like scan; that live scan was not run during implementation to avoid spending the owner's Apify balance or inserting test records into EOC.

## Vercel safeguard
Both Vercel configuration files disable branch deployments for `feature/apify-social-radar-budget-2026-10-13` through `git.deploymentEnabled`. That branch-specific guard should be retained until the owner decides how to integrate the change; main-branch production settings are otherwise unchanged.
