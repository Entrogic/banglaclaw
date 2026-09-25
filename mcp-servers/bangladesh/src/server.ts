import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ALIASES, DIVISIONS } from "./data.js";
import { formatTaka, toBanglaDigits, toEnglishDigits } from "./format.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}

function normalize(text: string): string {
  return text.normalize("NFC").trim().toLowerCase().replace(/['’]/g, "").replace(/\s+/g, " ");
}

export function findDistricts(query: string) {
  const q = normalize(toEnglishDigits(query));
  const alias = ALIASES[q];
  const target = alias !== undefined ? normalize(alias) : q;
  const matches = [];
  for (const division of DIVISIONS) {
    for (const district of division.districts) {
      const en = normalize(district.name);
      const bn = normalize(district.nameBn);
      if (en === target || bn === target || en.startsWith(target) || bn.startsWith(target)) {
        matches.push({ district: district.name, districtBn: district.nameBn, division: division.name, divisionBn: division.nameBn });
      }
    }
  }
  return matches;
}

/** Bangladesh reference-data MCP server: divisions/districts, Taka formatting, digit conversion. */
export function createServer(): McpServer {
  const server = new McpServer({ name: "banglaclaw-bangladesh", version: "1.0.0" });

  server.registerTool(
    "list_divisions",
    {
      title: "List divisions",
      description: "List the 8 divisions of Bangladesh with Bangla names and district counts.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () =>
      json({ divisions: DIVISIONS.map((d) => ({ name: d.name, nameBn: d.nameBn, districtCount: d.districts.length })) }),
  );

  server.registerTool(
    "list_districts",
    {
      title: "List districts",
      description: "List districts of Bangladesh (English and Bangla names), optionally for one division (English or Bangla name).",
      inputSchema: { division: z.string().min(1).max(50).optional().describe("Division name, e.g. Sylhet or সিলেট") },
      annotations: readOnly,
    },
    async ({ division }) => {
      if (division === undefined) {
        return json({ districts: DIVISIONS.flatMap((d) => d.districts.map((x) => ({ ...x, division: d.name }))) });
      }
      const q = normalize(division);
      const match = DIVISIONS.find((d) => normalize(d.name) === q || normalize(d.nameBn) === q || normalize(ALIASES[q] ?? "") === normalize(d.name));
      if (match === undefined) {
        return { isError: true, content: [{ type: "text" as const, text: `Unknown division "${division}". Divisions: ${DIVISIONS.map((d) => d.name).join(", ")}` }] };
      }
      return json({ division: match.name, divisionBn: match.nameBn, districts: match.districts });
    },
  );

  server.registerTool(
    "find_district",
    {
      title: "Find district",
      description: "Find a district by English or Bangla name (prefix match, common old spellings accepted) and return its division.",
      inputSchema: { query: z.string().min(1).max(50).describe("District name, e.g. Comilla, কুমিল্লা, Cox") },
      annotations: readOnly,
    },
    async ({ query }) => json({ matches: findDistricts(query) }),
  );

  server.registerTool(
    "format_taka",
    {
      title: "Format Taka",
      description: "Format a Bangladeshi Taka amount with lakh/crore grouping (৳1,23,456.50) and a কোটি/লক্ষ/হাজার breakdown, in Bangla or English digits.",
      inputSchema: {
        amount: z.number().describe("Amount in Taka, e.g. 12345678.5"),
        locale: z.enum(["bn", "en"]).default("bn"),
      },
      annotations: readOnly,
    },
    async ({ amount, locale }) => {
      try {
        return json(formatTaka(amount, locale));
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: (error as Error).message }] };
      }
    },
  );

  server.registerTool(
    "convert_digits",
    {
      title: "Convert digits",
      description: "Convert digits in text between Bangla (০-৯) and English (0-9).",
      inputSchema: { text: z.string().max(10_000), to: z.enum(["bn", "en"]) },
      annotations: readOnly,
    },
    async ({ text, to }) => json({ text: to === "bn" ? toBanglaDigits(text) : toEnglishDigits(text) }),
  );

  return server;
}
