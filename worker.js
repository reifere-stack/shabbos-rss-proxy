/**
 * Shabbos Dashboard - RSS Proxy Cache
 * Cloudflare Worker
 * 
 * - Fetches RSS feeds from rss2json.com
 * - Caches responses for 1 hour in Cloudflare's edge cache
 * - Serves cached results to all users (no rate limiting)
 * - CORS headers allow browser requests from any origin
 */

const CACHE_TTL = 3600; // 1 hour in seconds

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Only allow GET
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    
    // Route: /rss?url=ENCODED_RSS_URL
    if (url.pathname === '/rss') {
      const rssUrl = url.searchParams.get('url');
      if (!rssUrl) {
        return jsonResponse({ error: 'Missing url parameter' }, 400);
      }

      // Use Cloudflare Cache API - keyed by the RSS URL
      const cacheKey = new Request('https://rss-cache/' + btoa(rssUrl).slice(0, 64), request);
      const cache = caches.default;

      // Check cache first
      let cached = await cache.match(cacheKey);
      if (cached) {
        const body = await cached.text();
        return new Response(body, {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'X-Cache': 'HIT',
            'Cache-Control': 'public, max-age=' + CACHE_TTL,
          },
        });
      }

      // Fetch fresh from rss2json
      try {
        const rss2jsonUrl = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(rssUrl);
        const resp = await fetch(rss2jsonUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ShabbosBot/1.0)' },
          cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
        });

        if (!resp.ok) {
          return jsonResponse({ status: 'error', message: 'Upstream error: ' + resp.status }, 502);
        }

        const data = await resp.json();
        const body = JSON.stringify(data);

        // Store in cache
        const responseToCache = new Response(body, {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'X-Cache': 'MISS',
            'Cache-Control': 'public, max-age=' + CACHE_TTL,
          },
        });
        ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));

        return new Response(body, {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'X-Cache': 'MISS',
            'Cache-Control': 'public, max-age=' + CACHE_TTL,
          },
        });
      } catch (err) {
        return jsonResponse({ status: 'error', message: err.message }, 500);
      }
    }

    // Health check
    if (url.pathname === '/') {
      return new Response(JSON.stringify({ status: 'ok', service: 'Shabbos RSS Proxy' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
