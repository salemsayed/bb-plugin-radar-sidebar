import { describe, expect, it } from "vitest";
import { railReserve } from "./railLayout";

describe("railReserve", () => {
  it("gives the host footer its content and leaves the destination list a floor", () => {
    // Shell 900, list wants 700, footer content 280. List keeps 200,
    // so the footer is allowed its 280 rather than the two-control floor.
    expect(railReserve(900, 700, 40, 58, 280)).toBe(900 - 280 - 20);
  });

  it("reserves the crew before the host footer on short desktop windows", () => {
    expect(railReserve(633, 480, 112, 64, 250, 300)).toBe(633 - 157 - 20);
  });

  it("keeps the full list reserve when the shell cannot be measured", () => {
    expect(railReserve(0, 700, 40, 58, 280)).toBe(798);
  });
});
