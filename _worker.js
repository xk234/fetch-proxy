/**
 * XK Cloudflare Pages Proxy 2.0 u0-beta
 * ------------------------------------
 * A powerful fetch proxy designed for real-site compatibility.
 *
 * Endpoints:
 *   /:/target                    → plain mode
 *   /:b/<base64>/                → base64 mode (trailing / preferred)
 *   /:e/<encoded>/               → shift+mirror encoding (placeholder, trailing / preferred)
 *
 * All modes accept:
 *   example.com
 *   https://example.com
 *   http://example.com
 *   URI-encoded / Scramjet-style strings
 *
 * Query options (work on every endpoint):
 *   ?xk.proxy.http=0|1          Force HTTP (0) or HTTPS (1). Default = 1
 *   ?xk.proxy.headers=iframe    Header mode (default: iframe / zero-CORS)
 */

const VERSION = "2.0.0-u0-beta";

// ==================== Codec Registry ====================

const codecs = {
  // Plain mode: /:/...
  plain: {
    prefix: "/:/",
    decode(path) {
      // path already has the /:/ stripped by the router
      return path;
    }
  },

  // Base64 mode: /:b/<base64url>/
  base64: {
    prefix: "/:b/",
    decode(encoded) {
      try {
        // Support both standard and URL-safe base64
        let str = encoded.replace(/-/g, "+").replace(/_/g, "/");
        while (str.length % 4) str += "=";
        return atob(str);
      } catch (e) {
        return null;
      }
    }
  },

  // Shift + Mirror encoding placeholder: /:e/<payload>/
  // Simple but effective for now — will be expanded
  shiftmirror: {
    prefix: "/:e/",
    decode(encoded) {
      try {
        // Very lightweight reversible transform for u0-beta
        // Real version will use stronger shuffling later
        const reversed = encoded.split("").reverse().join("");
        let result = "";
        for (let i = 0; i < reversed.length; i++) {
          result += String.fromCharCode(reversed.charCodeAt(i) - 3);
        }
        return result;
      } catch (e) {
        return null;
      }
    }
  }
};

// ==================== Helpers ====================

function parseProxyOptions(url) {
  const params = url.searchParams;
  const options = {
    forceHttp: null,          // null = auto, 0 = force HTTP, 1 = force HTTPS
    headersMode: "iframe"     // default zero-CORS / iframe friendly
  };

  if (params.has("xk.proxy.http")) {
    const v = params.get("xk.proxy.http");
    if (v === "0") options.forceHttp = 0;
    if (v === "1") options.forceHttp = 1;
  }

  if (params.has("xk.proxy.headers")) {
    options.headersMode = params.get("xk.proxy.headers") || "iframe";
  }

  // Strip all xk.proxy.* params so they never reach the target
  const cleanParams = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (!key.startsWith("xk.proxy.")) {
      cleanParams.append(key, value);
    }
  }

  return { options, cleanParams };
}

