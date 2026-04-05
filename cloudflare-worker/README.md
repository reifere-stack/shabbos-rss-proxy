# Shabbos Dashboard RSS Proxy

Cloudflare Worker that caches RSS feeds for 1 hour at the edge, so thousands of users can share the same cached response instead of each hitting rss2json.com directly.

## Deploy in One Click

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/reifere-stack/shabbos-dashboard)

1. Click the button above
2. Sign in or create a free Cloudflare account (no credit card needed)
3. Cloudflare will deploy the worker automatically
4. Copy the worker URL it gives you (looks like `https://shabbos-rss-proxy.YOUR-NAME.workers.dev`)
5. Open `index.html` in this repo, find `const RSS_PROXY_URL = '';` and paste your URL there

## Free Tier Limits

Cloudflare Workers free tier: **100,000 requests/day** — enough for thousands of users.
Each RSS feed is cached for 1 hour, so only 1 request per feed per hour hits rss2json.com regardless of user count.
