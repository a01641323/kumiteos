import { describe, it, expect } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "./engine-types";

describe("engine test harness", () => {
  it("loads engine defaults", () => {
    expect(DEFAULT_ENGINE_CONFIG.minRestSeconds).toBe(120);
  });
});
