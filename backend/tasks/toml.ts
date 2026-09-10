import { ValidationError } from "../errors";

export function quoteToml(value: string): string {
  return JSON.stringify(value.replace(/\r\n/g, "\n"));
}

export function sectionContent(content: string, sectionName: string): string {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${sectionName}]`);
  if (start === -1) return "";
  const endOffset = lines
    .slice(start + 1)
    .findIndex((line) => /^\s*\[.+]\s*$/.test(line));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  return lines.slice(start + 1, end).join("\n");
}

export function topLevelContent(content: string): string {
  const sectionStart = content.search(/^\s*\[.+]\s*$/m);
  return sectionStart === -1 ? content : content.slice(0, sectionStart);
}

export function readString(source: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const multiline = source.match(
    new RegExp(`^\\s*${escapedKey}\\s*=\\s*(?:\"\"\"([\\s\\S]*?)\"\"\"|'''([\\s\\S]*?)''')`, "m")
  );
  if (multiline) {
    return (multiline[1] ?? multiline[2] ?? "").replace(/^\r?\n/, "");
  }

  const match = source.match(
    new RegExp(`^\\s*${escapedKey}\\s*=\\s*(\"(?:\\\\.|[^\"\\\\])*\"|'[^']*')\\s*(?:#.*)?$`, "m")
  );
  if (!match) return undefined;
  const token = match[1];
  if (token.startsWith("'")) return token.slice(1, -1);
  try {
    return JSON.parse(token) as string;
  } catch {
    throw new ValidationError(`Invalid TOML string for "${key}".`);
  }
}

export function readBoolean(source: string, key: string): boolean | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(`^\\s*${escapedKey}\\s*=\\s*(true|false)\\s*(?:#.*)?$`, "m")
  );
  return match ? match[1] === "true" : undefined;
}

export function readInteger(source: string, key: string): number | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(`^\\s*${escapedKey}\\s*=\\s*([0-9]+)\\s*(?:#.*)?$`, "m")
  );
  return match ? Number.parseInt(match[1], 10) : undefined;
}

