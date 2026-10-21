import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { detectLanguage } from "@entrogic-net/agent";
import type { ModelProvider } from "@entrogic-net/providers";
import type { BuiltinEvalMetric, EvalMetricResult, Golden, Language } from "@entrogic-net/shared";

export type JudgeLanguage = "bn" | "en";

export const DEFAULT_THRESHOLDS: Record<BuiltinEvalMetric, number> = {
  correctness: 0.6,
  answer_relevancy: 0.7,
  fluency: 0.6,
  conversation: 0.6,
  tool_correctness: 1,
  language_match: 1,
};

export const METRIC_NAMES: Record<BuiltinEvalMetric, string> = {
  correctness: "Correctness",
  answer_relevancy: "Answer Relevancy",
  fluency: "Bangla Fluency",
  conversation: "Conversation",
  tool_correctness: "Tool Correctness",
  language_match: "Language Match",
};

export const JUDGE_METRICS: ReadonlySet<BuiltinEvalMetric> = new Set(["correctness", "answer_relevancy", "fluency", "conversation"]);

/** What one golden produced: every turn of the conversation, the last answer and its run details. */
export interface EvalTranscript {
  golden: Golden;
  turns: { user: string; assistant: string }[];
  /** Language the agent detected for the last input. */
  language: Language;
  toolsCalled: string[];
}

/**
 * Judge rubrics in English and in Bangla (ADR-0020). Both say the same: compare meaning across
 * scripts and digit systems, which generic English-centric judges get wrong for Bangla answers.
 */
const RUBRICS: Record<Exclude<BuiltinEvalMetric, "tool_correctness" | "language_match">, Record<JudgeLanguage, string>> = {
  correctness: {
    en: `Judge whether the actual output answers the input correctly, using the expected output as the reference answer.
The conversation may be in Bangla (Bengali script), Banglish (Bangla written in Latin letters) or English.
Judge meaning, not wording or script: a correct answer in another phrasing or script is still correct.
Bengali and Latin digits are equivalent (৪২ = 42), and ৳, Tk and taka mean the same currency.
Numbers, amounts, dates, names and places must agree with the expected output.
Penalise invented facts and missing key information; do not penalise extra helpful detail that is correct.`,
    bn: `প্রত্যাশিত উত্তরকে রেফারেন্স ধরে বিচার করুন, আসল উত্তরটি প্রশ্নের সঠিক উত্তর দিয়েছে কি না।
কথোপকথন বাংলায় (বাংলা হরফে), বাংলিশে (ল্যাটিন হরফে লেখা বাংলা) বা ইংরেজিতে হতে পারে।
শব্দ বা হরফ নয়, অর্থ বিচার করুন: অন্যভাবে বা অন্য হরফে লেখা সঠিক উত্তরও সঠিক।
বাংলা ও ইংরেজি অঙ্ক সমান (৪২ = 42), আর ৳, Tk ও টাকা একই মুদ্রা।
সংখ্যা, পরিমাণ, তারিখ, নাম ও স্থান প্রত্যাশিত উত্তরের সঙ্গে মিলতে হবে।
বানানো তথ্য বা বাদ পড়া মূল তথ্যের জন্য নম্বর কাটুন; সঠিক বাড়তি তথ্যের জন্য কাটবেন না।`,
  },
  answer_relevancy: {
    en: `Judge whether the actual output addresses the input directly and helpfully.
The conversation may be in Bangla, Banglish or English; judge the content, not the script.
Off-topic, evasive or padded answers score low, and so does refusing a question that could be answered.`,
    bn: `বিচার করুন, আসল উত্তরটি প্রশ্নের সরাসরি ও কাজের জবাব দিয়েছে কি না।
কথোপকথন বাংলা, বাংলিশ বা ইংরেজিতে হতে পারে; হরফ নয়, বিষয়বস্তু বিচার করুন।
প্রসঙ্গের বাইরের, এড়িয়ে যাওয়া বা অপ্রয়োজনে লম্বা উত্তর কম নম্বর পাবে; উত্তর দেওয়া সম্ভব এমন প্রশ্নে অস্বীকার করলেও কম নম্বর।`,
  },
  fluency: {
    en: `Judge the language quality of the actual output for a Bangladeshi reader.
If it is in Bangla, it should be natural, grammatical standard Bangla in Bengali script (not machine-translated phrasing).
If it is in Banglish, it should be natural romanised Bangla as people type it in chat.
If it is in English, it should be clear and grammatical.
Ignore whether the facts are correct; judge only how the answer reads.`,
    bn: `একজন বাংলাদেশি পাঠকের জন্য আসল উত্তরের ভাষার মান বিচার করুন।
বাংলায় হলে তা বাংলা হরফে স্বাভাবিক, ব্যাকরণসম্মত প্রমিত বাংলা হতে হবে (যন্ত্রে অনুবাদ করা ধাঁচ নয়)।
বাংলিশে হলে মানুষ চ্যাটে যেভাবে লেখে তেমন স্বাভাবিক রোমান হরফের বাংলা হতে হবে।
ইংরেজিতে হলে স্পষ্ট ও ব্যাকরণসম্মত হতে হবে।
তথ্য সঠিক কি না দেখবেন না; শুধু উত্তরটি পড়তে কেমন, তা বিচার করুন।`,
  },
  conversation: {
    en: `Judge the whole conversation between the user and the assistant.
The last reply must stay consistent with, and correctly use, what was said earlier: names, numbers and facts the user gave, and the assistant's own earlier answers.
Forgetting or contradicting earlier turns scores low; so does asking again for information the user already gave.
The conversation may be in Bangla, Banglish or English; judge meaning, not script.`,
    bn: `ব্যবহারকারী ও সহকারীর পুরো কথোপকথন বিচার করুন।
শেষ উত্তরটিকে আগের কথার সঙ্গে সামঞ্জস্যপূর্ণ হতে হবে এবং তা সঠিকভাবে ব্যবহার করতে হবে: ব্যবহারকারীর দেওয়া নাম, সংখ্যা ও তথ্য, আর সহকারীর নিজের আগের উত্তর।
আগের কথা ভুলে গেলে বা তার উল্টো বললে কম নম্বর; ব্যবহারকারী যা আগেই বলেছেন তা আবার জানতে চাইলেও কম নম্বর।
কথোপকথন বাংলা, বাংলিশ বা ইংরেজিতে হতে পারে; হরফ নয়, অর্থ বিচার করুন।`,
  },
};

