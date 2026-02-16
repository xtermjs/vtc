import { describe, expect, it } from "bun:test";
import ImageKitty from "./image-kitty";

class TestImageKitty extends ImageKitty {
  output: string[] = [];
  errors: string[] = [];
  helpShown = false;
  private testArgs: Record<string, unknown> = {};
  private testFlags: Record<string, unknown> = {};

  protected override writeRaw(data: string): void {
    this.output.push(data);
  }

  override error(input: string | Error, _options?: any): never {
    const msg = input instanceof Error ? input.message : input;
    this.errors.push(msg);
    throw new Error(msg);
  }

  override async parse(..._args: unknown[]): Promise<any> {
    return {
      args: this.testArgs,
      flags: {
        action: this.testFlags.action,
        format: "png",
        noMove: false,
        ...this.testFlags,
      },
      argv: [],
      raw: [],
      metadata: { flags: {}, args: {}, raw: [] },
      nonExistentFlags: [],
    };
  }

  protected override async showCommandHelp(): Promise<void> {
    this.helpShown = true;
  }

  async runWith(options: {
    args?: Record<string, unknown>;
    flags?: Record<string, unknown>;
  }): Promise<string[]> {
    this.output = [];
    this.errors = [];
    this.helpShown = false;
    this.testArgs = options.args ?? {};
    this.testFlags = options.flags ?? {};
    await this.run();
    return [...this.output];
  }
}

const APC_PREFIX = "\x1b_G";
const APC_SUFFIX = "\x1b\\";

type ParsedApc = { meta: Map<string, string>; payload: string };

const parseApc = (line: string): ParsedApc => {
  if (!line.startsWith(APC_PREFIX) || !line.endsWith(APC_SUFFIX)) {
    throw new Error(`Unexpected APC: ${line}`);
  }

  const content = line.slice(APC_PREFIX.length, -APC_SUFFIX.length);
  const separatorIndex = content.indexOf(";");
  const metaPart =
    separatorIndex === -1 ? content : content.slice(0, separatorIndex);
  const payload =
    separatorIndex === -1 ? "" : content.slice(separatorIndex + 1);

  const meta = new Map<string, string>();
  if (metaPart.length > 0) {
    for (const entry of metaPart.split(",")) {
      const equalsIndex = entry.indexOf("=");
      const key = equalsIndex === -1 ? entry : entry.slice(0, equalsIndex);
      const value = equalsIndex === -1 ? "" : entry.slice(equalsIndex + 1);
      meta.set(key, value);
    }
  }

  return { meta, payload };
};

/** Split a concatenated buffer of APC sequences into individual ones */
const splitApcs = (raw: string): string[] => {
  const result: string[] = [];
  let remaining = raw;
  while (remaining.length > 0) {
    const endIdx = remaining.indexOf(APC_SUFFIX);
    if (endIdx === -1) break;
    result.push(remaining.slice(0, endIdx + APC_SUFFIX.length));
    remaining = remaining.slice(endIdx + APC_SUFFIX.length);
  }
  return result;
};

const runImageKitty = async (options: {
  args?: Record<string, unknown>;
  flags?: Record<string, unknown>;
}): Promise<string[]> => {
  const cmd = new TestImageKitty([], { bin: "vtc" } as any);
  const rawOutput = await cmd.runWith(options);
  // writeRaw is called once with all APCs concatenated; split them
  return rawOutput.flatMap(splitApcs);
};

// Create a tiny valid 1x1 red PNG for testing
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

const withTempFile = async (
  data: Buffer,
  fn: (path: string) => Promise<void>,
): Promise<void> => {
  const path = `/tmp/vtc-test-${Date.now()}.png`;
  await Bun.write(path, data);
  try {
    await fn(path);
  } finally {
    const file = Bun.file(path);
    if (await file.exists()) {
      await Bun.write(path, ""); // cleanup
    }
  }
};

