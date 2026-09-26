# ০৮ — স্কিল (Skills)

> ইংরেজি মূল: [../08-skills.md](../08-skills.md)

স্কিল হলো Markdown-এ লেখা পুনর্ব্যবহারযোগ্য দক্ষতা ও কাজের নির্দেশনা। কোনো অনুরোধ স্কিলের সাথে মিললে তার নির্দেশনা সিস্টেম প্রম্পটে যোগ হয়।

## ফোল্ডার কাঠামো

```text
skills/
├── calculation/
│   └── SKILL.md
└── time-and-date/
    └── SKILL.md
```

কোন ফোল্ডার থেকে স্কিল লোড হবে তা `skills.dirs` ঠিক করে (ডিফল্ট `[skills]`, কনফিগ ফাইল বা ওয়ার্কিং ডিরেক্টরির সাপেক্ষে)। যে ফোল্ডারে `SKILL.md` নেই তা উপেক্ষা করা হয়। কিন্তু ভুল `SKILL.md` বা একই নামের দুটি স্কিল থাকলে সেটি এরর; নীরবে বাদ দেওয়া হয় না।

CLI রিপোর `skills/` ফোল্ডারটি **বিল্ট-ইন স্কিল** হিসেবে সঙ্গে নিয়ে আসে (`calculation`, `time-and-date`)। বিল্ডের সময় এগুলো `@entrogic-net/cli` প্যাকেজে কপি হয়, তাই npm থেকে ইনস্টল করলেও কোনো কনফিগ ছাড়াই পাওয়া যায়। কনফিগ ও প্লাগইনের স্কিলের পরে এগুলো যোগ হয়; একই নামের কনফিগ করা স্কিল থাকলে সেটিই বিল্ট-ইনটির জায়গা নেয়, ডুপ্লিকেট এরর হয় না। শুধু নিজের স্কিল চাইলে `skills.builtin: false` দিন।

## SKILL.md ফরম্যাট

```markdown
---
name: calculation            # kebab-case, অনন্য
description: Accurate arithmetic and money calculations
version: 0.1.0               # semver
tools: [calculator]          # স্কিলটি যে টুলগুলোর উপর নির্ভর করে
triggers: [calculate, percent, হিসাব, koto hobe]
---
- Use the `calculator` tool for every non-trivial arithmetic step.
- …
```

- `triggers` বড়-ছোট হাতের অক্ষর মানে না। ল্যাটিন (ইংরেজি বা বাংলিশ) ট্রিগার পুরো শব্দ বা বাক্যাংশ হিসেবে মেলে। বাংলা ট্রিগার শব্দের অংশ (substring) হিসেবে মেলে, কারণ বাংলায় প্রত্যয় সরাসরি শব্দের সাথে জুড়ে যায় (হিসাব → হিসাবটা)।
- `tools` কখনো অনুমতি দেয় না; সিদ্ধান্ত নেয় টুল অ্যালাউলিস্ট (`tools.allow`, docs/09)। স্কিলের দরকারি টুল না থাকলে `banglaclaw doctor` ও `skill list` সতর্ক করে।

## নতুন স্কিল তৈরি

১. `skills/<নাম>/SKILL.md` ফাইল তৈরি করুন; `name` ফোল্ডারের নামের সাথে মিলিয়ে kebab-case-এ দিন।

২. তিন ভাষাতেই ট্রিগার দিন, যাতে বাংলা, বাংলিশ ও ইংরেজি সব অনুরোধে মেলে:

```markdown
---
name: delivery-charge
description: Delivery charges inside and outside Dhaka.
version: 0.1.0
tools: [calculator]
triggers: [delivery charge, shipping, delivery koto, ডেলিভারি চার্জ, ডেলিভারি]
---
- Inside Dhaka the delivery charge is ৳60; outside Dhaka it is ৳120.
- Use `calculator` to add the delivery charge to the order total.
```

৩. দরকারি টুলগুলো `banglaclaw.yaml`-এর `tools.allow`-এ আছে কিনা দেখুন।

৪. যাচাই করুন:

```bash
pnpm banglaclaw skill list      # স্কিল লোড হয়েছে কিনা ও টুলের সতর্কতা
pnpm banglaclaw doctor
pnpm banglaclaw chat            # চ্যাটে /skills দিয়ে তালিকা দেখুন
```

নির্দেশনা সংক্ষিপ্ত ও স্পষ্ট রাখুন। প্রতিটি সক্রিয় স্কিল সিস্টেম প্রম্পটে যোগ হয়, তাই লম্বা নির্দেশনা প্রতিটি রানের খরচ বাড়ায়।

## লোডিং মডেল (বাস্তবায়িত)

```text
ইউজারের অনুরোধ
   ↓
স্কিল খোঁজা — SkillSet.select(): মেলা ট্রিগারের ভিত্তিতে র‍্যাংক (কোনো মডেল কল নেই)
   ↓
শীর্ষ skills.maxActive-টি (ডিফল্ট ২) সক্রিয়
   ↓
নির্দেশনা সিস্টেম প্রম্পটে যোগ; নামগুলো রানে জমা হয় এবং run_start ইভেন্টে পাঠানো হয়
   ↓
এজেন্ট চালানো
```

`packages/skills`-এ বাস্তবায়িত: `parseSkill`, `loadSkillsFromDirs` ও `SkillSet`। প্লাগইনও নিজের স্কিল ফোল্ডার যোগ করতে পারে (`skillsDirs`, docs/23)।

## পরিকল্পনায় আছে

- কোড-স্তরের হুকের জন্য প্রতিটি স্কিলে `index.ts` (কাস্টম টুল, আগে/পরে প্রক্রিয়াকরণ)
- ট্রিগার মেলানো অস্পষ্ট হলে মডেলের সাহায্যে স্কিল বাছাই
- স্কিলের ভার্সনিং ও বিতরণ
