import type { Command } from "commander";
import { BanglaClawError } from "@entrogic-net/shared";

interface Node {
  name: string;
  description: string;
  options: string[];
  children: Node[];
}

function walk(cmd: Command): Node {
  return {
    name: cmd.name(),
    description: cmd.description().split("\n")[0] ?? "",
    options: cmd.options.map((o) => o.long ?? o.short ?? "").filter((o) => o !== ""),
    children: cmd.commands.filter((c) => !(c as Command & { _hidden?: boolean })._hidden).map(walk),
  };
}

const esc = (s: string) => s.replace(/'/g, "'\\''");

function bash(root: Node): string {
  const cases = root.children
    .map((ch) => `    ${ch.name}) opts="${[...ch.children.map((x) => x.name), ...ch.options, ...root.options].join(" ")}" ;;`)
    .join("\n");
  return `# banglaclaw bash completion — add to ~/.bashrc:  eval "$(banglaclaw completion bash)"
_banglaclaw() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" sub="\${COMP_WORDS[1]}" opts
  if [ "$COMP_CWORD" -eq 1 ]; then
    opts="${[...root.children.map((c) => c.name), ...root.options].join(" ")}"
  else
    case "$sub" in
${cases}
      *) opts="${root.options.join(" ")}" ;;
    esac
  fi
  COMPREPLY=( $(compgen -W "$opts" -- "$cur") )
}
complete -F _banglaclaw banglaclaw
`;
}

function zsh(root: Node): string {
  const top = root.children.map((c) => `'${c.name}:${esc(c.description)}'`).join(" ");
  const cases = root.children
    .map((ch) => {
      const opts = [...ch.options, ...root.options].map((o) => `'${o}'`).join(" ");
      if (ch.children.length === 0) return `    ${ch.name}) compadd -- ${opts} ;;`;
      const subs = ch.children.map((x) => `'${x.name}:${esc(x.description)}'`).join(" ");
      return `    ${ch.name}) local -a s; s=(${subs}); _describe 'command' s; compadd -- ${opts} ;;`;
    })
    .join("\n");
  return `#compdef banglaclaw
# banglaclaw zsh completion — save as _banglaclaw in a directory on $fpath, or add to ~/.zshrc:
#   source <(banglaclaw completion zsh)
_banglaclaw() {
  local -a commands
  commands=(${top})
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    compadd -- ${root.options.map((o) => `'${o}'`).join(" ")}
    return
  fi
  case "$words[2]" in
${cases}
  esac
}
compdef _banglaclaw banglaclaw
`;
}

function fish(root: Node): string {
  const lines = ["# banglaclaw fish completion — save to ~/.config/fish/completions/banglaclaw.fish", "complete -c banglaclaw -f"];
  for (const o of root.options.filter((x) => x.startsWith("--"))) lines.push(`complete -c banglaclaw -l ${o.slice(2)}`);
  for (const ch of root.children) {
    lines.push(`complete -c banglaclaw -n "__fish_use_subcommand" -a ${ch.name} -d '${esc(ch.description)}'`);
    for (const sub of ch.children) lines.push(`complete -c banglaclaw -n "__fish_seen_subcommand_from ${ch.name}" -a ${sub.name} -d '${esc(sub.description)}'`);
    for (const o of ch.options.filter((x) => x.startsWith("--"))) lines.push(`complete -c banglaclaw -n "__fish_seen_subcommand_from ${ch.name}" -l ${o.slice(2)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Generates a completion script by walking the commander tree, so it never goes stale. */
export function completionScript(program: Command, shell: string): string {
  const root = walk(program);
  if (shell === "bash") return bash(root);
  if (shell === "zsh") return zsh(root);
  if (shell === "fish") return fish(root);
  throw new BanglaClawError("INVALID_ARGUMENT", `Unsupported shell "${shell}" (use bash, zsh or fish)`);
}