function normalizeTarget(raw, forceHttp) {
  if (!raw) return null;

  let target = raw.trim();

  // Handle possible double-encoding / Scramjet leftovers
  try {
    if (target.includes("%")) {
      target = decodeURIComponent(target);
    }
  } catch (_) {}

  // If it already has a protocol
  if (/^https?:\/\//i.test(target)) {
    if (forceHttp === 0) {
      target = target.replace(/^https:\/\//i, "http://");
    } else if (forceHttp === 1) {
      target = target.replace(/^http:\/\//i, "https://");
    }
    return target;
  }

  // No protocol → decide based on forceHttp (default HTTPS)
  const protocol = forceHttp === 0 ? "http://" : "https://";
  return protocol + target.replace(/^\/+/, "");
}

function isTextContentType(ct) {
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

function rewriteUrl(url, base, proxyOrigin, codecPrefix = "/:/") {
  if (!url || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("javascript:")) {
    return url;
  }

  try {
    const absolute = new URL(url, base).href;
    // For u0-beta we keep everything in plain mode for maximum compatibility
    return proxyOrigin + codecPrefix + absolute;
  } catch {
    return url;
  }
}

function rewriteHtml(html, baseUrl, proxyOrigin) {
  // Basic but effective rewriting for u0-beta
  // Later versions will use HTMLRewriter / more advanced patterns

  // href / src / action / poster / data-src / srcset (simplified)
  html = html.replace(
    /(href|src|action|poster|data-src|data-href)=["']([^"']+)["']/gi,
    (match, attr, value) => {
      return `${attr}="${rewriteUrl(value, baseUrl, proxyOrigin)}"`;
    }
  );

  // srcset (very basic)
  html = html.replace(
    /srcset=["']([^"']+)["']/gi,
    (match, value) => {
      const parts = value.split(",").map(part => {
        const [url, descriptor] = part.trim().split(/\s+/);
        return rewriteUrl(url, baseUrl, proxyOrigin) + (descriptor ? " " + descriptor : "");
      });
      return `srcset="${parts.join(", ")}"`;
    }
  );

  // CSS url() inside style attributes / style tags (basic)
  html = html.replace(
    /url\(["']?([^"')]+)["']?\)/gi,
    (match, value) => {
      return `url("${rewriteUrl(value, baseUrl, proxyOrigin)}")`;
    }
  );

  return html;
}

function rewriteCss(css, baseUrl, proxyOrigin) {
  return css.replace(
    /url\(["']?([^"')]+)["']?\)/gi,
    (match, value) => {
      return `url("${rewriteUrl(value, baseUrl, proxyOrigin)}")`;
    }
  );
}

function applyHeaderMode(headers, mode) {
  const newHeaders = new Headers(headers);

  // Always useful
  newHeaders.delete("content-security-policy");
  newHeaders.delete("content-security-policy-report-only");
  newHeaders.delete("x-frame-options");
  newHeaders.delete("x-content-type-options");
  newHeaders.delete("strict-transport-security");

  if (mode === "iframe" || mode === "zero") {
    // Zero-CORS / iframe friendly
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH");
    newHeaders.set("Access-Control-Allow-Headers", "*");
    newHeaders.set("Access-Control-Allow-Credentials", "true");
    newHeaders.set("Access-Control-Expose-Headers", "*");
  }

  // Prevent caching issues while developing
  newHeaders.set("Cache-Control", "no-store");

  return newHeaders;
}

// ==================== Main Handler ====================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const proxyOrigin = url.origin;

    // Homepage
    if (path === "/" || path === "") {
      return new Response(homepageHtml(VERSION), {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    // Detect codec
    let codec = null;
    let rawTarget = null;

    if (path.startsWith("/:/")) {
      codec = codecs.plain;
      rawTarget = path.slice(3); // remove /:/
    } else if (path.startsWith("/:b/")) {
      codec = codecs.base64;
      rawTarget = path.slice(4);
      // strip trailing slash if present
      if (rawTarget.endsWith("/")) rawTarget = rawTarget.slice(0, -1);
      rawTarget = codec.decode(rawTarget);
    } else if (path.startsWith("/:e/")) {
      codec = codecs.shiftmirror;
      rawTarget = path.slice(4);
      if (rawTarget.endsWith("/")) rawTarget = rawTarget.slice(0, -1);
      rawTarget = codec.decode(rawTarget);
    }

    if (!codec || !rawTarget) {
      return new Response("Invalid proxy path. Use /:/example.com or /:b/<base64>/ etc.", {
        status: 400,
        headers: { "content-type": "text/plain" }
      });
    }

    // Parse options + clean query
    const { options, cleanParams } = parseProxyOptions(url);

    // Build final target URL
    let targetUrl = normalizeTarget(rawTarget, options.forceHttp);
    if (!targetUrl) {
      return new Response("Could not determine target URL", { status: 400 });
    }

    // Attach remaining query parameters
    try {
      const target = new URL(targetUrl);
      for (const [k, v] of cleanParams.entries()) {
        target.searchParams.append(k, v);
      }
      targetUrl = target.href;
    } catch (e) {
      return new Response("Invalid target URL: " + targetUrl, { status: 400 });
    }

    // Fetch the real site
    let upstream;
    try {
      const init = {
        method: request.method,
        headers: new Headers(request.headers),
        redirect: "manual" // we handle redirects ourselves
      };

      // Clean some request headers
      init.headers.delete("host");
      init.headers.delete("cf-connecting-ip");
      init.headers.delete("cf-ipcountry");
      init.headers.delete("cf-ray");
      init.headers.delete("cf-visitor");
      init.headers.delete("x-forwarded-for");
      init.headers.delete("x-real-ip");

      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
      }

      upstream = await fetch(targetUrl, init);
    } catch (err) {
      return new Response(`Upstream fetch failed: ${err.message}`, {
        status: 502,
        headers: { "content-type": "text/plain" }
      });
    }

    // Handle redirects
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const location = upstream.headers.get("location");
      if (location) {
        const rewritten = rewriteUrl(location, targetUrl, proxyOrigin);
        return new Response(null, {
          status: upstream.status,
          headers: {
            Location: rewritten,
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    }

    const contentType = upstream.headers.get("content-type") || "";
    const headers = applyHeaderMode(upstream.headers, options.headersMode);

    // Binary / non-text → pass through
    if (!isTextContentType(contentType)) {
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers
      });
    }

    // Text content → rewrite
    let body = await upstream.text();

    if (contentType.includes("html")) {
      body = rewriteHtml(body, targetUrl, proxyOrigin);
    } else if (contentType.includes("css")) {
      body = rewriteCss(body, targetUrl, proxyOrigin);
    }
    // JS rewriting can be expanded later

    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });
  }
};

// ==================== Homepage ====================

function homepageHtml(version) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>XK Proxy 2.0 u0-beta</title>
  <style>
    :root { color-scheme: dark; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f0f13;
      color: #e4e4e7;
      max-width: 720px;
      margin: 40px auto;
      padding: 0 20px;
      line-height: 1.6;
    }
    h1 { font-size: 1.8rem; margin-bottom: 0.2em; }
    .version { color: #a1a1aa; font-size: 0.9rem; }
    code, pre {
      background: #18181b;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
    }
    pre { padding: 12px; overflow-x: auto; }
    a { color: #7dd3fc; }
    .box {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
    }
  </style>
</head>
<body>
  <h1>XK Cloudflare Pages Proxy</h1>
  <div class="version">v${version}</div>

  <div class="box">
    <strong>Quick start</strong><br><br>
    <code>/:/example.com</code><br>
    <code>/:/https://example.com/path</code><br>
    <code>/:/y8.com?xk.proxy.http=0</code>
  </div>

  <h3>Endpoints</h3>
  <ul>
    <li><code>/:/</code> — plain</li>
    <li><code>/:b/&lt;base64&gt;/</code> — base64</li>
    <li><code>/:e/&lt;encoded&gt;/</code> — shift+mirror (early)</li>
  </ul>

  <h3>Options (work on all endpoints)</h3>
  <ul>
    <li><code>xk.proxy.http=0|1</code> — force HTTP or HTTPS (default HTTPS)</li>
    <li><code>xk.proxy.headers=iframe</code> — zero-CORS / iframe friendly (default)</li>
  </ul>

  <p style="margin-top: 40px; color: #71717a; font-size: 0.85rem;">
    Built for real-site unblocking. More codecs + stronger rewriting coming.
  </p>
</body>
</html>`;
}
