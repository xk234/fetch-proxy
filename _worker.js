
/**
 * XK Cloudflare Pages Proxy 2.0 — Apex+ Cloak
 * -------------------------------------------------------
 * Sticky-origin proxy + advanced tab cloaking system
 *
 * New:
 *  ?xk.tab.favicon=Google|clever|google.com|...
 *  ?xk.tab.title=Whatever
 *  ?xk.cloak=1|0|yes|no|true|false
 *
 * Cloak creates a blob: page with matching title/favicon,
 * embeds the current proxied page in a fully-permissioned iframe,
 * actively syncs title + favicon, and uses location.replace
 * so the omnibox only shows blob:...
 * (monitoring extensions like Blocksi / GoGuardian cannot see blob: pages)
 */

const VERSION = "2.0.2-apex-cloak";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 100;
const COOKIE_ORIGIN = "xk_origin";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

// Common shortcuts for favicon
const FAVICON_SHORTCUTS = {
  google: "https://www.google.com",
  clever: "https://clever.com",
  canvas: "https://canvas.instructure.com",
  schoology: "https://www.schoology.com",
  classroom: "https://classroom.google.com",
  drive: "https://drive.google.com",
  docs: "https://docs.google.com",
  gmail: "https://mail.google.com",
  outlook: "https://outlook.live.com",
  office: "https://www.office.com",
  microsoft: "https://www.microsoft.com",
  youtube: "https://www.youtube.com",
  github: "https://github.com",
  wikipedia: "https://www.wikipedia.org",
  duckduckgo: "https://duckduckgo.com",
  bing: "https://www.bing.com",
};

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

function truthy(val) {
  if (val == null) return false;
  const v = String(val).toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes" || v === "on";
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
    tabFavicon: params.get("xk.tab.favicon") || null,
    tabTitle: params.get("xk.tab.title") || null,
    cloak: truthy(params.get("xk.cloak")),
  };

  if (params.has("xk.proxy.http")) {
    const v = params.get("xk.proxy.http");
    if (v === "0") result.forceHttp = 0;
    if (v === "1") result.forceHttp = 1;
  }
  if (params.has("xk.proxy.headers")) {
    result.headersMode = params.get("xk.proxy.headers") || "iframe";
  }

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
  if (pathname === "/" || pathname.endsWith("/")) return pathname;
  const last = pathname.split("/").pop() || "";
  if (!last.includes(".")) return pathname + "/";
  return pathname;
}

