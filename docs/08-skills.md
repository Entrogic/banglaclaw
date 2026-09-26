# 08 — Skills

Skills package reusable domain expertise and workflows as Markdown instructions that are added to the system prompt when a request matches.

## Layout

```text
skills/
├── calculation/
│   └── SKILL.md
└── time-and-date/
    └── SKILL.md
```

Directories are configured with `skills.dirs` (default `[skills]`, relative to the config file or working directory). A folder without `SKILL.md` is ignored; an invalid `SKILL.md` or a duplicate skill name is an error, never silently skipped.

The CLI also ships the repo's `skills/` as **built-in skills** (`calculation`, `time-and-date`). The build copies them into the `@entrogic-net/cli` package, so an npm install has them without any config. They are added after the configured and plugin skills, and a configured skill with the same name replaces the built-in one instead of raising a duplicate error. Set `skills.builtin: false` to load only your own.

## SKILL.md format

```markdown
---
name: calculation            # kebab-case, unique
description: Accurate arithmetic and money calculations
version: 0.1.0               # semver
tools: [calculator]          # tools the skill relies on
triggers: [calculate, percent, হিসাব, koto hobe]
---
- Use the `calculator` tool for every non-trivial arithmetic step.
- …
```

- `triggers` are case-insensitive. Latin triggers match whole words or phrases. Bengali triggers match as substrings, because suffixes attach directly to the word (হিসাব → হিসাবটা).
- `tools` never grants permission: the tool allowlist (docs/09) still decides. `banglaclaw doctor` and `skill list` warn when a skill needs a tool that is unavailable.

## Loading model (implemented)

```text
User request
   ↓
Skill discovery — SkillSet.select(): rank skills by matched triggers (no model call)
   ↓
Top skills.maxActive (default 2) activated
   ↓
Instructions appended to the system prompt; names recorded on the run and emitted in run_start
   ↓
Agent execution
```

Implemented in `packages/skills`: `parseSkill`, `loadSkillsFromDirs` and `SkillSet`.

## Planned

- `index.ts` per skill for code-level hooks (custom tools, pre/post processing)
- Model-assisted selection when trigger matching is ambiguous
- Skill versioning and distribution (v1.0 plugin ecosystem)
