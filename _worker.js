
/**
 * XK Cloudflare Pages Proxy 2.0.5
 * Sticky origin · cloak (loop-safe) · persistent xk.x.* · separate homepage
 */

const VERSION = "2.0.14-apex";

const HOMEPAGE_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n  <title>XK Proxy</title>\n  <style>\n    :root {\n      color-scheme: dark;\n      --bg: #0b0b0f;\n      --panel: #12121a;\n      --border: #23232f;\n      --text: #e8e8ed;\n      --muted: #8b8b9a;\n      --accent: #5b8cff;\n      --accent2: #3d6ef0;\n      --danger: #ef4444;\n      --ok: #22c55e;\n    }\n    * { box-sizing: border-box; }\n    html, body { height: 100%; margin: 0; }\n    body {\n      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;\n      background: var(--bg);\n      color: var(--text);\n      display: flex;\n      flex-direction: column;\n    }\n\n    /* Top chrome */\n    .chrome {\n      background: var(--panel);\n      border-bottom: 1px solid var(--border);\n      padding: 8px 10px 10px;\n      display: flex;\n      flex-direction: column;\n      gap: 8px;\n    }\n    .tabs {\n      display: flex;\n      gap: 6px;\n      align-items: center;\n      overflow-x: auto;\n    }\n    .tab {\n      display: flex;\n      align-items: center;\n      gap: 8px;\n      padding: 6px 12px;\n      background: #1a1a24;\n      border: 1px solid var(--border);\n      border-radius: 8px 8px 0 0;\n      font-size: 12px;\n      color: var(--muted);\n      cursor: pointer;\n      max-width: 180px;\n      white-space: nowrap;\n      overflow: hidden;\n      text-overflow: ellipsis;\n    }\n    .tab.active {\n      background: var(--bg);\n      color: var(--text);\n      border-bottom-color: var(--bg);\n    }\n    .tab .x {\n      opacity: 0.5;\n      font-size: 14px;\n      line-height: 1;\n    }\n    .tab .x:hover { opacity: 1; color: var(--danger); }\n    .new-tab {\n      width: 28px; height: 28px;\n      border-radius: 8px;\n      border: 1px solid var(--border);\n      background: #1a1a24;\n      color: var(--text);\n      cursor: pointer;\n      font-size: 16px;\n    }\n\n    .bar {\n      display: flex;\n      gap: 8px;\n      align-items: center;\n    }\n    .navbtns { display: flex; gap: 4px; }\n    .navbtns button {\n      width: 32px; height: 32px;\n      border-radius: 8px;\n      border: 1px solid var(--border);\n      background: #1a1a24;\n      color: var(--text);\n      cursor: pointer;\n    }\n    .navbtns button:hover { border-color: var(--accent); }\n    .omnibox {\n      flex: 1;\n      display: flex;\n      background: #1a1a24;\n      border: 1px solid var(--border);\n      border-radius: 10px;\n      overflow: hidden;\n    }\n    .omnibox input {\n      flex: 1;\n      border: 0;\n      background: transparent;\n      color: var(--text);\n      padding: 10px 12px;\n      font-size: 14px;\n      outline: none;\n    }\n    .omnibox button {\n      border: 0;\n      background: var(--accent);\n      color: #fff;\n      padding: 0 16px;\n      font-weight: 600;\n      cursor: pointer;\n    }\n    .omnibox button:hover { background: var(--accent2); }\n\n    .tools {\n      display: flex;\n      gap: 6px;\n      flex-wrap: wrap;\n    }\n    .tools button, .tools select {\n      height: 30px;\n      border-radius: 8px;\n      border: 1px solid var(--border);\n      background: #1a1a24;\n      color: var(--text);\n      padding: 0 10px;\n      font-size: 12px;\n      cursor: pointer;\n    }\n    .tools button:hover, .tools select:hover { border-color: var(--accent); }\n    .tools .danger:hover { border-color: var(--danger); color: var(--danger); }\n\n    /* Viewport */\n    .viewport {\n      flex: 1;\n      position: relative;\n      background: #000;\n    }\n    .viewport iframe {\n      position: absolute;\n      inset: 0;\n      width: 100%;\n      height: 100%;\n      border: 0;\n      background: #fff;\n    }\n    .empty {\n      position: absolute;\n      inset: 0;\n      display: flex;\n      flex-direction: column;\n      align-items: center;\n      justify-content: center;\n      gap: 16px;\n      color: var(--muted);\n      padding: 24px;\n      text-align: center;\n    }\n    .empty h1 {\n      margin: 0;\n      font-size: 1.6rem;\n      color: var(--text);\n      font-weight: 650;\n    }\n    .chips {\n      display: flex;\n      flex-wrap: wrap;\n      gap: 8px;\n      justify-content: center;\n      max-width: 560px;\n    }\n    .chip {\n      padding: 8px 14px;\n      border-radius: 999px;\n      border: 1px solid var(--border);\n      background: #1a1a24;\n      color: var(--text);\n      font-size: 13px;\n      cursor: pointer;\n      text-decoration: none;\n    }\n    .chip:hover { border-color: var(--accent); }\n\n    .status {\n      font-size: 11px;\n      color: var(--muted);\n      padding: 4px 10px;\n      border-top: 1px solid var(--border);\n      background: var(--panel);\n      display: flex;\n      justify-content: space-between;\n    }\n\n    .modal-bg {\n      position: fixed; inset: 0;\n      background: rgba(0,0,0,.55);\n      display: none;\n      align-items: center;\n      justify-content: center;\n      z-index: 50;\n    }\n    .modal-bg.show { display: flex; }\n    .modal {\n      width: min(420px, 92vw);\n      background: var(--panel);\n      border: 1px solid var(--border);\n      border-radius: 14px;\n      padding: 18px;\n    }\n    .modal h3 { margin: 0 0 10px; }\n    .modal label { display: block; font-size: 12px; color: var(--muted); margin: 10px 0 4px; }\n    .modal input {\n      width: 100%;\n      padding: 10px 12px;\n      border-radius: 8px;\n      border: 1px solid var(--border);\n      background: #1a1a24;\n      color: var(--text);\n    }\n    .modal .row { display: flex; gap: 8px; margin-top: 14px; }\n    .modal .row button {\n      flex: 1;\n      height: 36px;\n      border-radius: 8px;\n      border: 1px solid var(--border);\n      background: #1a1a24;\n      color: var(--text);\n      cursor: pointer;\n    }\n    .modal .row button.primary {\n      background: var(--accent);\n      border-color: var(--accent);\n      color: #fff;\n      font-weight: 600;\n    }\n  </style>\n</head>\n<body>\n  <div class=\"chrome\">\n    <div class=\"tabs\" id=\"tabs\">\n      <button class=\"new-tab\" id=\"btnNew\" title=\"New tab\">+</button>\n    </div>\n    <div class=\"bar\">\n      <div class=\"navbtns\">\n        <button id=\"btnBack\" title=\"Back\">\u2190</button>\n        <button id=\"btnFwd\" title=\"Forward\">\u2192</button>\n        <button id=\"btnReload\" title=\"Reload\">\u21bb</button>\n      </div>\n      <form class=\"omnibox\" id=\"form\">\n        <input id=\"url\" type=\"text\" placeholder=\"Search DuckDuckGo or enter URL\u2026\" autocomplete=\"off\" spellcheck=\"false\" />\n        <button type=\"submit\">Go</button>\n      </form>\n    </div>\n    <div class=\"tools\">\n      <button id=\"btnHome\">Home</button>\n      <button id=\"btnCloak\">Cloak tab</button>\n      <button id=\"btnPermCloak\">Perm cloak (cookie)</button>\n      <button id=\"btnOverride\">Title / Favicon\u2026</button>\n      <button id=\"btnResetX\" class=\"danger\">Reset xk.x.*</button>\n      <button id=\"btnClearSticky\" class=\"danger\">Clear sticky host</button>\n      <select id=\"proto\">\n        <option value=\"\">https (default)</option>\n        <option value=\"0\">force http</option>\n        <option value=\"1\">force https</option>\n      </select>\n      <select id=\"allowjs\">\n        <option value=\"\">JS on</option>\n        <option value=\"0\">JS off</option>\n      </select>\n    </div>\n  </div>\n\n  <div class=\"viewport\" id=\"viewport\">\n    <div class=\"empty\" id=\"empty\">\n      <h1>XK Proxy</h1>\n      <div>Search or open a site. Sticky origin + cloak built in.</div>\n      <div class=\"chips\">\n        <a class=\"chip\" data-go=\"duckduckgo.com\">DuckDuckGo</a>\n        <a class=\"chip\" data-go=\"example.com\">example.com</a>\n        <a class=\"chip\" data-go=\"y8.com?xk.proxy.http=0\">y8 (HTTP)</a>\n        <a class=\"chip\" data-go=\"wikipedia.org\">Wikipedia</a>\n        <a class=\"chip\" data-go=\"www.tiktok.com/\">TikTok</a>\n      </div>\n    </div>\n  </div>\n\n  <div class=\"status\">\n    <span id=\"statusLeft\">Ready</span>\n    <span id=\"statusRight\">XK Proxy 2.0</span>\n  </div>\n\n  <div class=\"modal-bg\" id=\"modal\">\n    <div class=\"modal\">\n      <h3>Persistent override (xk.x.*)</h3>\n      <label>Title (xk.x.title)</label>\n      <input id=\"mTitle\" placeholder=\"Google Classroom\" />\n      <label>Favicon host (xk.x.image)</label>\n      <input id=\"mImage\" placeholder=\"Google / clever / google.com\" />\n      <div class=\"row\">\n        <button id=\"mCancel\">Cancel</button>\n        <button class=\"primary\" id=\"mApply\">Apply cookies</button>\n      </div>\n    </div>\n  </div>\n\n  <script>\n  (function () {\n    var tabs = [];\n    var active = -1;\n\n    var tabsEl = document.getElementById(\"tabs\");\n    var viewport = document.getElementById(\"viewport\");\n    var empty = document.getElementById(\"empty\");\n    var urlInput = document.getElementById(\"url\");\n    var statusLeft = document.getElementById(\"statusLeft\");\n    var form = document.getElementById(\"form\");\n\n    function isUrl(t) {\n      t = (t || \"\").trim();\n      if (/^https?:\\/\\//i.test(t)) return true;\n      if (/^[a-z0-9.-]+\\.[a-z]{2,}([\\/:?#]|$)/i.test(t)) return true;\n      return false;\n    }\n\n    function buildProxyPath(raw) {\n      raw = (raw || \"\").trim();\n      if (!raw) return null;\n      var q = [];\n      var proto = document.getElementById(\"proto\").value;\n      var allowjs = document.getElementById(\"allowjs\").value;\n      if (proto !== \"\") q.push(\"xk.proxy.http=\" + proto);\n      if (allowjs !== \"\") q.push(\"xk.allowjs=\" + allowjs);\n\n      var target;\n      if (isUrl(raw)) {\n        target = raw.replace(/^https?:\\/\\//i, \"\");\n      } else {\n        target = \"duckduckgo.com/?q=\" + encodeURIComponent(raw);\n      }\n      var path = \"/:/\" + target;\n      if (q.length) {\n        path += (path.indexOf(\"?\") >= 0 ? \"&\" : \"?\") + q.join(\"&\");\n      }\n      return path;\n    }\n\n    function renderTabs() {\n      // remove old tab buttons (keep +)\n      var nodes = tabsEl.querySelectorAll(\".tab\");\n      nodes.forEach(function (n) { n.remove(); });\n      tabs.forEach(function (t, i) {\n        var el = document.createElement(\"div\");\n        el.className = \"tab\" + (i === active ? \" active\" : \"\");\n        el.title = t.title || t.url;\n        el.innerHTML = \"<span>\" + (t.title || t.url || \"New Tab\").replace(/</g, \"&lt;\") + \"</span><span class='x'>\u00d7</span>\";\n        el.addEventListener(\"click\", function (e) {\n          if (e.target.classList.contains(\"x\")) {\n            closeTab(i);\n          } else {\n            activate(i);\n          }\n        });\n        tabsEl.insertBefore(el, document.getElementById(\"btnNew\"));\n      });\n    }\n\n    function activate(i) {\n      if (i < 0 || i >= tabs.length) return;\n      active = i;\n      tabs.forEach(function (t, idx) {\n        if (t.iframe) t.iframe.style.display = idx === active ? \"block\" : \"none\";\n      });\n      empty.style.display = tabs.length ? \"none\" : \"flex\";\n      urlInput.value = tabs[i] ? tabs[i].url : \"\";\n      statusLeft.textContent = tabs[i] ? tabs[i].url : \"Ready\";\n      renderTabs();\n    }\n\n    function closeTab(i) {\n      var t = tabs[i];\n      if (t && t.iframe) t.iframe.remove();\n      tabs.splice(i, 1);\n      if (!tabs.length) {\n        active = -1;\n        empty.style.display = \"flex\";\n        urlInput.value = \"\";\n        statusLeft.textContent = \"Ready\";\n      } else {\n        activate(Math.max(0, i - 1));\n      }\n      renderTabs();\n    }\n\n    function openInTab(path, title) {\n      empty.style.display = \"none\";\n      var iframe = document.createElement(\"iframe\");\n      iframe.setAttribute(\"allow\", \"accelerometer; autoplay; camera; clipboard-read; clipboard-write; encrypted-media; fullscreen; geolocation; gyroscope; microphone; midi; payment; picture-in-picture; sync-xhr; usb; xr-spatial-tracking\");\n      iframe.allowFullscreen = true;\n      iframe.src = path;\n      viewport.appendChild(iframe);\n      var tab = { url: path, title: title || path, iframe: iframe };\n      tabs.push(tab);\n      activate(tabs.length - 1);\n\n      iframe.addEventListener(\"load\", function () {\n        try {\n          var docTitle = iframe.contentDocument && iframe.contentDocument.title;\n          if (docTitle) {\n            tab.title = docTitle;\n            renderTabs();\n          }\n        } catch (e) {}\n      });\n    }\n\n    form.addEventListener(\"submit\", function (e) {\n      e.preventDefault();\n      var path = buildProxyPath(urlInput.value);\n      if (!path) return;\n      openInTab(path, urlInput.value.trim());\n    });\n\n    document.getElementById(\"btnNew\").addEventListener(\"click\", function () {\n      empty.style.display = \"flex\";\n      // create blank tab slot conceptually \u2014 just focus empty\n      active = -1;\n      tabs.forEach(function (t) { if (t.iframe) t.iframe.style.display = \"none\"; });\n      urlInput.value = \"\";\n      urlInput.focus();\n      renderTabs();\n    });\n\n    document.getElementById(\"btnBack\").addEventListener(\"click\", function () {\n      var t = tabs[active];\n      if (t && t.iframe && t.iframe.contentWindow) {\n        try { t.iframe.contentWindow.history.back(); } catch (e) {}\n      }\n    });\n    document.getElementById(\"btnFwd\").addEventListener(\"click\", function () {\n      var t = tabs[active];\n      if (t && t.iframe && t.iframe.contentWindow) {\n        try { t.iframe.contentWindow.history.forward(); } catch (e) {}\n      }\n    });\n    document.getElementById(\"btnReload\").addEventListener(\"click\", function () {\n      var t = tabs[active];\n      if (t && t.iframe) t.iframe.src = t.iframe.src;\n    });\n\n    document.getElementById(\"btnHome\").addEventListener(\"click\", function () {\n      location.href = \"/?xk.index\";\n    });\n\n    document.getElementById(\"btnCloak\").addEventListener(\"click\", function () {\n      var t = tabs[active];\n      if (!t) return alert(\"Open a tab first\");\n      var u = t.url;\n      u += (u.indexOf(\"?\") >= 0 ? \"&\" : \"?\") + \"xk.cloak=1\";\n      t.iframe.src = u;\n      t.url = u;\n      urlInput.value = u;\n    });\n\n    document.getElementById(\"btnPermCloak\").addEventListener(\"click\", function () {\n      // set permanent cloak cookie via navigation\n      var t = tabs[active];\n      var base = t ? t.url : \"/:/duckduckgo.com\";\n      var u = base + (base.indexOf(\"?\") >= 0 ? \"&\" : \"?\") + \"xk.x.cloak=1\";\n      if (t) {\n        t.iframe.src = u;\n        t.url = u;\n      } else {\n        openInTab(u, \"Perm cloak\");\n      }\n    });\n\n    document.getElementById(\"btnOverride\").addEventListener(\"click\", function () {\n      document.getElementById(\"modal\").classList.add(\"show\");\n    });\n    document.getElementById(\"mCancel\").addEventListener(\"click\", function () {\n      document.getElementById(\"modal\").classList.remove(\"show\");\n    });\n    document.getElementById(\"mApply\").addEventListener(\"click\", function () {\n      var title = document.getElementById(\"mTitle\").value.trim();\n      var image = document.getElementById(\"mImage\").value.trim();\n      var params = [];\n      if (title) params.push(\"xk.x.title=\" + encodeURIComponent(title));\n      if (image) params.push(\"xk.x.image=\" + encodeURIComponent(image));\n      if (!params.length) return;\n      var t = tabs[active];\n      var base = t ? t.url : \"/:/duckduckgo.com\";\n      var u = base + (base.indexOf(\"?\") >= 0 ? \"&\" : \"?\") + params.join(\"&\");\n      document.getElementById(\"modal\").classList.remove(\"show\");\n      if (t) {\n        t.iframe.src = u;\n        t.url = u;\n      } else {\n        openInTab(u, title || \"Override\");\n      }\n    });\n\n    document.getElementById(\"btnResetX\").addEventListener(\"click\", function () {\n      location.href = \"/?xk.x.n=1\";\n    });\n\n    document.getElementById(\"btnClearSticky\").addEventListener(\"click\", function () {\n      location.href = \"/?xk.index\";\n    });\n\n    document.querySelectorAll(\"[data-go]\").forEach(function (el) {\n      el.addEventListener(\"click\", function (e) {\n        e.preventDefault();\n        var path = buildProxyPath(el.getAttribute(\"data-go\"));\n        openInTab(path, el.textContent);\n      });\n    });\n  })();\n  </script>\n</body>\n</html>\n";


const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 100;
const COOKIE_ORIGIN = "xk_origin";
const COOKIE_X_CLOAK = "xk_x_cloak";
const COOKIE_X_TITLE = "xk_x_title";
const COOKIE_X_IMAGE = "xk_x_image";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

// Site-specific rewrite packs (GitHub raw)
const REWRITE_REPO = "xk234/fetch-proxy-website-rewrites";
const REWRITE_BRANCH = "main";
const SITE_MODES = {
  tiktok: {
    origin: "https://www.tiktok.com",
    rewriteDir: "TikTok",
    stickyPath: "/",
  },
};

function detectSiteMode(pathname) {
  // /:TikTok/  /:tiktok/  /:TikTok  /:tiktok
  const m = pathname.match(/^\/:([A-Za-z][A-Za-z0-9_-]*)\/?$/);
  if (!m) return null;
  const key = m[1].toLowerCase();
  if (SITE_MODES[key]) return { key, ...SITE_MODES[key] };
  return null;
}

async function fetchRewriteOverride(siteKey, assetPath) {
  // assetPath like "/" or "/index.html" or "/api/..."
  let p = assetPath || "/";
  if (p.endsWith("/")) p += "index.html";
  if (p === "") p = "/index.html";
  if (!p.startsWith("/")) p = "/" + p;
  const mode = SITE_MODES[siteKey];
  if (!mode) return null;
  const rawUrl =
    "https://raw.githubusercontent.com/" + REWRITE_REPO + "/" + REWRITE_BRANCH +
    "/" + mode.rewriteDir + p;
  try {
    const res = await fetch(rawUrl, {
      headers: { "User-Agent": "xk-proxy-rewrite-fetch", Accept: "*/*" },
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (res.ok) {
      return { res, source: rawUrl };
    }
  } catch {}
  // jsDelivr fallback
  try {
    const cdn =
      "https://cdn.jsdelivr.net/gh/" + REWRITE_REPO + "@" + REWRITE_BRANCH +
      "/" + mode.rewriteDir + p;
    const res = await fetch(cdn, { headers: { Accept: "*/*" } });
    if (res.ok) return { res, source: cdn };
  } catch {}
  return null;
}


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
  // Multiple variants so Chromebook / Chrome actually drop it
  const base = name + "=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
  headers.append("Set-Cookie", base + "; Secure; SameSite=Lax");
  headers.append("Set-Cookie", base + "; Secure; SameSite=None");
  headers.append("Set-Cookie", base);
  headers.append("Set-Cookie", base + "; SameSite=Lax");
}

function clearAllXkCookies(headers) {
  const names = [
    COOKIE_ORIGIN, COOKIE_X_CLOAK, COOKIE_X_TITLE, COOKIE_X_IMAGE,
    "xk_origin", "xk_x_cloak", "xk_x_title", "xk_x_image",
    "xk_sticky", "xk_host", "xk_hostname"
  ];
  for (const n of names) clearCookie(headers, n);
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
  // Unwrap accidental double-proxy prefixes
  // e.g. https:https://xkfp.pages.dev/:/https://cdn...  OR  https://xkfp.pages.dev/:/https://...
  for (let i = 0; i < 5; i++) {
    t = t.replace(/^https:\/\/https:\/\//i, "https://");
    t = t.replace(/^https:https:\/\//i, "https://");
    t = t.replace(/^https:\/\/https:/i, "https://");
    // strip nested proxy origin /:/ 
    const nested = t.match(/^https?:\/\/[^/]+\/:\/(https?:\/\/.+)$/i);
    if (nested) { t = nested[1]; continue; }
    break;
  }
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

/** Serve static assets via ASSETS; null if missing */
async function serveAsset(env, request, path) {
  if (!env.ASSETS) return null;
  try {
    const u = new URL(path, "https://assets.local");
    const res = await env.ASSETS.fetch(u.pathname + u.search);
    if (res && res.status !== 404) return res;
  } catch {}
  try {
    const res = await env.ASSETS.fetch(new Request(new URL(path, request.url), { method: "GET" }));
    if (res && res.status !== 404) return res;
  } catch {}
  return null;
}

function homepageResponse(extraHeaders) {
  const h = new Headers({
    "content-type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Server": "xk",
  });
  if (extraHeaders) {
    for (const [k, v] of extraHeaders.entries()) {
      if (k.toLowerCase() === "set-cookie") h.append(k, v);
    }
  }
  return new Response(HOMEPAGE_HTML, { status: 200, headers: h });
}

function buildClientScript(opts) {
  const chunks = [];
  const up = opts.upstreamOrigin ? JSON.stringify(opts.upstreamOrigin) : "null";
  const tt = opts.isTikTok ? "true" : "false";

  // Network rewriter - school safe
  chunks.push(
    "(function(){" +
    "if(window.__xkNet)return;window.__xkNet=1;" +
    "var UP=" + up + ",TT=" + tt + ";" +
    "var FORCE=new RegExp('tiktok\\\\.com$|tiktokv\\\\.com$|tiktokv\\\\.eu$|tiktokcdn\\\\.com$|tiktokcdn-eu\\\\.com$|tiktokcdn-us\\\\.com$|ttlivecdn\\\\.com$|ttwstatic\\\\.com$|musical\\\\.ly$|byteoversea\\\\.com$|ibyteimg\\\\.com$|ibytedtos\\\\.com$|tiktokw\\\\.eu$|tiktokw\\\\.com$|bytedance\\\\.com$','i');" +
    "function shouldProxy(h){if(!h)return false;if(h===location.hostname)return false;if(TT)return FORCE.test(h)||/tiktok/i.test(h)||/byteoversea|ttlive|ttwstatic|musical\\.ly|bytedance/i.test(h);return FORCE.test(h);}" +
    "function toProxy(u){try{" +
    "if(!u||typeof u!=='string')return u;" +
    "if(/^blob:|^data:|^javascript:|^about:/i.test(u))return u;" +
    "if(u.indexOf('/:/')!==-1||u.indexOf('/:n/')!==-1||u.indexOf('/$/')!==-1)return u;if(u.indexOf(location.origin)===0&&u.indexOf('/:/')!==-1)return u;" +
    "var abs;if(/^https?:\\/\\//i.test(u))abs=u;else if(u.slice(0,2)==='//')abs=location.protocol+u;" +
    "else if(u.charAt(0)==='/'&&UP)abs=String(UP).replace(/\\/$/,'')+u;else return u;" +
    "var a=new URL(abs,location.href);if(a.origin===location.origin)return u;" +
    "if(!shouldProxy(a.hostname)&&!TT)return u;" +
    "return location.origin+'/:/'+a.href;" +
    "}catch(e){return u;}}" +
    "window.__xkToProxy=toProxy;" +
    "try{var _f=window.fetch;window.fetch=function(input,init){try{if(typeof input==='string')input=toProxy(input);else if(input&&input.url){var nu=toProxy(input.url);if(nu!==input.url)input=new Request(nu,input);}}catch(e){}return _f.call(this,input,init);};}catch(e){}" +
    "try{var _xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{if(typeof u==='string')arguments[1]=toProxy(u);}catch(e){}return _xo.apply(this,arguments);};}catch(e){}" +
    "try{var _WS=window.WebSocket;window.WebSocket=function(url,protocols){try{url=String(url);if(url.indexOf('/:/')===-1)url=toProxy(url);if(url.indexOf('https://')===0)url='wss://'+url.slice(8);else if(url.indexOf('http://')===0)url='ws://'+url.slice(7);}catch(e){}return protocols!==undefined?new _WS(url,protocols):new _WS(url);};window.WebSocket.prototype=_WS.prototype;}catch(e){}" +
    "try{var _Wk=window.Worker;window.Worker=function(url,opts){try{url=toProxy(String(url));}catch(e){}return new _Wk(url,opts);};}catch(e){}" +
    "function patchAttr(proto,attr){try{var d=Object.getOwnPropertyDescriptor(proto,attr);if(!d||!d.set)return;Object.defineProperty(proto,attr,{configurable:true,enumerable:!!d.enumerable,get:d.get,set:function(v){try{v=toProxy(String(v));}catch(e){}return d.set.call(this,v);}});}catch(e){}}" +
    "try{patchAttr(HTMLScriptElement.prototype,'src');}catch(e){}" +
    "try{patchAttr(HTMLImageElement.prototype,'src');}catch(e){}" +
    "try{patchAttr(HTMLSourceElement.prototype,'src');}catch(e){}" +
    "try{patchAttr(HTMLVideoElement.prototype,'src');}catch(e){}" +
    "try{patchAttr(HTMLAudioElement.prototype,'src');}catch(e){}" +
    "try{patchAttr(HTMLIFrameElement.prototype,'src');}catch(e){}" +
    "try{patchAttr(HTMLLinkElement.prototype,'href');}catch(e){}" +
    "try{var _sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){try{if(n&&v&&(n==='src'||n==='href'))v=toProxy(String(v));}catch(e){}return _sa.call(this,n,v);};}catch(e){}" +
    "})();"
  );

  if (opts.isTikTok) {
    chunks.push(
      "(function(){function kill(){try{var re=/DivLoginContainer|LoginContainer|AgeGate|age-gate|verify-age|TUXModal|captcha-verify|DivModalContainer/i;" +
      "var nodes=document.querySelectorAll('div,section,aside');for(var i=0;i<nodes.length;i++){var el=nodes[i],c=(el.className&&String(el.className))||'';if(re.test(c)||re.test(el.id||'')){try{el.remove();}catch(e){}}}" +
      "try{document.body.style.overflow='auto';}catch(e){}}catch(e){}}kill();setInterval(kill,500);" +
      "try{new MutationObserver(kill).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}})();"
    );
  }

  chunks.push(
    "(function(){if(window.__xkTools)return;window.__xkTools=1;" +
    "document.addEventListener('click',function(e){if(!(e.ctrlKey&&e.altKey))return;e.preventDefault();e.stopPropagation();var t=e.target;if(!t||t===document.body||t===document.documentElement)return;try{t.remove();}catch(err){try{t.style.display='none';}catch(e2){}}},true);" +
    "})();"
  );

  if (opts.lsWipe) chunks.push("try{localStorage.clear();sessionStorage.clear();}catch(e){}");
  if (opts.allowJs === false) {
    chunks.push("try{document.addEventListener('DOMContentLoaded',function(){var n=document.querySelectorAll('script');for(var i=0;i<n.length;i++)n[i].remove();},true);}catch(e){}");
  }

  const favHost = opts.tabFavicon ? resolveFaviconHost(opts.tabFavicon) : null;
  if (opts.tabTitle || favHost) {
    const titleJS = opts.tabTitle ? JSON.stringify(String(opts.tabTitle)) : "null";
    const favJS = favHost ? JSON.stringify(String(favHost)) : "null";
    chunks.push(
      "(function(){var T=" + titleJS + ",F=" + favJS + ";" +
      "function at(){if(!T)return;try{if(document.title!==T)document.title=T;}catch(e){}}" +
      "function sf(h){try{var l=document.querySelector('link[rel*=\"icon\"]');if(!l){l=document.createElement('link');l.rel='icon';document.head.appendChild(l);}l.href=h;}catch(e){}}" +
      "if(T){at();try{Object.defineProperty(document,'title',{configurable:true,get:function(){return T;},set:function(){}});}catch(e){}setInterval(at,1000);}" +
      "if(F){var u='https://www.google.com/s2/favicons?domain='+encodeURIComponent(String(F).replace(/^https?:\\/\\//,''))+'&sz=64';sf(u);setInterval(function(){sf(u);},2000);}" +
      "})();"
    );
  }

  if (opts.cloak) {
    const titleJS = opts.tabTitle ? JSON.stringify(String(opts.tabTitle)) : "null";
    chunks.push(
      "(function(){try{if(window!==window.top)return;}catch(e){return;}" +
      "if(window.__xkC)return;window.__xkC=1;" +
      "if(/^blob:/i.test(location.href))return;" +
      "if(/[?&]xk\\._frame=/.test(location.href))return;" +
      "var real=location.href,title=document.title||'Tab',fav='';" +
      "try{var il=document.querySelector('link[rel*=\"icon\"]');if(il)fav=il.href;}catch(e){}" +
      "var LT=" + titleJS + ";" +
      "var src=real+(real.indexOf('?')>=0?'&':'?')+'xk._frame=1';" +
      "var h='\\u003c!DOCTYPE html\\u003e\\u003chtml data-xk-cloaked=\\\"1\\\"\\u003e\\u003chead\\u003e\\u003cmeta charset=\\\"utf-8\\\"\\u003e';" +
      "h+='\\u003ctitle\\u003e'+String(LT||title).replace(/</g,'&lt;')+'\\u003c/title\\u003e';" +
      "if(fav)h+='\\u003clink rel=\\\"icon\\\" href=\\\"'+String(fav).replace(/\"/g,'')+'\\\"\\u003e';" +
      "h+='\\u003cstyle\\u003ehtml,body{margin:0;height:100%;overflow:hidden;background:#111}iframe{border:0;width:100%;height:100%;display:block}\\u003c/style\\u003e\\u003c/head\\u003e\\u003cbody\\u003e';" +
      "h+='\\u003ciframe src=\\\"'+src+'\\\" allow=\\\"fullscreen\\\" allowfullscreen\\u003e\\u003c/iframe\\u003e\\u003c/body\\u003e\\u003c/html\\u003e';" +
      "try{location.replace(URL.createObjectURL(new Blob([h],{type:'text/html'})));}catch(e){}" +
      "})();"
    );
  }

  if (!chunks.length) return "";
  return "<script id=\"xk-ctrl\">" + chunks.join("\n") + "</script>";
}

function injectClient(html, opts) {
  const script = buildClientScript(opts);
  if (!script) return html;
  // Inject as early as possible so fetch hooks + cloak beat page JS
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + script);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => m + script);
  }
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, script + "</head>");
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, script + "</body>");
  return script + html;
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

    // ===== HARD RESET — always works, ignores sticky =====
    // /xk/reset  /xk/nuke  ?xk.reset  ?xk.index  ?xk.nuke
    const isHardReset =
      path === "/xk/reset" || path === "/xk/nuke" || path === "/xk/reset/" || path === "/xk/nuke/" ||
      url.searchParams.has("xk.reset") || url.searchParams.has("xk.nuke") ||
      url.searchParams.has("xk.index");
    if (isHardReset) {
      const h = new Headers({
        "content-type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
        "Server": "xk",
        "Clear-Site-Data": "\"cookies\", \"storage\"",
      });
      clearAllXkCookies(h);
      // also try homepage
      const home = HOMEPAGE_HTML;
      const body = home.replace(
        "<h1>XK Proxy</h1>",
        "<h1>XK Proxy</h1><p style=\"color:#22c55e\">Sticky origin + overrides cleared.</p>"
      );
      return new Response(body, { status: 200, headers: h });
    }

    // Never treat /xk/* as sticky upstream paths
    if (path === "/xk" || path.startsWith("/xk/")) {
      if (path.startsWith("/xk/public/") || path.startsWith("/xk/lib/") ||
          path === "/xk/public" || path === "/xk/lib" || path === "/xk/home" || path === "/xk/home/") {
        // fall through to static / homepage handling below via path rewrite
        if (path === "/xk/home" || path === "/xk/home/") {
          return homepageResponse(null);
        }
      }
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
      clearAllXkCookies(outHeaders);
      cookieTouched = true;
      const home = await serveAsset(env, request, "/xk/public/index.html")
        || await serveAsset(env, request, "/index.html");
      if (home && home.ok) {
        const body = await home.text();
        outHeaders.set("content-type", "text/html; charset=utf-8");
        outHeaders.set("Cache-Control", "no-store");
        return new Response(body, { status: 200, headers: outHeaders });
      }
      return homepageResponse(outHeaders);
    }

    // If only resetting x cookies on root, show homepage
    if (cookieTouched && (path === "/" || path === "") && !url.searchParams.has("xk.cloak") &&
        !url.searchParams.has("xk.tab.title") && !getCookie(request, COOKIE_ORIGIN)) {
      // fall through to homepage logic below
    }

    let mode = null;
    let rawTarget = null;
    let siteModeKey = null;

    // /:TikTok/ style special modes — set sticky + redirect to /
    const siteHit = detectSiteMode(path);
    if (siteHit) {
      const h = new Headers({
        Location: "/",
        "Cache-Control": "no-store",
        Server: "xk",
      });
      setCookie(h, COOKIE_ORIGIN, siteHit.origin + "/", COOKIE_MAX_AGE);
      setCookie(h, "xk_site", siteHit.key, COOKIE_MAX_AGE);
      return new Response(null, { status: 302, headers: h });
    }

    // Also allow /:TikTok/foryou path style: /:TikTok/anything
    const sitePathHit = path.match(/^\/:([A-Za-z][A-Za-z0-9_-]*)\/(.*)$/);
    if (sitePathHit && SITE_MODES[sitePathHit[1].toLowerCase()]) {
      const key = sitePathHit[1].toLowerCase();
      const rest = sitePathHit[2] || "";
      const conf = SITE_MODES[key];
      mode = "sticky";
      siteModeKey = key;
      rawTarget = conf.origin.replace(/^https?:\/\//i, "") + "/" + rest;
      // will set sticky below via isNewSelection
    } else if (path.startsWith("/:/") || path.startsWith("/$/")) {
      mode = "sticky";
      rawTarget = path.slice(3);
    } else if (path.startsWith("/:n/")) {
      mode = "norewrite";
      rawTarget = path.slice(4);
    }

    // Remember site from cookie
    if (!siteModeKey) {
      const sk = getCookie(request, "xk_site");
      if (sk && SITE_MODES[sk]) siteModeKey = sk;
    }

    let targetUrl = null;
    let isNewSelection = false;
    const stickyDisabled = getCookie(request, "xk_sticky") === "0" || url.searchParams.has("xk.nosticky");
    const sticky = stickyDisabled ? null : getCookie(request, COOKIE_ORIGIN);

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
        const h = base.hostname.toLowerCase();
        if (h === "tiktok.com" || h.endsWith(".tiktok.com")) {
          siteModeKey = siteModeKey || "tiktok";
        }
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

    // Homepage — try static assets, always fall back to embedded copy
    if (!targetUrl) {
      const home = await serveAsset(env, request, "/xk/public/index.html")
        || await serveAsset(env, request, "/index.html");
      if (home && home.ok) {
        try {
          const body = await home.text();
          if (body && body.length > 100) {
            outHeaders.set("content-type", "text/html; charset=utf-8");
            outHeaders.set("Cache-Control", "no-store");
            return new Response(body, { status: 200, headers: outHeaders });
          }
        } catch {}
      }
      return homepageResponse(outHeaders);
    }

    // Skip cloak injection when request is the inner frame of a cloak
    const isInnerFrame = url.searchParams.has("xk._frame") || url.searchParams.get("xk._frame") === "1";
    if (isInnerFrame) {
      xk.cloak = false; // critical: prevent infinite re-cloak
    }

    // Try rewrite-pack override (e.g. GitHub TikTok/index.html)
    if (siteModeKey && mode !== "norewrite") {
      try {
        let assetPath = "/";
        try { assetPath = new URL(targetUrl).pathname || "/"; } catch {}
        // map bare / to index.html inside pack
        const ov = await fetchRewriteOverride(siteModeKey, assetPath);
        if (ov && ov.res) {
          const ct = ov.res.headers.get("content-type") || "text/html; charset=utf-8";
          let body = await ov.res.text();
          xk.isTikTok = siteModeKey === "tiktok";
          xk.upstreamOrigin = SITE_MODES[siteModeKey].origin;
          if (ct.includes("html") || assetPath.endsWith(".html") || assetPath.endsWith("/")) {
            body = injectClient(body, xk);
          }
          const rh = new Headers({
            "content-type": ct.includes("html") ? "text/html; charset=utf-8" : ct,
            "Cache-Control": "no-store",
            Server: "xk",
            "Access-Control-Allow-Origin": "*",
            "X-XK-Rewrite": ov.source,
          });
          if (isNewSelection) setCookie(rh, COOKIE_ORIGIN, SITE_MODES[siteModeKey].origin + "/", COOKIE_MAX_AGE);
          if (siteModeKey) setCookie(rh, "xk_site", siteModeKey, COOKIE_MAX_AGE);
          return new Response(body, { status: 200, headers: rh });
        }
      } catch (e) {}
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

    // Detect TikTok / site mode for this response
    try {
      const u = new URL(targetUrl);
      const host = u.hostname.toLowerCase();
      xk.isTikTok = host === "tiktok.com" || host.endsWith(".tiktok.com") || siteModeKey === "tiktok" || /tiktok/i.test(host);
      xk.upstreamOrigin = u.origin;
    } catch {
      xk.isTikTok = siteModeKey === "tiktok";
      xk.upstreamOrigin = siteModeKey && SITE_MODES[siteModeKey] ? SITE_MODES[siteModeKey].origin : null;
    }

    // School mode: rewrite absolute TikTok/CDN URLs in text responses so browser never hits blocked hosts
    if (xk.isTikTok || siteModeKey === "tiktok") {
      const hostPart = "(?:[a-z0-9-]+\\.)*(?:tiktok\\.com|tiktokv\\.com|tiktokv\\.eu|tiktokcdn\\.com|tiktokcdn-eu\\.com|tiktokcdn-us\\.com|ttlivecdn\\.com|ttwstatic\\.com|musical\\.ly|byteoversea\\.com|ibyteimg\\.com|ibytedtos\\.com|tiktokw\\.eu|tiktokw\\.com|bytedance\\.com)";
      // Do not match URLs that already sit after /:/
      const reAbs = new RegExp("(?<!/:/)https?://" + hostPart + "[^\\s\\"'<>]*", "gi");
      const reProto = new RegExp("(?<!/:/)(?<!https:)(?<!http:)//" + hostPart + "[^\\s\\"'<>]*", "gi");
      body = body.replace(reAbs, (m) => proxyOrigin + "/:/" + m);
      body = body.replace(reProto, (m) => proxyOrigin + "/:/https:" + m);
    }

    if (contentType.includes("html")) {
      if (xk.allowJs === false) body = stripScripts(body);
      body = injectClient(body, xk);
    }

    return new Response(body, {
      status: upstream.status, statusText: upstream.statusText, headers: responseHeaders,
    });
  },
};
