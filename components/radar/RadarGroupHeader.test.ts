import { describe, expect, it } from "vitest";

describe("groupGlyph", () => {
  it("gives every non-time grouping mode a distinct, correct icon", async () => {
    const { groupGlyph } = await import("./RadarGroupHeader");
    // Regression: the sortable path rendered a folder for the Pinned group.
    expect(groupGlyph({ id: "pinned", icon: "Pin", projectId: null }, true)).toBe(
      "Pin",
    );
    expect(
      groupGlyph({ id: "pinned", icon: "Pin", projectId: null }, false),
    ).toBe("Pin");
    expect(
      groupGlyph({ id: "project:x", icon: "Folder", projectId: "x" }, true),
    ).toBe("Folder");
    expect(
      groupGlyph({ id: "project:x", icon: "Folder", projectId: "x" }, false),
    ).toBe("FolderOpen");
    expect(
      groupGlyph({ id: "time:today", icon: "Clock", projectId: null }, false),
    ).toBeNull();
    expect(
      groupGlyph(
        { id: "section:s1", icon: "SectionMove", projectId: null },
        false,
      ),
    ).toBe("SectionMove");
  });
});
