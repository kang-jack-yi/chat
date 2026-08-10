import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import * as Y from "yjs";
import { exportCloudDocument } from "../../app/lib/document-export";
import { importCloudDocument } from "../../app/lib/document-import";

function stateWithText(value: string) {
  const document = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  text.insert(0, value);
  paragraph.insert(0, [text]);
  document.getXmlFragment("default").insert(0, [paragraph]);
  const state = Buffer.from(Y.encodeStateAsUpdate(document));
  document.destroy();
  return state;
}

function stateText(state: Buffer) {
  const document = new Y.Doc();
  Y.applyUpdate(document, new Uint8Array(state));
  const values: string[] = [];
  const visit = (node: any) => {
    if (node instanceof Y.XmlText) {
      values.push(node.toDelta().map((operation) => String(operation.insert || "")).join(""));
    }
    if (typeof node?.toArray === "function") node.toArray().forEach(visit);
  };
  visit(document.getXmlFragment("default"));
  document.destroy();
  return values.join("\n");
}

function editorDocument(state: Buffer) {
  const document = new Y.Doc();
  Y.applyUpdate(document, new Uint8Array(state));
  const toJson = (node: Y.XmlElement | Y.XmlText): Record<string, unknown> => {
    if (node instanceof Y.XmlText) {
      return { type: "text", text: node.toString() };
    }
    const attrs = node.getAttributes();
    return {
      type: node.nodeName,
      ...(Object.keys(attrs).length ? { attrs } : {}),
      content: node.toArray().map((child) => toJson(child as Y.XmlElement | Y.XmlText)),
    };
  };
  const result = {
    type: "doc",
    content: document.getXmlFragment("default").toArray()
      .map((node) => toJson(node as Y.XmlElement | Y.XmlText)),
  };
  document.destroy();
  return result;
}

describe("云文档本地文件导入", () => {
  it("支持导入 docx 文档", async () => {
    const source = exportCloudDocument("doc", stateWithText("导入 Word 正文")).data;
    const imported = await importCloudDocument("项目说明.docx", source);
    assert.equal(imported.type, "doc");
    assert.equal(imported.title, "项目说明");
    assert.match(stateText(imported.state), /导入 Word 正文/);
  });

  it("支持导入旧版 xls 表格", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["姓名", "部门"],
      ["林远", "产品中心"],
    ]), "成员");
    const source = XLSX.write(workbook, { type: "buffer", bookType: "xls" }) as Buffer;
    const imported = await importCloudDocument("成员名单.xls", source);
    assert.equal(imported.type, "sheet");
    assert.match(stateText(imported.state), /产品中心/);
    assert.deepEqual(editorDocument(imported.state).content?.[0], {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [{ type: "paragraph", content: [{ type: "text", text: "姓名" }] }],
            },
            {
              type: "tableHeader",
              content: [{ type: "paragraph", content: [{ type: "text", text: "部门" }] }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "林远" }] }],
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "产品中心" }] }],
            },
          ],
        },
      ],
    });
  });

  it("支持 CSV 和 Markdown 常用文本格式", async () => {
    const csv = await importCloudDocument("计划.csv", Buffer.from("任务,负责人\n联调,陈默"));
    const markdown = await importCloudDocument("说明.md", Buffer.from("# 一级标题\n正文"));
    assert.match(stateText(csv.state), /陈默/);
    assert.match(stateText(markdown.state), /一级标题/);
  });
});
