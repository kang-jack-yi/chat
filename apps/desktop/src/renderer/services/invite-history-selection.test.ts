import { describe, expect, it } from "vitest";
import { initialInviteHistorySelection } from "../../auxiliary/invite-history-selection";

describe("invite history initial selection", () => {
  it("selects every locally available message on first open", () => {
    expect(initialInviteHistorySelection([11, 12, 13], [], true))
      .toEqual([11, 12, 13]);
  });

  it("restores only IDs still present in the latest local query", () => {
    expect(initialInviteHistorySelection([12, 13, 14], [11, 12, 14], false))
      .toEqual([12, 14]);
  });
});
