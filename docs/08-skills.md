# 08 — Skills

Skills package reusable domain expertise and workflows.

## Example

```text
skills/
├── coding/
│   ├── SKILL.md
│   └── index.ts
├── ecommerce/
│   ├── SKILL.md
│   └── index.ts
└── customer-support/
    ├── SKILL.md
    └── index.ts
```

## Skill contents

A skill may define:

- Metadata
- Instructions
- Allowed tools
- Examples
- Workflow guidance
- Constraints

## Loading model

```text
User request
   ↓
Router
   ↓
Skill discovery
   ↓
Load relevant skill
   ↓
Agent execution
```

Skills should be composable and independently versionable.
