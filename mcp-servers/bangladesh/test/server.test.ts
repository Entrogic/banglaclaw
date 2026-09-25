import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { DIVISIONS, createServer, findDistricts, formatTaka, groupLakh, toBanglaDigits, toEnglishDigits } from "../src/index.js";

describe("data", () => {
  it("has 8 divisions and 64 unique districts", () => {
    expect(DIVISIONS).toHaveLength(8);
    const names = DIVISIONS.flatMap((d) => d.districts.map((x) => x.name));
    expect(names).toHaveLength(64);
    expect(new Set(names).size).toBe(64);
    expect(new Set(DIVISIONS.flatMap((d) => d.districts.map((x) => x.nameBn))).size).toBe(64);
  });

  it("finds districts by English, Bangla, prefix and old spelling", () => {
    expect(findDistricts("Comilla")).toEqual([{ district: "Cumilla", districtBn: "কুমিল্লা", division: "Chattogram", divisionBn: "চট্টগ্রাম" }]);
    expect(findDistricts("কুমিল্লা")[0]?.district).toBe("Cumilla");
    expect(findDistricts("cox")[0]?.district).toBe("Cox's Bazar");
    expect(findDistricts("Sylhet")[0]?.division).toBe("Sylhet");
    expect(findDistricts("Atlantis")).toEqual([]);
  });
});

describe("format", () => {
  it.each([
    ["0", "0"],
    ["999", "999"],
    ["1000", "1,000"],
    ["100000", "1,00,000"],
    ["12345678", "1,23,45,678"],
  ])("groupLakh(%s) = %s", (input, expected) => {
    expect(groupLakh(input)).toBe(expected);
  });

  it("formats Taka in Bangla and English", () => {
    expect(formatTaka(12345678.5, "bn")).toEqual({ numeric: "৳১,২৩,৪৫,৬৭৮.৫০", words: "১ কোটি ২৩ লক্ষ ৪৫ হাজার ৬৭৮ টাকা ৫০ পয়সা" });
    expect(formatTaka(1500, "en")).toEqual({ numeric: "৳1,500", words: "1 thousand 500 taka" });
    expect(formatTaka(0, "en").words).toBe("0 taka");
    expect(formatTaka(-250.25, "en")).toEqual({ numeric: "-৳250.25", words: "minus 250 taka 25 paisa" });
    expect(formatTaka(2_000_000_000, "bn").words).toBe("২০০ কোটি টাকা");
    expect(() => formatTaka(Number.NaN, "en")).toThrow();
  });

  it("converts digits both ways", () => {
    expect(toBanglaDigits("Room 204, 2026")).toBe("Room ২০৪, ২০২৬");
    expect(toEnglishDigits("৳১,৫০০")).toBe("৳1,500");
  });
});

describe("MCP server", () => {
  async function connect() {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverTransport);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientTransport);
    return client;
  }

  it("lists read-only tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["convert_digits", "find_district", "format_taka", "list_districts", "list_divisions"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("answers tool calls with structured content", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "list_districts", arguments: { division: "সিলেট" } });
    expect(result.structuredContent).toMatchObject({ division: "Sylhet", districts: expect.arrayContaining([{ name: "Sylhet", nameBn: "সিলেট" }]) });

    const taka = await client.callTool({ name: "format_taka", arguments: { amount: 150000 } });
    expect(taka.structuredContent).toEqual({ numeric: "৳১,৫০,০০০", words: "১ লক্ষ ৫০ হাজার টাকা" });

    const bad = await client.callTool({ name: "list_districts", arguments: { division: "Atlantis" } });
    expect(bad.isError).toBe(true);
  });
});
