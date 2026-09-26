/**
 * Self-contained browser chat (channels.web). Talks to /v1/ws with the user's API key, which is
 * kept in localStorage, and to /v1/sessions for the sidebar (titled by the server) and history. It subscribes to the open
 * session so operator replies during a handoff appear live. No external assets, so a strict CSP
 * applies. Colours match the admin dashboard palette.
 *
 * The page is split into STYLE, BODY and SCRIPT. They are String.raw literals, so regex escapes
 * pass through untouched; they must not contain a backtick or a dollar-brace (use \x60 in the script).
 */
import { MARKDOWN_JS } from "./browser-markdown.js";

export const WEB_CHAT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const STYLE = String.raw`
  /* Same palette as the admin dashboard; data-theme on <html> overrides the OS preference. */
  :root { color-scheme: light dark;
    --page:light-dark(#f7f6f2,#0e1512); --surface:light-dark(#ffffff,#151f1a); --surface-2:light-dark(#efede6,#1c2822); --side:light-dark(#efede6,#111a16);
    --text:light-dark(#15201b,#e7ece9); --text-2:light-dark(#3d4a44,#c2ccc7); --muted:light-dark(#5f6b65,#8d9a93); --border:light-dark(rgba(21,32,27,.12),rgba(231,236,233,.1));
    --accent:light-dark(#0b6b4f,#34b58a); --accent-strong:light-dark(#085a42,#4cc79d); --on-accent:light-dark(#ffffff,#06140f); --accent-text:light-dark(#0a5c44,#5fd3a8);
    --wash:light-dark(rgba(11,107,79,.08),rgba(52,181,138,.12)); --red:#d42c39; --red-text:light-dark(#c62f3a,#f0616b);
    --critical:light-dark(#b42f2f,#f28b8b); --critical-wash:light-dark(rgba(198,47,58,.08),rgba(240,97,107,.12)); --warning:light-dark(#b07400,#e0b25a);
    --shadow:light-dark(rgba(21,32,27,.08),rgba(0,0,0,.35));
    --mono:ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace; }
  :root[data-theme="light"] { color-scheme: light; }
  :root[data-theme="dark"] { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height:100%; }
  body { margin:0; background:var(--page); color:var(--text); font:15px/1.65 system-ui, -apple-system, "Segoe UI", "Noto Sans Bengali", "Hind Siliguri", "SolaimanLipi", "Kohinoor Bangla", sans-serif; -webkit-font-smoothing:antialiased; }
  input, button, textarea { font:inherit; color:inherit; }
  :focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  button { cursor:pointer; }
  button:disabled { opacity:.45; cursor:default; }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:36px; padding:0 14px; border:0; border-radius:10px; background:var(--accent); color:var(--on-accent); font-weight:600; }
  .btn:hover:not(:disabled) { background:var(--accent-strong); }
  .ghost { display:inline-flex; align-items:center; justify-content:center; gap:8px; height:34px; min-width:34px; padding:0 8px; border:0; border-radius:8px; background:transparent; color:var(--text-2); }
  .ghost:hover:not(:disabled) { background:var(--wash); color:var(--text); }
  svg { flex:none; }
  .app { display:grid; grid-template-columns:272px minmax(0,1fr); height:100dvh; }
  .app.collapsed { grid-template-columns:0 minmax(0,1fr); }
  .app.collapsed #side { visibility:hidden; }
  .app:not(.collapsed) #open { display:none; }

  /* Sidebar */
  #side { display:flex; flex-direction:column; min-width:0; overflow:hidden; background:var(--side); border-right:1px solid var(--border); }
  .side-head { display:flex; align-items:center; gap:8px; padding:14px 12px 10px 16px; }
  .brand { display:flex; align-items:center; gap:10px; margin-right:auto; font-size:16px; font-weight:700; letter-spacing:-.01em; white-space:nowrap; }
  .mark { position:relative; width:24px; height:24px; border-radius:7px; background:#0b6b4f; flex:none; }
  .mark::after { content:""; position:absolute; top:50%; left:45%; width:11px; height:11px; border-radius:50%; background:var(--red); transform:translate(-50%,-50%); }
  #new { justify-content:flex-start; margin:0 12px 8px; height:38px; padding:0 12px; border:1px solid var(--border); background:var(--surface); color:var(--text); font-weight:600; }
  #sessions { flex:1; overflow-y:auto; padding:4px 8px 12px; }
  .group { margin:14px 8px 4px; color:var(--muted); font-size:11.5px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; }
  .srow { display:flex; align-items:center; gap:8px; width:100%; height:36px; padding:0 10px; border:0; border-radius:8px; background:transparent; color:var(--text-2); text-align:left; }
  .srow:hover { background:var(--wash); color:var(--text); }
  .srow.active { background:var(--surface); color:var(--text); font-weight:600; box-shadow:0 1px 2px var(--shadow); }
  .srow .title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .srow .dot { width:7px; height:7px; border-radius:50%; background:var(--red); flex:none; }
  .side-empty { margin:16px 12px; color:var(--muted); font-size:13px; }
  .side-foot { display:flex; align-items:center; gap:4px; padding:10px 12px; border-top:1px solid var(--border); }
  #who { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; color:var(--muted); }
  #theme svg { display:none; }
  :root:not([data-theme]) #theme .t-system, :root[data-theme="light"] #theme .t-light, :root[data-theme="dark"] #theme .t-dark { display:block; }

  /* Main column */
  main { display:flex; flex-direction:column; min-width:0; height:100dvh; }
  .top { display:flex; align-items:center; gap:8px; height:52px; padding:0 12px 0 16px; border-bottom:1px solid var(--border); }
  #title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
  .pill { display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 9px; border-radius:999px; background:var(--surface-2); color:var(--muted); font-size:12px; font-weight:500; white-space:nowrap; }
  #agentpill:empty { display:none; }
  #scroll { flex:1; overflow-y:auto; }
  #log { max-width:780px; margin:0 auto; padding:28px 20px 12px; display:flex; flex-direction:column; gap:22px; }

  /* Turns */
  .turn { animation:rise .16s ease-out; }
  @keyframes rise { from { opacity:0; transform:translateY(4px); } }
  .turn.user { align-self:flex-end; max-width:85%; }
  .turn.user .bubble { padding:10px 15px; border-radius:18px 18px 6px 18px; background:var(--surface-2); white-space:pre-wrap; overflow-wrap:anywhere; }
  .turn.user.long .bubble { max-height:9.5em; overflow:hidden; mask-image:linear-gradient(#000 70%, transparent); }
  .turn.user.long.open .bubble { max-height:none; mask-image:none; }
  .more { display:block; margin:4px 4px 0 auto; padding:0; border:0; background:none; color:var(--muted); font-size:12.5px; }
  .turn.assistant { display:flex; flex-direction:column; gap:10px; min-width:0; }
  .who-line { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:12.5px; font-weight:600; }
  .who-line .mark { width:18px; height:18px; border-radius:5px; }
  .who-line .mark::after { width:8px; height:8px; }
  .turn.operator .who-line { color:var(--red-text); }
  .turn.operator .md { padding-left:12px; border-left:3px solid var(--red); }
  .meta { color:var(--muted); font-size:12px; }
  .note { align-self:center; padding:3px 12px; border-radius:999px; background:var(--surface-2); color:var(--muted); font-size:12.5px; }
  .errline { padding:8px 12px; border-radius:10px; background:var(--critical-wash); color:var(--critical); font-size:14px; }
  .thinking { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:13.5px; }
  .dots { display:inline-flex; gap:3px; }
  .dots i { width:6px; height:6px; border-radius:50%; background:var(--accent); animation:blink 1.2s infinite ease-in-out; }
  .dots i:nth-child(2) { animation-delay:.15s; } .dots i:nth-child(3) { animation-delay:.3s; }
  @keyframes blink { 0%, 80%, 100% { opacity:.25; } 40% { opacity:1; } }

  /* Markdown */
  .md { overflow-wrap:anywhere; }
  .md > :first-child { margin-top:0; } .md > :last-child { margin-bottom:0; }
  .md p, .md ul, .md ol, .md blockquote, .md table, .md .code { margin:0 0 .75em; }
  .md h1, .md h2, .md h3 { margin:1.1em 0 .5em; font-size:1.08em; line-height:1.35; }
  .md h1 { font-size:1.25em; }
  .md ul, .md ol { padding-left:1.4em; }
  .md li + li { margin-top:.2em; }
  .md blockquote { padding-left:12px; border-left:3px solid var(--border); color:var(--text-2); }
  .md a { color:var(--accent-text); }
  .md code { padding:.1em .35em; border-radius:5px; background:var(--surface-2); font:.88em var(--mono); }
  .md table { border-collapse:collapse; display:block; overflow-x:auto; font-size:.93em; }
  .md th, .md td { padding:6px 12px; border:1px solid var(--border); text-align:left; }
  .md th { background:var(--surface-2); font-weight:600; }
  .code { border:1px solid var(--border); border-radius:10px; overflow:hidden; background:var(--surface); }
  .code-head { display:flex; align-items:center; justify-content:space-between; height:32px; padding:0 6px 0 12px; background:var(--surface-2); color:var(--muted); font:12px var(--mono); }
  .code-head button { height:24px; padding:0 8px; border:0; border-radius:6px; background:transparent; color:var(--muted); font:12px system-ui, sans-serif; }
  .code-head button:hover { background:var(--wash); color:var(--text); }
  .code pre { margin:0; padding:12px 14px; overflow-x:auto; }
  .code pre code { padding:0; background:none; font-size:13px; line-height:1.55; }

  /* Tool cards and the "Worked for" fold */
  .tool { border:1px solid var(--border); border-radius:10px; background:var(--surface); font-size:13.5px; }
  .tool > summary, .worked > summary { display:flex; align-items:center; gap:8px; list-style:none; cursor:pointer; }
  .tool > summary::-webkit-details-marker, .worked > summary::-webkit-details-marker { display:none; }
  .tool > summary { min-height:36px; padding:6px 12px; }
  .tool .tname { font:600 13px var(--mono); }
  .tool .targs { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); font:12.5px var(--mono); }
  .tool .tdur { color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
  .ticon { display:inline-grid; place-items:center; width:18px; height:18px; border-radius:50%; font-size:11px; font-weight:700; flex:none; }
  .tool[data-state="running"] .ticon { border:2px solid var(--wash); border-top-color:var(--accent); animation:spin .8s linear infinite; }
  .tool[data-state="ok"] .ticon { background:var(--wash); color:var(--accent-text); }
  .tool[data-state="fail"] .ticon { background:var(--critical-wash); color:var(--critical); }
  @keyframes spin { to { transform:rotate(360deg); } }
  .chev { color:var(--muted); transition:transform .15s; }
  details[open] > summary .chev { transform:rotate(90deg); }
  .tbody { padding:0 12px 12px; border-top:1px solid var(--border); }
  .tlabel { margin:10px 0 4px; color:var(--muted); font-size:11.5px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; }
  .tbody pre { margin:0; padding:8px 10px; max-height:260px; overflow:auto; border-radius:8px; background:var(--surface-2); font:12.5px/1.5 var(--mono); white-space:pre-wrap; overflow-wrap:anywhere; }
  .tbody .err { color:var(--critical); }
  .worked > summary { width:max-content; max-width:100%; padding:2px 0; color:var(--muted); font-size:13px; font-weight:500; }
  .worked > summary:hover { color:var(--text); }
  .worked > .inner { display:flex; flex-direction:column; gap:6px; margin-top:8px; padding-left:12px; border-left:2px solid var(--border); }
  .activity { display:flex; flex-direction:column; gap:6px; }

  /* Empty state and connect card */
  .hero { margin:12vh auto 0; max-width:520px; text-align:center; }
  .hero .mark { width:44px; height:44px; margin:0 auto 16px; border-radius:12px; }
  .hero .mark::after { width:20px; height:20px; }
  .hero h1 { margin:0 0 6px; font-size:24px; letter-spacing:-.02em; }
  .hero p { margin:0 0 22px; color:var(--muted); }
  .chips { display:flex; flex-wrap:wrap; justify-content:center; gap:8px; }
  .chips button { padding:8px 14px; border:1px solid var(--border); border-radius:999px; background:var(--surface); color:var(--text-2); font-size:14px; }
  .chips button:hover { border-color:var(--accent); color:var(--text); }
  .connect { margin:14vh auto 0; width:100%; max-width:420px; padding:28px; border:1px solid var(--border); border-radius:16px; background:var(--surface); box-shadow:0 10px 30px -18px var(--shadow); }
  .connect h1 { display:flex; align-items:center; gap:10px; margin:0 0 6px; font-size:20px; }
  .connect p { margin:0 0 16px; color:var(--muted); font-size:14px; }
  .connect form { display:flex; gap:8px; }
  #key { flex:1; min-width:0; height:38px; padding:0 12px; border:1px solid var(--border); border-radius:10px; background:var(--page); }
  #key:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--wash); }
  #keyerr { margin:10px 0 0; color:var(--critical); font-size:13.5px; }
  #keyerr:empty { display:none; }

  /* Composer and footer */
  .dock { max-width:780px; width:100%; margin:0 auto; padding:0 20px 12px; position:relative; }
  #form { display:flex; align-items:flex-end; gap:8px; padding:8px 8px 8px 16px; border:1px solid var(--border); border-radius:20px; background:var(--surface); box-shadow:0 8px 28px -16px var(--shadow); }
  #form:focus-within { border-color:var(--accent); }
  #input { flex:1; min-height:38px; max-height:220px; padding:7px 0; border:0; background:transparent; resize:none; outline:none; }
  #send, #stop { width:38px; height:38px; padding:0; border-radius:50%; flex:none; }
  #stop { display:none; background:var(--text); color:var(--page); }
  .running #send { display:none; } .running #stop { display:inline-flex; }
  #menu { position:absolute; left:20px; right:20px; bottom:calc(100% - 4px); margin:0; padding:6px; list-style:none; border:1px solid var(--border); border-radius:14px; background:var(--surface); box-shadow:0 12px 32px -16px var(--shadow); }
  #menu[hidden] { display:none; }
  #menu li { display:flex; gap:12px; padding:7px 10px; border-radius:8px; cursor:pointer; }
  #menu li b { min-width:84px; font:600 13px var(--mono); }
  #menu li span { color:var(--muted); font-size:13.5px; }
  #menu li.sel { background:var(--wash); }
  #footer { display:flex; flex-wrap:wrap; align-items:center; gap:6px 12px; padding:8px 6px 0; color:var(--muted); font-size:12px; }
  #footer .hint { margin-left:auto; }
  kbd { padding:0 5px; border:1px solid var(--border); border-bottom-width:2px; border-radius:5px; font:11px var(--mono); color:var(--muted); }
  #status { display:inline-flex; align-items:center; gap:6px; }
  #status::before { content:""; width:7px; height:7px; border-radius:50%; background:var(--muted); }
  #status[data-state="connecting"]::before, #status[data-state="running"]::before { background:var(--warning); animation:pulse 1s ease-in-out infinite; }
  #status[data-state="on"]::before { background:var(--accent); }
  #status[data-state="error"] { color:var(--critical); }
  #status[data-state="error"]::before { background:var(--critical); }
  @keyframes pulse { 50% { opacity:.3; } }
  /* Sidebar tabs, search, row actions, files */
  .tabs { display:flex; gap:4px; margin:0 12px 8px; padding:3px; border-radius:10px; background:var(--surface-2); }
  .tab { flex:1; height:30px; border:0; border-radius:7px; background:transparent; color:var(--text-2); font-weight:600; font-size:13.5px; }
  .tab.active { background:var(--surface); color:var(--text); box-shadow:0 1px 2px var(--shadow); }
  .pane { display:flex; flex-direction:column; flex:1; min-height:0; }
  .pane[hidden] { display:none; }
  .search { margin:0 12px 6px; height:34px; padding:0 11px; border:1px solid var(--border); border-radius:9px; background:var(--surface); color:var(--text); }
  .search:focus { outline:none; border-color:var(--accent); }
  #sessions { flex:1; overflow-y:auto; padding:4px 8px 12px; }
  .srow { position:relative; }
  .srow .open { all:unset; display:flex; align-items:center; gap:8px; flex:1; min-width:0; height:100%; cursor:pointer; }
  .srow .open:focus-visible { outline:2px solid var(--accent); border-radius:6px; }
  .srow .acts { display:none; gap:2px; }
  .srow:hover .acts, .srow:focus-within .acts, .srow.active .acts { display:flex; }
  .srow .acts button { width:26px; height:26px; min-width:0; padding:0; font-size:13px; }
  .srow input.rename { flex:1; min-width:0; height:26px; padding:0 6px; border:1px solid var(--accent); border-radius:6px; background:var(--surface); color:var(--text); font:inherit; }
  .files-head { display:flex; align-items:center; justify-content:space-between; margin:0 12px 4px 20px; color:var(--muted); font-size:12px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; }
  #files { flex:1; overflow-y:auto; padding:0 8px 12px; }
  .frow { display:flex; align-items:center; gap:8px; width:100%; min-height:32px; padding:4px 10px; border:0; border-radius:8px; background:transparent; color:var(--text-2); text-align:left; font-size:14px; cursor:pointer; }
  .frow:hover { background:var(--wash); color:var(--text); }
  .frow .fname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .frow .fsize { color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
  .fdir { padding:8px 10px 2px; color:var(--muted); font-size:12.5px; font-weight:600; }
  /* Composer extras */
  .icon-btn { display:inline-flex; align-items:center; justify-content:center; gap:4px; width:38px; height:38px; flex:none; padding:0; border:0; border-radius:50%; background:transparent; color:var(--muted); }
  .icon-btn:hover:not(:disabled) { background:var(--wash); color:var(--text); }
  .icon-btn[hidden] { display:none; }
  #mic[aria-pressed="true"] { width:auto; padding:0 12px; border-radius:19px; background:var(--critical-wash); color:var(--critical); }
  #mic-time { font-size:12.5px; font-variant-numeric:tabular-nums; }
  #attachments { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px; }
  #attachments:empty { display:none; }
  .chip { display:inline-flex; align-items:center; gap:6px; max-width:100%; padding:4px 6px 4px 10px; border:1px solid var(--border); border-radius:999px; background:var(--surface); font-size:13px; }
  .chip .cname { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chip .cstate { color:var(--muted); font-size:12px; }
  .chip.error { border-color:var(--critical); color:var(--critical); }
  .chip button { width:22px; height:22px; border:0; border-radius:50%; background:transparent; color:var(--muted); }
  .chip button:hover { background:var(--wash); color:var(--text); }
  main.drop { outline:3px dashed var(--accent); outline-offset:-10px; }
  /* Message actions */
  .msg-acts { display:flex; gap:4px; }
  .turn.user .msg-acts { justify-content:flex-end; opacity:0; transition:opacity .12s; }
  .turn.user:hover .msg-acts, .turn.user:focus-within .msg-acts { opacity:1; }
  .msg-acts button { height:26px; padding:0 9px; border:1px solid transparent; border-radius:7px; background:transparent; color:var(--muted); font-size:12.5px; }
  .msg-acts button:hover { border-color:var(--border); background:var(--surface); color:var(--text); }
  /* File viewer */
  .viewer { position:fixed; inset:0; z-index:10; display:grid; place-items:center; padding:16px; background:rgba(0,0,0,.4); }
  .viewer[hidden] { display:none; }
  .viewer-card { display:flex; flex-direction:column; width:min(760px,100%); max-height:min(80vh,900px); border-radius:14px; background:var(--surface); box-shadow:0 24px 60px -20px rgba(0,0,0,.5); overflow:hidden; }
  .viewer-head { display:flex; align-items:center; gap:4px; padding:10px 10px 10px 16px; border-bottom:1px solid var(--border); }
  .viewer-head b { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--mono); font-size:14px; }
  .viewer-head .grow { flex:1; }
  .viewer-head .danger { color:var(--critical); }
  .viewer-body { flex:1; overflow:auto; padding:16px; }
  .viewer-body pre.raw { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font:13px/1.6 var(--mono); }
  .versions { display:flex; flex-direction:column; gap:6px; }
  .version { display:flex; align-items:center; gap:10px; padding:8px 12px; border:1px solid var(--border); border-radius:10px; font-size:14px; }
  .version .grow { flex:1; color:var(--muted); font-size:13px; }
  #toast { position:fixed; left:50%; bottom:24px; z-index:11; transform:translateX(-50%); display:flex; align-items:center; gap:12px; padding:10px 14px; border-radius:12px; background:var(--text); color:var(--page); font-size:14px; box-shadow:0 10px 30px -10px rgba(0,0,0,.5); }
  #toast[hidden] { display:none; }
  #toast button { border:0; background:none; color:inherit; font-weight:700; text-decoration:underline; cursor:pointer; }
  #backdrop { display:none; }
  @media (max-width:820px) {
    .app, .app.collapsed { grid-template-columns:minmax(0,1fr); }
    .app:not(.collapsed) #open, .app.collapsed #open { display:inline-flex; }
    #side { position:fixed; inset:0 auto 0 0; z-index:5; width:min(84vw,300px); transform:translateX(-100%); transition:transform .2s; visibility:visible !important; }
    .app.drawer #side { transform:none; box-shadow:0 0 40px var(--shadow); }
    .app.drawer #backdrop { display:block; position:fixed; inset:0; z-index:4; background:rgba(0,0,0,.35); }
    #log { padding:20px 14px 8px; } .dock { padding:0 10px 8px; } #menu { left:10px; right:10px; }
    #footer .hint { display:none; }
  }
`;

