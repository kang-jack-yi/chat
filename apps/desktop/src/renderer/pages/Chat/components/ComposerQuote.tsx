import { File, FileImage, MessageSquareReply, X } from "lucide-react";
import type { Message } from "@chat/shared";

export interface ComposerQuoteProps {
  quote: Message;
  onClear: () => void;
}

export default function ComposerQuote({ quote, onClear }: ComposerQuoteProps) {
  const quoteImage = quote.parts.find((part) => part.type === "image");
  const quoteFile = quote.parts.find((part) => part.type === "file");

  return (
    <div
      className="group flex min-h-[48px] items-center gap-2.5 rounded-md border-l-[3px] border-[var(--chat-primary)] bg-[var(--chat-header)] px-2.5 py-1.5"
      contentEditable={false}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[var(--app-surface)] text-[var(--app-primary)] shadow-sm">
        {quoteImage ? (
          <FileImage size={15} />
        ) : quoteFile ? (
          <File size={15} />
        ) : (
          <MessageSquareReply size={15} />
        )}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5 text-left">
        <strong className="truncate text-[11px] font-medium text-[var(--app-text-secondary)]">
          回复 {quote.senderName}
        </strong>
        <span className="truncate text-xs text-[var(--app-text-tertiary)]">
          {quote.summary}
        </span>
      </span>
      <button
        type="button"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--app-text-tertiary)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text)]"
        aria-label="取消回复"
        onClick={onClear}
      >
        <X size={13} />
      </button>
    </div>
  );
}
