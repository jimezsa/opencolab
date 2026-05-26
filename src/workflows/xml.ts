/**
 * Minimal XML parser for workflow definitions.
 * Accepts a small, safe subset of XML: elements with attributes, text content,
 * self-closing tags, and CDATA sections. Rejects DTDs, processing instructions,
 * external entities, and oversized inputs.
 */

const MAX_XML_BYTES = 256 * 1024;
const MAX_NESTING_DEPTH = 64;

export interface XmlElement {
  tag: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  line: number;
}

export interface XmlText {
  kind: "text";
  value: string;
}

export type XmlNode = XmlElement | XmlText;

export interface XmlParseError {
  message: string;
  line: number;
}

export class XmlSyntaxError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`Line ${line}: ${message}`);
    this.name = "XmlSyntaxError";
    this.line = line;
  }
}

const ENTITY_TABLE: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'"
};

export function parseXml(source: string): XmlElement {
  if (typeof source !== "string") {
    throw new XmlSyntaxError("Workflow source must be a string.", 1);
  }
  if (Buffer.byteLength(source, "utf8") > MAX_XML_BYTES) {
    throw new XmlSyntaxError(
      `Workflow XML exceeds ${MAX_XML_BYTES} bytes.`,
      1
    );
  }

  const parser = new Parser(source);
  parser.skipProlog();
  parser.skipWhitespaceAndComments();
  const root = parser.parseElement(0);
  parser.skipWhitespaceAndComments();
  if (!parser.eof()) {
    throw new XmlSyntaxError(
      "Unexpected content after root element.",
      parser.line
    );
  }
  return root;
}

class Parser {
  private readonly source: string;
  private position = 0;
  public line = 1;

  constructor(source: string) {
    this.source = source;
  }

  eof(): boolean {
    return this.position >= this.source.length;
  }

  peek(offset = 0): string {
    return this.source[this.position + offset] ?? "";
  }

  advance(count = 1): void {
    for (let i = 0; i < count && !this.eof(); i += 1) {
      const ch = this.source[this.position];
      this.position += 1;
      if (ch === "\n") {
        this.line += 1;
      }
    }
  }

  startsWith(prefix: string): boolean {
    return this.source.startsWith(prefix, this.position);
  }

  skipProlog(): void {
    this.skipWhitespaceAndComments();
    if (this.startsWith("<?xml")) {
      const end = this.source.indexOf("?>", this.position);
      if (end < 0) {
        throw new XmlSyntaxError("Unterminated XML declaration.", this.line);
      }
      this.advanceTo(end + 2);
    }
  }

  private advanceTo(targetIndex: number): void {
    while (this.position < targetIndex && !this.eof()) {
      this.advance(1);
    }
  }