describe("ImageKitty", () => {
  it("errors when no file provided for transmit-display", async () => {
    await expect(
      runImageKitty({ flags: { action: "transmit-display" } }),
    ).rejects.toThrow("File argument is required");
  });

  it("shows help when no file and no action", async () => {
    const cmd = new TestImageKitty([], { bin: "vtc" } as any);
    await cmd.runWith({});
    expect(cmd.helpShown).toBe(true);
  });

  it("errors when non-PNG file used with png format", async () => {
    await withTempFile(Buffer.from("not a png file"), async (path) => {
      await expect(
        runImageKitty({ args: { file: path } }),
      ).rejects.toThrow("Input file is not a valid PNG");
    });
  });

  it("errors when raw pixel file lacks width/height", async () => {
    await withTempFile(Buffer.from("raw pixel data"), async (path) => {
      await expect(
        runImageKitty({ args: { file: path }, flags: { format: "rgb" } }),
      ).rejects.toThrow("--width and --height are required");
    });
  });

  it("sends raw RGB pixel data with explicit dimensions", async () => {
    // 2x1 image, 3 bytes per pixel = 6 bytes
    const rawRgb = Buffer.from([255, 0, 0, 0, 255, 0]);
    await withTempFile(rawRgb, async (path) => {
      const output = await runImageKitty({
        args: { file: path },
        flags: { format: "rgb", width: 2, height: 1 },
      });

      const { meta, payload } = parseApc(output[0]!);
      expect(meta.get("f")).toBe("24");
      expect(meta.get("s")).toBe("2");
      expect(meta.get("v")).toBe("1");
      const decoded = Buffer.from(payload, "base64");
      expect(decoded).toEqual(rawRgb);
    });
  });

  it("sends raw RGBA pixel data with explicit dimensions", async () => {
    // 1x1 image, 4 bytes per pixel = 4 bytes
    const rawRgba = Buffer.from([255, 0, 0, 255]);
    await withTempFile(rawRgba, async (path) => {
      const output = await runImageKitty({
        args: { file: path },
        flags: { format: "rgba", width: 1, height: 1 },
      });

      const { meta, payload } = parseApc(output[0]!);
      expect(meta.get("f")).toBe("32");
      expect(meta.get("s")).toBe("1");
      expect(meta.get("v")).toBe("1");
      const decoded = Buffer.from(payload, "base64");
      expect(decoded).toEqual(rawRgba);
    });
  });

  it("sends a single-chunk PNG with correct metadata", async () => {
    await withTempFile(TINY_PNG, async (path) => {
      const output = await runImageKitty({ args: { file: path } });

      expect(output).toHaveLength(1);
      const { meta, payload } = parseApc(output[0]!);
      expect(meta.get("a")).toBe("T");
      expect(meta.get("f")).toBe("100");
      expect(meta.get("m")).toBe("0");
      expect(payload.length).toBeGreaterThan(0);

      // Verify the payload is valid base64 of our PNG
      const decoded = Buffer.from(payload, "base64");
      expect(decoded).toEqual(TINY_PNG);
    });
  });

  it("splits data into chunks by size", async () => {
    await withTempFile(TINY_PNG, async (path) => {
      // Use a small chunk size to force multiple chunks
      const output = await runImageKitty({
        args: { file: path },
        flags: { chunkSize: 40 },
      });

      expect(output.length).toBeGreaterThan(1);

      // First chunk: has full metadata, m=1
      const first = parseApc(output[0]!);
      expect(first.meta.get("a")).toBe("T");
      expect(first.meta.get("f")).toBe("100");
      expect(first.meta.get("m")).toBe("1");
      expect(first.payload.length).toBeLessThanOrEqual(40);

      // Middle chunks: only m=1
      for (let i = 1; i < output.length - 1; i++) {
        const mid = parseApc(output[i]!);
        expect(mid.meta.get("a")).toBeUndefined();
        expect(mid.meta.get("m")).toBe("1");
      }

      // Last chunk: only m=0
      const last = parseApc(output[output.length - 1]!);
      expect(last.meta.get("m")).toBe("0");

      // Reassemble and verify
      const combined = output.map((o) => parseApc(o).payload).join("");
      const decoded = Buffer.from(combined, "base64");
      expect(decoded).toEqual(TINY_PNG);
    });
  });

  it("emits query action with no file", async () => {
    const output = await runImageKitty({
      flags: { action: "query" },
    });

    expect(output).toHaveLength(1);
    const { meta, payload } = parseApc(output[0]!);
    expect(meta.get("a")).toBe("q");
    expect(meta.get("i")).toBe("31");
    expect(payload).toBe("");
  });

  it("decodes PNG to RGB pixel data with auto-extracted dimensions", async () => {
    await withTempFile(TINY_PNG, async (path) => {
      const output = await runImageKitty({
        args: { file: path },
        flags: { format: "rgb" },
      });

      const { meta, payload } = parseApc(output[0]!);
      expect(meta.get("f")).toBe("24");
      // Width and height auto-extracted from 1x1 PNG
      expect(meta.get("s")).toBe("1");
      expect(meta.get("v")).toBe("1");
      // Payload should be base64 of 3 bytes (1 pixel × RGB)
      const decoded = Buffer.from(payload, "base64");
      expect(decoded.length).toBe(3);
    });
  });

  it("decodes PNG to RGBA pixel data with auto-extracted dimensions", async () => {
    await withTempFile(TINY_PNG, async (path) => {
      const output = await runImageKitty({
        args: { file: path },
        flags: { format: "rgba" },
      });

      const { meta, payload } = parseApc(output[0]!);
      expect(meta.get("f")).toBe("32");
      // Width and height auto-extracted from 1x1 PNG
      expect(meta.get("s")).toBe("1");
      expect(meta.get("v")).toBe("1");
      // Payload should be base64 of 4 bytes (1 pixel × RGBA)
      const decoded = Buffer.from(payload, "base64");
      expect(decoded.length).toBe(4);
    });
  });

  it("includes optional metadata flags", async () => {
    await withTempFile(TINY_PNG, async (path) => {
      const output = await runImageKitty({
        args: { file: path },
        flags: {
          columns: 40,
          rows: 20,
          imageId: 5,
          quiet: "2",
          noMove: true,
        },
      });

      const { meta } = parseApc(output[0]!);
      expect(meta.get("c")).toBe("40");
      expect(meta.get("r")).toBe("20");
      expect(meta.get("i")).toBe("5");
      expect(meta.get("q")).toBe("2");
      expect(meta.get("C")).toBe("1");
    });
  });

  it("query respects custom imageId", async () => {
    const output = await runImageKitty({
      flags: { action: "query", imageId: 42 },
    });

    const { meta } = parseApc(output[0]!);
    expect(meta.get("i")).toBe("42");
  });
});
