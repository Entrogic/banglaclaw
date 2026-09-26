import { MARKDOWN_JS } from "../browser-markdown.js";

/** Settings the browser needs; validated by the config schema (the colour is a #rrggbb hex). */
export interface WidgetPublicConfig {
  title: string;
  greeting: string;
  color: string;
  position: "right" | "left";
  maxInputChars: number;
}

/** JSON that is safe inside a <script> element and a JS file (no "</script>", no U+2028/2029). */
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/*
 * The literals below are String.raw: they must not contain a backtick or a dollar-brace.
 */

const LOADER = String.raw`/* BanglaClaw chat widget. Embed with <script src="https://<gateway>/widget.js" async></script> */
(function () {
  "use strict";
  if (window.__banglaclawWidget) return;
  window.__banglaclawWidget = true;
  var cfg = __CONFIG__;
  var script = document.currentScript;
  var base = script && script.src ? new URL(script.src).origin : location.origin;
  var side = cfg.position === "left" ? "left" : "right";
  var host = document.createElement("div");
  host.setAttribute("data-banglaclaw-widget", "");
  host.style.cssText = "position:fixed;z-index:2147483000;bottom:0;" + side + ":0;";
  var root = host.attachShadow({ mode: "open" });
  var chat = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/></svg>';
  var cross = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  root.innerHTML =
    "<style>" +
    ":host{all:initial}" +
    ".bubble{position:fixed;bottom:20px;" + side + ":20px;width:58px;height:58px;border:0;border-radius:50%;background:var(--bc-accent);color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 10px 30px -8px rgba(0,0,0,.45);transition:transform .15s}" +
    ".bubble:hover{transform:scale(1.06)}.bubble:focus-visible{outline:3px solid var(--bc-accent);outline-offset:3px}" +
    ".badge{position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;background:#d42c39;border:2px solid #fff;display:none}" +
    ".badge.on{display:block}" +
    ".panel{position:fixed;bottom:90px;" + side + ":20px;width:380px;height:min(620px,calc(100vh - 110px));border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 24px 60px -12px rgba(0,0,0,.45);opacity:0;transform:translateY(12px) scale(.98);pointer-events:none;transition:opacity .18s,transform .18s}" +
    ".panel.open{opacity:1;transform:none;pointer-events:auto}" +
    "iframe{width:100%;height:100%;border:0;display:block;color-scheme:normal}" +
    "@media (max-width:480px){.panel{inset:0;width:100%;height:100%;border-radius:0}.panel.open ~ .bubble{display:none}}" +
    "</style>" +
    '<div class="panel" role="dialog" aria-label=""></div>' +
    '<button class="bubble" type="button" aria-expanded="false"><span class="icon"></span><span class="badge"></span></button>';
  host.style.setProperty("--bc-accent", cfg.color);
  var panel = root.querySelector(".panel");
  var bubble = root.querySelector(".bubble");
  var icon = root.querySelector(".icon");
  var badge = root.querySelector(".badge");
  var frame = null;
  var loaded = false;
  var open = false;
  panel.setAttribute("aria-label", cfg.title);
  bubble.setAttribute("aria-label", "Open " + cfg.title + " chat");
  icon.innerHTML = chat;

  function show(next) {
    open = next;
    if (open && !frame) {
      frame = document.createElement("iframe");
      frame.title = cfg.title;
      frame.allow = "clipboard-write";
      frame.src = base + "/widget/frame?origin=" + encodeURIComponent(location.origin);
      frame.addEventListener("load", function () { loaded = true; if (open) frame.contentWindow.postMessage({ type: "banglaclaw:opened" }, base); });
      panel.appendChild(frame);
    }
    panel.classList.toggle("open", open);
    bubble.setAttribute("aria-expanded", String(open));
    bubble.setAttribute("aria-label", (open ? "Close " : "Open ") + cfg.title + " chat");
    icon.innerHTML = open ? cross : chat;
    if (open) {
      badge.classList.remove("on");
      if (loaded) frame.contentWindow.postMessage({ type: "banglaclaw:opened" }, base);
    }
  }
  bubble.addEventListener("click", function () { show(!open); });
  window.addEventListener("message", function (e) {
    if (e.origin !== base || !e.data || typeof e.data.type !== "string") return;
    if (e.data.type === "banglaclaw:close") { show(false); bubble.focus(); }
    else if (e.data.type === "banglaclaw:unread" && !open) badge.classList.add("on");
  });
  window.BanglaClaw = { open: function () { show(true); }, close: function () { show(false); }, toggle: function () { show(!open); } };
  function mount() { document.body.appendChild(host); }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();
`;