function resolveFaviconHost(value) {
  if (!value) return null;
  const key = value.toLowerCase().trim();
  if (FAVICON_SHORTCUTS[key]) return FAVICON_SHORTCUTS[key];
  // treat as hostname
  if (key.includes(".") || key.startsWith("http")) {
    try {
      const u = key.startsWith("http") ? new URL(key) : new URL("https://" + key);
      return u.origin;
    } catch {
      return null;
    }
  }
  return null;
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

// ====================== CLIENT CONTROL + CLOAK SCRIPT ======================

function buildClientScript(opts, proxyOrigin) {
  const parts = [];

  // ---- Storage tools ----
  if (opts.lsWipe) {
    parts.push(`
      try { localStorage.clear(); sessionStorage.clear(); console.log("[XK] localStorage wiped"); } catch(e){}
    `);
  }
  if (opts.idbWipe) {
    parts.push(`
      (async()=>{ try {
        const dbs = await indexedDB.databases();
        for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
        console.log("[XK] IndexedDB wiped");
      } catch(e){} })();
    `);
  }
  if (opts.opfsWipe) {
    parts.push(`
      (async()=>{ try {
        if (navigator.storage?.getDirectory) {
          const root = await navigator.storage.getDirectory();
          for await (const [name] of root.entries()) await root.removeEntry(name,{recursive:true});
          console.log("[XK] OPFS wiped");
        }
      } catch(e){} })();
    `);
  }
  if (opts.lsView) {
    parts.push(`
      try {
        const data = {};
        for (let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); data[k]=localStorage.getItem(k); }
        console.log("[XK] localStorage:", data);
        document.body.insertAdjacentHTML("afterbegin", '<pre style="background:#111;color:#0f0;padding:12px;z-index:999999;position:relative;max-height:40vh;overflow:auto">'+JSON.stringify(data,null,2)+'</pre>');
      } catch(e){}
    `);
  }
  if (opts.idbView) {
    parts.push(`
      (async()=>{ try {
        const dbs = await indexedDB.databases();
        console.log("[XK] IDB:", dbs);
        document.body.insertAdjacentHTML("afterbegin", '<pre style="background:#111;color:#0ff;padding:12px;z-index:999999;position:relative">'+JSON.stringify(dbs,null,2)+'</pre>');
      } catch(e){} })();
    `);
  }
  if (opts.opfsView) {
    parts.push(`
      (async()=>{ try {
        if (navigator.storage?.getDirectory) {
          const root = await navigator.storage.getDirectory();
          const entries = [];
          for await (const [name, handle] of root.entries()) entries.push({name, kind: handle.kind});
          console.log("[XK] OPFS:", entries);
          document.body.insertAdjacentHTML("afterbegin", '<pre style="background:#111;color:#ff0;padding:12px;z-index:999999;position:relative">'+JSON.stringify(entries,null,2)+'</pre>');
        }
      } catch(e){} })();
    `);
  }

  // ---- Favicon + Title lock ----
  const faviconHost = opts.tabFavicon ? resolveFaviconHost(opts.tabFavicon) : null;
  const lockedTitle = opts.tabTitle ? JSON.stringify(opts.tabTitle) : null;

  if (faviconHost || lockedTitle) {
    parts.push(`
      (function(){
        const lockedTitle = ${lockedTitle};
        const faviconHost = ${faviconHost ? JSON.stringify(faviconHost) : "null"};

        function setFavicon(href) {
          let link = document.querySelector("link[rel*='icon']");
          if (!link) {
            link = document.createElement("link");
            link.rel = "icon";
            document.head.appendChild(link);
          }
          link.href = href;
        }

        function lockTitle() {
          if (!lockedTitle) return;
          if (document.title !== lockedTitle) document.title = lockedTitle;
        }

        // Initial
        if (lockedTitle) {
          document.title = lockedTitle;
          // Aggressive lock
          const observer = new MutationObserver(lockTitle);
          observer.observe(document.querySelector("title") || document.head, { childList: true, characterData: true, subtree: true });
          setInterval(lockTitle, 800);
          // Also trap common ways pages change title
          const desc = Object.getOwnPropertyDescriptor(Document.prototype, "title");
          if (desc && desc.set) {
            Object.defineProperty(document, "title", {
              get() { return lockedTitle; },
              set() { /* ignore */ },
              configurable: true
            });
          }
        }

        if (faviconHost) {
          // Prefer Google's s2 favicon service (reliable) then direct
          const candidates = [
            "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(faviconHost.replace(/^https?:\\/\\//,"")) + "&sz=64",
            faviconHost + "/favicon.ico",
            faviconHost + "/favicon.png"
          ];
          setFavicon(candidates[0]);
          // Keep it locked
          setInterval(() => setFavicon(candidates[0]), 1500);
        }
      })();
    `);
  }

  // ---- Full Cloak (blob:) ----
  if (opts.cloak) {
    parts.push(`
      (function(){
        // Only run once
        if (window.__xkCloaked) return;
        window.__xkCloaked = true;

        const realUrl = location.href;

        // Capture current title + favicon before we leave
        const currentTitle = document.title || "Loading...";
        let currentFavicon = "";
        const iconLink = document.querySelector("link[rel*='icon']");
        if (iconLink) currentFavicon = iconLink.href;

        // Build the blob page
        const html = \`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>\${currentTitle.replace(/</g,"&lt;")}</title>
\${currentFavicon ? '<link rel="icon" href="'+currentFavicon+'">' : ''}
<style>
  html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#000}
  iframe{border:0;width:100%;height:100%;display:block}
</style>
</head>
<body>
<iframe id="xkframe" src="\${realUrl}" allow="accelerometer; autoplay; camera; clipboard-read; clipboard-write; encrypted-media; fullscreen; geolocation; gyroscope; microphone; midi; payment; picture-in-picture; sync-xhr; usb; xr-spatial-tracking" allowfullscreen></iframe>
<script>
(function(){
  const frame = document.getElementById("xkframe");
  const lockedTitle = \${JSON.stringify(opts.tabTitle || null)};
  const faviconHost = \${faviconHost ? JSON.stringify(faviconHost) : "null"};

  function setFav(href){
    let l = document.querySelector("link[rel*='icon']");
    if(!l){ l=document.createElement("link"); l.rel="icon"; document.head.appendChild(l); }
    l.href = href;
  }

  // Sync title from iframe when possible
  setInterval(() => {
    try {
      if (lockedTitle) {
        document.title = lockedTitle;
      } else if (frame.contentDocument && frame.contentDocument.title) {
        document.title = frame.contentDocument.title;
      }
    } catch(e){}
  }, 600);

  // Keep favicon locked
  if (faviconHost) {
    const href = "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(faviconHost.replace(/^https?:\\/\\//,"")) + "&sz=64";
    setFav(href);
    setInterval(() => setFav(href), 2000);
  } else if (currentFavicon) {
    setInterval(() => setFav(currentFavicon), 2000);
  }

  // Also lock document.title property
  if (lockedTitle) {
    try {
      Object.defineProperty(document, "title", {
        get(){ return lockedTitle; },
        set(){},
        configurable: true
      });
    } catch(e){}
  }
})();
</script>
</body>
</html>\`;

        const blob = new Blob([html], { type: "text/html" });
        const blobUrl = URL.createObjectURL(blob);
        location.replace(blobUrl);
      })();
    `);
  }

  if (parts.length === 0) return "";

  return `<script id="xk-client-control">
(function(){
${parts.join("\n")}
})();
</script>`;
}

function injectClient(html, opts, proxyOrigin) {
  const script = buildClientScript(opts, proxyOrigin);
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

    const guard = await checkBanAndRate(request, env);
    if (guard.blocked) {
      return new Response(
        JSON.stringify({ error: guard.reason, message: guard.message, ipHash: guard.ipHash }),
        {
          status: guard.reason === "banned" ? 403 : 429,
          headers: { "content-type": "application/json", "Retry-After": "60" },
        }
      );
    }

    // ?xk.index → clear sticky
    if (xk.clearIndex) {
      const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
      clearOriginCookie(headers);
      return new Response(homePage(VERSION), { headers });
    }

    let targetUrl = null;
    let isNewSelection = false;
    const sticky = getOriginFromCookie(request);

    // Explicit /:/ or /$/
    if (path.startsWith("/:/") || path.startsWith("/$/")) {
      const raw = path.slice(3);
      targetUrl = normalizeTarget(raw, xk.forceHttp);
      if (targetUrl) {
        try {
          const u = new URL(targetUrl);
          u.pathname = ensureTrailingSlash(u.pathname);
          for (const [k, v] of xk.cleanParams) u.searchParams.append(k, v);
          targetUrl = u.href;
        } catch {}
        isNewSelection = true;
      }
    }

    // Root + sticky → sticky root
    if (!targetUrl && (path === "/" || path === "") && sticky) {
      try {
        const base = new URL(sticky);
        base.pathname = "/";
        base.search = "";
        for (const [k, v] of xk.cleanParams) base.searchParams.append(k, v);
        targetUrl = base.href;
      } catch {}
    }

    // Relative + sticky
    if (!targetUrl && sticky) {
      try {
        const base = new URL(sticky);
        let p = path || "/";
        p = ensureTrailingSlash(p);
        base.pathname = p;
        base.search = "";
        for (const [k, v] of xk.cleanParams) base.searchParams.append(k, v);
        targetUrl = base.href;
      } catch {
        return new Response("Invalid sticky origin", { status: 400 });
      }
    }

    // No target → homepage
    if (!targetUrl) {
      return new Response(homePage(VERSION), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Fetch
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

    // Redirects
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

    const responseHeaders = cleanHeaders(upstream.headers, xk.headersMode);
    if (isNewSelection) setOriginCookie(responseHeaders, targetUrl);

    const contentType = upstream.headers.get("content-type") || "";

    if (!isText(contentType)) {
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }

    let body = await upstream.text();

    if (contentType.includes("html")) {
      body = injectClient(body, xk, proxyOrigin);
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
<title>XK Proxy 2.0 — Apex Cloak</title>
<style>
:root{color-scheme:dark}
body{font-family:system-ui,-apple-system,sans-serif;background:#09090b;color:#e4e4e7;max-width:780px;margin:48px auto;padding:0 20px;line-height:1.65}
h1{font-size:1.9rem;margin:0 0 4px}
.ver{color:#a1a1aa;font-size:.9rem;margin-bottom:28px}
.box{background:#18181b;border:1px solid #27272a;border-radius:10px;padding:18px 20px;margin:18px 0}
code{background:#27272a;padding:2px 7px;border-radius:4px;font-size:.88em}
ul{padding-left:1.3em}
li{margin:6px 0}
.badge{display:inline-block;background:#14532d;color:#86efac;font-size:.75rem;padding:2px 8px;border-radius:99px;margin-left:8px}
</style>
</head>
<body>
<h1>XK Proxy 2.0 <span class="badge">Apex Cloak</span></h1>
<div class="ver">v${version}</div>

<div class="box">
<strong>Basic</strong><br><br>
<code>/:/duckduckgo.com</code><br>
<code>/:/y8.com?xk.proxy.http=0</code><br>
<code>?xk.index</code> — clear sticky origin
</div>

<div class="box">
<strong>Tab cloaking</strong><br><br>
<code>?xk.tab.favicon=Google</code> or <code>clever</code> or <code>google.com</code><br>
<code>?xk.tab.title=Google Classroom</code><br>
<code>?xk.cloak=1</code> (or yes / true) — full blob: cloak<br><br>
Example:<br>
<code>/:/duckduckgo.com?xk.tab.favicon=Google&xk.tab.title=Google&xk.cloak=1</code>
</div>

<div class="box">
<strong>Storage tools</strong><br><br>
<code>?xk.ls.wipe</code> / <code>?xk.ls.view</code><br>
<code>?xk.idb.wipe</code> / <code>?xk.idb.view</code><br>
<code>?xk.opfs.wipe</code> / <code>?xk.opfs.view</code>
</div>

<p style="color:#71717a;font-size:.88rem;margin-top:36px">
After setting a site, the root of this proxy loads that site.
Cloak turns the page into a blob: so monitoring extensions cannot see the real URL.
</p>
</body>
</html>`;
}
