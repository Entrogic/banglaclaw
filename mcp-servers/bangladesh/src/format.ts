const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

export function toBanglaDigits(text: string): string {
  return text.replace(/[0-9]/g, (c) => BN_DIGITS[Number(c)] as string);
}

export function toEnglishDigits(text: string): string {
  return text.replace(/[০-৯]/g, (c) => String(BN_DIGITS.indexOf(c)));
}

/** South Asian grouping: last 3 digits, then groups of 2 (1,23,45,678). */
export function groupLakh(integerDigits: string): string {
  if (integerDigits.length <= 3) return integerDigits;
  const last3 = integerDigits.slice(-3);
  const rest = integerDigits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

export interface TakaFormat {
  /** e.g. "৳1,23,45,678.50" */
  numeric: string;
  /** e.g. "১ কোটি ২৩ লক্ষ ৪৫ হাজার ৬৭৮ টাকা ৫০ পয়সা" */
  words: string;
}

/**
 * Formats a Taka amount with lakh/crore grouping and a unit breakdown
 * (কোটি = 10^7, লক্ষ = 10^5, হাজার = 10^3). Rounds to paisa.
 */
export function formatTaka(amount: number, locale: "bn" | "en"): TakaFormat {
  if (!Number.isFinite(amount)) throw new Error("Amount must be a finite number");
  const negative = amount < 0;
  const totalPaisa = Math.round(Math.abs(amount) * 100);
  if (!Number.isSafeInteger(totalPaisa)) throw new Error("Amount is too large");
  const taka = Math.floor(totalPaisa / 100);
  const paisa = totalPaisa % 100;

  const numericEn = `${negative ? "-" : ""}৳${groupLakh(String(taka))}${paisa > 0 ? `.${String(paisa).padStart(2, "0")}` : ""}`;

  const units: [number, string, string][] = [
    [10_000_000, "কোটি", "crore"],
    [100_000, "লক্ষ", "lakh"],
    [1_000, "হাজার", "thousand"],
  ];
  const parts: string[] = [];
  let rest = taka;
  // Crore is the largest unit, so amounts ≥ 100 crore read as e.g. "১২৩৪ কোটি".
  for (const [size, bn, en] of units) {
    const n = Math.floor(rest / size);
    if (n > 0) parts.push(`${n} ${locale === "bn" ? bn : en}`);
    rest %= size;
  }
  if (rest > 0 || parts.length === 0) parts.push(String(rest));
  let words = `${parts.join(" ")} ${locale === "bn" ? "টাকা" : "taka"}`;
  if (paisa > 0) words += ` ${paisa} ${locale === "bn" ? "পয়সা" : "paisa"}`;
  if (negative) words = `${locale === "bn" ? "ঋণাত্মক" : "minus"} ${words}`;

  return locale === "bn" ? { numeric: toBanglaDigits(numericEn), words: toBanglaDigits(words) } : { numeric: numericEn, words };
}
