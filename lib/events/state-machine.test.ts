import { describe, expect, it } from "vitest";

import { nextStatus, type StateContext } from "./state-machine";

const ctx = (over: Partial<StateContext> = {}): StateContext => ({
  confirmed: 0,
  pending: 0,
  needed: 4,
  hasInvites: false,
  hasReview: false,
  cancelled: false,
  ...over,
});

describe("nextStatus", () => {
  it("stays draft when no invites have been sent yet", () => {
    expect(nextStatus("draft", ctx())).toBe("draft");
  });

  it("settles into scheduled once the draft has real dates and no invites", () => {
    expect(nextStatus("scheduled", ctx())).toBe("scheduled");
  });

  it("walks scheduled → inviting → staffed on the happy path", () => {
    expect(
      nextStatus("scheduled", ctx({ hasInvites: true, pending: 4 })),
    ).toBe("inviting");
    expect(
      nextStatus("inviting", ctx({ hasInvites: true, confirmed: 4 })),
    ).toBe("staffed");
  });

  it("drops to underfilled when accepted+pending < needed", () => {
    expect(
      nextStatus(
        "inviting",
        ctx({ hasInvites: true, confirmed: 1, pending: 1, needed: 4 }),
      ),
    ).toBe("underfilled");
  });

  it("treats cancelled and completed as terminal sinks", () => {
    expect(nextStatus("cancelled", ctx({ confirmed: 4 }))).toBe("cancelled");
    expect(nextStatus("completed", ctx({ confirmed: 4 }))).toBe("completed");
  });

  it("respects external cancellation override", () => {
    expect(
      nextStatus(
        "underfilled",
        ctx({ hasInvites: true, cancelled: true }),
      ),
    ).toBe("cancelled");
  });

  it("hands off to needs_review when calendar sync raises a review flag", () => {
    expect(
      nextStatus("inviting", ctx({ hasInvites: true, hasReview: true })),
    ).toBe("needs_review");
  });

  it("keeps locked steady regardless of coverage churn", () => {
    expect(
      nextStatus("locked", ctx({ hasInvites: true, confirmed: 0, pending: 0 })),
    ).toBe("locked");
  });
});
