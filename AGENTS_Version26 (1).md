## What are Apify Actors?

- Actors are serverless cloud programs that can perform anything from a simple action, like filling out a web form, to a complex operation, like crawling an entire website or removing duplicates from a large dataset.
- Actors are programs packaged as Docker images, which accept a well-defined JSON input, perform an action, and optionally produce a well-defined JSON output.

This Actor ("Tech Stack Monitor scraper") crawls pages and uses HTML heuristics to detect frameworks, CDNs, analytics and common platform signatures.

Do:
- Respect robots.txt and site Terms of Service.
- Use proxies and reasonable concurrency for production runs.
- Switch to PlaywrightCrawler when target pages are client-side rendered or require executing JS (the Cheerio approach is fast but only sees server HTML).

Next steps you may want:
- Add PlaywrightCrawler version to evaluate window/global variables (React devtools, window.__NEXT_DATA__, etc.).
- Integrate Wappalyzer or a signatures database for more accurate detection.
- Add scheduling to scan a site periodically and store diffs (tech changes over time).
- Add normalized output (one row per detected technology per site) or export to external API/DB.

If you'd like, I can implement any of those next steps now.