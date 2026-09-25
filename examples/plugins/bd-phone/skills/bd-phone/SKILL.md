---
name: bd-phone
description: Checking and normalising Bangladeshi mobile numbers.
version: 1.0.0
tools: [validate_bd_phone]
triggers: [phone, mobile, number, nombor, nambar, ফোন, মোবাইল, নম্বর, নাম্বার, bkash, বিকাশ]
---
- When the user gives a phone number, check it with `validate_bd_phone` before using it.
- Report the operator and the +88 form; if invalid, explain the expected 11-digit 01XXXXXXXXX format.
- Never ask for PINs or OTPs.
