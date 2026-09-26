#!/usr/bin/env bash
# Packs every publishable package exactly as `changeset publish` would (pnpm pack rewrites
# workspace:* ranges), installs the tarballs into an empty project with npm, and checks that
# the CLI, the unscoped wrapper, the MCP server and the libraries load. Run after `pnpm build`.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/tarballs" "$work/app"

cd "$root"
pnpm -r --filter './packages/*' --filter ./apps/cli --filter ./apps/banglaclaw --filter './mcp-servers/*' \
  exec pnpm pack --pack-destination "$work/tarballs" >/dev/null
echo "packed $(ls "$work/tarballs" | wc -l) packages"

# No tarball may contain tests, secrets or workspace-only ranges.
for t in "$work"/tarballs/*.tgz; do
  list=$(tar -tzf "$t")
  if grep -qE '(^package/(test|\.env)|\.test\.)' <<<"$list"; then echo "unexpected file in $(basename "$t")"; exit 1; fi
  if tar -xOzf "$t" package/package.json | grep -q '"workspace:'; then echo "workspace: range left in $(basename "$t")"; exit 1; fi
done

cd "$work/app"
npm init -y >/dev/null
npm install --no-audit --no-fund --loglevel=error "$work"/tarballs/*.tgz >/dev/null

version=$(node -p "require('./node_modules/@entrogic-net/cli/package.json').version")
test "$(node node_modules/@entrogic-net/cli/dist/index.js --version)" = "$version" || { echo "@entrogic-net/cli --version mismatch"; exit 1; }
test "$(node node_modules/banglaclaw/bin.js --version)" = "$version" || { echo "banglaclaw wrapper --version mismatch"; exit 1; }
npx --no-install banglaclaw --help >/dev/null
# The built-in skills ship inside the CLI and load without any config.
node node_modules/@entrogic-net/cli/dist/index.js skill list --json | grep -q '"calculation"' || { echo "built-in skills missing"; exit 1; }
node --input-type=module -e '
  const libs = ["agent", "agents", "auth", "channels", "client", "gateway", "knowledge", "mcp", "observability", "plugin-sdk", "providers", "session", "shared", "skills", "storage", "tools"];
  for (const lib of libs) await import(`@entrogic-net/${lib}`);
  const { BanglaClawClient } = await import("@entrogic-net/client");
  if (typeof BanglaClawClient !== "function") throw new Error("client export missing");
'
test -x node_modules/.bin/banglaclaw-mcp-bangladesh
echo "pack smoke test passed (v$version)"
