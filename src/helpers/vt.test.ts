import { describe, expect, it } from "bun:test";
import { osc } from "./vt";

describe("osc", () => {
  it("formats OSC with metadata and payload", () => {
    expect(osc(["a=1", "b=2"], "payload"))
        .toBe("\x1b]99;a=1:b=2;payload\x1b\\");
  });

  it("supports empty metadata", () => {
    expect(osc([], "payload"))
        .toBe("\x1b]99;;payload\x1b\\");
  });

  it("supports empty payload", () => {
    expect(osc(["p=title"], ""))
        .toBe("\x1b]99;p=title;\x1b\\");
  });
});
