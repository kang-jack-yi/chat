import * as Y from "yjs";

interface ZipEntry {
  name: string;
  data: Buffer;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return crc >>> 0;
});

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const value of data) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function xml(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function children(node: any): any[] {
  return typeof node?.toArray === "function" ? node.toArray() : [];
}

function nodeName(node: any) {
  return String(node?.nodeName || "").toLowerCase();
}

function xmlTextContent(node: Y.XmlText): string {
  return node.toDelta()
    .map((operation) => typeof operation.insert === "string" ? operation.insert : "")
    .join("");
}

function textContent(node: any): string {
  // XmlText#toString() serializes formatting attributes as tags such as
  // <bold> and <underline>. Office cell text needs the plain inserted text.
  if (node instanceof Y.XmlText) return xmlTextContent(node);
  return children(node).map(textContent).join("");
}

const wordContentWidth = 9026;

function paragraph(text: string, headingLevel = 0, compact = false, bold = false) {
  const spacing = compact
    ? `<w:spacing w:after="0" w:line="300" w:lineRule="auto"/>`
    : headingLevel
      ? `<w:spacing w:before="240" w:after="160" w:line="360" w:lineRule="auto"/>`
      : `<w:spacing w:after="160" w:line="360" w:lineRule="auto"/>`;
  const runProperties = headingLevel || bold
    ? `<w:rPr>${headingLevel || bold ? "<w:b/>" : ""}${headingLevel ? `<w:sz w:val="${headingLevel === 1 ? 32 : 26}"/><w:szCs w:val="${headingLevel === 1 ? 32 : 26}"/>` : ""}</w:rPr>`
    : "";
  return `<w:p><w:pPr>${spacing}</w:pPr><w:r>${runProperties}<w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

function wordTable(table: any) {
  const rows = children(table).filter((item) => nodeName(item) === "tablerow");
  const columnCount = Math.max(1, ...rows.map((row) => children(row)
    .filter((item) => ["tablecell", "tableheader"].includes(nodeName(item))).length));
  const columnWidth = Math.floor(wordContentWidth / columnCount);
  const grid = Array.from({ length: columnCount }, () => `<w:gridCol w:w="${columnWidth}"/>`).join("");
  const rowXml = rows.map((row) => {
    const cells = children(row).filter((item) => ["tablecell", "tableheader"].includes(nodeName(item)));
    return `<w:tr>${cells.map((cell) => {
      const isHeader = nodeName(cell) === "tableheader";
      const shading = isHeader ? `<w:shd w:val="clear" w:color="auto" w:fill="EEF3F8"/>` : "";
      return `<w:tc><w:tcPr><w:tcW w:w="${columnWidth}" w:type="dxa"/><w:vAlign w:val="center"/>${shading}</w:tcPr>${paragraph(textContent(cell), 0, true, isHeader)}</w:tc>`;
    }).join("")}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${wordContentWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B8C2CC"/><w:left w:val="single" w:sz="4" w:color="B8C2CC"/><w:bottom w:val="single" w:sz="4" w:color="B8C2CC"/><w:right w:val="single" w:sz="4" w:color="B8C2CC"/><w:insideH w:val="single" w:sz="4" w:color="D9E1E8"/><w:insideV w:val="single" w:sz="4" w:color="D9E1E8"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowXml}</w:tbl>`;
}

function wordBlocks(nodes: any[]): string {
  return nodes.map((node) => {
    const name = nodeName(node);
    if (name === "table") return wordTable(node);
    if (name === "heading") {
      const level = Number(node.getAttribute?.("level") || 1);
      return paragraph(textContent(node), Math.min(Math.max(level, 1), 2));
    }
    if (["bulletlist", "orderedlist", "listitem", "blockquote"].includes(name)) {
      return wordBlocks(children(node));
    }
    if (name === "horizontalrule") return paragraph("——————");
    return paragraph(textContent(node));
  }).join("");
}

function documentFile(fragment: Y.XmlFragment) {
  const body = wordBlocks(children(fragment)) || paragraph("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;
  return zip([
    { name: "[Content_Types].xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`) },
    { name: "_rels/.rels", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: "word/document.xml", data: Buffer.from(documentXml) },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: "word/styles.xml", data: Buffer.from(stylesXml) },
  ]);
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function sheetRows(fragment: Y.XmlFragment) {
  const result: string[][] = [];
  const visit = (nodes: any[]) => {
    for (const node of nodes) {
      if (nodeName(node) !== "table") {
        visit(children(node));
        continue;
      }
      if (result.length) result.push([]);
      for (const row of children(node).filter((item) => nodeName(item) === "tablerow")) {
        result.push(children(row)
          .filter((cell) => ["tablecell", "tableheader"].includes(nodeName(cell)))
          .map(textContent));
      }
    }
  };
  visit(children(fragment));
  return result.length ? result : [[textContent(fragment)]];
}

function spreadsheetFile(fragment: Y.XmlFragment) {
  const rows = sheetRows(fragment);
  const sheetData = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return zip([
    { name: "[Content_Types].xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`) },
    { name: "_rels/.rels", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`) },
  ]);
}

export function exportCloudDocument(type: "doc" | "sheet", state?: Buffer | null) {
  const ydoc = new Y.Doc();
  if (state?.length) Y.applyUpdate(ydoc, new Uint8Array(state));
  const fragment = ydoc.getXmlFragment("default");
  const data = type === "sheet" ? spreadsheetFile(fragment) : documentFile(fragment);
  ydoc.destroy();
  return {
    data,
    extension: type === "sheet" ? "xlsx" : "docx",
    mimeType: type === "sheet"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}