  skipWhitespaceAndComments(): void {
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        this.advance(1);
        continue;
      }
      if (this.startsWith("<!--")) {
        const end = this.source.indexOf("-->", this.position + 4);
        if (end < 0) {
          throw new XmlSyntaxError("Unterminated XML comment.", this.line);
        }
        this.advanceTo(end + 3);
        continue;
      }
      break;
    }
  }

  parseElement(depth: number): XmlElement {
    if (depth > MAX_NESTING_DEPTH) {
      throw new XmlSyntaxError(
        `Workflow nesting exceeds ${MAX_NESTING_DEPTH} levels.`,
        this.line
      );
    }
    if (this.peek() !== "<") {
      throw new XmlSyntaxError("Expected '<' at element start.", this.line);
    }
    if (this.startsWith("<!DOCTYPE") || this.startsWith("<!ENTITY")) {
      throw new XmlSyntaxError(
        "Document type declarations and entities are not allowed.",
        this.line
      );
    }
    if (this.startsWith("<?")) {
      throw new XmlSyntaxError(
        "Processing instructions are not allowed in workflow XML.",
        this.line
      );
    }
    this.advance(1); // consume '<'
    const startLine = this.line;
    const tag = this.readName();
    if (!tag) {
      throw new XmlSyntaxError("Missing element name.", startLine);
    }
    const attributes = this.readAttributes();
    if (this.peek() === "/") {
      this.advance(1);
      if (this.peek() !== ">") {
        throw new XmlSyntaxError(
          "Expected '>' after self-closing element.",
          this.line
        );
      }
      this.advance(1);
      return {
        tag,
        attributes,
        children: [],
        line: startLine
      };
    }
    if (this.peek() !== ">") {
      throw new XmlSyntaxError(
        "Expected '>' or '/>' at element start.",
        this.line
      );
    }
    this.advance(1);
    const children: XmlNode[] = [];
    let textBuffer = "";
    const flushText = (): void => {
      if (textBuffer.length === 0) {
        return;
      }
      children.push({ kind: "text", value: textBuffer });
      textBuffer = "";
    };
    while (!this.eof()) {
      if (this.startsWith("</")) {
        flushText();
        this.advance(2);
        const closeName = this.readName();
        if (closeName !== tag) {
          throw new XmlSyntaxError(
            `Closing tag </${closeName}> does not match <${tag}>.`,
            this.line
          );
        }
        this.skipWhitespaceInTag();
        if (this.peek() !== ">") {
          throw new XmlSyntaxError("Expected '>' on closing tag.", this.line);
        }
        this.advance(1);
        return {
          tag,
          attributes,
          children,
          line: startLine
        };
      }
      if (this.startsWith("<!--")) {
        flushText();
        const end = this.source.indexOf("-->", this.position + 4);
        if (end < 0) {
          throw new XmlSyntaxError("Unterminated XML comment.", this.line);
        }
        this.advanceTo(end + 3);
        continue;
      }
      if (this.startsWith("<![CDATA[")) {
        flushText();
        const end = this.source.indexOf("]]>", this.position + 9);
        if (end < 0) {
          throw new XmlSyntaxError("Unterminated CDATA section.", this.line);
        }
        const cdata = this.source.slice(this.position + 9, end);
        children.push({ kind: "text", value: cdata });
        this.advanceTo(end + 3);
        continue;
      }
      if (this.peek() === "<") {
        flushText();
        children.push(this.parseElement(depth + 1));
        continue;
      }
      const ch = this.peek();
      if (ch === "&") {
        textBuffer += this.readEntity();
        continue;
      }
      textBuffer += ch;
      this.advance(1);
    }
    throw new XmlSyntaxError(`Unterminated element <${tag}>.`, startLine);
  }

  private readName(): string {
    let name = "";
    while (!this.eof()) {
      const ch = this.peek();
      if (
        (ch >= "a" && ch <= "z") ||
        (ch >= "A" && ch <= "Z") ||
        (ch >= "0" && ch <= "9") ||
        ch === "-" ||
        ch === "_" ||
        ch === ":" ||
        ch === "."
      ) {
        name += ch;
        this.advance(1);
        continue;
      }
      break;
    }
    return name;
  }

  private skipWhitespaceInTag(): void {
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        this.advance(1);
        continue;
      }
      break;
    }
  }

  private readAttributes(): Record<string, string> {
    const result: Record<string, string> = {};
    while (!this.eof()) {
      this.skipWhitespaceInTag();
      const ch = this.peek();
      if (ch === ">" || ch === "/") {
        return result;
      }
      const name = this.readName();
      if (!name) {
        throw new XmlSyntaxError("Invalid attribute name.", this.line);
      }
      this.skipWhitespaceInTag();
      if (this.peek() !== "=") {
        throw new XmlSyntaxError(
          `Expected '=' after attribute '${name}'.`,
          this.line
        );
      }
      this.advance(1);
      this.skipWhitespaceInTag();
      const value = this.readAttributeValue(name);
      if (Object.prototype.hasOwnProperty.call(result, name)) {
        throw new XmlSyntaxError(
          `Duplicate attribute '${name}'.`,
          this.line
        );
      }
      result[name] = value;
    }
    throw new XmlSyntaxError("Unterminated attribute list.", this.line);
  }

  private readAttributeValue(attribute: string): string {
    const quote = this.peek();
    if (quote !== '"' && quote !== "'") {
      throw new XmlSyntaxError(
        `Attribute '${attribute}' must be quoted.`,
        this.line
      );
    }
    this.advance(1);
    let value = "";
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === quote) {
        this.advance(1);
        return value;
      }
      if (ch === "<") {
        throw new XmlSyntaxError(
          `Attribute '${attribute}' must not contain '<'.`,
          this.line
        );
      }
      if (ch === "&") {
        value += this.readEntity();
        continue;
      }
      value += ch;
      this.advance(1);
    }
    throw new XmlSyntaxError(
      `Unterminated attribute value for '${attribute}'.`,
      this.line
    );
  }

  private readEntity(): string {
    const start = this.line;
    this.advance(1); // consume '&'
    let name = "";
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === ";") {
        this.advance(1);
        return this.resolveEntity(name, start);
      }
      if (name.length > 16) {
        throw new XmlSyntaxError("Invalid XML entity.", start);
      }
      name += ch;
      this.advance(1);
    }
    throw new XmlSyntaxError("Unterminated XML entity.", start);
  }

  private resolveEntity(name: string, lineNo: number): string {
    if (!name) {
      throw new XmlSyntaxError("Empty XML entity.", lineNo);
    }
    if (name.startsWith("#")) {
      const isHex = name[1] === "x" || name[1] === "X";
      const digits = isHex ? name.slice(2) : name.slice(1);
      const code = Number.parseInt(digits, isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
        throw new XmlSyntaxError(`Invalid numeric entity '&${name};'.`, lineNo);
      }
      return String.fromCodePoint(code);
    }
    const known = ENTITY_TABLE[name];
    if (known === undefined) {
      throw new XmlSyntaxError(
        `Unknown XML entity '&${name};'.`,
        lineNo
      );
    }
    return known;
  }
}

export function getElementText(element: XmlElement): string {
  let text = "";
  for (const child of element.children) {
    if (isElement(child)) {
      throw new XmlSyntaxError(
        `Element <${element.tag}> on line ${element.line} contains nested elements where text was expected.`,
        element.line
      );
    }
    text += child.value;
  }
  return text;
}

export function isElement(node: XmlNode): node is XmlElement {
  return (node as XmlElement).tag !== undefined;
}

export function findChildren(element: XmlElement, tag: string): XmlElement[] {
  const matches: XmlElement[] = [];
  for (const child of element.children) {
    if (isElement(child) && child.tag === tag) {
      matches.push(child);
    }
  }
  return matches;
}

export function findChild(element: XmlElement, tag: string): XmlElement | null {
  for (const child of element.children) {
    if (isElement(child) && child.tag === tag) {
      return child;
    }
  }
  return null;
}

export function listElementChildren(element: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  for (const child of element.children) {
    if (isElement(child)) {
      result.push(child);
    }
  }
  return result;
}