const OUTPUT_FORMAT: Record<JudgeLanguage, string> = {
  en: 'Reply with JSON only, no other text: {"score": <integer 0-10>, "reason": "<one or two sentences>"}. 10 means fully meets the criteria, 0 not at all.',
  bn: 'শুধু JSON দিয়ে উত্তর দিন, অন্য কোনো লেখা নয়: {"score": <0 থেকে 10 পূর্ণসংখ্যা>, "reason": "<এক-দুই বাক্যে কারণ, বাংলায়>"}। 10 মানে মানদণ্ড পুরোপুরি পূরণ, 0 মানে একেবারেই নয়।',
};

const LABELS: Record<JudgeLanguage, { role: string; criteria: string; input: string; expected: string; actual: string; conversation: string; user: string; assistant: string }> = {
  en: { role: "You are a strict, fair evaluator of an AI assistant's answers.", criteria: "Criteria", input: "Input", expected: "Expected output", actual: "Actual output", conversation: "Conversation", user: "User", assistant: "Assistant" },
  bn: { role: "আপনি একজন কঠোর কিন্তু ন্যায্য মূল্যায়নকারী, যিনি একটি এআই সহকারীর উত্তর যাচাই করেন।", criteria: "মানদণ্ড", input: "প্রশ্ন", expected: "প্রত্যাশিত উত্তর", actual: "আসল উত্তর", conversation: "কথোপকথন", user: "ব্যবহারকারী", assistant: "সহকারী" },
};

const VerdictSchema = z.object({ score: z.number().min(0).max(10), reason: z.string().max(2_000).default("") });

