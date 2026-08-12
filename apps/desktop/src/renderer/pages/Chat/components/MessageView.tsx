import MessageBubble, { type MessageBubbleProps } from "./MessageBubble";
import SystemMessage from "./SystemMessage";

export interface MessageViewProps extends MessageBubbleProps {
  currentUserId?: number;
  compactSystem?: boolean;
}

/**
 * Single rendering seam for every persisted message kind.
 * Pages own surrounding metadata and layout; message visuals stay here.
 */
export default function MessageView({
  message,
  currentUserId,
  compactSystem,
  ...bubbleProps
}: MessageViewProps) {
  if (message.kind === "system") {
    return (
      <SystemMessage
        message={message}
        currentUserId={currentUserId}
        compact={compactSystem}
      />
    );
  }
  return <MessageBubble message={message} {...bubbleProps} />;
}
