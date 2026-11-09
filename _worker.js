
/**
 * XK Cloudflare Pages Proxy 2.0 — Apex Cloak
 * ------------------------------------------
 * Sticky-origin proxy with cloaking, no-rewrite mode, IP hiding,
 * and static asset passthrough for /xk/public and /xk/lib.
 *
 * Endpoints:
 *   /:/target          sticky proxy (sets hostname cookie)
 *   /:n/target         no-rewrite, no sticky
 *   /$/target          legacy alias of /:/
 *
 * Control params (all endpoints):
 *   xk.proxy.http=0|1
 *   xk.proxy.headers=iframe|zero
 *   xk.index           clear sticky, show homepage
 *   xk.tab.favicon=Google|clever|google.com|...
 *   xk.tab.title=...
 *   xk.cloak=1|yes|true
 *   xk.allowjs=0|no|false   (strip/disable JS)
 *   xk.ls.wipe / xk.ls.view
 *   xk.idb.wipe / xk.idb.view
 *   xk.opfs.wipe / xk.opfs.view
 */

const VERSION = "2.0.3-apex";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 100;
const COOKIE_ORIGIN = "xk_origin";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

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

const STRIP_RESPONSE_HEADERS = [
  "cf-ray", "cf-cache-status", "cf-request-id", "cf-ipcountry",
  "server", "x-powered-by", "via", "x-served-by", "x-cache", "x-cache-hits",
  "x-timer", "x-edge-location", "x-request-id", "report-to", "nel",
  "content-security-policy", "content-security-policy-report-only",
  "x-frame-options", "x-content-type-options", "strict-transport-security",
  "cross-origin-opener-policy", "cross-origin-embedder-policy",
  "cross-origin-resource-policy", "permissions-policy",
];

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
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

