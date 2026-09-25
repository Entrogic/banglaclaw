// @ts-check
import { definePlugin, defineTool, pluginDir, z } from "@banglaclaw/plugin-sdk";

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Mobile prefixes (after 01) → operator. */
const OPERATORS = {
  3: "Grameenphone",
  7: "Grameenphone",
  4: "Banglalink",
  9: "Banglalink",
  6: "Robi (Airtel)",
  8: "Robi",
  5: "Teletalk",
};

/** @param {string} input */
export function parseBdMobile(input) {
  const ascii = input.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d))).replace(/[\s\-().]/g, "");
  const match = /^(?:\+?88)?(01([3-9])\d{8})$/.exec(ascii);
  if (match === null) return { valid: false, input };
  const local = /** @type {string} */ (match[1]);
  const operator = OPERATORS[/** @type {keyof typeof OPERATORS} */ (Number(match[2]))];
  return { valid: true, input, local, international: `+88${local}`, operator };
}

const validateBdPhone = defineTool({
  name: "validate_bd_phone",
  description:
    "Validate a Bangladeshi mobile number (Bangla or English digits, with or without +88) and return its normalised form and operator.",
  risk: "safe",
  timeoutMs: 1_000,
  inputSchema: z.strictObject({ number: z.string().min(3).max(40) }),
  outputSchema: z.strictObject({
    valid: z.boolean(),
    input: z.string(),
    local: z.string().optional(),
    international: z.string().optional(),
    operator: z.string().optional(),
  }),
  async execute({ number }) {
    return parseBdMobile(number);
  },
});

export default definePlugin({
  name: "bd-phone",
  version: "1.0.0",
  description: "Bangladeshi mobile number validation",
  tools: [validateBdPhone],
  skillsDirs: [pluginDir(import.meta.url, "skills")],
});
