/**
 * Self-contained browser chat (channels.web). Talks to /v1/ws with the user's API key, which is
 * kept in localStorage. It subscribes to its session so operator replies during a handoff appear
 * live. No external assets, so a strict CSP applies. Colours match the admin dashboard palette.
 */
export const WEB_CHAT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const WEB_CHAT_HTML = `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BanglaClaw Chat</title>
<style>
  /* Same palette as the admin dashboard; data-theme on <html> overrides the OS preference. */
  :root { color-scheme: light dark;
    --page:light-dark(#f7f6f2,#0e1512); --surface:light-dark(#ffffff,#151f1a); --surface-2:light-dark(#efede6,#1c2822);
    --text:light-dark(#15201b,#e7ece9); --muted:light-dark(#5f6b65,#8d9a93); --border:light-dark(rgba(21,32,27,.12),rgba(231,236,233,.12));
    --accent:light-dark(#0b6b4f,#34b58a); --accent-strong:light-dark(#085a42,#4cc79d); --on-accent:light-dark(#ffffff,#06140f);
    --wash:light-dark(rgba(11,107,79,.08),rgba(52,181,138,.12)); --red:#d42c39; --red-text:light-dark(#c62f3a,#f0616b); --critical:light-dark(#b42f2f,#f28b8b);
    --critical-wash:light-dark(rgba(198,47,58,.08),rgba(240,97,107,.12)); --warning:light-dark(#b07400,#e0b25a);
    --shadow:light-dark(rgba(21,32,27,.08),rgba(0,0,0,.35)); }
  :root[data-theme="light"] { color-scheme: light; }
  :root[data-theme="dark"] { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--page); color:var(--text); font:16px/1.6 system-ui, -apple-system, "Segoe UI", "Noto Sans Bengali", "Hind Siliguri", "SolaimanLipi", "Kohinoor Bangla", sans-serif; height:100dvh; display:flex; flex-direction:column; -webkit-font-smoothing:antialiased; }
  input, button, textarea { font:inherit; color:inherit; }
  :focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  button { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:38px; padding:0 16px; background:var(--accent); color:var(--on-accent); border:0; border-radius:10px; font-weight:600; cursor:pointer; transition:background .12s; }
  button:hover:not(:disabled) { background:var(--accent-strong); }
  button:disabled { opacity:.45; cursor:default; }
  button.secondary { background:transparent; color:var(--text); border:1px solid var(--border); font-weight:500; }
  button.secondary:hover:not(:disabled) { background:var(--surface-2); }
  button.icon { width:38px; padding:0; }
  #theme svg { display:none; }
  :root:not([data-theme]) #theme .t-system, :root[data-theme="light"] #theme .t-light, :root[data-theme="dark"] #theme .t-dark { display:block; }
  header { display:flex; gap:10px; align-items:center; padding:10px 16px; border-bottom:1px solid var(--border); background:color-mix(in srgb, var(--surface) 88%, transparent); backdrop-filter:blur(10px); flex-wrap:wrap; position:sticky; top:0; z-index:1; }
  .brand { display:flex; align-items:center; gap:10px; margin:0 auto 0 0; font-size:17px; font-weight:700; letter-spacing:-.01em; }
  .mark { position:relative; width:26px; height:26px; border-radius:7px; background:#0b6b4f; flex:none; }
  .mark::after { content:""; position:absolute; top:50%; left:45%; width:12px; height:12px; border-radius:50%; background:var(--red); transform:translate(-50%,-50%); }
  #status { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 10px; border-radius:999px; background:var(--surface-2); color:var(--muted); font-size:13px; font-weight:500; white-space:nowrap; }
  #status::before { content:""; width:8px; height:8px; border-radius:50%; background:var(--muted); }
  #status[data-state="connecting"]::before { background:var(--warning); animation:pulse 1s ease-in-out infinite; }
  #status[data-state="on"] { color:var(--accent); background:var(--wash); }
  #status[data-state="on"]::before { background:var(--accent); }
  #status[data-state="error"] { color:var(--critical); background:var(--critical-wash); }
  #status[data-state="error"]::before { background:var(--critical); }
  @keyframes pulse { 50% { opacity:.3; } }
  #auth { display:flex; gap:6px; flex:1 1 300px; max-width:440px; }
  #auth input { flex:1; min-width:0; height:38px; padding:0 12px; background:var(--page); border:1px solid var(--border); border-radius:10px; }
  #auth input:focus, form textarea:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--wash); }
  main { flex:1; overflow-y:auto; padding:24px 16px; display:flex; flex-direction:column; gap:12px; max-width:820px; width:100%; margin:0 auto; }
  main:empty::before { content:"আসসালামু আলাইকুম! বাংলা, Banglish বা English-এ যা খুশি জিজ্ঞেস করুন।"; margin:auto; max-width:420px; padding:24px; text-align:center; color:var(--muted); font-size:15px; }
  .msg { padding:10px 15px; border-radius:18px; max-width:85%; white-space:pre-wrap; overflow-wrap:anywhere; box-shadow:0 1px 2px var(--shadow); animation:rise .16s ease-out; }
  @keyframes rise { from { opacity:0; transform:translateY(4px); } }
  .user { align-self:flex-end; background:var(--accent); color:var(--on-accent); border-bottom-right-radius:6px; }
  .assistant { align-self:flex-start; background:var(--surface); border:1px solid var(--border); border-bottom-left-radius:6px; }
  .operator { align-self:flex-start; background:var(--surface); border:1px solid var(--border); border-left:3px solid var(--red); border-bottom-left-radius:6px; }
  .operator::before { content:"👤 অপারেটর"; display:block; margin-bottom:2px; color:var(--red-text); font-size:12px; font-weight:700; }
  .msg.tool { align-self:center; max-width:100%; padding:3px 12px; border-radius:12px; background:var(--surface-2); box-shadow:none; color:var(--muted); font:12.5px/1.6 ui-monospace, "SF Mono", Menlo, monospace; text-align:center; }
  .msg.error { align-self:center; max-width:100%; padding:6px 14px; border-radius:10px; background:var(--critical-wash); box-shadow:none; color:var(--critical); font-size:14px; }
  form { display:flex; align-items:flex-end; gap:8px; margin:0 auto 16px; padding:8px 8px 8px 16px; max-width:788px; width:calc(100% - 32px); background:var(--surface); border:1px solid var(--border); border-radius:22px; box-shadow:0 6px 24px -12px var(--shadow); }
  form:focus-within { border-color:var(--accent); }
  form textarea { flex:1; resize:none; min-height:38px; max-height:160px; padding:7px 0; background:transparent; border:0; }
  form textarea:focus { box-shadow:none; }
  #send { width:38px; padding:0; border-radius:50%; flex:none; }
  @media (max-width:560px) { header { gap:8px; } #theme { order:2; } #auth { order:3; max-width:none; flex:1 1 180px; min-width:0; } #new { order:4; } form { margin-bottom:10px; width:calc(100% - 20px); } }
</style>
<script>
  // Apply the saved theme before first paint.
  try { const t = localStorage.getItem("bc.theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch {}
</script>
</head>
<body>
<header>
  <div class="brand"><span class="mark" aria-hidden="true"></span>BanglaClaw</div>
  <span id="status" data-state="off">disconnected</span>
  <div id="auth"><input id="key" type="password" placeholder="API key (bck_…)" autocomplete="off" aria-label="API key"><button id="connect">Connect</button></div>
  <button id="new" class="secondary" title="Start a new conversation">New chat</button>
  <button id="theme" class="secondary icon" type="button" title="Theme: system" aria-label="Theme: system"><svg class="t-system" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg><svg class="t-light" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="t-dark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg></button>
</header>
<main id="log" aria-live="polite"></main>
<form id="form"><textarea id="input" rows="1" placeholder="বাংলা, Banglish বা English-এ লিখুন…" aria-label="Message" disabled></textarea><button id="send" aria-label="Send" title="Send" disabled><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></form>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  let ws, sessionId = store.get("bc.session"), subscribed = null, current = null, counter = 0;
  $("key").value = store.get("bc.key") || "";

  const add = (cls, text) => { const el = document.createElement("div"); el.className = "msg " + cls; el.textContent = text; $("log").append(el); el.scrollIntoView({ block: "end" }); return el; };
  // Follow the current session so operator replies (handoff) arrive without a new message.
  const follow = () => {
    if (!ws || ws.readyState !== 1 || subscribed === sessionId) return;
    if (subscribed) ws.send(JSON.stringify({ type: "unsubscribe", sessionId: subscribed }));
    subscribed = sessionId;
    if (sessionId) ws.send(JSON.stringify({ type: "subscribe", sessionId }));
  };
  // state (off | connecting | on | error) colours the status dot; omitted, it stays as it is.
  const setReady = (ready, label, state) => { $("status").textContent = label; if (state) $("status").dataset.state = state; $("input").disabled = !ready; $("send").disabled = !ready; if (ready) $("input").focus(); };

  function connect() {
    const key = $("key").value.trim();
    if (!key) return;
    store.set("bc.key", key);
    if (ws) ws.close();
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/v1/ws");
    setReady(false, "connecting…", "connecting");
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", apiKey: key }));
    ws.onclose = (e) => { subscribed = null; setReady(false, e.code === 4401 ? "invalid API key" : "disconnected", e.code === 4401 ? "error" : "off"); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "ready") { setReady(true, "connected as " + m.user.name, "on"); follow(); }
      else if (m.type === "session_event") {
        if (m.sessionId !== sessionId) return;
        if (m.event.type === "operator_message") { add("operator", m.event.text); current = null; }
        else if (m.event.type === "handoff_released") add("tool", "🤖 back to the assistant");
      }
      else if (m.type === "event") {
        const ev = m.event;
        if (ev.type === "token") { current = current || add("assistant", ""); current.textContent += ev.text; current.scrollIntoView({ block: "end" }); }
        else if (ev.type === "tool_start" && !ev.tool.startsWith("transfer_to_") && ev.tool !== "request_human") { add("tool", "⚙ " + ev.tool + " " + JSON.stringify(ev.input)); current = null; }
        else if (ev.type === "agent_transfer") { add("tool", "↪ " + ev.to); current = null; }
        else if (ev.type === "handoff") { add("tool", ev.pending ? "⏳ waiting for a human operator" : "👤 handed to a human: " + ev.reason); current = null; }
      } else if (m.type === "done") {
        sessionId = m.sessionId; store.set("bc.session", sessionId); follow();
        if (m.run.status !== "completed" && m.run.status !== "limited") add("error", m.run.error || m.run.status);
        current = null; setReady(true, $("status").textContent);
      } else if (m.type === "error" && !m.ref && m.error.code === "session_not_found") {
        // The saved session belongs to another key or no longer exists: start fresh quietly.
        sessionId = null; subscribed = null; store.set("bc.session", null);
      } else if (m.type === "error") { add("error", m.error.message); current = null; setReady(true, $("status").textContent); }
    };
  }

  // The button's icon follows data-theme in CSS; only its label is set here.
  const showTheme = (t) => { $("theme").title = "Theme: " + t; $("theme").setAttribute("aria-label", "Theme: " + t); };
  showTheme(document.documentElement.dataset.theme || "system");
  $("theme").onclick = () => {
    const next = { system: "light", light: "dark", dark: "system" }[document.documentElement.dataset.theme || "system"];
    if (next === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
    store.set("bc.theme", next === "system" ? null : next); showTheme(next);
  };
  $("connect").onclick = connect;
  $("key").onkeydown = (e) => { if (e.key === "Enter") connect(); };
  $("new").onclick = () => { sessionId = null; store.set("bc.session", null); follow(); $("log").replaceChildren(); add("tool", "— new conversation —"); };
  $("input").oninput = (e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; };
  $("input").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("form").requestSubmit(); } };
  $("form").onsubmit = (e) => {
    e.preventDefault();
    const text = $("input").value.trim();
    if (!text || !ws || ws.readyState !== 1) return;
    add("user", text); $("input").value = ""; $("input").style.height = "auto"; current = null;
    ws.send(JSON.stringify({ type: "run", ref: "r" + (++counter), text, ...(sessionId ? { sessionId } : {}) }));
    setReady(false, $("status").textContent);
  };
  if ($("key").value) connect();
})();
</script>
</body>
</html>`;
