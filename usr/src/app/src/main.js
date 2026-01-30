// Tech Stack Monitor scraper (Cheerio + Crawlee)
// Detects common front-end frameworks, CDNs, analytics and platform signatures.

import { Actor } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
  startUrls = ['https://example.com'],
  maxRequestsPerCrawl = 200,
  followInternalOnly = true,
  detectCdnsAndLibraries = true,
  enqueueLinks: shouldEnqueue = false,
} = input;

// Basic technology signatures (heuristics). Extend as needed.
const TECH_SIGNALS = [
  { name: 'React', test: (html, scripts) => /react(?:dom)?/i.test(html) || scripts.some(s => /react(?:\.min)?\.js|react-dom/i.test(s)) },
  { name: 'Vue', test: (html, scripts) => /vue(?:\.|js)?/i.test(html) || scripts.some(s => /vue(?:\.runtime)?(?:\.min)?\.js/i.test(s)) },
  { name: 'Angular', test: (html, scripts) => /angular(?!-js)/i.test(html) || scripts.some(s => /angular(?:\.min)?\.js|ng-app/i.test(s)) },
  { name: 'Next.js', test: (html, scripts) => /nextjs|next\-data/i.test(html) || scripts.some(s => /_next\/static/i.test(s)) },
  { name: 'Gatsby', test: (html, scripts) => /gatsby\-js/i.test(html) || /gatsby\-prefetch/i.test(html) },
  { name: 'jQuery', test: (html, scripts) => /jquery/i.test(html) || scripts.some(s => /jquery(?:\.min)?\.js/i.test(s)) },
  { name: 'WordPress', test: (html, scripts) => /wp-content|wp-includes|wordpress/i.test(html) || /generator" content="WordPress/i.test(html) },
  { name: 'Shopify', test: (html, scripts) => /cdn\.shopify\.com|myshopify\.com/i.test(html) || /Shopify/i.test(html) },
  { name: 'Vercel', test: (html, scripts) => /vercel/i.test(html) || /x-vercel-id/i.test(html) },
  { name: 'Cloudflare', test: (html, scripts) => /cloudflare/i.test(html) || /cf-cache-status|server: cloudflare/i.test(html) },
  { name: 'Google Analytics', test: (html, scripts) => /gtag\(|ga\(|google-analytics/i.test(html) || scripts.some(s => /googletagmanager|google-analytics|gtag/i.test(s)) },
  { name: 'Segment', test: (html, scripts) => /analytics\.segment\.io|window.analytics/i.test(html) },
  { name: 'Hotjar', test: (html, scripts) => /hotjar/i.test(html) },
  { name: 'Stripe', test: (html, scripts) => /js\.stripe\-v3|stripe\.com/i.test(html) },
  { name: 'Microsoft IIS', test: (html, scripts) => /X-Powered-By: ASP\.NET|IIS/i.test(html) || /server: Microsoft-IIS/i.test(html) },
  // Add more as required
];

// Hosts/strings to treat as CDNs or libraries
const CDN_HOST_SIGS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'ajax.googleapis.com',
  'cdn.shopify.com',
  'googletagmanager.com',
  'www.googletagmanager.com',
  'cdn.segment.com',
  'cdn.syndication.twimg.com',
  'cdn.ampproject.org'
];

const proxyConfiguration = await Actor.createProxyConfiguration();

const crawler = new CheerioCrawler({
  proxyConfiguration,
  maxRequestsPerCrawl,
  async requestHandler({ request, $, enqueueLinks, log }) {
    const url = request.loadedUrl ?? request.url;
    log.info('Processing', { url });

    // Optionally enqueue internal links for a site scan
    if (shouldEnqueue) {
      await enqueueLinks({
        globs: ['**/*'],
        transformRequestFunction: (r) => {
          if (followInternalOnly) {
            try {
              const startHost = new URL(request.userData.startHost || request.url).host;
              if (new URL(r.url).host !== startHost) return null;
            } catch (e) {
              return null;
            }
          }
          return r;
        },
        userData: { startHost: request.userData.startHost || new URL(url).host },
      });
    }

    try {
      const html = $.root().html() || '';
      const title = $('title').first().text().trim() || '';
      const metaGenerator = $('meta[name="generator"]').attr('content') || $('meta[name="Generator"]').attr('content') || '';
      const scripts = $('script[src]').map((i, el) => $(el).attr('src')).get().filter(Boolean);
      const inlineScripts = $('script:not([src])').map((i, el) => $(el).text().slice(0, 200)).get();
      const links = $('link[rel="preconnect"], link[rel="preload"], link[rel="dns-prefetch"]').map((i, el) => $(el).attr('href')).get().filter(Boolean);

      // Detect CDNs/hosts
      const cdns = [];
      for (const s of scripts.concat(links)) {
        try {
          const host = new URL(s, url).host;
          if (CDN_HOST_SIGS.some(sig => host.includes(sig))) cdns.push(host);
        } catch (e) {
          // skip invalid
        }
      }
      // Deduplicate
      const cdnsUnique = Array.from(new Set(cdns));

      // Server/generator heuristics from meta or common strings in HTML
      let server = metaGenerator || '';
      if (!server) {
        const lower = html.toLowerCase();
        if (lower.includes('wordpress')) server = 'WordPress';
        else if (lower.includes('shopify')) server = 'Shopify';
        else if (lower.includes('vercel')) server = 'Vercel';
      }

      // Detect analytics libraries separately
      const analytics = [];
      if (/gtag\(|google-analytics|analytics.js/i.test(html) || scripts.some(s => /googletagmanager|google-analytics/i.test(s))) analytics.push('Google Analytics');
      if (/hotjar/i.test(html) || scripts.some(s => /hotjar/i.test(s))) analytics.push('Hotjar');
      if (/segment/i.test(html) || scripts.some(s => /segment/i.test(s))) analytics.push('Segment');

      // Run TECH_SIGNALS tests
      const techs = [];
      for (const sig of TECH_SIGNALS) {
        try {
          if (sig.test(html, scripts.concat(inlineScripts))) techs.push(sig.name);
        } catch (e) {
          // ignore per-signal errors
        }
      }
      if (metaGenerator && !techs.includes(metaGenerator)) techs.push(metaGenerator);

      // Also inspect <meta name="keywords"> and body for obvious platform mentions
      const metaKeywords = $('meta[name="keywords"]').attr('content') || '';
      if (/shopify/i.test(metaKeywords) && !techs.includes('Shopify')) techs.push('Shopify');

      // Collect full script src list and first-party script count
      const parsedScripts = scripts.map(s => {
        try {
          const u = new URL(s, url);
          return { src: u.toString(), host: u.host };
        } catch (e) {
          return { src: s, host: '' };
        }
      });

      const detected_via = [];
      if (cdnsUnique.length) detected_via.push('cdn-hosts');
      if (analytics.length) detected_via.push('analytics-snippets');
      if (metaGenerator) detected_via.push('meta-generator');
      if (inlineScripts.length) detected_via.push('inline-script-snippets');

      // Save result
      await Dataset.pushData({
        url,
        title,
        technologies: techs,
        cdns: cdnsUnique,
        analytics,
        scripts: parsedScripts.slice(0, 50),
        meta_generator: metaGenerator,
        server,
        detected_via,
        timestamp: new Date().toISOString(),
      });

      log.info('Saved tech-stack record', { url, tech_count: techs.length });
    } catch (err) {
      log.warning('Extraction failed', { url, message: err.message });
    }
  },
});

const startRequests = (startUrls || []).map((u) => {
  try {
    const parsed = new URL(u);
    return { url: u, userData: { startHost: parsed.host } };
  } catch (e) {
    return { url: u, userData: {} };
  }
});

await crawler.run(startRequests);
await Actor.exit();
