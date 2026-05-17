import { describe, expect, it } from "vitest";

import { condenseRoleLabel } from "./role-gaps";

describe("condenseRoleLabel", () => {
  it("returns short role codes unchanged", () => {
    expect(condenseRoleLabel("Extrication", "EXTR")).toBe("EXTR");
    expect(condenseRoleLabel("Medical", "MED")).toBe("MED");
  });

  it("uppercases + truncates the first word of a longer role name", () => {
    expect(condenseRoleLabel("Lead role", "Incident Lead")).toBe("INCI");
  });

  it("falls back to the requirement label when no role name is provided", () => {
    expect(condenseRoleLabel("Extrication", undefined)).toBe("EXTR");
    // Long requirement labels get truncated to four chars.
    expect(condenseRoleLabel("medical responder", undefined)).toBe("MEDI");
  });

  it("strips non-letters before truncating", () => {
    expect(condenseRoleLabel("99-ZULU", undefined)).toBe("ZULU");
  });
});
