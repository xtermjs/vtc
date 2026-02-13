import { describe, expect, it } from "bun:test";
import { apc, osc } from "./vt";

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

describe("apc", () => {
  it("formats APC with comma-separated metadata and payload", () => {
    expect(apc(["a=T", "f=100"], "base64data"))
        .toBe("\x1b_Ga=T,f=100;base64data\x1b\\");
  });

  it("supports empty metadata", () => {
    expect(apc([], "base64data"))
        .toBe("\x1b_G;base64data\x1b\\");
  });

  it("supports empty payload", () => {
    expect(apc(["a=q", "i=31"], ""))
        .toBe("\x1b_Ga=q,i=31;\x1b\\");
  });
});
