import * as Y from "yjs";

/** 从文档及表格的协作状态提取纯文本，用于全文搜索和版本预览。 */
export function documentText(state?: Buffer | null): string {
  const document = new Y.Doc();
  try {
    if (state?.length) Y.applyUpdate(document, state);
    return textFromNode(document.getXmlFragment("default")).trim();
  } finally {
    document.destroy();
  }
}

/** 递归读取格式化文本，保留段落和单元格间隔，不输出 HTML 标签。 */
function textFromNode(
  node: Y.XmlFragment | Y.XmlElement | Y.XmlText | Y.XmlHook,
): string {
  if (node instanceof Y.XmlText) {
    return node
      .toDelta()
      .map((operation) =>
        typeof operation.insert === "string" ? operation.insert : "",
      )
      .join("");
  }
  if (node instanceof Y.XmlHook) return "";
  return node
    .toArray()
    .map((child) => textFromNode(child))
    .join("\n");
}
