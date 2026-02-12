import { describe, expect, it } from "bun:test";
import { format } from "node:util";
import Notification from "./notification";

class TestNotification extends Notification {
  output: string[] = [];
  private testMessage: string[] | undefined;
  private testFlags: Record<string, unknown> = {};

  override log(message?: string, ...args: unknown[]): void {
    this.output.push(format(message as any, ...(args as any[])));
  }

  override async parse(..._args: unknown[]): Promise<any> {
    this.parsed = true;
    return {
      args: { message: this.testMessage },
      flags: this.testFlags,
      argv: [],
      raw: [],
      metadata: { flags: {}, args: {}, raw: [] },
      nonExistentFlags: [],
    };
  }

  async runWith(options: {
    message?: string[];
    flags?: Record<string, unknown>;
  }): Promise<string[]> {
    this.output = [];
    this.testMessage = options.message;
    this.testFlags = options.flags ?? {};
    await this.run();
    return [...this.output];
  }
}

const OSC_PREFIX = "\x1b]99;";
const OSC_SUFFIX = "\x1b\\";

type ParsedOsc = { meta: Map<string, string[]>; payload: string };

const toBase64 = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64");

const parseOsc = (line: string): ParsedOsc => {
  if (!line.startsWith(OSC_PREFIX) || !line.endsWith(OSC_SUFFIX)) {
    throw new Error(`Unexpected OSC: ${line}`);
  }

  const content = line.slice(OSC_PREFIX.length, -OSC_SUFFIX.length);
  const separatorIndex = content.indexOf(";");
  const metaPart = separatorIndex === -1 ? content : content.slice(0, separatorIndex);
  const payload = separatorIndex === -1 ? "" : content.slice(separatorIndex + 1);

  const meta = new Map<string, string[]>();
  if (metaPart.length > 0) {
    for (const entry of metaPart.split(":")) {
      const equalsIndex = entry.indexOf("=");
      const key = equalsIndex === -1 ? entry : entry.slice(0, equalsIndex);
      const value = equalsIndex === -1 ? "" : entry.slice(equalsIndex + 1);
      const list = meta.get(key) ?? [];
      list.push(value);
      meta.set(key, list);
    }
  }

  return { meta, payload };
};

const expectMetaValue = (
  meta: Map<string, string[]>,
  key: string,
  value: string,
): void => {
  const values = meta.get(key) ?? [];
  expect(values.includes(value)).toBe(true);
};

const expectMetaValues = (
  meta: Map<string, string[]>,
  key: string,
  values: string[],
): void => {
  const stored = meta.get(key) ?? [];
  for (const value of values) {
    expect(stored.includes(value)).toBe(true);
  }
};

const getLine = (output: string[], index: number): string => {
  const line = output[index];
  if (line === undefined) {
    throw new Error(`Missing output line ${index}`);
  }
  return line;
};

const runNotification = async (options: {
  message?: string[];
  flags?: Record<string, unknown>;
}): Promise<string[]> => {
  const notification = new TestNotification([], { bin: "vtc" } as any);
  return notification.runWith(options);
};

describe("Notification", () => {
  it("uses default title payload when no message", async () => {
    const output = await runNotification({});

    expect(output).toHaveLength(1);
    const { meta, payload } = parseOsc(getLine(output, 0));
    expect(payload).toBe("Hello world");
    expectMetaValue(meta, "p", "title");
  });

  it("uses title payload for single message", async () => {
    const output = await runNotification({ message: ["Hello"] });

    expect(output).toHaveLength(1);
    const { meta, payload } = parseOsc(getLine(output, 0));
    expect(payload).toBe("Hello");
    expectMetaValue(meta, "p", "title");
  });

  it("splits title and body with default completion flags", async () => {
    const output = await runNotification({ message: ["Title", "Body", "More"] });

    expect(output).toHaveLength(2);

    const first = parseOsc(getLine(output, 0));
    expect(first.payload).toBe("Title");
    expectMetaValue(first.meta, "p", "title");
    expectMetaValue(first.meta, "d", "0");

    const second = parseOsc(getLine(output, 1));
    expect(second.payload).toBe("Body More");
    expectMetaValue(second.meta, "p", "body");
    expectMetaValue(second.meta, "d", "1");
  });

  it("auto-sets base64 for icon payload type", async () => {
    const output = await runNotification({
      message: ["ICONDATA"],
      flags: { payloadType: "icon" },
    });

    expect(output).toHaveLength(1);
    const { meta, payload } = parseOsc(getLine(output, 0));
    expect(payload).toBe("ICONDATA");
    expectMetaValue(meta, "p", "icon");
    expectMetaValue(meta, "e", "1");
  });

  it("respects explicit base64 for icon payload type", async () => {
    const output = await runNotification({
      message: ["ICONDATA"],
      flags: { payloadType: "icon", base64: 0 },
    });

    expect(output).toHaveLength(1);
    const { meta } = parseOsc(getLine(output, 0));
    expectMetaValue(meta, "p", "icon");
    expectMetaValue(meta, "e", "0");
  });

  it("emits metadata for each flag", async () => {
    const cases = [
      { name: "actions", flags: { actions: "open" }, key: "a", value: "open" },
      { name: "close", flags: { close: 1 }, key: "c", value: "1" },
      { name: "complete", flags: { complete: 1 }, key: "d", value: "1" },
      { name: "base64", flags: { base64: 1 }, key: "e", value: "1" },
      { name: "app", flags: { app: "MyApp" }, key: "f", value: toBase64("MyApp") },
      { name: "icon-cache", flags: { iconCache: "cache-id" }, key: "g", value: "cache-id" },
      { name: "identifier", flags: { identifier: "id-1" }, key: "i", value: "id-1" },
      { name: "icon-name", flags: { iconName: ["bell"] }, key: "n", value: toBase64("bell") },
      { name: "occasion", flags: { occasion: "launch" }, key: "o", value: "launch" },
      { name: "payload-type", flags: { payloadType: "body" }, key: "p", value: "body" },
      { name: "sound", flags: { sound: "ding" }, key: "s", value: toBase64("ding") },
      { name: "type", flags: { type: ["info"] }, key: "t", value: toBase64("info") },
      { name: "urgency", flags: { urgency: 2 }, key: "u", value: "2" },
      { name: "expire", flags: { expire: 5000 }, key: "w", value: "5000" },
    ];

    for (const entry of cases) {
      const output = await runNotification({ message: ["Title"], flags: entry.flags });
      expect(output).toHaveLength(1);
      const { meta } = parseOsc(getLine(output, 0));
      expectMetaValue(meta, entry.key, entry.value);
    }
  });

  it("emits multiple icon names and types", async () => {
    const output = await runNotification({
      message: ["Title"],
      flags: { iconName: ["bell", "alert"], type: ["info", "warning"] },
    });

    expect(output).toHaveLength(1);
    const { meta } = parseOsc(getLine(output, 0));
    expectMetaValues(meta, "n", [toBase64("bell"), toBase64("alert")]);
    expectMetaValues(meta, "t", [toBase64("info"), toBase64("warning")]);
  });
});
