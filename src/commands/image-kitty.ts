import { Args, Command, Flags } from "@oclif/core";
import { apc } from "../helpers/vt";

const DEFAULT_CHUNK_SIZE = 4096;

export default class ImageKitty extends Command {
  static override description =
    "Display an image using the Kitty Graphics Protocol (APC sequences)";

  static override args = {
    file: Args.string({
      description: "Path to the image file",
      required: false,
    }),
  };

  static override flags = {
    action: Flags.option({
      char: "a",
      description: "Graphics action",
      options: ["transmit-display", "query"] as const,
      default: "transmit-display" as const,
    })(),
    format: Flags.option({
      char: "f",
      description: "Image format",
      options: ["png", "rgb", "rgba"] as const,
      default: "png" as const,
    })(),
    chunkSize: Flags.integer({
      char: "c",
      description: "Max bytes of base64 data per chunk (default: 4096)",
    }),
    width: Flags.integer({
      char: "W",
      description: "Image width in pixels (required for rgb/rgba)",
    }),
    height: Flags.integer({
      char: "H",
      description: "Image height in pixels (required for rgb/rgba)",
    }),
    columns: Flags.integer({
      description: "Display width in terminal columns",
    }),
    rows: Flags.integer({
      description: "Display height in terminal rows",
    }),
    imageId: Flags.integer({
      char: "i",
      description: "Image ID",
    }),
    placementId: Flags.integer({
      char: "p",
      description: "Placement ID",
    }),
    quiet: Flags.option({
      char: "q",
      description: "Quiet mode: 1=suppress OK, 2=suppress all",
      options: ["0", "1", "2"] as const,
    })(),
    noMove: Flags.boolean({
      description: "Do not move cursor after displaying image",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ImageKitty);

    if (flags.action === "query") {
      this.emitQuery(flags);
      return;
    }

    if (!args.file) {
      this.error("File argument is required for transmit-display action");
    }

    const file = Bun.file(args.file);
    const data = Buffer.from(await file.arrayBuffer());
    const base64 = data.toString("base64");

    this.emitTransmitDisplay(base64, flags);
  }

  private emitQuery(flags: {
    imageId?: number;
    quiet?: string;
  }): void {
    const meta: string[] = ["a=q", "i=31"];
    if (flags.imageId !== undefined) {
      meta[1] = `i=${flags.imageId}`;
    }
    if (flags.quiet !== undefined) {
      meta.push(`q=${flags.quiet}`);
    }
    this.writeRaw(apc(meta, ""));
  }

  private emitTransmitDisplay(
    base64: string,
    flags: {
      format?: string;
      chunkSize?: number;
      width?: number;
      height?: number;
      columns?: number;
      rows?: number;
      imageId?: number;
      placementId?: number;
      quiet?: string;
      noMove?: boolean;
    },
  ): void {
    const formatCode = formatToCode(flags.format ?? "png");
    const size = flags.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const chunks: string[] = [];
    for (let i = 0; i < base64.length; i += size) {
      chunks.push(base64.slice(i, i + size));
    }

    const parts: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0;
      const isLast = i === chunks.length - 1;
      const meta: string[] = [];

      if (isFirst) {
        meta.push("a=T");
        meta.push(`f=${formatCode}`);

        if (flags.width !== undefined) meta.push(`s=${flags.width}`);
        if (flags.height !== undefined) meta.push(`v=${flags.height}`);
        if (flags.columns !== undefined) meta.push(`c=${flags.columns}`);
        if (flags.rows !== undefined) meta.push(`r=${flags.rows}`);
        if (flags.imageId !== undefined) meta.push(`i=${flags.imageId}`);
        if (flags.placementId !== undefined) meta.push(`p=${flags.placementId}`);
        if (flags.quiet !== undefined) meta.push(`q=${flags.quiet}`);
        if (flags.noMove) meta.push("C=1");
      }

      meta.push(`m=${isLast ? 0 : 1}`);

      parts.push(apc(meta, chunks[i]!));
    }

    this.writeRaw(parts.join(""));
  }

  protected writeRaw(data: string): void {
    process.stdout.write(data);
  }
}

function formatToCode(format: string): number {
  switch (format) {
    case "rgb": return 24;
    case "rgba": return 32;
    case "png": return 100;
    default: return 100;
  }
}
