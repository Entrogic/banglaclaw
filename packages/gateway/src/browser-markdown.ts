/**
 * Minimal markdown renderer for the browser pages (web chat, widget), inlined into their scripts.
 * Every piece of text is HTML-escaped before tags are added, and only http(s) links become
 * anchors, so model output cannot inject markup. Defines esc(), BT, inline(), blocks() and md().
 * It is a String.raw literal: no backtick or dollar-brace inside (BT is "\x60").
 */
export const MARKDOWN_JS = String.raw`
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const BT = "\x60";
  function inline(text) {
    return text.split(BT).map((part, i) => {
      if (i % 2 === 1) return "<code>" + esc(part) + "</code>";
      return esc(part)
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
        .replace(/~~([^~]+)~~/g, "<del>$1</del>");
    }).join("");
  }
  const LIST = /^\s*([-*+]|\d+[.)])\s+/;
  function blocks(text) {
    const lines = text.split("\n"), out = [];
    const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { out.push("<h" + m[1].length + ">" + inline(m[2]) + "</h" + m[1].length + ">"); i++; continue; }
      if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        let t = "<table><thead><tr>" + cells(l).map((c) => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>";
        i += 2;
        while (i < lines.length && /^\s*\|/.test(lines[i])) { t += "<tr>" + cells(lines[i]).map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>"; i++; }
        out.push(t + "</tbody></table>"); continue;
      }
      if (LIST.test(l)) {
        const ordered = /^\s*\d/.test(l), items = [];
        while (i < lines.length && LIST.test(lines[i])) { items.push("<li>" + inline(lines[i].replace(LIST, "")) + "</li>"); i++; }
        out.push((ordered ? "<ol>" : "<ul>") + items.join("") + (ordered ? "</ol>" : "</ul>")); continue;
      }
      if (/^>\s?/.test(l)) {
        const q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, "")); i++; }
        out.push("<blockquote>" + blocks(q.join("\n")) + "</blockquote>"); continue;
      }
      const p = [inline(l)];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|\s*\|)/.test(lines[i]) && !LIST.test(lines[i])) { p.push(inline(lines[i])); i++; }
      out.push("<p>" + p.join("<br>") + "</p>");
    }
    return out.join("");
  }
  function md(text) {
    return text.split(BT + BT + BT).map((part, i) => {
      if (i % 2 === 0) return blocks(part);
      const nl = part.indexOf("\n"), lang = nl < 0 ? "" : part.slice(0, nl).trim(), code = nl < 0 ? part : part.slice(nl + 1);
      return '<div class="code"><div class="code-head"><span>' + esc(lang || "code") + '</span><button type="button" data-copy>Copy</button></div><pre><code>' + esc(code.replace(/\n$/, "")) + "</code></pre></div>";
    }).join("");
  }
`;
