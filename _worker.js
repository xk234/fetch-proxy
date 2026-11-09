
/**
 * XK Cloudflare Pages Proxy 2.0 — Apex+
 * -------------------------------------------------------
 * Sticky-origin proxy that actually works on real sites
 * (DuckDuckGo, MacVG-style hubs, etc.)
 *
 * New in this build:
 *  - Root `/` is overridden by the sticky hostname
 *  - ?xk.index          → clear sticky origin, show real homepage
 *  - ?xk.ls.wipe        → wipe localStorage
 *  - ?xk.idb.wipe       → wipe IndexedDB
 *  - ?xk.opfs.wipe      → wipe Origin Private File System
 *  - ?xk.ls.view / ?xk.idb.view / ?xk.opfs.view → simple viewers
 *  - Trailing-slash normalization (these proxies work better with it)
 *  - Per-IP rate limit 100/min + device IP-hash bans
 */

const VERSION = "2.0.1-apex+";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 100;
const COOKIE_ORIGIN = "xk_origin";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// ====================== HELPERS ======================

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
    .slice(0, 24);
}

function parseAllXkParams(url) {
  const params = url.searchParams;
  const result = {
    forceHttp: null,
    headersMode: "iframe",
    clearIndex: params.has("xk.index"),
    lsWipe: params.has("xk.ls.wipe"),
    lsView: params.has("xk.ls.view"),
    idbWipe: params.has("xk.idb.wipe"),
    idbView: params.has("xk.idb.view"),
    opfsWipe: params.has("xk.opfs.wipe"),
    opfsView: params.has("xk.opfs.view"),
  };

  if (params.has("xk.proxy.http")) {
    const v = params.get("xk.proxy.http");
    if (v === "0") result.forceHttp = 0;
    if (v === "1") result.forceHttp = 1;
  }
  if (params.has("xk.proxy.headers")) {
    result.headersMode = params.get("xk.proxy.headers") || "iframe";
  }

  // Clean params that should never reach the target
  const clean = new URLSearchParams();
  for (const [k, v] of params.entries()) {
    if (!k.startsWith("xk.")) clean.append(k, v);
  }
  result.cleanParams = clean;
  return result;
}