/** The judge prompt for one metric and case; exported for tests and docs. */
export function judgePrompt(metric: keyof typeof RUBRICS, t: EvalTranscript, language: JudgeLanguage): { system: string; user: string } {
  const l = LABELS[language];
  const last = t.turns.at(-1);
  const sections =
    metric === "conversation"
      ? [`${l.conversation}:\n${t.turns.map((turn) => `${l.user}: ${turn.user}\n${l.assistant}: ${turn.assistant}`).join("\n\n")}`]
      : [
          `${l.input}:\n${t.golden.input}`,
          ...(metric === "correctness" && t.golden.expected_output !== undefined ? [`${l.expected}:\n${t.golden.expected_output}`] : []),
          `${l.actual}:\n${last?.assistant ?? ""}`,
        ];
  return { system: `${l.role}\n\n${l.criteria}:\n${RUBRICS[metric][language]}\n\n${OUTPUT_FORMAT[language]}`, user: sections.join("\n\n") };
}

/** Parses the judge's JSON verdict; tolerates code fences and text around it. */
export function parseVerdict(text: string): { score: number; reason: string } | undefined {
  const match = /\{[\s\S]*\}/.exec(text);
  if (match === null) return undefined;
  try {
    const parsed = VerdictSchema.safeParse(JSON.parse(match[0]));
    return parsed.success ? { score: parsed.data.score / 10, reason: parsed.data.reason } : undefined;
  } catch {
    return undefined;
  }
}

/** Metrics a case lacks inputs for are skipped, as in the DeepEval harness. */
export function applies(metric: BuiltinEvalMetric, golden: Golden): boolean {
  if (metric === "correctness") return golden.expected_output !== undefined;
  if (metric === "conversation") return (golden.turns?.length ?? 0) > 0;
  if (metric === "tool_correctness") return golden.expected_tools !== undefined;
  return true;
}

/** Same rule as the system prompt (docs/04): reply in the user's language; Banglish may also be answered in Bengali script. */
export function languageMatch(t: EvalTranscript, threshold: number): EvalMetricResult {
  const input = detectLanguage(t.golden.input);
  const allowed: Language[] = t.golden.reply_language !== undefined ? [t.golden.reply_language] : input === "bn-en" ? ["bn-en", "bn"] : [input];
  const got = detectLanguage(t.turns.at(-1)?.assistant ?? "");
  const score = allowed.includes(got) ? 1 : 0;
  return { name: METRIC_NAMES.language_match, score, threshold, success: score >= threshold, reason: `Reply detected as ${got}; expected ${allowed.join(" or ")} (input was ${input}).` };
}

/** Share of expected tools that were called; with `expected_tools: []`, 1 only when no tool was called. */
export function toolCorrectness(t: EvalTranscript, threshold: number): EvalMetricResult {
  const expected = t.golden.expected_tools ?? [];
  const called = new Set(t.toolsCalled);
  const score = expected.length === 0 ? (called.size === 0 ? 1 : 0) : expected.filter((x) => called.has(x)).length / expected.length;
  const reason = `Called [${[...called].join(", ")}]; expected [${expected.join(", ")}].`;
  return { name: METRIC_NAMES.tool_correctness, score, threshold, success: score >= threshold, reason };
}

/** One LLM-as-a-judge metric. Asks twice when the first answer is not a valid verdict; never throws. */
export async function judgeMetric(metric: keyof typeof RUBRICS, t: EvalTranscript, options: { judge: ModelProvider; language: JudgeLanguage; threshold: number; signal: AbortSignal }): Promise<EvalMetricResult> {
  const { system, user } = judgePrompt(metric, t, options.language);
  const base = { name: METRIC_NAMES[metric], threshold: options.threshold };
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reply = await options.judge.chat([new SystemMessage(system), new HumanMessage(user)], { signal: options.signal });
      const verdict = parseVerdict(reply.text);
      if (verdict !== undefined) return { ...base, score: verdict.score, success: verdict.score >= options.threshold, ...(verdict.reason !== "" && { reason: verdict.reason }) };
    }
    return { ...base, success: false, error: "The judge did not return a valid verdict" };
  } catch (error) {
    if (options.signal.aborted) throw error;
    return { ...base, success: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  }
}
