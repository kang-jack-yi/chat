import path from "node:path";
import { inflateRawSync } from "node:zlib";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import * as XLSX from "xlsx";
import * as Y from "yjs";

export interface ImportedCloudDocument {
  type: "doc" | "sheet";
  title: string;
  state: Buffer;
}

const maximumEntries = 2_000;
const maximumExpandedBytes = 100 * 1024 * 1024;

function decodeXml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function zipEntries(data: Buffer) {
  let endOffset = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65_557); offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("文件不是有效的 Office 文档");
  const count = data.readUInt16LE(endOffset + 10);
  if (count > maximumEntries) throw new Error("文档内容过于复杂");
  let offset = data.readUInt32LE(endOffset + 16);
  let expandedBytes = 0;
  const result = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    if (data.readUInt32LE(offset) !== 0x02014b50) throw new Error("Office 文档结构损坏");
    const compression = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const uncompressedSize = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42);
    const name = data.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replace(/\\/g, "/");
    if (name.includes("../") || name.startsWith("/")) throw new Error("Office 文档包含不安全路径");
    expandedBytes += uncompressedSize;
    if (expandedBytes > maximumExpandedBytes) throw new Error("文档解压后超过 100 MB");
    if (data.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Office 文档结构损坏");
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = data.subarray(start, start + compressedSize);
    if (!name.endsWith("/")) {
      if (compression === 0) result.set(name, Buffer.from(compressed));
      else if (compression === 8) result.set(name, inflateRawSync(compressed));
      else throw new Error("暂不支持该 Office 压缩格式");
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

function textElement(name: string, value: string) {
  const element = new Y.XmlElement(name);
  const text = new Y.XmlText();
  if (value) text.insert(0, value);
  element.insert(0, [text]);
  return element;
}

function stateFromNodes(nodes: Y.XmlElement[]) {
  const document = new Y.Doc();
  document.getXmlFragment("default").insert(0, nodes.length ? nodes : [textElement("paragraph", "")]);
  const state = Buffer.from(Y.encodeStateAsUpdate(document));
  document.destroy();
  return state;
}

function wordText(xml: string) {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function importDocx(data: Buffer) {
  const entries = zipEntries(data);
  const source = entries.get("word/document.xml")?.toString("utf8");
  if (!source) throw new Error("Word 文档缺少正文内容");
  const body = /<w:body[^>]*>([\s\S]*?)<\/w:body>/.exec(source)?.[1] || source;
  const nodes: Y.XmlElement[] = [];
  for (const block of body.matchAll(/<w:(p|tbl)\b[^>]*>[\s\S]*?<\/w:\1>/g)) {
    if (block[1] === "p") {
      const style = /<w:pStyle[^>]*w:val="Heading([1-6])"/i.exec(block[0]);
      const element = textElement(style ? "heading" : "paragraph", wordText(block[0]));
      if (style) element.setAttribute("level", String(Math.min(Number(style[1]), 2)));
      nodes.push(element);
      continue;
    }
    const table = new Y.XmlElement("table");
    const rows: Y.XmlElement[] = [];
    for (const rowSource of block[0].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
      const row = new Y.XmlElement("tableRow");
      const cells = [...rowSource[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)]
        .map((cell) => {
          const element = new Y.XmlElement(rows.length ? "tableCell" : "tableHeader");
          element.insert(0, [textElement("paragraph", wordText(cell[1]))]);
          return element;
        });
      if (cells.length) row.insert(0, cells);
      rows.push(row);
    }
    if (rows.length) table.insert(0, rows);
    nodes.push(table);
  }
  if (!nodes.length) throw new Error("Word 文档正文结构无法识别");
  return stateFromNodes(nodes);
}

function rowsToState(rows: string[][]) {
  const table = new Y.XmlElement("table");
  const rowNodes = (rows.length ? rows : [[""]]).map((values, rowIndex) => {
    const row = new Y.XmlElement("tableRow");
    const cells = (values.length ? values : [""]).map((value) => {
      const cell = new Y.XmlElement(rowIndex === 0 ? "tableHeader" : "tableCell");
      cell.insert(0, [textElement("paragraph", value)]);
      return cell;
    });
    row.insert(0, cells);
    return row;
  });
  table.insert(0, rowNodes);
  return stateFromNodes([table]);
}

function importSpreadsheet(data: Buffer) {
  const workbook = XLSX.read(data, {
    type: "buffer",
    cellDates: true,
    cellText: true,
    sheetRows: 10_000,
  });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) throw new Error("表格文件中没有可导入的工作表");
  const values = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true,
  });
  const rows = values.map((row) => row.map((value) => String(value ?? "")));
  const cellCount = rows.reduce((total, row) => total + row.length, 0);
  if (cellCount > 100_000) throw new Error("表格超过 100,000 个单元格，请拆分后导入");
  return rowsToState(rows);
}

