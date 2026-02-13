export function osc(metadata: string[], payload: string): string {
    const metaValue = metadata.join(":");
    return `\x1b]99;${metaValue};${payload}\x1b\\`;
}

export function apc(metadata: string[], payload: string): string {
    const metaValue = metadata.join(",");
    return `\x1b_G${metaValue};${payload}\x1b\\`;
}