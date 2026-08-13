import { Avatar as AntAvatar, Badge } from "antd";
import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { authService } from "../../services/auth";

export interface AvatarProps {
  text: string;
  online?: boolean;
  group?: boolean;
  large?: boolean;
  active?: boolean;
  src?: string;
}

export default function Avatar({ text, online, group, large, active, src }: AvatarProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string>();
  useEffect(() => {
    if (!src) {
      setResolvedSrc(undefined);
      return;
    }
    let objectUrl = "";
    let canceled = false;
    void authService.avatarBlob(src).then((blob) => {
      if (canceled) return;
      objectUrl = URL.createObjectURL(blob);
      setResolvedSrc(objectUrl);
    }).catch(() => setResolvedSrc(undefined));
    return () => {
      canceled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  const colors = ["#4b8fea", "#45aa91", "#73879b", "#e5a64d", "#7f73df", "#e97369"];
  const backgroundColor = active
    ? "#256fc8"
    : group
      ? "#7481a4"
      : colors[(text?.charCodeAt(0) || 0) % colors.length];
  const size = large ? 76 : 40;
  const avatar = (
    <AntAvatar
      shape="square"
      size={size}
      icon={group ? <Users size={large ? 28 : 18} /> : undefined}
      src={resolvedSrc}
      style={{
        backgroundColor,
        color: active ? "#ffffff" : undefined,
        fontSize: large ? 28 : 15,
      }}
      className={
        large
          ? "!rounded-2xl !shadow-lg"
          : `!rounded-xl ${active ? "!shadow-sm" : ""}`
      }
    >
      {!group && text?.slice(0, 1)}
    </AntAvatar>
  );
  return online ? <Badge dot color="#1ca777" offset={[-2, size - 3]}>{avatar}</Badge> : avatar;
}
