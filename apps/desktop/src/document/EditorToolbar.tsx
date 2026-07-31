import { Button, Divider, Dropdown, Select, Tooltip, type MenuProps } from "antd";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Columns3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Merge,
  Quote,
  Redo2,
  Rows3,
  Split,
  Strikethrough,
  Table2,
  Underline,
  Undo2,
} from "lucide-react";
import type { Editor } from "@tiptap/react";

interface EditorToolbarProps {
  editor: Editor;
  documentType: "doc" | "sheet";
  readOnly: boolean;
}

function ToolButton({
  title,
  active = false,
  disabled = false,
  onClick,
  icon,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip title={title}>
      <Button
        type={active ? "primary" : "text"}
        size="small"
        disabled={disabled}
        icon={icon}
        aria-label={title}
        onClick={onClick}
      />
    </Tooltip>
  );
}

export default function EditorToolbar({ editor, documentType, readOnly }: EditorToolbarProps) {
  const tableItems: MenuProps["items"] = [
    {
      key: "insert",
      label: "插入 6 × 4 表格",
      onClick: () => editor.chain().focus().insertTable({ rows: 6, cols: 4, withHeaderRow: true }).run(),
    },
    { type: "divider" },
    { key: "add-row-before", label: "在上方添加行", onClick: () => editor.chain().focus().addRowBefore().run() },
    { key: "add-row-after", label: "在下方添加行", onClick: () => editor.chain().focus().addRowAfter().run() },
    { key: "delete-row", label: "删除当前行", danger: true, onClick: () => editor.chain().focus().deleteRow().run() },
    { type: "divider" },
    { key: "add-column-before", label: "在左侧添加列", onClick: () => editor.chain().focus().addColumnBefore().run() },
    { key: "add-column-after", label: "在右侧添加列", onClick: () => editor.chain().focus().addColumnAfter().run() },
    { key: "delete-column", label: "删除当前列", danger: true, onClick: () => editor.chain().focus().deleteColumn().run() },
    { type: "divider" },
    { key: "delete-table", label: "删除表格", danger: true, onClick: () => editor.chain().focus().deleteTable().run() },
  ];
  const setLink = () => {
    const current = editor.getAttributes("link").href || "";
    const href = window.prompt("请输入链接地址", current);
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  };

  return (
    <div className="documentToolbar">
      <Select
        size="small"
        value={
          editor.isActive("heading", { level: 1 }) ? "h1"
            : editor.isActive("heading", { level: 2 }) ? "h2"
              : editor.isActive("heading", { level: 3 }) ? "h3"
                : "paragraph"
        }
        disabled={readOnly}
        className="documentToolbarHeading"
        onChange={(value) => {
          if (value === "paragraph") editor.chain().focus().setParagraph().run();
          else editor.chain().focus().toggleHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
        }}
        options={[
          { value: "paragraph", label: "正文" },
          { value: "h1", label: "标题 1" },
          { value: "h2", label: "标题 2" },
          { value: "h3", label: "标题 3" },
        ]}
      />
      <Divider type="vertical" />
      <ToolButton title="撤销" disabled={readOnly || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} icon={<Undo2 size={16} />} />
      <ToolButton title="重做" disabled={readOnly || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} icon={<Redo2 size={16} />} />
      <Divider type="vertical" />
      <ToolButton title="加粗" active={editor.isActive("bold")} disabled={readOnly} onClick={() => editor.chain().focus().toggleBold().run()} icon={<Bold size={16} />} />
      <ToolButton title="斜体" active={editor.isActive("italic")} disabled={readOnly} onClick={() => editor.chain().focus().toggleItalic().run()} icon={<Italic size={16} />} />
      <ToolButton title="下划线" active={editor.isActive("underline")} disabled={readOnly} onClick={() => editor.chain().focus().toggleUnderline().run()} icon={<Underline size={16} />} />
      <ToolButton title="删除线" active={editor.isActive("strike")} disabled={readOnly} onClick={() => editor.chain().focus().toggleStrike().run()} icon={<Strikethrough size={16} />} />
      <ToolButton title="高亮" active={editor.isActive("highlight")} disabled={readOnly} onClick={() => editor.chain().focus().toggleHighlight({ color: "#fff1a8" }).run()} icon={<Highlighter size={16} />} />
      <Divider type="vertical" />
      <ToolButton title="左对齐" active={editor.isActive({ textAlign: "left" })} disabled={readOnly} onClick={() => editor.chain().focus().setTextAlign("left").run()} icon={<AlignLeft size={16} />} />
      <ToolButton title="居中" active={editor.isActive({ textAlign: "center" })} disabled={readOnly} onClick={() => editor.chain().focus().setTextAlign("center").run()} icon={<AlignCenter size={16} />} />
      <ToolButton title="右对齐" active={editor.isActive({ textAlign: "right" })} disabled={readOnly} onClick={() => editor.chain().focus().setTextAlign("right").run()} icon={<AlignRight size={16} />} />
      <ToolButton title="两端对齐" active={editor.isActive({ textAlign: "justify" })} disabled={readOnly} onClick={() => editor.chain().focus().setTextAlign("justify").run()} icon={<AlignJustify size={16} />} />
      <Divider type="vertical" />
      <ToolButton title="无序列表" active={editor.isActive("bulletList")} disabled={readOnly} onClick={() => editor.chain().focus().toggleBulletList().run()} icon={<List size={16} />} />
      <ToolButton title="有序列表" active={editor.isActive("orderedList")} disabled={readOnly} onClick={() => editor.chain().focus().toggleOrderedList().run()} icon={<ListOrdered size={16} />} />
      <ToolButton title="引用" active={editor.isActive("blockquote")} disabled={readOnly} onClick={() => editor.chain().focus().toggleBlockquote().run()} icon={<Quote size={16} />} />
      <ToolButton title="链接" active={editor.isActive("link")} disabled={readOnly} onClick={setLink} icon={<Link2 size={16} />} />
      <Divider type="vertical" />
      <Dropdown menu={{ items: tableItems }} trigger={["click"]} disabled={readOnly}>
        <Button type={documentType === "sheet" ? "primary" : "text"} size="small" icon={<Table2 size={16} />}>
          表格
        </Button>
      </Dropdown>
      <ToolButton title="合并单元格" disabled={readOnly || !editor.can().mergeCells()} onClick={() => editor.chain().focus().mergeCells().run()} icon={<Merge size={16} />} />
      <ToolButton title="拆分单元格" disabled={readOnly || !editor.can().splitCell()} onClick={() => editor.chain().focus().splitCell().run()} icon={<Split size={16} />} />
      <ToolButton title="添加行" disabled={readOnly || !editor.can().addRowAfter()} onClick={() => editor.chain().focus().addRowAfter().run()} icon={<Rows3 size={16} />} />
      <ToolButton title="添加列" disabled={readOnly || !editor.can().addColumnAfter()} onClick={() => editor.chain().focus().addColumnAfter().run()} icon={<Columns3 size={16} />} />
    </div>
  );
}