const FRAME_STYLE = String.raw`
  :root { color-scheme: light dark; --accent: __COLOR__;
    --page:light-dark(#ffffff,#0e1512); --surface:light-dark(#f4f3ee,#18221d); --text:light-dark(#15201b,#e7ece9); --muted:light-dark(#5f6b65,#8d9a93);
    --border:light-dark(rgba(21,32,27,.12),rgba(231,236,233,.12)); --critical:light-dark(#b42f2f,#f28b8b); --red:#d42c39; }
  * { box-sizing:border-box; }
  html, body { height:100%; margin:0; }
  body { display:flex; flex-direction:column; background:var(--page); color:var(--text); font:15px/1.55 system-ui, -apple-system, "Segoe UI", "Noto Sans Bengali", "Hind Siliguri", "SolaimanLipi", sans-serif; -webkit-font-smoothing:antialiased; }
  button, textarea { font:inherit; color:inherit; }
  :focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  header { display:flex; align-items:center; gap:10px; padding:14px 12px 14px 16px; background:var(--accent); color:#fff; }
  .avatar { position:relative; width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,.18); display:grid; place-items:center; flex:none; font-weight:700; }
  .avatar::after { content:""; position:absolute; right:0; bottom:0; width:10px; height:10px; border-radius:50%; background:#4ade80; border:2px solid var(--accent); }
  .who { flex:1; min-width:0; }
  .who b { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:15.5px; }
  .who span { display:block; font-size:12.5px; opacity:.85; }
  header button { width:34px; height:34px; display:grid; place-items:center; border:0; border-radius:8px; background:transparent; color:#fff; cursor:pointer; }
  header button:hover { background:rgba(255,255,255,.16); }
  #log { flex:1; overflow-y:auto; padding:16px 14px; display:flex; flex-direction:column; gap:10px; }
  .msg { max-width:86%; padding:9px 13px; border-radius:16px; overflow-wrap:anywhere; animation:rise .15s ease-out; }
  @keyframes rise { from { opacity:0; transform:translateY(4px); } }
  .msg.user { align-self:flex-end; background:var(--accent); color:#fff; border-bottom-right-radius:5px; white-space:pre-wrap; }
  .msg.bot, .msg.operator { align-self:flex-start; background:var(--surface); border-bottom-left-radius:5px; }
  .msg.operator { border-left:3px solid var(--red); }
  .msg.operator::before { content:attr(data-label); display:block; margin-bottom:2px; color:var(--red); font-size:12px; font-weight:700; }
  .note { align-self:center; max-width:92%; padding:4px 12px; border-radius:999px; background:var(--surface); color:var(--muted); font-size:12.5px; text-align:center; }
  .note.error { color:var(--critical); }
  .typing { align-self:flex-start; display:flex; align-items:center; gap:8px; padding:10px 13px; border-radius:16px; background:var(--surface); color:var(--muted); font-size:13px; }
  .typing i { width:6px; height:6px; border-radius:50%; background:var(--accent); display:inline-block; animation:blink 1.2s infinite ease-in-out; }
  .typing i:nth-child(2) { animation-delay:.15s; } .typing i:nth-child(3) { animation-delay:.3s; }
  @keyframes blink { 0%, 80%, 100% { opacity:.25; } 40% { opacity:1; } }
  .md > :first-child { margin-top:0; } .md > :last-child { margin-bottom:0; }
  .md p, .md ul, .md ol, .md blockquote, .md table, .md .code { margin:0 0 .6em; }
  .md h1, .md h2, .md h3 { margin:.8em 0 .4em; font-size:1.02em; }
  .md ul, .md ol { padding-left:1.3em; }
  .md a { color:var(--accent); }
  .md code { padding:.1em .3em; border-radius:4px; background:rgba(127,127,127,.15); font:.88em ui-monospace, Menlo, monospace; }
  .md table { border-collapse:collapse; display:block; overflow-x:auto; font-size:.92em; }
  .md th, .md td { padding:4px 8px; border:1px solid var(--border); }
  .code { border:1px solid var(--border); border-radius:8px; overflow:hidden; }
  .code-head { display:flex; justify-content:space-between; align-items:center; padding:2px 4px 2px 10px; font:12px ui-monospace, monospace; color:var(--muted); }
  .code-head button { border:0; background:none; color:var(--muted); cursor:pointer; font-size:12px; }
  .code pre { margin:0; padding:8px 10px; overflow-x:auto; }
  .code pre code { background:none; padding:0; }
  form { display:flex; align-items:flex-end; gap:8px; margin:0 12px; padding:6px 6px 6px 14px; border:1px solid var(--border); border-radius:18px; background:var(--page); }
  form:focus-within { border-color:var(--accent); }
  textarea { flex:1; min-height:36px; max-height:140px; padding:7px 0; border:0; background:transparent; resize:none; outline:none; }
  textarea:focus-visible { outline:none; }
  #send { width:36px; height:36px; flex:none; display:grid; place-items:center; border:0; border-radius:50%; background:var(--accent); color:#fff; cursor:pointer; }
  #send:disabled { opacity:.45; cursor:default; }
  footer { padding:8px 12px 10px; text-align:center; font-size:11.5px; color:var(--muted); }
  footer a { color:inherit; }
`;

