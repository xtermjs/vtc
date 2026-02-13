import { Args, Command, Flags } from "@oclif/core";

export default class Notification extends Command {
  static override description = "Print OSC 99 notification escape sequence";

  static override args = {
    message: Args.string({
      description: "Title and optional body text",
      multiple: true,
      required: false,
    }),
  };

  static override flags = {
    actions: Flags.string({ char: "a", description: "Actions on activation" }),
    close: Flags.option({
      char: "c",
      description: "Report close events",
      options: ["0", "1"] as const,
    })(),
    complete: Flags.option({
      char: "d",
      description: "Chunk completion flag",
      options: ["0", "1"] as const,
    })(),
    base64: Flags.option({
      char: "e",
      description: "Payload is base64",
      options: ["0", "1"] as const,
    })(),
    app: Flags.string({ char: "f", description: "Application name" }),
    iconCache: Flags.string({ char: "g", description: "Icon cache id" }),
    identifier: Flags.string({ char: "i", description: "Notification id" }),
    iconName: Flags.string({ char: "n", description: "Icon name", multiple: true }),
    occasion: Flags.string({ char: "o", description: "Occasion" }),
    payloadType: Flags.string({ char: "p", description: "Payload type" }),
    sound: Flags.string({ char: "s", description: "Sound name" }),
    type: Flags.string({ char: "t", description: "Notification type", multiple: true }),
    urgency: Flags.option({
      char: "u",
      description: "Urgency",
      options: ["0", "1", "2"] as const,
    })(),
    expire: Flags.integer({ char: "w", description: "Auto-expire ms" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Notification);

    type MetaValue = string | number | string[] | undefined;
    type Metadata = {
      a?: string;
      c?: number | string;
      d?: number | string;
      e?: number | string;
      f?: string;
      g?: string;
      i?: string;
      n?: string[];
      o?: string;
      p?: string;
      s?: string;
      t?: string[];
      u?: number | string;
      w?: number;
    };

    const base64Keys = new Set(["f", "n", "s", "t"]);

    const toBase64 = (value: string): string =>
      Buffer.from(value, "utf8").toString("base64");

    const addMeta = (entries: string[], key: string, value: MetaValue): void => {
      if (value === undefined) {
        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          addMeta(entries, key, item);
        }
        return;
      }

      const rawValue = String(value);
      const encodedValue = base64Keys.has(key) ? toBase64(rawValue) : rawValue;
      entries.push(`${key}=${encodedValue}`);
    };

    const buildMetadata = (overrides: Partial<Metadata>): string[] => {
      const meta: Metadata = {
        a: flags.actions,
        c: flags.close,
        d: flags.complete,
        e: flags.base64,
        f: flags.app,
        g: flags.iconCache,
        i: flags.identifier,
        n: flags.iconName,
        o: flags.occasion,
        p: flags.payloadType,
        s: flags.sound,
        t: flags.type,
        u: flags.urgency,
        w: flags.expire,
        ...overrides,
      };

      const entries: string[] = [];
      addMeta(entries, "a", meta.a);
      addMeta(entries, "c", meta.c);
      addMeta(entries, "d", meta.d);
      addMeta(entries, "e", meta.e);
      addMeta(entries, "f", meta.f);
      addMeta(entries, "g", meta.g);
      addMeta(entries, "i", meta.i);
      addMeta(entries, "n", meta.n);
      addMeta(entries, "o", meta.o);
      addMeta(entries, "p", meta.p);
      addMeta(entries, "s", meta.s);
      addMeta(entries, "t", meta.t);
      addMeta(entries, "u", meta.u);
      addMeta(entries, "w", meta.w);
      return entries;
    };

    const buildOsc = (metadata: string[], payload: string): string => {
      const metaValue = metadata.join(":");
      return `\x1b]99;${metaValue};${payload}\x1b\\`;
    };

    const rawMessage = args.message;
    const messageParts = Array.isArray(rawMessage)
      ? rawMessage
      : rawMessage
        ? [rawMessage]
        : [];
    const payloadParts = messageParts.filter((value) => value.length > 0);
    const payloadType = flags.payloadType;

    if (payloadType) {
      const effectiveBase64 =
        payloadType === "icon" && flags.base64 === undefined ? 1 : flags.base64;
      const metadata = buildMetadata({ p: payloadType, e: effectiveBase64 });
      const payload = payloadParts.join(" ");
      this.log(buildOsc(metadata, payload));
      return;
    }

    if (payloadParts.length === 0) {
      const metadata = buildMetadata({ p: "title" });
      this.log(buildOsc(metadata, "Hello world"));
      return;
    }

    if (payloadParts.length === 1) {
      const metadata = buildMetadata({ p: "title" });
      this.log(buildOsc(metadata, payloadParts[0]));
      return;
    }

    const title = payloadParts[0];
    const body = payloadParts.slice(1).join(" ");
    const autoComplete = flags.complete ?? 0;
    const titleMeta = buildMetadata({ p: "title", d: autoComplete });
    const bodyMeta = buildMetadata({ p: "body", d: flags.complete ?? 1 });

    this.log(buildOsc(titleMeta, title));
    this.log(buildOsc(bodyMeta, body));
  }
}
