export interface KeyValuesEntry {
  key: string;
  value: string | KeyValuesObject;
  line: number;
}

export interface KeyValuesObject {
  entries: KeyValuesEntry[];
}

interface Token {
  type: "value" | "open" | "close" | "eof";
  value?: string;
  line: number;
}

export class KeyValuesParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} at line ${line}`);
    this.name = "KeyValuesParseError";
  }
}

class Tokenizer {
  private index = 0;
  private line = 1;

  constructor(private readonly source: string) {}

  next(): Token {
    this.skipWhitespaceAndComments();
    if (this.index >= this.source.length)
      return { type: "eof", line: this.line };

    const line = this.line;
    const char = this.source[this.index];
    if (char === "{") {
      this.index += 1;
      return { type: "open", line };
    }
    if (char === "}") {
      this.index += 1;
      return { type: "close", line };
    }
    if (char === '"') return { type: "value", value: this.readQuoted(), line };
    return { type: "value", value: this.readBare(), line };
  }

  private skipWhitespaceAndComments(): void {
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (/\s/u.test(char)) {
        if (char === "\n") this.line += 1;
        this.index += 1;
        continue;
      }
      if (char === "/" && this.source[this.index + 1] === "/") {
        this.index += 2;
        while (
          this.index < this.source.length &&
          this.source[this.index] !== "\n"
        )
          this.index += 1;
        continue;
      }
      if (char === "/" && this.source[this.index + 1] === "*") {
        const startLine = this.line;
        this.index += 2;
        let closed = false;
        while (this.index < this.source.length) {
          if (this.source[this.index] === "\n") this.line += 1;
          if (
            this.source[this.index] === "*" &&
            this.source[this.index + 1] === "/"
          ) {
            this.index += 2;
            closed = true;
            break;
          }
          this.index += 1;
        }
        if (!closed)
          throw new KeyValuesParseError(
            "Unterminated block comment",
            startLine,
          );
        continue;
      }
      break;
    }
  }

  private readQuoted(): string {
    const startLine = this.line;
    this.index += 1;
    let value = "";
    while (this.index < this.source.length) {
      const char = this.source[this.index++];
      if (char === '"') return value;
      if (char === "\n") this.line += 1;
      if (char !== "\\") {
        value += char;
        continue;
      }

      if (this.index >= this.source.length) break;
      const escaped = this.source[this.index++];
      if (escaped === "n") value += "\n";
      else if (escaped === "r") value += "\r";
      else if (escaped === "t") value += "\t";
      else if (escaped === '"') value += '"';
      else if (escaped === "\\") value += "\\";
      else value += `\\${escaped}`;
    }
    throw new KeyValuesParseError("Unterminated quoted string", startLine);
  }

  private readBare(): string {
    const start = this.index;
    while (
      this.index < this.source.length &&
      !/[\s{}]/u.test(this.source[this.index])
    ) {
      if (
        this.source[this.index] === "/" &&
        ["/", "*"].includes(this.source[this.index + 1])
      )
        break;
      this.index += 1;
    }
    if (start === this.index)
      throw new KeyValuesParseError("Unexpected token", this.line);
    return this.source.slice(start, this.index);
  }
}

export function parseKeyValues(source: string): KeyValuesObject {
  const tokenizer = new Tokenizer(source);
  return parseObject(tokenizer, false);
}

function parseObject(tokenizer: Tokenizer, nested: boolean): KeyValuesObject {
  const entries: KeyValuesEntry[] = [];
  while (true) {
    const key = tokenizer.next();
    if (key.type === "eof") {
      if (nested)
        throw new KeyValuesParseError("Missing closing brace", key.line);
      return { entries };
    }
    if (key.type === "close") {
      if (!nested)
        throw new KeyValuesParseError("Unexpected closing brace", key.line);
      return { entries };
    }
    if (key.type !== "value")
      throw new KeyValuesParseError("Expected a key", key.line);

    const value = tokenizer.next();
    if (value.type === "open") {
      entries.push({
        key: key.value!,
        value: parseObject(tokenizer, true),
        line: key.line,
      });
    } else if (value.type === "value") {
      entries.push({ key: key.value!, value: value.value!, line: key.line });
    } else {
      throw new KeyValuesParseError(
        `Expected a value for ${key.value}`,
        value.line,
      );
    }
  }
}

export function objectEntries(
  object: KeyValuesObject,
  key: string,
): KeyValuesEntry[] {
  return object.entries.filter((entry) => entry.key === key);
}

export function uniqueObject(
  object: KeyValuesObject,
  key: string,
): KeyValuesObject {
  const matches = objectEntries(object, key);
  if (matches.length !== 1 || typeof matches[0].value === "string") {
    throw new KeyValuesParseError(
      `Expected exactly one object named ${key}`,
      matches[0]?.line ?? 1,
    );
  }
  return matches[0].value;
}