function normalizeTarget(raw, forceHttp) {
  if (!raw) return null;
  let t = raw.trim();
  try {
    if (t.includes("%")) t = decodeURIComponent(t);
  } catch {}

  if (/^https?:\/\//i.test(t)) {
    if (forceHttp === 0) t = t.replace(/^https:\/\//i, "http://");
    else if (forceHttp === 1) t = t.replace(/^http:\/\//i, "https://");
    return t;
  }
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

function cleanHeaders(headers, mode = "iframe") {
  const h = new Headers(headers);
  [
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
  ].forEach((k) => h.delete(k));

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

function clearOriginCookie(headers) {
  headers.append(
    "Set-Cookie",
    `${COOKIE_ORIGIN}=; Path=/; Max-Age=0; Secure; SameSite=Lax`
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

function ensureTrailingSlash(pathname) {
  // Many static sites and game hubs expect trailing slash on directories
  if (pathname === "/" || pathname.endsWith("/")) return pathname;
  // Heuristic: if it looks like a directory (no extension), add slash
  const last = pathname.split("/").pop() || "";
  if (!last.includes(".")) return pathname + "/";
  return pathname;
}

// ====================== RATE LIMIT + BAN ======================

async function checkBanAndRate(request, env) {
  const ip = getClientIP(request);
  const ipHash = await hashIP(ip);

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

  if (env.RATE_LIMIT) {
    const key = `rl:${ipHash}:${Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS)}`;
    let count = parseInt((await env.RATE_LIMIT.get(key)) || "0", 10);
    if (count >= RATE_LIMIT_MAX) {
      return {
        blocked: true,
        reason: "rate",
        message: `Rate limit exceeded (${RATE_LIMIT_MAX} req/min).`,
        ipHash,
      };
    }
    await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 120 });
  }

  return { blocked: false, ipHash };
}

// ====================== CLIENT CONTROL SCRIPT ======================

function buildControlScript(opts) {
  // Injected only when a wipe/view command is present
  const actions = [];

  if (opts.lsWipe) {
    actions.push(`
      try {
        localStorage.clear();
        sessionStorage.clear();
        console.log("[XK] localStorage + sessionStorage wiped");
      } catch(e){ console.error(e); }
    `);
  }

  if (opts.idbWipe) {
    actions.push(`
      (async () => {
        try {
          const dbs = await indexedDB.databases();
          for (const db of dbs) {
            if (db.name) indexedDB.deleteDatabase(db.name);
          }
          console.log("[XK] IndexedDB wiped");
        } catch(e){ console.error(e); }
      })();
    `);
  }

  if (opts.opfsWipe) {
    actions.push(`
      (async () => {
        try {
          if (navigator.storage && navigator.storage.getDirectory) {
            const root = await navigator.storage.getDirectory();
            for await (const [name] of root.entries()) {
              await root.removeEntry(name, { recursive: true });
            }
            console.log("[XK] OPFS wiped");
          }
        } catch(e){ console.error(e); }
      })();
    `);
  }

  // Simple viewers
  if (opts.lsView) {
    actions.push(`
      try {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          data[k] = localStorage.getItem(k);
        }
        console.log("[XK] localStorage contents:", data);
        document.body.insertAdjacentHTML("afterbegin",
          '<pre style="background:#111;color:#0f0;padding:12px;z-index:99999;position:relative;max-height:40vh;overflow:auto">' +
          JSON.stringify(data, null, 2) + "</pre>");
      } catch(e){ console.error(e); }
    `);
  }

  if (opts.idbView) {
    actions.push(`
      (async () => {
        try {
          const dbs = await indexedDB.databases();
          console.log("[XK] IndexedDB databases:", dbs);
          document.body.insertAdjacentHTML("afterbegin",
            '<pre style="background:#111;color:#0ff;padding:12px;z-index:99999;position:relative">' +
            JSON.stringify(dbs, null, 2) + "</pre>");
        } catch(e){ console.error(e); }
      })();
    `);
  }

  if (opts.opfsView) {
    actions.push(`
      (async () => {
        try {
          if (navigator.storage && navigator.storage.getDirectory) {
            const root = await navigator.storage.getDirectory();
            const entries = [];
            for await (const [name, handle] of root.entries()) {
              entries.push({ name, kind: handle.kind });
            }
            console.log("[XK] OPFS entries:", entries);
            document.body.insertAdjacentHTML("afterbegin",
              '<pre style="background:#111;color:#ff0;padding:12px;z-index:99999;position:relative">' +
              JSON.stringify(entries, null, 2) + "</pre>");
          }
        } catch(e){ console.error(e); }
      })();
    `);
  }

  if (actions.length === 0) return "";

  return `<script id="xk-control">
(function(){
  ${actions.join("\n")}
})();
</script>`;
}

function injectControl(html, opts) {
  const script = buildControlScript(opts);
  if (!script) return html;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, script + "</head>");
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, script + "</body>");
  }
  return html + script;
}

// ====================== MAIN ======================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let path = url.pathname;
    const proxyOrigin = url.origin;
    const xk = parseAllXkParams(url);

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

    // ---------- Rate limit + ban ----------
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
          headers: { "content-type": "application/json", "Retry-After": "60" },
        }
      );
    }

    // ---------- ?xk.index → clear sticky and show real homepage ----------
    if (xk.clearIndex) {
      const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
      clearOriginCookie(headers);
      return new Response(homePage(VERSION), { headers });
    }

    // ---------- Determine target ----------
    let targetUrl = null;
    let isNewSelection = false;
    let sticky = getOriginFromCookie(request);

    // Explicit selection via /:/ or /$/
    if (path.startsWith("/:/") || path.startsWith("/$/")) {
      const raw = path.startsWith("/:/") ? path.slice(3) : path.slice(3);
      targetUrl = normalizeTarget(raw, xk.forceHttp);
      if (targetUrl) {
        try {
          const u = new URL(targetUrl);
          // trailing slash preference for directory-like paths
          u.pathname = ensureTrailingSlash(u.pathname);
          for (const [k, v] of xk.cleanParams) u.searchParams.append(k, v);
          targetUrl = u.href;
        } catch {}
        isNewSelection = true;
      }
    }

    // Root path + sticky origin → treat as the sticky site's root
    if (!targetUrl && (path === "/" || path === "") && sticky) {
      try {
        const base = new URL(sticky);
        base.pathname = "/";
        base.search = url.search; // keep any non-xk params
        // strip xk.* from the search we forward
        for (const key of [...base.searchParams.keys()]) {
          if (key.startsWith("xk.")) base.searchParams.delete(key);
        }
        targetUrl = base.href;
      } catch {}
    }

    // Normal relative request while sticky is set
    if (!targetUrl && sticky) {
      try {
        const base = new URL(sticky);
        let p = path || "/";
        // Prefer trailing slash on extension-less paths
        p = ensureTrailingSlash(p);
        base.pathname = p;
        base.search = url.search;
        for (const key of [...base.searchParams.keys()]) {
          if (key.startsWith("xk.")) base.searchParams.delete(key);
        }
        targetUrl = base.href;
      } catch {
        return new Response("Invalid sticky origin", { status: 400 });
      }
    }

    // No target and no sticky → real homepage
    if (!targetUrl) {
      return new Response(homePage(VERSION), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
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

    // ---------- Redirects ----------
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const loc = upstream.headers.get("location");
      if (loc) {
        let newLoc = loc;
        try {
          const abs = new URL(loc, targetUrl).href;
          newLoc = proxyOrigin + "/:/" + abs;
        } catch {}
        const h = new Headers({ Location: newLoc, "Access-Control-Allow-Origin": "*" });
        if (isNewSelection) setOriginCookie(h, targetUrl);
        return new Response(null, { status: upstream.status, headers: h });
      }
    }

    // ---------- Build response ----------
    const responseHeaders = cleanHeaders(upstream.headers, xk.headersMode);

    if (isNewSelection) {
      setOriginCookie(responseHeaders, targetUrl);
    }

    const contentType = upstream.headers.get("content-type") || "";

    // Binary passthrough
    if (!isText(contentType)) {
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }

    let body = await upstream.text();

    // Inject control scripts when wipe/view is requested
    if (contentType.includes("html")) {
      body = injectControl(body, xk);
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
<title>XK Proxy 2.0 — Apex+</title>
<style>
:root{color-scheme:dark}
body{font-family:system-ui,-apple-system,sans-serif;background:#09090b;color:#e4e4e7;max-width:760px;margin:48px auto;padding:0 20px;line-height:1.65}
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
<h1>XK Proxy 2.0 <span class="badge">Apex+</span></h1>
<div class="ver">v${version}</div>

<div class="box">
<strong>Quick start</strong><br><br>
<code>/:/duckduckgo.com</code><br>
<code>/:/https://example.com/path/</code><br>
<code>/:/y8.com?xk.proxy.http=0</code>
</div>

<div class="box">
<strong>Special commands</strong><br><br>
<code>?xk.index</code> — clear sticky origin and return here<br>
<code>?xk.ls.wipe</code> — wipe localStorage + sessionStorage<br>
<code>?xk.idb.wipe</code> — wipe IndexedDB<br>
<code>?xk.opfs.wipe</code> — wipe Origin Private File System<br>
<code>?xk.ls.view</code> / <code>?xk.idb.view</code> / <code>?xk.opfs.view</code> — viewers
</div>

<p style="color:#71717a;font-size:.88rem;margin-top:36px">
After you set a site, just visiting the root of this proxy will load that site.
Use <code>?xk.index</code> any time you want the real homepage back.
</p>
</body>
</html>`;
}