const ICON = {
  panel: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  send: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  stop: '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor"/></svg>',
  clip: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.4 11.6-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
  mic: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>',
  refresh: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  close: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  logout: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/></svg>',
  theme:
    '<svg class="t-system" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>' +
    '<svg class="t-light" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>' +
    '<svg class="t-dark" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
};

const BODY = String.raw`
<div class="app" id="app">
  <aside id="side" aria-label="Conversations">
    <div class="side-head"><div class="brand"><span class="mark" aria-hidden="true"></span>BanglaClaw</div><button id="collapse" class="ghost" type="button" title="Hide sidebar" aria-label="Hide sidebar">@panel</button></div>
    <button id="new" class="ghost" type="button" title="Start a new conversation">@plus New chat</button>
    <div class="tabs" role="tablist" aria-label="Sidebar"><button id="tab-chats" class="tab active" type="button" role="tab" aria-selected="true">Chats</button><button id="tab-files" class="tab" type="button" role="tab" aria-selected="false" hidden>Files</button></div>
    <div id="pane-chats" class="pane"><input id="search" class="search" type="search" placeholder="Search conversations" aria-label="Search conversations" autocomplete="off"><nav id="sessions"></nav></div>
    <div id="pane-files" class="pane" hidden><div class="files-head"><span>Your workspace</span><button id="files-refresh" class="ghost" type="button" title="Refresh" aria-label="Refresh files">@refresh</button></div><nav id="files" aria-label="Files"></nav></div>
    <div class="side-foot"><span id="who">not connected</span><button id="theme" class="ghost" type="button" title="Theme: system" aria-label="Theme: system">@theme</button><button id="logout" class="ghost" type="button" title="Forget API key" aria-label="Forget API key">@logout</button></div>
  </aside>
  <div id="backdrop"></div>
  <main>
    <div class="top"><button id="open" class="ghost" type="button" title="Show sidebar" aria-label="Show sidebar">@panel</button><span id="title">New chat</span><span id="agentpill" class="pill"></span></div>
    <div id="scroll"><div id="log" aria-live="polite"></div></div>
    <div class="dock" id="dock">
      <ul id="menu" role="listbox" hidden></ul>
      <div id="attachments"></div>
      <form id="form"><button id="attach" class="icon-btn" type="button" title="Attach a file (PDF, DOCX, TXT, CSV…)" aria-label="Attach a file" hidden>@clip</button><input id="file" type="file" accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.pdf,.docx" hidden><textarea id="input" rows="1" placeholder="বাংলা, Banglish বা English-এ লিখুন…" aria-label="Message" disabled></textarea><button id="mic" class="icon-btn" type="button" title="Speak (voice to text)" aria-label="Record voice" aria-pressed="false" hidden>@mic<span id="mic-time"></span></button><button id="send" class="btn" aria-label="Send" title="Send (Enter)" disabled>@send</button><button id="stop" class="btn" type="button" aria-label="Stop" title="Stop (Esc)">@stop</button></form>
      <div id="footer"><span id="status" data-state="off">disconnected</span><span id="info"></span><span class="hint"><kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline · <kbd>/</kbd> commands · <kbd>Esc</kbd> stop</span></div>
    </div>
  </main>
  <div id="viewer" class="viewer" hidden role="dialog" aria-modal="true" aria-labelledby="viewer-title">
    <div class="viewer-card">
      <div class="viewer-head"><b id="viewer-title"></b><span class="grow"></span><button id="viewer-history" class="ghost" type="button">History</button><button id="viewer-download" class="ghost" type="button">Download</button><button id="viewer-delete" class="ghost danger" type="button">Delete</button><button id="viewer-close" class="ghost" type="button" aria-label="Close">@close</button></div>
      <div id="viewer-body" class="viewer-body"></div>
    </div>
  </div>
  <div id="toast" role="status" hidden></div>
</div>
`.replace(/@(\w+)/g, (match, name: string) => (name in ICON ? ICON[name as keyof typeof ICON] : match));

