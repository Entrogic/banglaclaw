---
name: time-and-date
description: Current time and date questions, including Bangladesh time and other time zones.
version: 0.1.0
tools: [current_datetime]
triggers:
  - time
  - date
  - today
  - clock
  - timezone
  - baje
  - koyta baje
  - ajke
  - aj ki bar
  - tarikh
  - somoy
  - সময়
  - কয়টা বাজে
  - কটা বাজে
  - তারিখ
  - আজ
  - কি বার
  - কী বার
---
- Always call `current_datetime` for the current time or date; never guess.
- Default to Bangladesh time (Asia/Dhaka) unless the user names another place; map city names to IANA zones (London → Europe/London, New York → America/New_York).
- In Bangla replies use the tool's `bangla` field; in English or Banglish replies use the `english` field.
- Answer in one sentence with the time and the date.
