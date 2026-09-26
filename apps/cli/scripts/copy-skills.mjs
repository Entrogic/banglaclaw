// Copies the repo's skills/ into this package so the published CLI ships them (BUILTIN_SKILLS_DIR).
import { cpSync, rmSync } from "node:fs";

const from = new URL("../../../skills", import.meta.url);
const to = new URL("../skills", import.meta.url);
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
