/**
 * Self-contained browser chat (channels.web). Talks to /v1/ws with the user's API key, which is
 * kept in localStorage. No external assets, so a strict CSP applies.
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
  :root { --bg:#f6f7f9; --panel:#fff; --text:#1c1f24; --muted:#6b7280; --user:#0f766e; --user-text:#fff; --border:#e5e7eb; --accent:#0f766e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111418; --panel:#1a1e24; --text:#e8eaed; --muted:#9aa0a6; --user:#14b8a6; --user-text:#06201d; --border:#2a2f37; --accent:#14b8a6; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.55 system-ui, "Noto Sans Bengali", "Hind Siliguri", "SolaimanLipi", sans-serif; height:100dvh; display:flex; flex-direction:column; }
  header { display:flex; gap:8px; align-items:center; padding:10px 16px; border-bottom:1px solid var(--border); background:var(--panel); flex-wrap:wrap; }
  header h1 { font-size:17px; margin:0 auto 0 0; }
  input, button, textarea { font:inherit; color:inherit; }
  input, textarea { background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:8px 10px; }
  button { background:var(--accent); color:var(--user-text); border:0; border-radius:8px; padding:8px 14px; cursor:pointer; }
  button.secondary { background:transparent; color:var(--text); border:1px solid var(--border); }
  #status { font-size:13px; color:var(--muted); }
  main { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:10px; max-width:820px; width:100%; margin:0 auto; }
  .msg { padding:10px 14px; border-radius:14px; max-width:85%; white-space:pre-wrap; overflow-wrap:anywhere; }
  .user { align-self:flex-end; background:var(--user); color:var(--user-text); border-bottom-right-radius:4px; }
  .assistant { align-self:flex-start; background:var(--panel); border:1px solid var(--border); border-bottom-left-radius:4px; }
  .tool { align-self:flex-start; font-size:13px; color:var(--muted); font-family:ui-monospace, monospace; }
  .error { align-self:center; color:#dc2626; font-size:14px; }
  form { display:flex; gap:8px; padding:12px 16px; border-top:1px solid var(--border); background:var(--panel); max-width:820px; width:100%; margin:0 auto; }
  form textarea { flex:1; resize:none; min-height:44px; max-height:160px; }
  #auth { display:flex; gap:8px; flex:1 1 320px; }
  #auth input { flex:1; min-width:0; }
</style>
</head>
<body>
<header>
  <h1>🐾 BanglaClaw</h1>
  <span id="status">disconnected</span>
  <div id="auth"><input id="key" type="password" placeholder="API key (bck_…)" autocomplete="off"><button id="connect">Connect</button></div>
  <button id="new" class="secondary" title="Start a new conversation">New chat</button>
</header>
<main id="log" aria-live="polite"></main>
<form id="form"><textarea id="input" rows="1" placeholder="বাংলা, Banglish বা English-এ লিখুন…" disabled></textarea><button id="send" disabled>Send</button></form>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  let ws, sessionId = store.get("bc.session"), current = null, counter = 0;
  $("key").value = store.get("bc.key") || "";

  const add = (cls, text) => { const el = document.createElement("div"); el.className = "msg " + cls; el.textContent = text; $("log").append(el); el.scrollIntoView({ block: "end" }); return el; };
  const setReady = (ready, label) => { $("status").textContent = label; $("input").disabled = !ready; $("send").disabled = !ready; if (ready) $("input").focus(); };

  function connect() {
    const key = $("key").value.trim();
    if (!key) return;
    store.set("bc.key", key);
    if (ws) ws.close();
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/v1/ws");
    setReady(false, "connecting…");
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", apiKey: key }));
    ws.onclose = (e) => setReady(false, e.code === 4401 ? "invalid API key" : "disconnected");
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "ready") setReady(true, "connected as " + m.user.name);
      else if (m.type === "event") {
        const ev = m.event;
        if (ev.type === "token") { current = current || add("assistant", ""); current.textContent += ev.text; current.scrollIntoView({ block: "end" }); }
        else if (ev.type === "tool_start") { add("tool", "⚙ " + ev.tool + " " + JSON.stringify(ev.input)); current = null; }
      } else if (m.type === "done") {
        sessionId = m.sessionId; store.set("bc.session", sessionId);
        if (m.run.status !== "completed" && m.run.status !== "limited") add("error", m.run.error || m.run.status);
        current = null; setReady(true, $("status").textContent);
      } else if (m.type === "error") { add("error", m.error.message); current = null; setReady(true, $("status").textContent); }
    };
  }

  $("connect").onclick = connect;
  $("key").onkeydown = (e) => { if (e.key === "Enter") connect(); };
  $("new").onclick = () => { sessionId = null; store.set("bc.session", null); $("log").replaceChildren(); add("tool", "— new conversation —"); };
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
