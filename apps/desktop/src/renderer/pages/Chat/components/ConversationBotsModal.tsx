import { useEffect, useState } from "react";
import { Button, Input, Modal, Popconfirm, Spin, Tag, Tooltip, message } from "antd";
import { Bot, Copy, KeyRound, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import type { Conversation, ConversationBot } from "@chat/shared";
import { chatService } from "../../../services/chat";
import { writeClipboardText } from "../../../services/clipboard";

export interface ConversationBotsModalProps {
  open: boolean;
  conversation: Conversation;
  onClose: () => void;
}

const BOT_TONES = [
  { background: "#eaf3ff", color: "#2878d4" },
  { background: "#f1edff", color: "#7254d5" },
  { background: "#eaf9f2", color: "#168961" },
  { background: "#fff3e5", color: "#d4771a" },
];

export default function ConversationBotsModal({
  open,
  conversation,
  onClose,
}: ConversationBotsModalProps) {
  const [items, setItems] = useState<ConversationBot[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<ConversationBot>();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isGroup = conversation.type === "group";

  const load = async () => {
    setLoading(true);
    try {
      setItems(await chatService.bots(conversation.id));
    } catch (error: any) {
      message.error(error.message || "加载机器人失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void load();
    setEditing(undefined);
    setName("");
  }, [open, conversation.id]);

  const copyWebhook = async (bot: ConversationBot) => {
    try {
      const detail = await chatService.botDetail(conversation.id, bot.id);
      await writeClipboardText(detail.webhookUrl);
      message.success("Webhook 地址已复制");
    } catch (error: any) {
      message.error(error.message || "复制失败");
    }
  };

  const submit = async () => {
    const value = name.trim();
    if (!value) return;
    setSubmitting(true);
    try {
      if (editing) {
        await chatService.updateBot(conversation.id, editing.id, { name: value });
        message.success("机器人名称已更新");
      } else {
        await chatService.createBot(conversation.id, { name: value });
        message.success("机器人已创建，请及时复制并保存 Webhook 地址");
      }
      setEditing(undefined);
      setName("");
      await load();
    } catch (error: any) {
      message.error(error.message || "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  const resetBot = async (bot: ConversationBot) => {
    try {
      const result = await chatService.resetBot(conversation.id, bot.id);
      await writeClipboardText(result.webhookUrl);
      await load();
      message.success("Webhook 已重置，新地址已复制");
    } catch (error: any) {
      message.error(error.message || "重置失败");
    }
  };

  const removeBot = async (bot: ConversationBot) => {
    try {
      await chatService.removeBot(conversation.id, bot.id);
      await load();
      message.success("机器人已删除");
    } catch (error: any) {
      message.error(error.message || "删除失败");
    }
  };

  return (
    <Modal
      open={open}
      title={
        <div className="flex items-center gap-3 py-1">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--app-primary-soft)] text-[var(--app-primary)]">
            <Bot size={19} />
          </span>
          <span>
            <strong className="block text-base font-semibold text-[var(--app-text)]">
              {isGroup ? "群机器人" : "会话机器人"}
            </strong>
            <small className="mt-0.5 block text-xs font-normal text-[var(--app-text-secondary)]">
              通过 Webhook 向当前{isGroup ? "群聊" : "会话"}推送消息
            </small>
          </span>
        </div>
      }
      width={660}
      footer={null}
      onCancel={onClose}
      destroyOnHidden
      styles={{ body: { padding: "6px 22px 22px" } }}
    >
      <p className="mb-5 border-l-2 border-[var(--app-primary)] pl-3 text-xs leading-5 text-[var(--app-text-secondary)]">
        机器人不会作为联系人或会话成员出现。创建后可从机器人列表复制 Webhook 地址。
      </p>

      <section className="mb-5 rounded-xl border border-[var(--app-line)] bg-[var(--app-surface-soft)] p-4">
        <div className="mb-3 flex items-start gap-2.5">
          <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-lg bg-[var(--app-primary-soft)] text-[var(--app-primary)]">
            <Sparkles size={15} />
          </span>
          <span>
            <strong className="block text-sm font-medium text-[var(--app-text)]">
              {editing ? "编辑机器人" : "新建机器人"}
            </strong>
            <small className="mt-0.5 block text-xs text-[var(--app-text-tertiary)]">
              名称将展示在机器人发送的每条消息上
            </small>
          </span>
        </div>
        <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label className="min-w-0 flex-1 text-xs text-[var(--app-text-secondary)]">
            机器人名称
            <Input
              value={name}
              maxLength={40}
              placeholder="例如：部署通知助手"
              className="mt-1"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {editing && (
            <Button onClick={() => { setEditing(undefined); setName(""); }}>取消</Button>
          )}
          <Button
            type="primary"
            icon={editing ? <Pencil size={15} /> : <Plus size={15} />}
            loading={submitting}
            disabled={!name.trim()}
            htmlType="submit"
          >
            {editing ? "保存" : "创建机器人"}
          </Button>
        </form>
      </section>

      <div className="mb-3 flex items-center justify-between">
        <strong className="text-sm font-semibold text-[var(--app-text)]">已创建机器人</strong>
        <Tag bordered={false} className="m-0 rounded-full bg-[var(--app-primary-soft)] px-2 text-xs text-[var(--app-primary)]">
          {items.length} 个
        </Tag>
      </div>

      {loading ? (
        <div className="grid h-32 place-items-center"><Spin /></div>
      ) : (
        <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
          {!items.length && (
            <div className="grid h-32 place-items-center rounded-xl border border-dashed border-[var(--app-line)] bg-[var(--app-surface-soft)] text-sm text-[var(--app-text-tertiary)]">
              还没有机器人
            </div>
          )}
          {items.map((bot, index) => (
            <article key={bot.id} className="flex items-center gap-3 rounded-xl border border-[var(--app-line)] bg-[var(--app-surface)] px-3.5 py-3 hover:bg-[var(--app-surface-muted)]">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base font-medium" style={BOT_TONES[index % BOT_TONES.length]}>
                {bot.avatar || <Bot size={19} />}
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-medium text-[var(--app-text)]">{bot.name}</strong>
                <small className="mt-1 block truncate text-xs text-[var(--app-text-tertiary)]">
                  创建人：{bot.createdByName || "成员"} · 密钥尾号 {bot.secretTail}
                </small>
              </span>
              <div className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--app-surface-soft)] p-0.5">
                <Tooltip title="复制 Webhook 地址">
                  <Button aria-label="复制 Webhook 地址" type="text" size="small" icon={<Copy size={15} />} onClick={() => void copyWebhook(bot)} />
                </Tooltip>
                <Tooltip title="编辑名称">
                  <Button aria-label="编辑机器人名称" type="text" size="small" icon={<Pencil size={15} />} onClick={() => { setEditing(bot); setName(bot.name); }} />
                </Tooltip>
                <Popconfirm title="重置后旧地址会立即失效" description="确认重置这个 Webhook 地址吗？" okText="重置" cancelText="取消" onConfirm={() => resetBot(bot)}>
                  <Tooltip title="重置地址"><Button aria-label="重置 Webhook 地址" type="text" size="small" icon={<KeyRound size={15} />} /></Tooltip>
                </Popconfirm>
                <Popconfirm title="确定删除这个机器人？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => removeBot(bot)}>
                  <Tooltip title="删除"><Button aria-label="删除机器人" danger type="text" size="small" icon={<Trash2 size={15} />} /></Tooltip>
                </Popconfirm>
              </div>
            </article>
          ))}
        </div>
      )}
    </Modal>
  );
}
