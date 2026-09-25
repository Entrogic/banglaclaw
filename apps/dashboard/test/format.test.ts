import { describe, expect, it } from "vitest";
import { fmtDay, fmtDuration, fmtNum, fmtPct, fmtRelative, fmtUsd, niceTicks } from "../src/format";

describe("format", () => {
  it("compacts large numbers only", () => {
    expect(fmtNum(1284)).toBe("1,284");
    expect(fmtNum(12_900)).toBe("12.9K");
    expect(fmtNum(4_200_000)).toBe("4.2M");
  });

  it("formats percentages, money and durations", () => {
    expect(fmtPct(1, 0)).toBe("—");
    expect(fmtPct(1, 40)).toBe("2.5%");
    expect(fmtPct(1, 4)).toBe("25%");
    expect(fmtUsd(0.0012)).toBe("$0.0012");
    expect(fmtUsd(0.5062)).toBe("$0.51");
    expect(fmtUsd(0)).toBe("$0.00");
    expect(fmtUsd(12.5)).toBe("$12.50");
    expect(fmtDuration(850)).toBe("850 ms");
    expect(fmtDuration(2_340)).toBe("2.3 s");
    expect(fmtDuration(125_000)).toBe("2 m 5 s");
  });

  it("formats day keys without shifting the timezone", () => {
    expect(fmtDay("2026-09-21")).toBe("Sep 21");
    expect(fmtDay("not-a-day")).toBe("not-a-day");
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-09-25T12:00:00Z");
    expect(fmtRelative("2026-09-25T11:59:50Z", now)).toBe("just now");
    expect(fmtRelative("2026-09-25T11:30:00Z", now)).toBe("30 min ago");
    expect(fmtRelative("2026-09-25T09:00:00Z", now)).toBe("3 h ago");
    expect(fmtRelative("2026-09-23T12:00:00Z", now)).toBe("2 d ago");
  });

  it("builds round axis ticks covering the maximum", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(930)).toEqual([0, 250, 500, 750, 1000]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
  });
});
