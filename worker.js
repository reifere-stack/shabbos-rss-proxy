/**
 * Shabbos Dashboard - RSS Proxy Cache
 * Cloudflare Worker
 * 
 * - Fetches RSS feeds DIRECTLY (no rss2json dependency)
 * - Parses XML to JSON on the edge
 * - Caches responses for 1 hour
 * - Serves cached results to all users
 */

const CACHE_TTL = 3600; // 1 hour

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    if (request.method !== 'GET') {
      return jsonResp({ error: 'Method not allowed' }, 405);
    }

    const url = new URL(request.url);

    // Route: /rss?url=ENCODED_RSS_URL
    if (url.pathname === '/rss') {
      const rssUrl = url.searchParams.get('url');
      if (!rssUrl) return jsonResp({ error: 'Missing url param' }, 400);

      // Check cache
      const cacheKey = new Request('https://rss-cache/' + encodeURIComponent(rssUrl));
      const cache = caches.default;
      let cached = await cache.match(cacheKey);
      if (cached) {
        const body = await cached.text();
        return new Response(body, {
          headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
        });
      }

      // Fetch RSS XML directly from source
      try {
        const resp = await fetch(rssUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ShabbosBot/1.0)',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          },
        });

        if (!resp.ok) {
          return jsonResp({ status: 'error', message: 'Feed returned ' + resp.status }, 502);
        }

        const xml = await resp.text();
        const parsed = parseRSS(xml, rssUrl);
        const body = JSON.stringify(parsed);

        // Cache the response
        const toCache = new Response(body, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=' + CACHE_TTL,
            ...corsHeaders(),
          },
        });
        ctx.waitUntil(cache.put(cacheKey, toCache.clone()));

        return new Response(body, {
          headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
        });
      } catch (err) {
        return jsonResp({ status: 'error', message: err.message }, 500);
      }
    }

    // Health
    if (url.pathname === '/') {
      return jsonResp({ status: 'ok', service: 'Shabbos RSS Proxy', cache_ttl: CACHE_TTL });
    }

    return new Response('Not found', { status: 404 });
  },
};

/**
 * Lightweight RSS/Atom XML parser — no dependencies needed.
 * Outputs the same { status, feed, items } format as rss2json
 * so the dashboard doesn't need any changes.
 */
function parseRSS(xml, feedUrl) {
  const items = [];
  const feedTitle = extractTag(xml, 'title') || feedUrl;

  // Try RSS 2.0 <item> tags first, then Atom <entry> tags
  const itemBlocks = extractBlocks(xml, 'item');
  const isAtom = itemBlocks.length === 0;
  const blocks = isAtom ? extractBlocks(xml, 'entry') : itemBlocks;

  for (const block of blocks) {
    const title = decodeEntities(extractTag(block, 'title') || '');
    const link = isAtom
      ? (extractAttr(block, 'link', 'href') || '')
      : (extractTag(block, 'link') || '');
    const description = decodeEntities(extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content:encoded') || extractTag(block, 'content') || '');
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated') || '';
    const author = extractTag(block, 'author') || extractTag(block, 'dc:creator') || '';

    items.push({ title, link, description, pubDate, author });
  }

  return {
    status: 'ok',
    feed: { title: decodeEntities(feedTitle), url: feedUrl },
    items,
  };
}

function extractBlocks(xml, tag) {
  const regex = new RegExp('<' + tag + '[\\s>][\\s\\S]*?<\\/' + tag + '>', 'gi');
  return xml.match(regex) || [];
}

function extractTag(xml, tag) {
  // Handle CDATA
  const cdataRegex = new RegExp('<' + tag + '[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/' + tag + '>', 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  const regex = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function extractAttr(xml, tag, attr) {
  const regex = new RegExp('<' + tag + '[^>]*' + attr + '=["\']([^"\']*)["\']', 'i');
  const match = xml.match(regex);
  return match ? match[1] : '';
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

