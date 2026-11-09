
/**
 * XK Cloudflare Pages Proxy 2.0
 * "Apex" build — genuinely powerful sticky-origin proxy
 * -------------------------------------------------------
 * Based on the proven cookie-sticky design that made the old
 * git-5y9 proxy work for MacVG / Seraph, but massively upgraded.
 *
 * Features:
 *  - Sticky origin via cookie (the key that made the old one work)
 *  - /:/target  (plain) + future /:b/ /:e/ support
 *  - Protocol force (xk.proxy.http=0|1)
 *  - Aggressive header cleaning (iframe / zero-CORS)
 *  - Absolute URL rewriting so navigation stays inside proxy
 *  - Per-IP rate limit: 100 requests / minute
 *  - Device-IP hash bans (permanent until manually cleared)
 *  - Clean error pages
 *  - Ready for KV binding (RATE_LIMIT + BANS)
 */

const VERSION = "2.0.0-apex";

// ====================== CONFIG ======================

const RATE_LIMIT_WINDOW_MS = 60 * 1000;      // 1 minute
const RATE_LIMIT_MAX = 100;                  // 100 requests per minute per IP
const COOKIE_ORIGIN = "xk_origin";           // sticky origin cookie
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;     // 7 days

// ====================== UTILITIES ======================

function getClientIP(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "0.0.0.0"
  );
}

async function hashIP(ip) {
  const data = new TextEncoder().encode(ip + "|xk-proxy-salt-v2");
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24); // short but unique enough
}

function parseProxyOptions(url) {
  const params = url.searchParams;
  const options = {
    forceHttp: null, // null = keep as-is / default https
    headersMode: "iframe",
  };

  if (params.has("xk.proxy.http")) {
    const v = params.get("xk.proxy.http");
    if (v === "0") options.forceHttp = 0;
    if (v === "1") options.forceHttp = 1;
  }
  if (params.has("xk.proxy.headers")) {
    options.headersMode = params.get("xk.proxy.headers") || "iframe";
  }

  // Strip control params
  const clean = new URLSearchParams();
  for (const [k, v] of params.entries()) {
    if (!k.startsWith("xk.proxy.")) clean.append(k, v);
  }
  return { options, cleanParams: clean };
}

