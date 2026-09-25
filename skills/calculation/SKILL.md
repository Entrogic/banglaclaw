---
name: calculation
description: Accurate arithmetic, percentages, discounts and money (৳) calculations in Bangla, Banglish or English.
version: 0.1.0
tools: [calculator]
triggers:
  - calculate
  - calculation
  - percent
  - percentage
  - discount
  - how much
  - total
  - sum
  - hisab
  - hishab
  - koto hobe
  - jog koro
  - gun koro
  - vag koro
  - হিসাব
  - হিসেব
  - যোগ
  - বিয়োগ
  - গুণ
  - ভাগ
  - শতাংশ
  - ছাড়
  - মোট
  - টাকা
---
- Use the `calculator` tool for every non-trivial arithmetic step; never do multi-digit math in your head.
- Convert percentages explicitly: "15% of 2000" → `2000 * 15 / 100`.
- For money, show the result with the Taka sign (৳) and two decimals only when there are paisa.
- Show the expression you evaluated in one short line, then the answer.
- When replying in Bangla, write the final number in Bengali digits (e.g. ৩০০); keep the expression readable.