const FRAME_BODY = String.raw`
<header>
  <div class="avatar" aria-hidden="true" id="avatar"></div>
  <div class="who"><b id="title"></b><span>সাধারণত কয়েক সেকেন্ডে উত্তর দেয়</span></div>
  <button id="reset" type="button" title="নতুন কথোপকথন" aria-label="নতুন কথোপকথন"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>
  <button id="close" type="button" title="বন্ধ করুন" aria-label="বন্ধ করুন"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
</header>
<main id="log" aria-live="polite"></main>
<form id="form"><textarea id="input" rows="1" placeholder="আপনার বার্তা লিখুন…" aria-label="বার্তা"></textarea><button id="send" aria-label="পাঠান" title="পাঠান"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></form>
<footer>Powered by <a href="https://github.com/Entrogic/banglaclaw" target="_blank" rel="noopener noreferrer">BanglaClaw</a></footer>
`;

const FRAME_SCRIPT = String.raw`
(() => {
  const cfg = __CONFIG__;
  const $ = (id) => document.getElementById(id);
  const log = $("log");
  const params = new URLSearchParams(location.search);
  const parentOrigin = params.get("origin") || "*";
  const post = (type) => { try { parent.postMessage({ type }, parentOrigin); } catch {} };
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  let token = store.get("bcw.token"), busy = false, following = false, hasSession = false;

  $("title").textContent = cfg.title;
  $("avatar").textContent = Array.from(cfg.title)[0] || "B";
  $("input").maxLength = cfg.maxInputChars;

  const el = (cls, text) => { const d = document.createElement("div"); d.className = cls; if (text != null) d.textContent = text; return d; };
  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const add = (node) => { log.append(node); scroll(); return node; };
  const bot = (text, cls) => { const d = el("msg " + (cls || "bot") + " md"); d.innerHTML = md(text); if (cls === "operator") d.dataset.label = "প্রতিনিধি"; return add(d); };
  const note = (text, error) => add(el("note" + (error ? " error" : ""), text));
  const greet = () => bot(cfg.greeting);

  async function ensureToken() {
    const res = await fetch("/widget/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(token ? { token } : {}) });
    if (!res.ok) throw new Error(res.status === 429 ? "rate" : "session");
    token = (await res.json()).token;
    store.set("bcw.token", token);
  }
  async function api(path, init, retried) {
    if (!token) await ensureToken();
    const res = await fetch(path, { ...(init || {}), headers: { ...((init && init.headers) || {}), authorization: "Bearer " + token } });
    if (res.status === 401 && !retried) { token = null; store.set("bcw.token", null); return api(path, init, true); }
    return res;
  }
  // Server-Sent Events over fetch (EventSource cannot send the token header).
  async function* events(res) {
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
      let i;
      while ((i = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        let event = "message", data = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch {}
        yield { event, data: parsed };
      }
    }
  }

  async function follow() {
    if (following) return;
    following = true;
    let delay = 2000;
    while (following) {
      try {
        const res = await api("/widget/api/events");
        if (res.status === 404) { following = false; return; }
        if (!res.ok) throw new Error("events");
        delay = 2000;
        for await (const ev of events(res)) {
          if (ev.event === "operator") { bot(ev.data.text, "operator"); post("banglaclaw:unread"); }
          else if (ev.event === "released") note("আবার সহকারী উত্তর দিচ্ছে");
        }
      } catch {}
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30000);
    }
  }

  async function send(text) {
    if (busy || !text) return;
    busy = true; $("send").disabled = true;
    add(el("msg user", text));
    const typing = add(el("typing"));
    typing.innerHTML = "<i></i><i></i><i></i>";
    const label = el("", "লিখছে…"); typing.append(label);
    let reply = null, raw = "";
    try {
      const res = await api("/widget/api/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (!res.ok) {
        typing.remove();
        note(res.status === 429 ? "একটু বেশি দ্রুত পাঠাচ্ছেন — কয়েক সেকেন্ড পরে আবার চেষ্টা করুন।" : res.status === 503 ? "এই মুহূর্তে ব্যস্ত, একটু পরে আবার চেষ্টা করুন।" : "বার্তা পাঠানো যায়নি।", true);
        return;
      }
      hasSession = true;
      for await (const ev of events(res)) {
        if (ev.event === "token") {
          if (!reply) { typing.remove(); reply = add(el("msg bot md")); }
          raw += ev.data.text; reply.innerHTML = md(raw); scroll();
        } else if (ev.event === "activity") label.textContent = "খুঁজে দেখছি…";
        else if (ev.event === "handoff") { typing.remove(); note(ev.data.pending ? "একজন প্রতিনিধি শীঘ্রই উত্তর দেবেন।" : "আপনার কথোপকথন একজন প্রতিনিধির কাছে পাঠানো হয়েছে।"); }
        else if (ev.event === "done") {
          typing.remove();
          if (!reply && ev.data.reply) reply = bot(ev.data.reply);
          if (ev.data.status === "aborted") note("উত্তর বন্ধ হয়েছে।", true);
        } else if (ev.event === "error") { typing.remove(); note(ev.data.message || "কিছু একটা ভুল হয়েছে।", true); }
      }
      typing.remove();
      if (reply) post("banglaclaw:unread");
      follow();
    } catch {
      typing.remove();
      note("সংযোগে সমস্যা হয়েছে। আবার চেষ্টা করুন।", true);
    } finally {
      busy = false; $("send").disabled = false; $("input").focus();
    }
  }

  async function start() {
    greet();
    try {
      const res = await api("/widget/api/history");
      if (!res.ok) return;
      const { messages, handoff } = await res.json();
      for (const m of messages) m.role === "user" ? add(el("msg user", m.text)) : bot(m.text, m.role === "operator" ? "operator" : "bot");
      if (handoff) note("একজন প্রতিনিধি শীঘ্রই উত্তর দেবেন।");
      if (messages.length) { hasSession = true; follow(); }
    } catch {
      note("সংযোগ করা যায়নি। পরে আবার চেষ্টা করুন।", true);
    }
  }

  const autosize = () => { const i = $("input"); i.style.height = "auto"; i.style.height = i.scrollHeight + "px"; };
  $("input").oninput = autosize;
  $("input").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("form").requestSubmit(); } };
  $("form").onsubmit = (e) => { e.preventDefault(); const text = $("input").value.trim(); $("input").value = ""; autosize(); send(text); };
  $("close").onclick = () => post("banglaclaw:close");
  $("reset").onclick = async () => {
    if (busy) return;
    following = false;
    if (hasSession) { try { await api("/widget/api/reset", { method: "POST" }); } catch {} }
    hasSession = false; log.replaceChildren(); greet(); $("input").focus();
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") post("banglaclaw:close"); });
  window.addEventListener("message", (e) => { if (e.data && e.data.type === "banglaclaw:opened") $("input").focus(); });
  log.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]");
    if (b && navigator.clipboard) navigator.clipboard.writeText(b.closest(".code").querySelector("code").textContent);
  });
  start();
})();
`;

/** The loader served at /widget.js, with the public settings baked in (no extra request, no CORS). */
export function widgetLoaderJs(config: WidgetPublicConfig): string {
  return LOADER.replace("__CONFIG__", () => inlineJson({ title: config.title, color: config.color, position: config.position }));
}

/** The chat page shown inside the widget's iframe. */
export function widgetFrameHtml(config: WidgetPublicConfig): string {
  return [
    '<!doctype html>\n<html lang="bn">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>',
    config.title.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch),
    "</title>\n<style>",
    FRAME_STYLE.replace("__COLOR__", () => config.color),
    "</style>\n</head>\n<body>",
    FRAME_BODY,
    "<script>(() => {\n",
    MARKDOWN_JS,
    "\nwindow.md = md;\n})();</script>\n<script>",
    FRAME_SCRIPT.replace("__CONFIG__", () => inlineJson(config)),
    "</script>\n</body>\n</html>",
  ].join("");
}