const SCRIPT = String.raw`
(() => {
  const $ = (id) => document.getElementById(id);
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  const h = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const json = (v) => { if (typeof v === "string") return v; try { return JSON.stringify(v, null, 2); } catch { return String(v); } };
  const oneLine = (v) => { if (v && typeof v === "object") { const vals = Object.values(v); if (vals.length === 1 && typeof vals[0] !== "object") return String(vals[0]); } return typeof v === "string" ? v : JSON.stringify(v) || ""; };
  const isControl = (tool) => tool.startsWith("transfer_to_") || tool === "request_human";
  const CHEV = '<svg class="chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
`;

const SCRIPT_MAIN = String.raw`

  // ---- State ----
  let ws = null, me = null, key = store.get("bc.key") || "", sessionId = store.get("bc.session"), subscribed = null, counter = 0;
  let sessions = [], run = null, lastUsage = "", agent = "", paint = 0;
  let titles = {};
  try { titles = JSON.parse(store.get("bc.titles") || "{}") || {}; } catch {}
  const saveTitle = (id, text) => { if (!id || !text || titles[id]) return; titles[id] = text.replace(/\s+/g, " ").trim().slice(0, 60); store.set("bc.titles", JSON.stringify(titles)); };
  const log = $("log"), scroller = $("scroll");
  const atBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  const scrollEnd = (force) => { if (force || atBottom()) scroller.scrollTop = scroller.scrollHeight; };
  const shortId = (id) => (id ? id.slice(0, 8) : "new");
  const setStatus = (label, state) => { $("status").textContent = label; if (state) $("status").dataset.state = state; };
  const setComposer = (on) => { $("input").disabled = !on; $("send").disabled = !on; if (on) $("input").focus(); };
  function renderInfo() {
    const parts = [];
    if (agent) parts.push("agent " + agent);
    parts.push("session " + shortId(sessionId));
    if (lastUsage) parts.push(lastUsage);
    $("info").textContent = parts.join("  ·  ");
    $("agentpill").textContent = agent && agent !== "supervisor" ? agent : "";
    $("title").textContent = sessionId ? titles[sessionId] || "Conversation " + shortId(sessionId) : "New chat";
  }

  // ---- Sidebar ----
  // init: { method, json, body, type } — json is sent as JSON, body as-is with Content-Type type.
  async function api(path, init) {
    const o = init || {};
    const headers = { authorization: "Bearer " + key };
    if (o.json !== undefined) headers["content-type"] = "application/json";
    else if (o.type) headers["content-type"] = o.type;
    const res = await fetch(path, { method: o.method || "GET", headers, body: o.json !== undefined ? JSON.stringify(o.json) : o.body });
    if (!res.ok) { const body = await res.json().catch(() => null); const err = new Error((body && body.error && body.error.message) || "HTTP " + res.status); err.status = res.status; throw err; }
    return res.status === 204 ? null : o.raw ? res : res.json();
  }
  function groupOf(date) {
    const day = 864e5, start = new Date(); start.setHours(0, 0, 0, 0);
    const t = new Date(date).getTime(), s = start.getTime();
    return t >= s ? "Today" : t >= s - day ? "Yesterday" : t >= s - 6 * day ? "Previous 7 days" : "Older";
  }
  function renderSessions() {
    const nav = $("sessions");
    nav.replaceChildren();
    if (!me) return;
    if (sessions.length === 0) { nav.append(h("p", "side-empty", $("search").value.trim() ? "No conversations match." : "No conversations yet.")); return; }
    let group = "";
    for (const s of sessions) {
      const g = groupOf(s.updatedAt);
      if (g !== group) { group = g; nav.append(h("div", "group", g)); }
      const row = h("div", "srow" + (s.id === sessionId ? " active" : ""));
      const open = h("button", "open");
      open.type = "button";
      open.title = new Date(s.updatedAt).toLocaleString();
      const label = s.title || titles[s.id] || s.externalId || "Conversation " + shortId(s.id);
      open.append(h("span", "title", label));
      if (s.status === "handoff") { const d = h("span", "dot"); d.title = "Waiting for a human"; open.append(d); }
      open.onclick = () => openSession(s.id);
      const acts = h("span", "acts");
      const rename = h("button", "ghost", "✎"); rename.type = "button"; rename.title = "Rename"; rename.setAttribute("aria-label", "Rename " + label);
      rename.onclick = () => startRename(row, s, label);
      const del = h("button", "ghost", "🗑"); del.type = "button"; del.title = "Delete"; del.setAttribute("aria-label", "Delete " + label);
      del.onclick = () => deleteSession(s, label);
      acts.append(rename, del);
      row.append(open, acts);
      nav.append(row);
    }
  }
  async function loadSessions() {
    if (!me) return;
    const q = $("search").value.trim();
    try { sessions = (await api("/v1/sessions?limit=50" + (q ? "&q=" + encodeURIComponent(q) : ""))).sessions; } catch { return; }
    // Titles come with the list (the first user message, stored by the gateway).
    for (const s of sessions) if (s.title) titles[s.id] = s.title;
    renderSessions(); renderInfo();
  }

  // ---- Transcript ----
  function empty() {
    log.replaceChildren();
    if (!me) {
      const card = h("div", "connect");
      card.innerHTML = '<h1><span class="mark" aria-hidden="true"></span>Connect to BanglaClaw</h1><p>Paste an API key. It stays in this browser (localStorage).</p><form id="keyform"><input id="key" type="password" placeholder="API key (bck_…)" autocomplete="off" aria-label="API key"><button id="connect" class="btn">Connect</button></form><p id="keyerr"></p>';
      log.append(card);
      $("key").value = key;
      $("keyform").onsubmit = (e) => { e.preventDefault(); key = $("key").value.trim(); connect(); };
      if ($("status").dataset.state === "error") $("keyerr").textContent = $("status").textContent;
      return;
    }
    const hero = h("div", "hero");
    hero.innerHTML = '<div class="mark" aria-hidden="true"></div><h1>আসসালামু আলাইকুম!</h1><p>বাংলা, Banglish বা English-এ যা খুশি জিজ্ঞেস করুন।</p>';
    const chips = h("div", "chips");
    for (const q of ["২৫ × ৪ কত?", "আজকে কী বার?", "Banglish e ekta chhoto kobita likho", "What can you do?"]) {
      const b = h("button", null, q);
      b.type = "button";
      b.onclick = () => { $("input").value = q; autosize(); $("input").focus(); };
      chips.append(b);
    }
    hero.append(chips);
    log.append(hero);
  }
  const clearHero = () => { if (log.querySelector(".hero, .connect")) log.replaceChildren(); };
  function userTurn(text) {
    clearHero();
    const t = h("div", "turn user");
    t.append(h("div", "bubble", text));
    if (text.length > 600 || text.split("\n").length > 7) {
      t.classList.add("long");
      const more = h("button", "more", "Show more");
      more.type = "button";
      more.onclick = () => { more.textContent = t.classList.toggle("open") ? "Show less" : "Show more"; };
      t.append(more);
    }
    const acts = h("div", "msg-acts");
    acts.append(actionButton("Edit", () => { $("input").value = text; autosize(); $("input").focus(); }), actionButton("Copy", () => copyText(text)));
    t.append(acts);
    log.append(t);
    return t;
  }
  function actionButton(label, onClick) { const b = h("button", null, label); b.type = "button"; b.onclick = onClick; return b; }
  function copyText(text, button) {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => toast("Copied"));
  }
  /** Copy (the reply text) and Retry (ask the same question again) under a finished reply. */
  function replyActions(turn, question) {
    turn.querySelector(":scope > .msg-acts")?.remove();
    const acts = h("div", "msg-acts");
    acts.append(actionButton("Copy", () => copyText([...turn.querySelectorAll(":scope > .md")].map((m) => m.innerText).join("\n\n"))));
    if (question) acts.append(actionButton("Retry", () => { if (!run) send(question); }));
    turn.append(acts);
  }
  function assistantTurn(cls, label) {
    clearHero();
    const t = h("div", "turn assistant" + (cls ? " " + cls : ""));
    const who = h("div", "who-line");
    who.innerHTML = cls === "operator" ? "👤 " : '<span class="mark" aria-hidden="true"></span>';
    who.append(document.createTextNode(label));
    t.append(who);
    log.append(t);
    return t;
  }
  function mdBlock(turn, text) { const d = h("div", "md"); d.innerHTML = md(text); turn.append(d); return d; }
  function activity(turn) {
    let a = turn.lastElementChild;
    if (!a || !a.classList.contains("activity")) { a = h("div", "activity"); turn.append(a); }
    return a;
  }
  function toolCard(tool, input) {
    const d = h("details", "tool");
    d.dataset.state = "running";
    const s = h("summary");
    s.innerHTML = '<span class="ticon"></span>';
    s.append(h("span", "tname", tool), h("span", "targs", oneLine(input)), h("span", "tdur"));
    s.insertAdjacentHTML("beforeend", CHEV);
    const body = h("div", "tbody");
    body.append(h("div", "tlabel", "Input"), h("pre", null, json(input)));
    d.append(s, body);
    return d;
  }
  function finishCard(card, ok, output, error, ms) {
    card.dataset.state = ok ? "ok" : "fail";
    card.querySelector(".ticon").textContent = ok ? "✓" : "!";
    if (ms != null) card.querySelector(".tdur").textContent = ms < 1000 ? ms + "ms" : (ms / 1000).toFixed(1) + "s";
    card.querySelector(".tbody").append(h("div", "tlabel", ok ? "Result" : "Error"), h("pre", ok ? null : "err", ok ? json(output) : error || "failed"));
  }
  // Tool activity folds into one "Worked for …" line under the speaker, like a finished task log.
  function fold(turn, label) {
    const groups = [...turn.querySelectorAll(":scope > .activity")];
    const cards = groups.flatMap((g) => [...g.children]);
    groups.forEach((g) => g.remove());
    if (!cards.length) return;
    const d = h("details", "worked"), s = h("summary"), inner = h("div", "inner");
    s.innerHTML = CHEV;
    s.append(document.createTextNode(label));
    cards.forEach((c) => inner.append(c));
    d.append(s, inner);
    turn.querySelector(".who-line").after(d);
  }

  function renderHistory(messages) {
    log.replaceChildren();
    let turn = null;
    const cards = {};
    let question = "";
    const close = () => { if (turn) { const n = turn.querySelectorAll(".tool").length; fold(turn, "Used " + n + " tool" + (n === 1 ? "" : "s")); replyActions(turn, question); } turn = null; };
    for (const m of messages) {
      if (m.role === "user") { close(); question = m.content; userTurn(m.content); }
      else if (m.role === "operator") { close(); mdBlock(assistantTurn("operator", "Operator"), m.content); }
      else if (m.role === "assistant") {
        if (!turn) turn = assistantTurn("", "BanglaClaw");
        if (m.content) mdBlock(turn, m.content);
        for (const c of m.toolCalls || []) {
          if (isControl(c.name)) continue;
          const card = toolCard(c.name, c.args);
          if (c.id) cards[c.id] = card;
          activity(turn).append(card);
        }
      } else if (m.role === "tool" && cards[m.toolCallId]) {
        const text = m.content || "";
        const bad = /^\s*\{?\s*"?(error|status)"?\s*:\s*"?(error|denied|invalid)/i.test(text);
        finishCard(cards[m.toolCallId], !bad, text, text, null);
      }
    }
    close();
    for (const c of log.querySelectorAll('.tool[data-state="running"]')) { c.dataset.state = "ok"; c.querySelector(".ticon").textContent = "✓"; }
    if (!log.children.length) empty();
    scrollEnd(true);
  }

  async function openSession(id) {
    if (run) return;
    sessionId = id; store.set("bc.session", id); lastUsage = ""; agent = "";
    const s = sessions.find((x) => x.id === id);
    if (s && s.activeAgent) agent = s.activeAgent;
    renderSessions(); renderInfo(); closeDrawer();
    try { renderHistory((await api("/v1/sessions/" + id + "/messages?limit=200")).messages); }
    catch (e) {
      if (e.status === 404) { sessionId = null; store.set("bc.session", null); renderInfo(); empty(); }
      else log.replaceChildren(h("div", "errline", String(e.message || e)));
    }
    follow();
  }
  function newChat() {
    if (run) return;
    sessionId = null; store.set("bc.session", null); lastUsage = ""; agent = "";
    follow(); empty(); renderSessions(); renderInfo(); closeDrawer();
    if (me) $("input").focus();
  }

  // ---- WebSocket ----
  // Follow the open session so operator replies (handoff) arrive without a new message.
  function follow() {
    if (!ws || ws.readyState !== 1 || subscribed === sessionId) return;
    if (subscribed) ws.send(JSON.stringify({ type: "unsubscribe", sessionId: subscribed }));
    subscribed = sessionId;
    if (sessionId) ws.send(JSON.stringify({ type: "subscribe", sessionId }));
  }
  function connect() {
    if (!key) return;
    store.set("bc.key", key);
    if (ws) { ws.onclose = null; ws.close(); }
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/v1/ws");
    setStatus("connecting…", "connecting");
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", apiKey: key }));
    ws.onclose = (e) => {
      subscribed = null; endRun(); setComposer(false);
      const invalid = e.code === 4401;
      setStatus(invalid ? "invalid API key" : "disconnected", invalid ? "error" : "off");
      if (invalid) { me = null; $("who").textContent = "not connected"; renderSessions(); empty(); }
    };
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  }
  async function onMessage(m) {
    if (m.type === "ready") {
      me = m.user; $("who").textContent = me.name; setStatus("connected", "on"); setComposer(true);
      if (sessionId) await openSession(sessionId); else empty();
      loadSessions(); loadFeatures();
      return;
    }
    if (m.type === "session_event") {
      if (m.sessionId !== sessionId) return;
      if (m.event.type === "operator_message") { mdBlock(assistantTurn("operator", "Operator"), m.event.text); scrollEnd(); }
      else if (m.event.type === "handoff_released") { log.append(h("div", "note", "🤖 back to the assistant")); scrollEnd(); }
      return;
    }
    if (m.type === "error" && !m.ref) {
      // The saved session belongs to another key or no longer exists: start fresh quietly.
      if (m.error.code === "session_not_found") { sessionId = null; subscribed = null; store.set("bc.session", null); renderInfo(); }
      return;
    }
    if (!run || m.ref !== run.ref) return;
    if (m.type === "event") onEvent(m.event);
    else if (m.type === "done") onDone(m);
    else if (m.type === "error") { removeThinking(); run.turn.append(h("div", "errline", m.error.message)); endRun(); }
  }

  // ---- Runs ----
  function removeThinking() { if (run) run.turn.querySelector(":scope > .thinking")?.remove(); }
  function send(text) {
    if (!text || !ws || ws.readyState !== 1 || run) return;
    if (text.startsWith("/")) return command(text);
    userTurn(text);
    const turn = assistantTurn("", "BanglaClaw"), wait = h("div", "thinking");
    wait.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
    wait.append(h("span", null, "Thinking…"));
    turn.append(wait);
    run = { ref: "r" + ++counter, text, turn, textEl: null, raw: "", tools: 0, cards: {}, started: performance.now(), tick: 0 };
    run.tick = setInterval(() => { if (run) setStatus("running · " + ((performance.now() - run.started) / 1000).toFixed(1) + "s", "running"); }, 100);
    $("dock").classList.add("running");
    $("input").value = ""; autosize();
    ws.send(JSON.stringify({ type: "run", ref: run.ref, text, ...(sessionId ? { sessionId } : {}) }));
    scrollEnd(true);
  }
  function onEvent(ev) {
    const t = run.turn;
    if (ev.type === "run_start") { agent = ev.agent; renderInfo(); }
    else if (ev.type === "token") {
      removeThinking();
      if (!run.textEl) { run.textEl = h("div", "md"); run.raw = ""; t.append(run.textEl); }
      run.raw += ev.text;
      if (!paint) paint = requestAnimationFrame(() => { paint = 0; if (run && run.textEl) { run.textEl.innerHTML = md(run.raw); scrollEnd(); } });
    } else if (ev.type === "tool_start" && !isControl(ev.tool)) {
      removeThinking(); flushText();
      const card = toolCard(ev.tool, ev.input);
      run.cards[ev.toolCallId] = card; run.tools++;
      activity(t).append(card);
      scrollEnd();
    } else if (ev.type === "tool_end" && run.cards[ev.audit.toolCallId]) {
      const a = ev.audit;
      finishCard(run.cards[a.toolCallId], a.status === "ok", a.output, a.status + (a.error ? ": " + a.error : ""), a.durationMs);
    } else if (ev.type === "agent_transfer") { flushText(); agent = ev.to; renderInfo(); t.append(h("div", "meta", "↪ handed to " + ev.to)); }
    else if (ev.type === "handoff") { removeThinking(); flushText(); t.append(h("div", "note", ev.pending ? "⏳ waiting for a human operator" : "👤 handed to a human: " + ev.reason)); }
  }
  function flushText() { if (run.textEl) run.textEl.innerHTML = md(run.raw); run.textEl = null; }
  function onDone(m) {
    const r = m.run, secs = (r.durationMs / 1000).toFixed(1);
    removeThinking(); flushText();
    if (run.tools) fold(run.turn, "Worked for " + secs + "s · " + run.tools + " tool" + (run.tools === 1 ? "" : "s"));
    if (r.status !== "completed" && r.status !== "limited") run.turn.append(h("div", "errline", r.status === "aborted" ? "Stopped." : r.error || r.status));
    lastUsage = r.usage ? r.usage.inputTokens + "→" + r.usage.outputTokens + " tokens" : "";
    const meta = [secs + "s"];
    if (lastUsage) meta.push(lastUsage);
    if (r.agentPath && r.agentPath.length > 1) meta.push(r.agentPath.join(" ↪ "));
    run.turn.append(h("div", "meta", meta.join(" · ")));
    replyActions(run.turn, run.text);
    const fresh = sessionId !== m.sessionId;
    sessionId = m.sessionId; store.set("bc.session", sessionId); saveTitle(sessionId, run.text);
    endRun(); renderInfo(); follow(); scrollEnd();
    if (!$("pane-files").hidden) loadFiles();
    if (fresh) loadSessions();
    else {
      const s = sessions.find((x) => x.id === sessionId);
      if (s) { s.updatedAt = new Date().toISOString(); sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); renderSessions(); }
    }
  }
  function endRun() {
    if (!run) return;
    clearInterval(run.tick);
    run = null;
    $("dock").classList.remove("running");
    if (ws && ws.readyState === 1 && me) { setStatus("connected", "on"); setComposer(true); }
  }
  function stop() { if (run && ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "cancel", ref: run.ref })); }

  // ---- Slash commands ----
  const COMMANDS = [
    { name: "/new", desc: "start a new conversation", run: () => newChat() },
    { name: "/sessions", desc: "show or hide the sidebar", run: () => toggleSide() },
    { name: "/theme", desc: "cycle system → light → dark", run: () => cycleTheme() },
    { name: "/logout", desc: "forget the API key", run: () => logout() },
  ];
  let menuSel = 0;
  function command(text) {
    const c = COMMANDS.find((x) => x.name === text.trim().split(/\s/)[0]);
    $("input").value = ""; autosize(); hideMenu();
    if (c) c.run();
    else { clearHero(); log.append(h("div", "note", "Unknown command " + text + " — try " + COMMANDS.map((x) => x.name).join(", "))); scrollEnd(true); }
  }
  const matches = () => { const v = $("input").value; return /^\/\S*$/.test(v) ? COMMANDS.filter((c) => c.name.startsWith(v)) : []; };
  function showMenu() {
    const list = matches(), menu = $("menu");
    if (!list.length) return hideMenu();
    menuSel = Math.min(menuSel, list.length - 1);
    menu.replaceChildren(...list.map((c, i) => {
      const li = h("li", i === menuSel ? "sel" : "");
      li.setAttribute("role", "option");
      li.append(h("b", null, c.name), h("span", null, c.desc));
      li.onmousedown = (e) => { e.preventDefault(); command(c.name); };
      return li;
    }));
    menu.hidden = false;
  }
  function hideMenu() { $("menu").hidden = true; menuSel = 0; }

  // ---- Layout, theme, key ----
  const app = $("app"), narrow = () => matchMedia("(max-width: 820px)").matches;
  function toggleSide() {
    if (narrow()) app.classList.toggle("drawer");
    else { app.classList.toggle("collapsed"); store.set("bc.side", app.classList.contains("collapsed") ? "hidden" : null); }
  }
  function closeDrawer() { app.classList.remove("drawer"); }
  if (store.get("bc.side") === "hidden") app.classList.add("collapsed");
  const showTheme = (t) => { $("theme").title = "Theme: " + t; $("theme").setAttribute("aria-label", "Theme: " + t); };
  function cycleTheme() {
    const next = { system: "light", light: "dark", dark: "system" }[document.documentElement.dataset.theme || "system"];
    if (next === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
    store.set("bc.theme", next === "system" ? null : next); showTheme(next);
  }
  function logout() {
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    endRun();
    key = ""; store.set("bc.key", null); store.set("bc.session", null); sessionId = null; me = null; sessions = [];
    setStatus("disconnected", "off"); setComposer(false); $("who").textContent = "not connected";
    renderSessions(); renderInfo(); empty();
  }
  showTheme(document.documentElement.dataset.theme || "system");

  const autosize = () => { const i = $("input"); i.style.height = "auto"; i.style.height = i.scrollHeight + "px"; };
  $("collapse").onclick = toggleSide; $("open").onclick = toggleSide; $("backdrop").onclick = closeDrawer;
  $("new").onclick = newChat; $("theme").onclick = cycleTheme; $("logout").onclick = logout; $("stop").onclick = stop;
  $("input").oninput = () => { autosize(); showMenu(); };
  $("input").onkeydown = (e) => {
    const list = $("menu").hidden ? [] : matches();
    if (list.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); menuSel = (menuSel + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length; showMenu(); return; }
    if (list.length && e.key === "Tab") { e.preventDefault(); $("input").value = list[menuSel].name; showMenu(); return; }
    if (e.key === "Escape" && list.length) { e.stopPropagation(); hideMenu(); return; }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (list.length) command(list[menuSel].name); else $("form").requestSubmit(); }
  };
  $("form").onsubmit = (e) => {
    e.preventDefault();
    const text = $("input").value.trim();
    if (text.startsWith("/")) return send(text);
    const ready = attachments.filter((a) => a.path);
    if (attachments.some((a) => !a.path && !a.error)) return toast("Wait for the upload to finish");
    if (!text && !ready.length) return;
    // The agent learns where attached files are; the user's words come first.
    send([text, ...ready.map((a) => attachmentNote(a, text))].filter(Boolean).join("\n\n"));
    attachments = []; renderAttachments();
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && run) stop(); });
  log.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b || !navigator.clipboard) return;
    navigator.clipboard.writeText(b.closest(".code").querySelector("code").textContent).then(() => { b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy"; }, 1200); });
  });

  // ---- Features, files panel, uploads, microphone ----
  let features = { workspace: false, uploads: null, transcription: false }, attachments = [];
  async function loadFeatures() {
    try { features = await api("/v1/features"); } catch { return; }
    $("tab-files").hidden = !features.workspace;
    $("attach").hidden = !features.uploads;
    $("mic").hidden = !(features.transcription && navigator.mediaDevices && window.MediaRecorder);
  }
  function showPane(which) {
    const files = which === "files";
    $("pane-chats").hidden = files; $("pane-files").hidden = !files;
    $("tab-chats").classList.toggle("active", !files); $("tab-files").classList.toggle("active", files);
    $("tab-chats").setAttribute("aria-selected", String(!files)); $("tab-files").setAttribute("aria-selected", String(files));
    if (files) loadFiles();
  }
  const size = (n) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");
  async function loadFiles() {
    const nav = $("files");
    let list;
    try { list = await api("/v1/workspace/files"); } catch (e) { nav.replaceChildren(h("p", "side-empty", String(e.message || e))); return; }
    nav.replaceChildren();
    if (!list.entries.length) { nav.append(h("p", "side-empty", "No files yet. Ask the agent to write something, or attach a file.")); return; }
    for (const e of list.entries) {
      const depth = e.path.split("/").length - 1;
      if (e.type === "dir") { const d = h("div", "fdir", "📁 " + e.path.split("/").pop()); d.style.paddingLeft = 10 + depth * 14 + "px"; nav.append(d); continue; }
      const row = h("button", "frow");
      row.type = "button"; row.style.paddingLeft = 10 + depth * 14 + "px"; row.title = e.path + " · " + new Date(e.modified).toLocaleString();
      row.append(h("span", null, "📄"), h("span", "fname", e.path.split("/").pop()), h("span", "fsize", size(e.size)));
      row.onclick = () => openViewer(e.path);
      nav.append(row);
    }
  }
  let viewing = null;
  async function openViewer(path) {
    viewing = path;
    $("viewer-title").textContent = path; $("viewer").hidden = false; $("viewer-close").focus();
    const body = $("viewer-body");
    body.replaceChildren(h("p", "meta", "Loading…"));
    try {
      const file = await api("/v1/workspace/file?path=" + encodeURIComponent(path));
      body.replaceChildren();
      if (/\.(md|markdown)$/i.test(path)) { const d = h("div", "md"); d.innerHTML = md(file.content); body.append(d); }
      else body.append(h("pre", "raw", file.content));
      if (file.truncated) body.append(h("p", "meta", "Showing the first part of the file."));
    } catch (e) { body.replaceChildren(h("div", "errline", String(e.message || e))); }
  }
  function closeViewer() { $("viewer").hidden = true; viewing = null; }
  async function showHistory() {
    if (!viewing) return;
    const path = viewing, body = $("viewer-body");
    let history;
    try { history = await api("/v1/workspace/history?path=" + encodeURIComponent(path)); } catch (e) { return toast(String(e.message || e)); }
    body.replaceChildren();
    const list = h("div", "versions");
    if (!history.versions.length) list.append(h("p", "meta", "No earlier versions yet."));
    for (const v of history.versions) {
      const row = h("div", "version");
      row.append(h("b", null, "Version " + v.version), h("span", "grow", new Date(v.savedAt).toLocaleString() + " · " + size(v.size)), actionButton("Restore", () => restoreFile(path, v.version)));
      list.append(row);
    }
    body.append(list);
  }
  async function restoreFile(path, version) {
    try { await api("/v1/workspace/restore", { method: "POST", json: version ? { path, version } : { path } }); } catch (e) { return toast(String(e.message || e)); }
    toast("Restored " + path); loadFiles(); openViewer(path);
  }
  async function downloadFile() {
    if (!viewing) return;
    try {
      const res = await api("/v1/workspace/file?download=1&path=" + encodeURIComponent(viewing), { raw: true });
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = viewing.split("/").pop(); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { toast(String(e.message || e)); }
  }
  async function deleteFile() {
    if (!viewing) return;
    const path = viewing;
    if (!confirm("Move " + path + " to the trash?")) return;
    try { await api("/v1/workspace/file?path=" + encodeURIComponent(path), { method: "DELETE" }); } catch (e) { return toast(String(e.message || e)); }
    closeViewer(); loadFiles();
    toast("Deleted " + path, "Undo", () => restoreFile(path));
  }
  let toastTimer = 0;
  function toast(text, action, onAction) {
    const t = $("toast");
    t.replaceChildren(h("span", null, text));
    if (action) { const b = h("button", null, action); b.type = "button"; b.onclick = () => { t.hidden = true; onAction(); }; t.append(b); }
    t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, action ? 7000 : 2500);
  }

  // Session rename and delete.
  function startRename(row, s, label) {
    const input = h("input", "rename"); input.value = s.title || label; input.setAttribute("aria-label", "New name");
    row.replaceChildren(input); input.focus(); input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return; done = true;
      const title = input.value.trim();
      if (save && title && title !== label) {
        try { const r = await api("/v1/sessions/" + s.id, { method: "PATCH", json: { title } }); titles[s.id] = r.session.title; store.set("bc.titles", JSON.stringify(titles)); }
        catch (e) { toast(String(e.message || e)); }
      }
      await loadSessions();
    };
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.stopPropagation(); finish(false); } };
    input.onblur = () => finish(true);
  }
  async function deleteSession(s, label) {
    if (run || !confirm("Delete “" + label + "”? Its messages are removed for good.")) return;
    try { await api("/v1/sessions/" + s.id, { method: "DELETE" }); } catch (e) { return toast(String(e.message || e)); }
    delete titles[s.id]; store.set("bc.titles", JSON.stringify(titles));
    if (s.id === sessionId) newChat();
    toast("Deleted " + label); loadSessions();
  }

  // Attachments: uploaded to the workspace right away; the message then says where they are.
  const bengali = (text) => /[\u0980-\u09FF]/.test(text);
  function attachmentNote(a, text) {
    return !text || bengali(text)
      ? "[সংযুক্ত ফাইল \"" + a.name + "\" workspace-এ " + a.path + " নামে রাখা আছে (" + a.characters + " অক্ষর); workspace_read দিয়ে পড়ুন।]"
      : "[Attached file \"" + a.name + "\" is saved in the workspace as " + a.path + " (" + a.characters + " characters); read it with workspace_read.]";
  }
  function renderAttachments() {
    const box = $("attachments");
    box.replaceChildren(...attachments.map((a) => {
      const c = h("span", "chip" + (a.error ? " error" : ""));
      c.append(h("span", null, "📄"), h("span", "cname", a.name), h("span", "cstate", a.error ? a.error : a.path ? "→ " + a.path : "uploading…"));
      const x = h("button", null, "×"); x.type = "button"; x.setAttribute("aria-label", "Remove " + a.name);
      x.onclick = () => { attachments = attachments.filter((b) => b !== a); renderAttachments(); };
      c.append(x);
      return c;
    }));
  }
  async function upload(file) {
    if (!features.uploads) return toast("Uploads are not enabled on this gateway");
    const a = { name: file.name, path: "", characters: 0, error: "" };
    attachments.push(a); renderAttachments();
    if (file.size > features.uploads.maxBytes) { a.error = "too large"; return renderAttachments(); }
    try {
      const saved = await api("/v1/workspace/uploads?filename=" + encodeURIComponent(file.name), { method: "POST", body: file, type: "application/octet-stream" });
      a.path = saved.path; a.characters = saved.characters;
      if (!$("pane-files").hidden) loadFiles();
    } catch (e) { a.error = String(e.message || e); }
    renderAttachments();
    $("input").focus();
  }

  // Microphone: record, then put the transcript in the composer to review before sending.
  let recorder = null, recordTimer = 0;
  async function toggleMic() {
    if (recorder) return recorder.stop();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast("Microphone access was refused"); }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
    const chunks = [];
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const started = Date.now();
    $("mic").setAttribute("aria-pressed", "true"); $("mic").setAttribute("aria-label", "Stop recording");
    recordTimer = setInterval(() => {
      const secs = Math.floor((Date.now() - started) / 1000);
      $("mic-time").textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
      if (secs >= 120) recorder && recorder.stop();
    }, 250);
    recorder.onstop = async () => {
      clearInterval(recordTimer); stream.getTracks().forEach((t) => t.stop());
      const mime = (recorder && recorder.mimeType) || "audio/webm";
      recorder = null;
      $("mic").setAttribute("aria-pressed", "false"); $("mic").setAttribute("aria-label", "Record voice"); $("mic-time").textContent = "";
      const blob = new Blob(chunks, { type: mime.split(";")[0] });
      if (!blob.size) return;
      $("mic").disabled = true; toast("Transcribing…");
      try {
        const { text } = await api("/v1/transcriptions", { method: "POST", body: blob, type: blob.type || "audio/webm" });
        const input = $("input");
        input.value = (input.value ? input.value.replace(/\s*$/, " ") : "") + text; autosize(); input.focus();
        $("toast").hidden = true;
      } catch (e) { toast(String(e.message || e)); }
      $("mic").disabled = false;
    };
    recorder.start();
  }

  $("tab-chats").onclick = () => showPane("chats"); $("tab-files").onclick = () => showPane("files");
  $("files-refresh").onclick = loadFiles;
  let searchTimer = 0;
  $("search").oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadSessions, 250); };
  $("viewer-close").onclick = closeViewer; $("viewer-history").onclick = showHistory; $("viewer-download").onclick = downloadFile; $("viewer-delete").onclick = deleteFile;
  $("viewer").onclick = (e) => { if (e.target === $("viewer")) closeViewer(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("viewer").hidden) closeViewer(); });
  $("attach").onclick = () => $("file").click();
  $("file").onchange = () => { for (const f of $("file").files) upload(f); $("file").value = ""; };
  $("mic").onclick = toggleMic;
  const mainEl = document.querySelector("main");
  mainEl.addEventListener("dragover", (e) => { if (features.uploads && e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); mainEl.classList.add("drop"); } });
  mainEl.addEventListener("dragleave", (e) => { if (e.target === mainEl || !mainEl.contains(e.relatedTarget)) mainEl.classList.remove("drop"); });
  mainEl.addEventListener("drop", (e) => { mainEl.classList.remove("drop"); if (!features.uploads || !e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); for (const f of e.dataTransfer.files) upload(f); });

  renderInfo(); empty();
  if (key) connect();
})();
`;

export const WEB_CHAT_HTML = [
  '<!doctype html>\n<html lang="bn">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>BanglaClaw Chat</title>\n',
  "<style>",
  STYLE,
  "</style>\n",
  // Apply the saved theme before first paint.
  '<script>try { const t = localStorage.getItem("bc.theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch {}</script>\n',
  "</head>\n<body>",
  BODY,
  "<script>",
  SCRIPT,
  MARKDOWN_JS,
  SCRIPT_MAIN,
  "</script>\n</body>\n</html>",
].join("");
