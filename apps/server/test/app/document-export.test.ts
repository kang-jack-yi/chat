import assert from "node:assert/strict";
import * as Y from "yjs";
import { exportCloudDocument } from "../../app/lib/document-export";

function stateWith(root: Y.XmlElement) {
  const ydoc = new Y.Doc();
  ydoc.getXmlFragment("default").insert(0, [root]);
  const state = Buffer.from(Y.encodeStateAsUpdate(ydoc));
  ydoc.destroy();
  return state;
}

function textElement(name: string, value: string) {
  const element = new Y.XmlElement(name);
  const text = new Y.XmlText();
  text.insert(0, value);
  element.insert(0, [text]);
  return element;
}

describe("云文档 Office 导出", () => {
  it("将普通文档导出为真实 docx 文件", () => {
    const exported = exportCloudDocument("doc", stateWith(textElement("paragraph", "测试正文")));
    assert.equal(exported.extension, "docx");
    assert.equal(exported.data.subarray(0, 4).toString("hex"), "504b0304");
    assert.ok(exported.data.includes(Buffer.from("word/document.xml")));
    assert.ok(exported.data.includes(Buffer.from("测试正文")));
    assert.ok(exported.data.includes(Buffer.from('w:spacing w:after="160" w:line="360"')));
    assert.ok(exported.data.includes(Buffer.from("word/styles.xml")));
  });

  it("导出 Word 表格时铺满正文宽度并设置等宽列", () => {
    const table = new Y.XmlElement("table");
    const row = new Y.XmlElement("tablerow");
    const first = new Y.XmlElement("tableheader");
    const second = new Y.XmlElement("tableheader");
    first.insert(0, [textElement("paragraph", "第一列")]);
    second.insert(0, [textElement("paragraph", "第二列")]);
    row.insert(0, [first, second]);
    table.insert(0, [row]);

    const exported = exportCloudDocument("doc", stateWith(table));

    assert.ok(exported.data.includes(Buffer.from('<w:tblW w:w="9026" w:type="dxa"/>')));
    assert.ok(exported.data.includes(Buffer.from('<w:tblLayout w:type="fixed"/>')));
    assert.ok(exported.data.includes(Buffer.from('<w:gridCol w:w="4513"/>')));
  });

  it("将在线表格导出为真实 xlsx 工作簿", () => {
    const table = new Y.XmlElement("table");
    const row = new Y.XmlElement("tablerow");
    const cell = new Y.XmlElement("tablecell");
    cell.insert(0, [textElement("paragraph", "A1 内容")]);
    row.insert(0, [cell]);
    table.insert(0, [row]);
    const exported = exportCloudDocument("sheet", stateWith(table));
    assert.equal(exported.extension, "xlsx");
    assert.equal(exported.data.subarray(0, 4).toString("hex"), "504b0304");
    assert.ok(exported.data.includes(Buffer.from("xl/worksheets/sheet1.xml")));
    assert.ok(exported.data.includes(Buffer.from("A1 内容")));
  });

  it("导出表格时不将富文本格式标签写入单元格", () => {
    const table = new Y.XmlElement("table");
    const row = new Y.XmlElement("tablerow");
    const cell = new Y.XmlElement("tablecell");
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, "普通");
    text.insert(2, "加粗", { bold: true });
    text.insert(4, "下划线", { underline: true });
    paragraph.insert(0, [text]);
    cell.insert(0, [paragraph]);
    row.insert(0, [cell]);
    table.insert(0, [row]);

    const exported = exportCloudDocument("sheet", stateWith(table));

    assert.ok(exported.data.includes(Buffer.from("普通加粗下划线")));
    assert.ok(!exported.data.includes(Buffer.from("&lt;bold&gt;")));
    assert.ok(!exported.data.includes(Buffer.from("&lt;underline&gt;")));
  });
});
