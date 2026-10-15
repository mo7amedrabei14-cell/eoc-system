# AI Radar: hourly collection, multi-level dedupe, and social connectors

## Schedule

The workflow `.github/workflows/ai_cron.yml` runs automatically every 30 minutes (GitHub Actions schedule syntax: `*/30 * * * *`). GitHub may delay scheduled starts during busy periods, so this is a half-hour schedule rather than a real-time guarantee. The workflow intentionally has no manual-dispatch trigger; scheduled GitHub Actions runs are the only supported trigger in this repository.

## Duplicate prevention

Before analysis/saving, the radar loads existing AI-news rows from the configured EOC API and compares every candidate at several levels:

1. Canonical URL: normalize host casing, \`www\`, trailing slash, fragments, and known tracking parameters.
2. Arabic-normalized headline: remove diacritics/tatweel, normalize common alef/ya variants, and compare exact normalized titles.
3. Similar headlines inside a 48-hour window, with strict similarity thresholds; when publication timestamps are missing, the threshold is stricter to reduce false positives.
4. Identical or very similar article body inside a 72-hour window when source text is available.
5. Apply the same checks against stored records and earlier candidates in the current run, regardless of whether they came from news RSS or a social platform.

Duplicates are omitted before Gemini analysis and before sending to the API. Existing database rows are not deleted or merged by this job. The database's existing unique constraint/upsert by \`news_link\` remains the final protection for exact URL repeats.

## Social source connectors

Only public posts or content available through credentials and permissions you are authorized to use are fetched. The pipeline is configurable; it does not silently gain access to every post on every platform.

In GitHub repository **Settings → Secrets and variables → Actions**, add the following **Variables** for source identifiers (comma-separated):

| Variable | Purpose |
|---|---|
| \`OSINT_TELEGRAM_CHANNELS\` | Public Telegram channel usernames, without \`@\` |
| \`OSINT_YOUTUBE_CHANNEL_IDS\` | YouTube channel IDs (normally begin with \`UC\`) |
| \`OSINT_REDDIT_SUBREDDITS\` | Subreddit names to monitor |
| \`META_FACEBOOK_PAGE_IDS\` | Facebook Page IDs available to the configured Meta app |
| \`META_INSTAGRAM_USER_IDS\` | Instagram professional-account IDs available to the Meta app |
| \`META_GRAPH_API_VERSION\` | Optional Graph API version override |

Add these **Secrets** only where required:

| Secret | Purpose |
|---|---|
| \`SYSTEM_API_URL\` | Optional active EOC backend base URL, or the full \`/api/ai-news\` endpoint |
| \`X_API_BEARER_TOKEN\` | X API bearer token with recent-search access |
| \`META_ACCESS_TOKEN\` | Meta token with the permissions required for the configured Page/Instagram accounts |
| \`REDDIT_ACCESS_TOKEN\` | Reddit OAuth access token; alternatively configure the four credentials below |
| \`REDDIT_CLIENT_ID\`, \`REDDIT_CLIENT_SECRET\`, \`REDDIT_USERNAME\`, \`REDDIT_PASSWORD\` | Optional Reddit script-app OAuth credentials used to obtain a token for a run |

Telegram public channel previews and public YouTube channel feeds can run without those platform API tokens when channel identifiers are set. X, Facebook, Instagram, and Reddit require approved/valid API credentials and can remain inactive until configured. For platforms without a public feed connector (for example TikTok or Threads), an HTTPS feed URL from a provider you are authorized to use can be added through `OSINT_EXTRA_SOCIAL_FEEDS`; this does not bypass that platform's permissions or API restrictions. No credentials are written into source code. The connectors match incident keywords and recent timestamps, then enter the same dedupe and analysis pipeline as RSS articles.

## Verification

Run the offline regression tests:

\`\`\`powershell
python -m unittest -v test_ai_news_dedupe.py test_social_media_sources.py
python test_ai_radar_resilience.py
\`\`\`

The tests do not contact social networks or Gemini. A live workflow run is still required to verify platform credentials, actual feed availability, API permissions, and end-to-end persistence.
