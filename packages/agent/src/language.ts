import type { Language } from "@banglaclaw/shared";

const BENGALI = /\p{Script=Bengali}/u;
const WORDLIKE = /[\p{L}\p{N}]/u;

/** Frequent romanised-Bangla words that rarely occur in English text. */
const BANGLISH_WORDS = new Set([
  "ami", "amar", "amake", "amra", "tumi", "tomar", "tomake", "apni", "apnar", "apnake", "se", "tar", "ora",
  "ki", "kii", "keno", "kemon", "kivabe", "kibhabe", "kothay", "kokhon", "koto", "koyta", "kon", "ke",
  "acho", "achen", "achi", "ache", "achhe", "chilo", "thakbe", "nai", "nei", "na", "hae", "ha", "hya",
  "bhalo", "valo", "kharap", "khub", "onek", "ektu", "shob", "sob", "aro",
  "kore", "koro", "koren", "korbo", "korte", "korchi", "korsi", "korlam", "hobe", "hoy", "hoyeche", "hoise", "hocche",
  "bolo", "bolen", "bolte", "jani", "janina", "jano", "dao", "den", "dite", "nao", "nibo", "jabo", "jao", "jai", "ashbo", "ashen", "dekho", "dekhi",
  "ekhon", "aj", "aaj", "ajke", "kal", "kalke", "porshu", "baje", "bajche", "shomoy", "somoy", "din", "raat",
  "bhai", "vai", "apu", "dada", "didi", "mama", "khala",
  "kotha", "taka", "dam", "jonno", "theke", "diye", "sathe", "shathe", "moto", "kintu", "tobe", "tahole", "jodi", "ar", "o",
  "dhonnobad", "accha", "achha", "thik", "thikache", "shuvo", "shubho", "salam", "assalamualaikum",
]);

const WORD = /[a-z]+/g;

/**
 * Deterministic language detection (no model call):
 * - "bn"    — at least half of the words are in Bengali script
 * - "bn-en" — Banglish (romanised Bangla), or Bengali script mixed into mostly-Latin text
 * - "en"    — everything else
 */
export function detectLanguage(text: string): Language {
  // Count words rather than code points: Bengali vowel signs would otherwise inflate its share.
  const tokens = text.split(/\s+/).filter((t) => WORDLIKE.test(t));
  if (tokens.length === 0) return "en";

  const bengali = tokens.filter((t) => BENGALI.test(t)).length;
  if (bengali / tokens.length >= 0.5) return "bn";
  if (bengali > 0) return "bn-en";

  const words = text.toLowerCase().match(WORD) ?? [];
  if (words.length === 0) return "en";
  // Very short words like "o"/"ar"/"na" are only weak signals; require two hits or a high ratio.
  const hits = words.filter((w) => BANGLISH_WORDS.has(w)).length;
  if (hits >= 2 || (hits === 1 && words.length <= 3 && words.some((w) => w.length >= 3 && BANGLISH_WORDS.has(w)))) {
    return "bn-en";
  }
  return "en";
}
