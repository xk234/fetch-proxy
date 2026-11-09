
/**
 * XK Cloudflare Pages Proxy 2.0.5
 * Sticky origin · cloak (loop-safe) · persistent xk.x.* · separate homepage
 */

const VERSION = "2.0.5-apex";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 100;
const COOKIE_ORIGIN = "xk_origin";
const COOKIE_X_CLOAK = "xk_x_cloak";
const COOKIE_X_TITLE = "xk_x_title";
const COOKIE_X_IMAGE = "xk_x_image";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

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
  "cf-ray","cf-cache-status","cf-request-id","cf-ipcountry","server","x-powered-by","via",
  "x-served-by","x-cache","x-cache-hits","x-timer","x-edge-location","x-request-id","report-to","nel",
  "content-security-policy","content-security-policy-report-only","x-frame-options","x-content-type-options",
  "strict-transport-security","cross-origin-opener-policy","cross-origin-embedder-policy",
  "cross-origin-resource-policy","permissions-policy",
];

function getClientIP(request) {
  return request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "0.0.0.0";
}

async function hashIP(ip) {
  const data = new TextEncoder().encode(ip + "|xk-proxy-salt-v2");
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("").slice(0,24);
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

function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const m = cookies.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

function setCookie(headers, name, value, maxAge) {
  headers.append("Set-Cookie",
    name + "=" + encodeURIComponent(value) + "; Path=/; Max-Age=" + maxAge + "; Secure; SameSite=Lax");
}
function clearCookie(headers, name) {
  headers.append("Set-Cookie", name + "=; Path=/; Max-Age=0; Secure; SameSite=Lax");
}

function parseXk(url, request) {
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
    // persistent xk.x.*
    xCloakSet: p.has("xk.x.cloak") ? truthy(p.get("xk.x.cloak")) : null,
    xTitleSet: p.get("xk.x.title"),
    xImageSet: p.get("xk.x.image"),
    xReset: p.has("xk.x.n"),
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

  // Merge cookie-based permanent overrides
  const cCloak = getCookie(request, COOKIE_X_CLOAK);
  const cTitle = getCookie(request, COOKIE_X_TITLE);
  const cImage = getCookie(request, COOKIE_X_IMAGE);
  if (cCloak === "1") o.cloak = true;
  if (cTitle && !o.tabTitle) o.tabTitle = cTitle;
  if (cImage && !o.tabFavicon) o.tabFavicon = cImage;

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

/** Serve static homepage / assets via ASSETS binding */
async function serveAsset(env, request, path) {
  if (!env.ASSETS) return null;
  try {
    // Try exact path
    let res = await env.ASSETS.fetch(new Request(new URL(path, request.url), request));
    if (res && res.status !== 404) return res;
    // Try without leading issues
    if (path.endsWith("/")) {
      res = await env.ASSETS.fetch(new Request(new URL(path + "index.html", request.url), request));
      if (res && res.status !== 404) return res;
    }
  } catch {}
  return null;
}

function buildClientScript(opts) {
  const chunks = [];

  // Storage tools
  if (opts.lsWipe) chunks.push('try{localStorage.clear();sessionStorage.clear();}catch(e){}');
  if (opts.idbWipe) chunks.push('(async function(){try{var d=await indexedDB.databases();for(var i=0;i<d.length;i++)if(d[i].name)indexedDB.deleteDatabase(d[i].name);}catch(e){}})();');
  if (opts.opfsWipe) chunks.push('(async function(){try{if(navigator.storage&&navigator.storage.getDirectory){var r=await navigator.storage.getDirectory();for await(var e of r.entries())await r.removeEntry(e[0],{recursive:true});}}catch(e){}})();');
  if (opts.lsView) chunks.push('try{var d={};for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);d[k]=localStorage.getItem(k);}document.body.insertAdjacentHTML("afterbegin","\\u003cpre style=\\"background:#111;color:#0f0;padding:12px;z-index:999999;position:relative;max-height:40vh;overflow:auto\\"\\u003e"+JSON.stringify(d,null,2)+"\\u003c/pre\\u003e");}catch(e){}');
  if (opts.idbView) chunks.push('(async function(){try{var d=await indexedDB.databases();document.body.insertAdjacentHTML("afterbegin","\\u003cpre style=\\"background:#111;color:#0ff;padding:12px;z-index:999999;position:relative\\"\\u003e"+JSON.stringify(d,null,2)+"\\u003c/pre\\u003e");}catch(e){}})();');
  if (opts.opfsView) chunks.push('(async function(){try{if(navigator.storage&&navigator.storage.getDirectory){var r=await navigator.storage.getDirectory();var a=[];for await(var e of r.entries())a.push({name:e[0],kind:e[1].kind});document.body.insertAdjacentHTML("afterbegin","\\u003cpre style=\\"background:#111;color:#ff0;padding:12px;z-index:999999;position:relative\\"\\u003e"+JSON.stringify(a,null,2)+"\\u003c/pre\\u003e");}}catch(e){}})();');

  if (opts.allowJs === false) {
    chunks.push('(function(){try{document.addEventListener("DOMContentLoaded",function(){var n=document.querySelectorAll("script");for(var i=0;i<n.length;i++)n[i].remove();},true);}catch(e){}})();');
  }

  // ===== POWERFUL title + favicon lock =====
  const favHost = opts.tabFavicon ? resolveFaviconHost(opts.tabFavicon) : null;
  if (opts.tabTitle || favHost) {
    const titleJS = opts.tabTitle ? JSON.stringify(opts.tabTitle) : "null";
    const favJS = favHost ? JSON.stringify(favHost) : "null";
    chunks.push(
      '(function(){' +
      'var T=' + titleJS + ',F=' + favJS + ';' +
      'function applyTitle(){if(!T)return;try{document.title=T;}catch(e){}' +
      'try{var el=document.querySelector("title");if(el)el.textContent=T;}catch(e){}}' +
      'function setFav(h){try{' +
      'var links=document.querySelectorAll("link[rel*=\'icon\'],link[rel*=\'shortcut\']");' +
      'if(!links.length){var l=document.createElement("link");l.rel="icon";document.head.appendChild(l);links=[l];}' +
      'for(var i=0;i<links.length;i++)links[i].href=h;' +
      '}catch(e){}}' +
      'if(T){' +
      'applyTitle();' +
      'try{Object.defineProperty(document,"title",{get:function(){return T;},set:function(){applyTitle();},configurable:true});}catch(e){}' +
      'try{var obs=new MutationObserver(function(){applyTitle();});' +
      'obs.observe(document.documentElement,{childList:true,subtree:true,characterData:true});}catch(e){}' +
      'setInterval(applyTitle,300);' +
      '}' +
      'if(F){var u="https://www.google.com/s2/favicons?domain="+encodeURIComponent(String(F).replace(/^https?:\\/\\//,""))+"&sz=64";' +
      'setFav(u);setInterval(function(){setFav(u);},800);}' +
      '})();'
    );
  }

  // ===== CLOAK (loop-safe) =====
  // Critical: never cloak when already inside an iframe (window !== top)
  // Also skip if data-xk-cloaked marker present
  if (opts.cloak) {
    const titleJS = opts.tabTitle ? JSON.stringify(opts.tabTitle) : "null";
    const favJS = favHost ? JSON.stringify(favHost) : "null";
    chunks.push(
      '(function(){' +
      // LOOP GUARD
      'try{if(window!==window.top)return;}catch(e){return;}' +
      'if(window.__xkC)return;window.__xkC=1;' +
      'if(document.documentElement&&document.documentElement.getAttribute("data-xk-cloaked"))return;' +
      'var real=location.href;' +
      // Don't cloak the cloak blob itself
      'if(/^blob:/.test(real))return;' +
      'var title=document.title||"...";' +
      'var fav="";var il=document.querySelector("link[rel*=\'icon\']");if(il)fav=il.href;' +
      'var LT=' + titleJS + ',FH=' + favJS + ';' +
      'var h="";' +
      'h+="\\u003c!DOCTYPE html\\u003e\\u003chtml data-xk-cloaked=\\"1\\"\\u003e\\u003chead\\u003e";' +
      'h+="\\u003cmeta charset=\\"utf-8\\"\\u003e\\u003cmeta name=\\"viewport\\" content=\\"width=device-width,initial-scale=1\\"\\u003e";' +
      'h+="\\u003ctitle\\u003e"+String(LT||title).replace(/</g,"&lt;")+"\\u003c/title\\u003e";' +
      'if(fav)h+="\\u003clink rel=\\"icon\\" href=\\""+fav+"\\"\\u003e";' +
      'h+="\\u003cstyle\\u003ehtml,body{margin:0;height:100%;overflow:hidden;background:#000}iframe{border:0;width:100%;height:100%;display:block}\\u003c/style\\u003e";' +
      'h+="\\u003c/head\\u003e\\u003cbody\\u003e";' +
      // iframe gets a marker query so server/client know it's inside cloak
      'var src=real+(real.indexOf("?")>=0?"&":"?")+"xk._frame=1";' +
      'h+="\\u003ciframe id=\\"f\\" src=\\""+src+"\\" allow=\\"accelerometer;autoplay;camera;clipboard-read;clipboard-write;encrypted-media;fullscreen;geolocation;gyroscope;microphone;midi;payment;picture-in-picture;sync-xhr;usb;xr-spatial-tracking\\" allowfullscreen\\u003e\\u003c/iframe\\u003e";' +
      'h+="\\u003cscript\\u003e";' +
      'h+="(function(){var f=document.getElementById(\'f\'),LT=' + titleJS + ',FH=' + favJS + ';";' +
      'h+="function sf(u){var ls=document.querySelectorAll(\'link[rel*=\\\\\'icon\\\\\']\');if(!ls.length){var l=document.createElement(\'link\');l.rel=\'icon\';document.head.appendChild(l);ls=[l];}for(var i=0;i<ls.length;i++)ls[i].href=u;}";' +
      'h+="function at(){if(!LT)return;document.title=LT;try{Object.defineProperty(document,\'title\',{get:function(){return LT;},set:function(){},configurable:true});}catch(e){}}";' +
      'h+="setInterval(function(){try{if(LT)at();else if(f.contentDocument&&f.contentDocument.title)document.title=f.contentDocument.title;}catch(e){}},500);at();";' +
      'h+="if(FH){var u=\'https://www.google.com/s2/favicons?domain=\'+encodeURIComponent(String(FH).replace(/^https?:\\\\/\\\\//,\'\'))+\'&sz=64\';sf(u);setInterval(function(){sf(u);},1000);}";' +
      'h+="})();\\u003c/script\\u003e\\u003c/body\\u003e\\u003c/html\\u003e";' +
      'location.replace(URL.createObjectURL(new Blob([h],{type:"text/html"})));' +
      '})();'
    );
  }

  if (!chunks.length) return "";
  return '<script id="xk-ctrl">\n(function(){\n' + chunks.join("\n") + "\n})();\n</script>";
}

function injectClient(html, opts) {
  // Never inject cloak into pages that are already framed markers
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
    const xk = parseXk(url, request);

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

    // Static assets — always try ASSETS first, never proxy
    if (path.startsWith("/xk/public/") || path.startsWith("/xk/lib/") ||
        path === "/xk/public" || path === "/xk/lib") {
      const asset = await serveAsset(env, request, path.endsWith("/") ? path + "index.html" : path);
      if (asset) return asset;
      if (path.includes("index.html") || path.endsWith("/")) {
        const asset2 = await serveAsset(env, request, "/xk/public/index.html");
        if (asset2) return asset2;
      }
      return new Response("Static asset not found: " + path + "\nMake sure xk/public/ is in the Pages deployment.", {
        status: 404,
        headers: { "content-type": "text/plain", Server: "xk" },
      });
    }

    const guard = await checkBanAndRate(request, env);
    if (guard.blocked) {
      return new Response(JSON.stringify({ error: guard.reason, message: guard.message, ipHash: guard.ipHash }), {
        status: guard.reason === "banned" ? 403 : 429,
        headers: { "content-type": "application/json", "Retry-After": "60", Server: "xk" },
      });
    }

    // Handle cookie mutations for xk.x.* and sticky clear BEFORE routing
    const outHeaders = new Headers({ Server: "xk" });
    let cookieTouched = false;

    if (xk.xReset) {
      clearCookie(outHeaders, COOKIE_X_CLOAK);
      clearCookie(outHeaders, COOKIE_X_TITLE);
      clearCookie(outHeaders, COOKIE_X_IMAGE);
      cookieTouched = true;
    }
    if (xk.xCloakSet === true) {
      setCookie(outHeaders, COOKIE_X_CLOAK, "1", COOKIE_MAX_AGE);
      cookieTouched = true;
      xk.cloak = true;
    } else if (xk.xCloakSet === false) {
      clearCookie(outHeaders, COOKIE_X_CLOAK);
      cookieTouched = true;
    }
    if (xk.xTitleSet != null && xk.xTitleSet !== "") {
      setCookie(outHeaders, COOKIE_X_TITLE, xk.xTitleSet, COOKIE_MAX_AGE);
      xk.tabTitle = xk.xTitleSet;
      cookieTouched = true;
    }
    if (xk.xImageSet != null && xk.xImageSet !== "") {
      setCookie(outHeaders, COOKIE_X_IMAGE, xk.xImageSet, COOKIE_MAX_AGE);
      xk.tabFavicon = xk.xImageSet;
      cookieTouched = true;
    }

    if (xk.clearIndex) {
      clearCookie(outHeaders, COOKIE_ORIGIN);
      cookieTouched = true;
      const home = await serveAsset(env, request, "/xk/public/index.html");
      if (home) {
        const body = await home.text();
        outHeaders.set("content-type", "text/html; charset=utf-8");
        outHeaders.set("Cache-Control", "no-store");
        return new Response(body, { status: 200, headers: outHeaders });
      }
      return new Response("Homepage missing. Ensure xk/public/index.html is deployed and ASSETS is available.", {
        status: 500, headers: outHeaders,
      });
    }

    // If only resetting x cookies on root, show homepage
    if (cookieTouched && (path === "/" || path === "") && !url.searchParams.has("xk.cloak") &&
        !url.searchParams.has("xk.tab.title") && !getCookie(request, COOKIE_ORIGIN)) {
      // fall through to homepage logic below
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
    const sticky = getCookie(request, COOKIE_ORIGIN);

    if (mode && rawTarget) {
      targetUrl = normalizeTarget(rawTarget, xk.forceHttp);
      if (targetUrl) {
        try {
          const u = new URL(targetUrl);
          if (mode === "sticky") u.pathname = ensureTrailingSlash(u.pathname);
          for (const [k, v] of xk.cleanParams) u.searchParams.append(k, v);
          // strip internal frame marker from upstream
          u.searchParams.delete("xk._frame");
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

    if (!targetUrl && sticky && path !== "/" && path !== "") {
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

    // Homepage
    if (!targetUrl) {
      const home = await serveAsset(env, request, "/xk/public/index.html");
      if (home) {
        const body = await home.text();
        outHeaders.set("content-type", "text/html; charset=utf-8");
        outHeaders.set("Cache-Control", "no-store");
        return new Response(body, { status: 200, headers: outHeaders });
      }
      return new Response(
        "Homepage missing (xk/public/index.html).\n" +
        "Cloudflare Pages must include the xk/ folder as static assets.\n" +
        "Check: Pages → Settings → Builds → that there is NO 'Output directory' filtering them out,\n" +
        "and that the deployment file list contains xk/public/index.html.\n" +
        "env.ASSETS " + (env.ASSETS ? "is present" : "is MISSING"),
        { status: 500, headers: { "content-type": "text/plain", Server: "xk" } }
      );
    }

    // Skip cloak injection when request is the inner frame of a cloak
    const isInnerFrame = url.searchParams.has("xk._frame") || url.searchParams.get("xk._frame") === "1";
    if (isInnerFrame) {
      xk.cloak = false; // critical: prevent infinite re-cloak
    }

    let upstream;
    try {
      const headers = new Headers(request.headers);
      ["host","cf-connecting-ip","cf-ipcountry","cf-ray","cf-visitor","cf-worker",
       "x-forwarded-for","x-forwarded-proto","x-real-ip","true-client-ip","cdn-loop"]
        .forEach(k => headers.delete(k));
      if (!headers.get("user-agent")) {
        headers.set("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      }
      upstream = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: ["GET","HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
      });
    } catch {
      return new Response("Upstream request failed", {
        status: 502, headers: { "content-type": "text/plain", Server: "xk" },
      });
    }

    if ([301,302,303,307,308].includes(upstream.status)) {
      const loc = upstream.headers.get("location");
      if (loc) {
        let newLoc = loc;
        try {
          const abs = new URL(loc, targetUrl).href;
          const prefix = mode === "norewrite" ? "/:n/" : "/:/";
          newLoc = proxyOrigin + prefix + abs;
        } catch {}
        const h = new Headers({ Location: newLoc, "Access-Control-Allow-Origin": "*", Server: "xk" });
        // copy any pending cookie headers
        for (const [k,v] of outHeaders.entries()) if (k.toLowerCase() === "set-cookie") h.append(k,v);
        if (isNewSelection) setCookie(h, COOKIE_ORIGIN, targetUrl, COOKIE_MAX_AGE);
        return new Response(null, { status: upstream.status, headers: h });
      }
    }

    const responseHeaders = cleanResponseHeaders(upstream.headers, xk.headersMode);
    for (const [k,v] of outHeaders.entries()) if (k.toLowerCase() === "set-cookie") responseHeaders.append(k,v);
    if (isNewSelection) setCookie(responseHeaders, COOKIE_ORIGIN, targetUrl, COOKIE_MAX_AGE);

    const contentType = upstream.headers.get("content-type") || "";

    if (!isText(contentType) || mode === "norewrite") {
      return new Response(upstream.body, {
        status: upstream.status, statusText: upstream.statusText, headers: responseHeaders,
      });
    }

    let body = await upstream.text();
    if (contentType.includes("html")) {
      if (xk.allowJs === false) body = stripScripts(body);
      body = injectClient(body, xk);
    }

    return new Response(body, {
      status: upstream.status, statusText: upstream.statusText, headers: responseHeaders,
    });
  },
};