function normalizeTarget(raw, forceHttp) {
  if (!raw) return null;
  let t = raw.trim();

  try {
    if (t.includes("%")) t = decodeURIComponent(t);
  } catch {}

  // Already has protocol
  if (/^https?:\/\//i.test(t)) {
    if (forceHttp === 0) t = t.replace(/^https:\/\//i, "http://");
    else if (forceHttp === 1) t = t.replace(/^http:\/\//i, "https://");
    return t;
  }

  // No protocol
  const proto = forceHttp === 0 ? "http://" : "https://";
  return proto + t.replace(/^\/+/, "");
}

function isText(ct) {
  if (!ct) return false;
  ct = ct.toLowerCase();
  return (
    ct.includes("text/") ||
    ct.includes("javascript") ||
    ct.includes("json") ||
    ct.includes("xml") ||
    ct.includes("svg") ||
    ct.includes("xhtml")
  );
}

function rewriteAbsoluteUrls(html, currentOrigin, proxyOrigin) {
  // Rewrite absolute links that point to the real origin so they stay inside the proxy
  // This is the key improvement over pure sticky-cookie for navigation
  try {
    const origin = new URL(currentOrigin).origin;
    const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // href / src / action etc that start with the real origin
    html = html.replace(
      new RegExp(`(href|src|action|poster|data-src|data-href)=["']${escaped}([^"']*)["']`, "gi"),
      (_, attr, path) => `${attr}="${proxyOrigin}/:/${origin}${path}"`
    );

    // plain https://origin/... in text / scripts (light touch)
    html = html.replace(
      new RegExp(escaped, "g"),
      proxyOrigin + "/:/" + origin.replace(/^https?:\/\//, "")
    );
  } catch {}
  return html;
}

function cleanHeaders(headers, mode = "iframe") {
  const h = new Headers(headers);

  // Always strip these
  const strip = [
    "content-security-policy",
    "content-security-policy-report-only",
    "x-frame-options",
    "x-content-type-options",
    "strict-transport-security",
    "cross-origin-opener-policy",
    "cross-origin-embedder-policy",
    "cross-origin-resource-policy",
    "permissions-policy",
    "report-to",
  ];
  strip.forEach((k) => h.delete(k));

  if (mode === "iframe" || mode === "zero") {
    h.set("Access-Control-Allow-Origin", "*");
    h.set("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,DELETE,OPTIONS,PATCH");
    h.set("Access-Control-Allow-Headers", "*");
    h.set("Access-Control-Expose-Headers", "*");
  }

  h.set("Cache-Control", "no-store");
  return h;
}

function setOriginCookie(headers, origin) {
  headers.append(
    "Set-Cookie",
    `${COOKIE_ORIGIN}=${encodeURIComponent(origin)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; Secure; SameSite=Lax`
  );
}

function getOriginFromCookie(request) {
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE_ORIGIN}=([^;]+)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

// ====================== RATE LIMIT + BAN ======================

async function checkBanAndRate(request, env) {
  const ip = getClientIP(request);
  const ipHash = await hashIP(ip);

  // 1. Check permanent / custom ban list (KV)
  if (env.BANS) {
    const banned = await env.BANS.get(`ban:${ipHash}`);
    if (banned) {
      return {
        blocked: true,
        reason: "banned",
        message: "This device has been banned from the proxy.",
        ipHash,
      };
    }
  }

  // 2. Rate limit (100 / min)
  if (env.RATE_LIMIT) {
    const key = `rl:${ipHash}:${Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS)}`;
    let count = parseInt((await env.RATE_LIMIT.get(key)) || "0", 10);

    if (count >= RATE_LIMIT_MAX) {
      return {
        blocked: true,
        reason: "rate",
        message: `Rate limit exceeded (${RATE_LIMIT_MAX} requests per minute).`,
        ipHash,
      };
    }

    // Increment
    await env.RATE_LIMIT.put(key, String(count + 1), {
      expirationTtl: 120, // keep a bit longer than the window
    });
  }

  return { blocked: false, ipHash };
}

// ====================== MAIN ======================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const proxyOrigin = url.origin;

    // ---------- Homepage ----------
    if (path === "/" || path === "") {
      return new Response(homePage(VERSION), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // ---------- CORS preflight ----------
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,DELETE,OPTIONS,PATCH",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // ---------- Ban + Rate Limit ----------
    const guard = await checkBanAndRate(request, env);
    if (guard.blocked) {
      return new Response(
        JSON.stringify({
          error: guard.reason,
          message: guard.message,
          ipHash: guard.ipHash,
        }),
        {
          status: guard.reason === "banned" ? 403 : 429,
          headers: {
            "content-type": "application/json",
            "Retry-After": "60",
          },
        }
      );
    }

    // ---------- Parse target ----------
    let targetUrl = null;
    let isNewSelection = false;

    // New style: /:/target...
    if (path.startsWith("/:/")) {
      const raw = path.slice(3); // after /:/
      const { options, cleanParams } = parseProxyOptions(url);

      targetUrl = normalizeTarget(raw, options.forceHttp);
      if (!targetUrl) {
        return new Response("Invalid target", { status: 400 });
      }

      // Attach remaining query params
      try {
        const u = new URL(targetUrl);
        for (const [k, v] of cleanParams) u.searchParams.append(k, v);
        targetUrl = u.href;
      } catch {
        return new Response("Bad target URL", { status: 400 });
      }

      isNewSelection = true;
    }
    // Legacy compatibility: /$/target (optional, keep for old habits)
    else if (path.startsWith("/$/")) {
      const raw = path.slice(3);
      const { options, cleanParams } = parseProxyOptions(url);
      targetUrl = normalizeTarget(raw, options.forceHttp);
      if (targetUrl) {
        try {
          const u = new URL(targetUrl);
          for (const [k, v] of cleanParams) u.searchParams.append(k, v);
          targetUrl = u.href;
        } catch {}
        isNewSelection = true;
      }
    }

    // ---------- Sticky origin (the secret sauce) ----------
    if (!targetUrl) {
      const sticky = getOriginFromCookie(request);
      if (sticky) {
        // Relative request → attach to sticky origin
        try {
          const base = new URL(sticky);
          base.pathname = path || "/";
          base.search = url.search;
          targetUrl = base.href;
        } catch {
          return new Response("Invalid sticky origin cookie", { status: 400 });
        }
      }
    }

    if (!targetUrl) {
      return new Response(
        "No target selected.\n\nUse /:/example.com  or  /:/https://example.com/path",
        { status: 400, headers: { "content-type": "text/plain" } }
      );
    }

    // ---------- Fetch upstream ----------
    let upstream;
    try {
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.delete("cf-connecting-ip");
      headers.delete("cf-ipcountry");
      headers.delete("cf-ray");
      headers.delete("cf-visitor");
      headers.delete("x-forwarded-for");
      headers.delete("x-real-ip");

      // Optional: present a normal browser UA if missing
      if (!headers.get("user-agent")) {
        headers.set(
          "user-agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );
      }

      upstream = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
      });
    } catch (err) {
      return new Response(`Upstream error: ${err.message}`, {
        status: 502,
        headers: { "content-type": "text/plain" },
      });
    }

    // ---------- Handle redirects ----------
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const loc = upstream.headers.get("location");
      if (loc) {
        let newLoc = loc;
        try {
          // Make absolute then prefix with proxy
          const abs = new URL(loc, targetUrl).href;
          newLoc = proxyOrigin + "/:/" + abs;
        } catch {}
        const h = new Headers();
        h.set("Location", newLoc);
        h.set("Access-Control-Allow-Origin", "*");
        if (isNewSelection) setOriginCookie(h, targetUrl);
        return new Response(null, { status: upstream.status, headers: h });
      }
    }

    // ---------- Prepare response ----------
    const { options } = parseProxyOptions(url);
    const responseHeaders = cleanHeaders(upstream.headers, options.headersMode);

    // Set sticky cookie when user explicitly selected a new target
    if (isNewSelection) {
      setOriginCookie(responseHeaders, targetUrl);
    }

    const contentType = upstream.headers.get("content-type") || "";

    // Binary → pass through
    if (!isText(contentType)) {
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }

    // Text → optional light rewrite
    let body = await upstream.text();

    if (contentType.includes("html") && isNewSelection) {
      // Only do absolute rewriting on the initial selection page
      // (keeps relative assets working via sticky cookie)
      body = rewriteAbsoluteUrls(body, targetUrl, proxyOrigin);
    }

    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};

// ====================== HOMEPAGE ======================

function homePage(version) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>XK Proxy 2.0 — Apex</title>
<style>
:root{color-scheme:dark}
body{font-family:system-ui,-apple-system,sans-serif;background:#09090b;color:#e4e4e7;max-width:740px;margin:48px auto;padding:0 20px;line-height:1.65}
h1{font-size:1.9rem;margin:0 0 4px}
.ver{color:#a1a1aa;font-size:.9rem;margin-bottom:28px}
.box{background:#18181b;border:1px solid #27272a;border-radius:10px;padding:18px 20px;margin:18px 0}
code{background:#27272a;padding:2px 7px;border-radius:4px;font-size:.88em}
pre{background:#18181b;padding:14px;border-radius:8px;overflow-x:auto;border:1px solid #27272a}
a{color:#7dd3fc}
ul{padding-left:1.3em}
li{margin:6px 0}
.badge{display:inline-block;background:#14532d;color:#86efac;font-size:.75rem;padding:2px 8px;border-radius:99px;margin-left:8px}
</style>
</head>
<body>
<h1>XK Proxy 2.0 <span class="badge">Apex</span></h1>
<div class="ver">v${version} — sticky-origin + rate limits + bans</div>

<div class="box">
<strong>Quick start</strong><br><br>
<code>/:/example.com</code><br>
<code>/:/https://example.com/path</code><br>
<code>/:/y8.com?xk.proxy.http=0</code><br>
<code>/:/mac-web.github.io/macvg/</code>
</div>

<h3>Why this version is stronger</h3>
<ul>
<li>Sticky origin cookie (same technique that made the old proxy work for MacVG)</li>
<li>Absolute URL rewriting on first load so navigation stays inside the proxy</li>
<li>Aggressive CSP / X-Frame-Options / COOP / COEP stripping</li>
<li>Zero-CORS / iframe-friendly by default</li>
<li>Per-IP rate limit: <strong>100 requests / minute</strong></li>
<li>Device IP-hash bans (permanent until cleared)</li>
</ul>

<h3>Rate limit &amp; bans</h3>
<p>Requires two KV namespaces bound in Cloudflare Pages:</p>
<pre>RATE_LIMIT   → for the 100/min counter
BANS         → for permanent device bans (key = ban:&lt;ipHash&gt;)</pre>

<p style="color:#71717a;font-size:.88rem;margin-top:40px">
Built to be actually usable on real sites. More codecs and JS rewriting coming next.
</p>
</body>
</html>`;
}