function truthy(val) {
  if (val == null) return false;
  const v = String(val).toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function falsy(val) {
  if (val == null) return false;
  const v = String(val).toLowerCase().trim();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

function parseXk(url) {
  const p = url.searchParams;
  const o = {
    forceHttp: null,
    headersMode: "iframe",
    clearIndex: p.has("xk.index"),
    lsWipe: p.has("xk.ls.wipe"),
    lsView: p.has("xk.ls.view"),
    idbWipe: p.has("xk.idb.wipe"),
    idbView: p.has("xk.idb.view"),
    opfsWipe: p.has("xk.opfs.wipe"),
    opfsView: p.has("xk.opfs.view"),
    tabFavicon: p.get("xk.tab.favicon"),
    tabTitle: p.get("xk.tab.title"),
    cloak: truthy(p.get("xk.cloak")),
    allowJs: true,
  };
  if (p.has("xk.allowjs")) {
    const v = p.get("xk.allowjs");
    if (falsy(v)) o.allowJs = false;
    if (truthy(v)) o.allowJs = true;
  }
  if (p.has("xk.proxy.http")) {
    const v = p.get("xk.proxy.http");
    if (v === "0") o.forceHttp = 0;
    if (v === "1") o.forceHttp = 1;
  }
  if (p.has("xk.proxy.headers")) o.headersMode = p.get("xk.proxy.headers") || "iframe";

  const clean = new URLSearchParams();
  for (const [k, v] of p.entries()) if (!k.startsWith("xk.")) clean.append(k, v);
  o.cleanParams = clean;
  return o;
}

function normalizeTarget(raw, forceHttp) {
  if (!raw) return null;
  let t = raw.trim();
  try { if (t.includes("%")) t = decodeURIComponent(t); } catch {}
  if (/^https?:\/\//i.test(t)) {
    if (forceHttp === 0) t = t.replace(/^https:\/\//i, "http://");
    else if (forceHttp === 1) t = t.replace(/^http:\/\//i, "https://");
    return t;
  }
  return (forceHttp === 0 ? "http://" : "https://") + t.replace(/^\/+/, "");
}

function isText(ct) {
  if (!ct) return false;
  ct = ct.toLowerCase();
  return ct.includes("text/") || ct.includes("javascript") || ct.includes("json") ||
    ct.includes("xml") || ct.includes("svg") || ct.includes("xhtml");
}

function resolveFaviconHost(value) {
  if (!value) return null;
  const key = value.toLowerCase().trim();
  if (FAVICON_SHORTCUTS[key]) return FAVICON_SHORTCUTS[key];
  if (key.includes(".") || key.startsWith("http")) {
    try {
      const u = key.startsWith("http") ? new URL(key) : new URL("https://" + key);
      return u.origin;
    } catch { return null; }
  }
  return null;
}

function ensureTrailingSlash(pathname) {
  if (pathname === "/" || pathname.endsWith("/")) return pathname;
  const last = pathname.split("/").pop() || "";
  if (!last.includes(".")) return pathname + "/";
  return pathname;
}

function setOriginCookie(headers, origin) {
  headers.append("Set-Cookie", COOKIE_ORIGIN + "=" + encodeURIComponent(origin) + "; Path=/; Max-Age=" + COOKIE_MAX_AGE + "; Secure; SameSite=Lax");
}
function clearOriginCookie(headers) {
  headers.append("Set-Cookie", COOKIE_ORIGIN + "=; Path=/; Max-Age=0; Secure; SameSite=Lax");
}
function getOriginFromCookie(request) {
  const cookies = request.headers.get("Cookie") || "";
  const m = cookies.match(new RegExp("(?:^|;\\s*)" + COOKIE_ORIGIN + "=([^;]+)"));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

function cleanResponseHeaders(upstreamHeaders, mode) {
  const h = new Headers(upstreamHeaders);
  for (const k of STRIP_RESPONSE_HEADERS) h.delete(k);
  h.delete("server");
  h.set("Server", "xk");
  if (mode === "iframe" || mode === "zero") {
    h.set("Access-Control-Allow-Origin", "*");
    h.set("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,DELETE,OPTIONS,PATCH");
    h.set("Access-Control-Allow-Headers", "*");
    h.set("Access-Control-Expose-Headers", "*");
  }
  h.set("Cache-Control", "no-store");
  return h;
}

async function checkBanAndRate(request, env) {
  const ip = getClientIP(request);
  const ipHash = await hashIP(ip);
  if (env.BANS) {
    const banned = await env.BANS.get("ban:" + ipHash);
    if (banned) return { blocked: true, reason: "banned", message: "Device banned.", ipHash };
  }
  if (env.RATE_LIMIT) {
    const key = "rl:" + ipHash + ":" + Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
    let count = parseInt((await env.RATE_LIMIT.get(key)) || "0", 10);
    if (count >= RATE_LIMIT_MAX) return { blocked: true, reason: "rate", message: "Rate limit (" + RATE_LIMIT_MAX + "/min).", ipHash };
    await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 120 });
  }
  return { blocked: false, ipHash };
}

function buildClientScript(opts) {
  const chunks = [];

  if (opts.lsWipe) chunks.push('try{localStorage.clear();sessionStorage.clear();}catch(e){}');
  if (opts.idbWipe) chunks.push('(async function(){try{var d=await indexedDB.databases();for(var i=0;i<d.length;i++)if(d[i].name)indexedDB.deleteDatabase(d[i].name);}catch(e){}})();');
  if (opts.opfsWipe) chunks.push('(async function(){try{if(navigator.storage&&navigator.storage.getDirectory){var r=await navigator.storage.getDirectory();for await(var e of r.entries())await r.removeEntry(e[0],{recursive:true});}}catch(e){}})();');
  if (opts.lsView) chunks.push('try{var d={};for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);d[k]=localStorage.getItem(k);}document.body.insertAdjacentHTML("afterbegin","\\u003cpre style=\\"background:#111;color:#0f0;padding:12px;z-index:999999;position:relative;max-height:40vh;overflow:auto\\"\\u003e"+JSON.stringify(d,null,2)+"\\u003c/pre\\u003e");}catch(e){}');
  if (opts.idbView) chunks.push('(async function(){try{var d=await indexedDB.databases();document.body.insertAdjacentHTML("afterbegin","\\u003cpre style=\\"background:#111;color:#0ff;padding:12px;z-index:999999;position:relative\\"\\u003e"+JSON.stringify(d,null,2)+"\\u003c/pre\\u003e");}catch(e){}})();');
  if (opts.opfsView) chunks.push('(async function(){try{if(navigator.storage&&navigator.storage.getDirectory){var r=await navigator.storage.getDirectory();var a=[];for await(var e of r.entries())a.push({name:e[0],kind:e[1].kind});document.body.insertAdjacentHTML("afterbegin","\\u003cpre style=\\"background:#111;color:#ff0;padding:12px;z-index:999999;position:relative\\"\\u003e"+JSON.stringify(a,null,2)+"\\u003c/pre\\u003e");}}catch(e){}})();');

  if (opts.allowJs === false) {
    chunks.push('(function(){try{document.addEventListener("DOMContentLoaded",function(){var n=document.querySelectorAll("script");for(var i=0;i<n.length;i++)n[i].remove();},true);}catch(e){}})();');
  }

  const favHost = opts.tabFavicon ? resolveFaviconHost(opts.tabFavicon) : null;
  if (opts.tabTitle || favHost) {
    const titleJS = opts.tabTitle ? JSON.stringify(opts.tabTitle) : "null";
    const favJS = favHost ? JSON.stringify(favHost) : "null";
    chunks.push(
      '(function(){var T=' + titleJS + ',F=' + favJS + ';' +
      'function setFav(h){var l=document.querySelector("link[rel*=\'icon\']");if(!l){l=document.createElement("link");l.rel="icon";document.head.appendChild(l);}l.href=h;}' +
      'if(T){document.title=T;try{Object.defineProperty(document,"title",{get:function(){return T;},set:function(){},configurable:true});}catch(e){}setInterval(function(){if(document.title!==T)document.title=T;},500);}' +
      'if(F){var u="https://www.google.com/s2/favicons?domain="+encodeURIComponent(F.replace(/^https?:\\/\\//,""))+"&sz=64";setFav(u);setInterval(function(){setFav(u);},1200);}' +
      '})();'
    );
  }

  if (opts.cloak) {
    const titleJS = opts.tabTitle ? JSON.stringify(opts.tabTitle) : "null";
    const favJS = favHost ? JSON.stringify(favHost) : "null";
    chunks.push(
      '(function(){' +
      'if(window.__xkC)return;window.__xkC=1;' +
      'var real=location.href,title=document.title||"...",fav="";' +
      'var il=document.querySelector("link[rel*=\'icon\']");if(il)fav=il.href;' +
      'var h="";' +
      'h+="\\u003c!DOCTYPE html\\u003e\\u003chtml\\u003e\\u003chead\\u003e";' +
      'h+="\\u003cmeta charset=\\"utf-8\\"\\u003e\\u003cmeta name=\\"viewport\\" content=\\"width=device-width,initial-scale=1\\"\\u003e";' +
      'h+="\\u003ctitle\\u003e"+String(title).replace(/</g,"&lt;")+"\\u003c/title\\u003e";' +
      'if(fav)h+="\\u003clink rel=\\"icon\\" href=\\""+fav+"\\"\\u003e";' +
      'h+="\\u003cstyle\\u003ehtml,body{margin:0;height:100%;overflow:hidden;background:#000}iframe{border:0;width:100%;height:100%;display:block}\\u003c/style\\u003e";' +
      'h+="\\u003c/head\\u003e\\u003cbody\\u003e";' +
      'h+="\\u003ciframe id=\\"f\\" src=\\""+real+"\\" allow=\\"accelerometer;autoplay;camera;clipboard-read;clipboard-write;encrypted-media;fullscreen;geolocation;gyroscope;microphone;midi;payment;picture-in-picture;sync-xhr;usb;xr-spatial-tracking\\" allowfullscreen\\u003e\\u003c/iframe\\u003e";' +
      'h+="\\u003cscript\\u003e";' +
      'h+="(function(){var f=document.getElementById(\'f\'),LT=' + titleJS + ',FH=' + favJS + ';" ;' +
      'h+="function sf(u){var l=document.querySelector(\'link[rel*=\\\\\'icon\\\\\']\');if(!l){l=document.createElement(\'link\');l.rel=\'icon\';document.head.appendChild(l);}l.href=u;}";' +
      'h+="setInterval(function(){try{if(LT)document.title=LT;else if(f.contentDocument&&f.contentDocument.title)document.title=f.contentDocument.title;}catch(e){}},600);";' +
      'h+="if(FH){var u=\'https://www.google.com/s2/favicons?domain=\'+encodeURIComponent(String(FH).replace(/^https?:\\\\/\\\\//,\'\'))+\'&sz=64\';sf(u);setInterval(function(){sf(u);},2000);}";' +
      'h+="if(LT){try{Object.defineProperty(document,\'title\',{get:function(){return LT;},set:function(){},configurable:true});}catch(e){}}";' +
      'h+="})();\\u003c/script\\u003e\\u003c/body\\u003e\\u003c/html\\u003e";' +
      'location.replace(URL.createObjectURL(new Blob([h],{type:"text/html"})));' +
      '})();'
    );
  }

  if (!chunks.length) return "";
  return '<script id="xk-ctrl">\n(function(){\n' + chunks.join("\n") + "\n})();\n</script>";
}

function injectClient(html, opts) {
  const script = buildClientScript(opts);
  if (!script) return html;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, script + "</head>");
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, script + "</body>");
  return html + script;
}

function stripScripts(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let path = url.pathname;
    const proxyOrigin = url.origin;
    const xk = parseXk(url);

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

    // Static: /xk/public/* and /xk/lib/* never proxied
    if (path.startsWith("/xk/public/") || path.startsWith("/xk/lib/") || path === "/xk/public" || path === "/xk/lib") {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return fetch(request);
    }

    const guard = await checkBanAndRate(request, env);
    if (guard.blocked) {
      return new Response(JSON.stringify({ error: guard.reason, message: guard.message, ipHash: guard.ipHash }), {
        status: guard.reason === "banned" ? 403 : 429,
        headers: { "content-type": "application/json", "Retry-After": "60", Server: "xk" },
      });
    }

    if (xk.clearIndex) {
      const headers = new Headers({ "content-type": "text/html; charset=utf-8", Server: "xk" });
      clearOriginCookie(headers);
      try {
        const homeReq = new Request(new URL("/xk/public/index.html", proxyOrigin), request);
        const home = env.ASSETS ? await env.ASSETS.fetch(homeReq) : await fetch(homeReq);
        if (home.ok) return new Response(await home.text(), { status: 200, headers });
      } catch {}
      return new Response("Homepage missing. Deploy xk/public/index.html", { status: 500, headers });
    }

    let mode = null;
    let rawTarget = null;

    if (path.startsWith("/:/") || path.startsWith("/$/")) {
      mode = "sticky";
      rawTarget = path.slice(3);
    } else if (path.startsWith("/:n/")) {
      mode = "norewrite";
      rawTarget = path.slice(4);
    }

    let targetUrl = null;
    let isNewSelection = false;
    const sticky = getOriginFromCookie(request);

    if (mode && rawTarget) {
      targetUrl = normalizeTarget(rawTarget, xk.forceHttp);
      if (targetUrl) {
        try {
          const u = new URL(targetUrl);
          if (mode === "sticky") u.pathname = ensureTrailingSlash(u.pathname);
          for (const [k, v] of xk.cleanParams) u.searchParams.append(k, v);
          targetUrl = u.href;
        } catch {}
        isNewSelection = mode === "sticky";
      }
    }

    if (!targetUrl && (path === "/" || path === "") && sticky) {
      try {
        const base = new URL(sticky);
        base.pathname = "/";
        base.search = "";
        for (const [k, v] of xk.cleanParams) base.searchParams.append(k, v);
        targetUrl = base.href;
        mode = "sticky";
      } catch {}
    }

    if (!targetUrl && sticky) {
      try {
        const base = new URL(sticky);
        let p = path || "/";
        p = ensureTrailingSlash(p);
        base.pathname = p;
        base.search = "";
        for (const [k, v] of xk.cleanParams) base.searchParams.append(k, v);
        targetUrl = base.href;
        mode = "sticky";
      } catch {
        return new Response("Invalid sticky origin", { status: 400, headers: { Server: "xk" } });
      }
    }

    if (!targetUrl) {
      try {
        const homeReq = new Request(new URL("/xk/public/index.html", proxyOrigin), request);
        const home = env.ASSETS ? await env.ASSETS.fetch(homeReq) : await fetch(homeReq);
        if (home.ok) {
          return new Response(await home.text(), {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8", Server: "xk", "Cache-Control": "no-store" },
          });
        }
      } catch {}
      return new Response("Homepage missing (xk/public/index.html)", { status: 500, headers: { Server: "xk" } });
    }

    let upstream;
    try {
      const headers = new Headers(request.headers);
      ["host","cf-connecting-ip","cf-ipcountry","cf-ray","cf-visitor","cf-worker","x-forwarded-for","x-forwarded-proto","x-real-ip","true-client-ip","cdn-loop"]
        .forEach((k) => headers.delete(k));
      if (!headers.get("user-agent")) {
        headers.set("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      }
      upstream = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
      });
    } catch (err) {
      return new Response("Upstream request failed", {
        status: 502,
        headers: { "content-type": "text/plain", Server: "xk" },
      });
    }

    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const loc = upstream.headers.get("location");
      if (loc) {
        let newLoc = loc;
        try {
          const abs = new URL(loc, targetUrl).href;
          const prefix = mode === "norewrite" ? "/:n/" : "/:/";
          newLoc = proxyOrigin + prefix + abs;
        } catch {}
        const h = new Headers({ Location: newLoc, "Access-Control-Allow-Origin": "*", Server: "xk" });
        if (isNewSelection) setOriginCookie(h, targetUrl);
        return new Response(null, { status: upstream.status, headers: h });
      }
    }

    const responseHeaders = cleanResponseHeaders(upstream.headers, xk.headersMode);
    if (isNewSelection) setOriginCookie(responseHeaders, targetUrl);

    const contentType = upstream.headers.get("content-type") || "";

    if (!isText(contentType) || mode === "norewrite") {
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }

    let body = await upstream.text();
    if (contentType.includes("html")) {
      if (xk.allowJs === false) body = stripScripts(body);
      body = injectClient(body, xk);
    }

    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};