function delimitedRows(source: string, delimiter: string) {
  const rows: string[][] = [[]];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      rows.at(-1)!.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      rows.at(-1)!.push(value);
      value = "";
      rows.push([]);
    } else value += character;
  }
  rows.at(-1)!.push(value);
  if (rows.length > 1 && rows.at(-1)!.length === 1 && rows.at(-1)![0] === "") rows.pop();
  return rows;
}

function plainTextState(source: string) {
  const nodes = source.replace(/^\uFEFF/, "").split(/\r?\n/)
    .map((line) => textElement("paragraph", line));
  return stateFromNodes(nodes);
}

function markdownState(source: string) {
  const nodes = source.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!heading) return textElement("paragraph", line);
    const element = textElement("heading", heading[2]);
    element.setAttribute("level", String(Math.min(heading[1].length, 2)));
    return element;
  });
  return stateFromNodes(nodes);
}

function rtfText(data: Buffer) {
  return data.toString("latin1")
    .replace(/\\u(-?\d+)\??/g, (_, value) => String.fromCharCode((Number(value) + 65_536) % 65_536))
    .replace(/\\'([0-9a-f]{2})/gi, (_, value) => String.fromCharCode(Number.parseInt(value, 16)))
    .replace(/\\(?:par|line)\b\s?/g, "\n")
    .replace(/\\tab\b\s?/g, "\t")
    .replace(/\\[{}\\]/g, (value) => value.slice(1))
    .replace(/\\[a-z]+-?\d*\s?/gi, "")
    .replace(/[{}]/g, "")
    .trim();
}

export async function importCloudDocument(filename: string, data: Buffer): Promise<ImportedCloudDocument> {
  const extension = path.extname(filename).toLowerCase();
  const title = path.basename(filename, extension).trim().slice(0, 120) || "导入文档";
  if ([".docx", ".docm", ".dotx"].includes(extension)) {
    try {
      return { type: "doc", title, state: importDocx(data) };
    } catch {
      const extracted = await mammoth.extractRawText({ buffer: data });
      return { type: "doc", title, state: plainTextState(extracted.value) };
    }
  }
  if (extension === ".doc") {
    const extracted = await new WordExtractor().extract(data);
    return { type: "doc", title, state: plainTextState(extracted.getBody()) };
  }
  if (extension === ".txt") return { type: "doc", title, state: plainTextState(data.toString("utf8")) };
  if (extension === ".md") return { type: "doc", title, state: markdownState(data.toString("utf8")) };
  if (extension === ".rtf") return { type: "doc", title, state: plainTextState(rtfText(data)) };
  if (extension === ".csv" || extension === ".tsv") {
    const source = data.toString("utf8").replace(/^\uFEFF/, "");
    return { type: "sheet", title, state: rowsToState(delimitedRows(source, extension === ".csv" ? "," : "\t")) };
  }
  if ([".xlsx", ".xls", ".xlsm", ".xlsb", ".ods"].includes(extension)) {
    return { type: "sheet", title, state: importSpreadsheet(data) };
  }
  throw new Error("仅支持常用 Word、Excel、TXT、Markdown、RTF、CSV 和 TSV 文件");
}
