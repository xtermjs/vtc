import { Args, Command, Flags, loadHelpClass } from "@oclif/core";
import { decodePng, encodePng } from "@lunapaint/png-codec";
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
    demo: Flags.boolean({
      description: "Display a built-in test image (no file needed)",
      default: false,
    }),
    action: Flags.option({
      char: "a",
      description: "Graphics action",
      options: ["transmit-display", "query"] as const,
    })(),
    format: Flags.option({
      char: "f",
      description: "Wire format: png (f=100) sends raw PNG bytes, rgb (f=24) sends 24-bit pixel data, rgba (f=32) sends 32-bit pixel data. For rgb/rgba, PNG input files are auto-decoded; raw pixel files require --width and --height.",
      options: ["png", "rgb", "rgba"] as const,
      default: "png" as const,
    })(),
    chunkSize: Flags.integer({
      char: "b",
      description: "Max bytes of base64 data per chunk (default: 4096)",
    }),
    width: Flags.integer({
      char: "s",
      description: "Image width in pixels (required for raw rgb/rgba input files)",
    }),
    height: Flags.integer({
      char: "v",
      description: "Image height in pixels (required for raw rgb/rgba input files)",
    }),
    columns: Flags.integer({
      char: "c",
      description: "Display width in terminal columns",
    }),
    rows: Flags.integer({
      char: "r",
      description: "Display height in terminal rows",
    }),
    imageId: Flags.integer({
      char: "i",
      description: "Image ID",
    }),
    quiet: Flags.option({
      char: "q",
      description: "Quiet mode: 1=suppress OK, 2=suppress all",
      options: ["0", "1", "2"] as const,
    })(),
    noMove: Flags.boolean({
      char: "C",
      description: "Do not move cursor after displaying image",
      default: false,
    }),
    srcX: Flags.integer({
      char: "x",
      description: "Source rectangle x offset in pixels (kitty x= key)",
    }),
    srcY: Flags.integer({
      char: "y",
      description: "Source rectangle y offset in pixels (kitty y= key)",
    }),
    srcWidth: Flags.integer({
      char: "w",
      description: "Source rectangle width in pixels (kitty w= key)",
    }),
    srcHeight: Flags.integer({
      char: "h",
      description: "Source rectangle height in pixels (kitty h= key)",
    }),
    offsetX: Flags.integer({
      char: "X",
      description: "Sub-cell horizontal offset in pixels (kitty X= key)",
    }),
    offsetY: Flags.integer({
      char: "Y",
      description: "Sub-cell vertical offset in pixels (kitty Y= key)",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ImageKitty);

    if (!args.file && !flags.demo && flags.action === undefined) {
      await this.showCommandHelp();
      return;
    }

    const action = flags.action ?? "transmit-display";

    if (action === "query") {
      this.emitQuery(flags);
      return;
    }

    if (!args.file && !flags.demo) {
      this.error("File argument is required for transmit-display action");
    }

    let fileBytes: Uint8Array;
    if (flags.demo) {
      fileBytes = await generateDemoPng();
    } else {
      const file = Bun.file(args.file!);
      fileBytes = new Uint8Array(await file.arrayBuffer());
    }
    const fileIsPng = isPng(fileBytes);

    let base64: string;
    let width: number | undefined = flags.width;
    let height: number | undefined = flags.height;

    if (flags.format === "png") {
      if (!fileIsPng) {
        this.error("Input file is not a valid PNG");
      }
      // Send raw PNG bytes as-is (f=100)
      base64 = Buffer.from(fileBytes).toString("base64");
    } else if (fileIsPng) {
      // Decode PNG to extract raw pixel data for rgb/rgba
      const decoded = await decodePng(fileBytes, { force32: true });
      width = decoded.image.width;
      height = decoded.image.height;

      let pixelData: Uint8Array;
      if (flags.format === "rgb") {
        // Strip alpha channel: RGBA → RGB
        const rgba = decoded.image.data;
        const pixelCount = width * height;
        pixelData = new Uint8Array(pixelCount * 3);
        for (let i = 0; i < pixelCount; i++) {
          pixelData[i * 3] = rgba[i * 4]!;
          pixelData[i * 3 + 1] = rgba[i * 4 + 1]!;
          pixelData[i * 3 + 2] = rgba[i * 4 + 2]!;
        }
      } else {
        // rgba: use decoded pixel data directly
        pixelData = decoded.image.data;
      }
      base64 = Buffer.from(pixelData).toString("base64");
    } else {
      // Raw pixel data file — width and height are required
      if (width === undefined || height === undefined) {
        this.error("--width and --height are required for raw rgb/rgba input files");
      }
      base64 = Buffer.from(fileBytes).toString("base64");
    }

    this.emitTransmitDisplay(base64, { ...flags, width, height });
  }

  protected async showCommandHelp(): Promise<void> {
    const Help = await loadHelpClass(this.config);
    const help = new Help(
      this.config,
      this.config.pjson.oclif?.helpOptions ?? this.config.pjson.helpOptions,
    );
    await help.showHelp(this.id ? [this.id, ...this.argv] : this.argv);
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
      quiet?: string;
      noMove?: boolean;
      srcX?: number;
      srcY?: number;
      srcWidth?: number;
      srcHeight?: number;
      offsetX?: number;
      offsetY?: number;
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
        if (flags.quiet !== undefined) meta.push(`q=${flags.quiet}`);
        if (flags.noMove) meta.push("C=1");
        if (flags.srcX !== undefined) meta.push(`x=${flags.srcX}`);
        if (flags.srcY !== undefined) meta.push(`y=${flags.srcY}`);
        if (flags.srcWidth !== undefined) meta.push(`w=${flags.srcWidth}`);
        if (flags.srcHeight !== undefined) meta.push(`h=${flags.srcHeight}`);
        if (flags.offsetX !== undefined) meta.push(`X=${flags.offsetX}`);
        if (flags.offsetY !== undefined) meta.push(`Y=${flags.offsetY}`);
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

// PNG magic bytes: 0x89 P N G \r \n 0x1A \n
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(data: Uint8Array): boolean {
  if (data.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, i) => data[i] === byte);
}

/** Generate a 200x200 PNG test image with a 4-quadrant color pattern */
async function generateDemoPng(): Promise<Uint8Array> {
  const width = 200;
  const height = 200;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const top = y < height / 2;
      const left = x < width / 2;
      if (top && left) {        // Red
        rgba[offset] = 255; rgba[offset + 1] = 0; rgba[offset + 2] = 0;
      } else if (top && !left) { // Green
        rgba[offset] = 0; rgba[offset + 1] = 255; rgba[offset + 2] = 0;
      } else if (!top && left) { // Blue
        rgba[offset] = 0; rgba[offset + 1] = 0; rgba[offset + 2] = 255;
      } else {                   // Yellow
        rgba[offset] = 255; rgba[offset + 1] = 255; rgba[offset + 2] = 0;
      }
      rgba[offset + 3] = 255;
    }
  }
  const encoded = await encodePng({ width, height, data: rgba, channels: 4 });
  return encoded.data;
}
