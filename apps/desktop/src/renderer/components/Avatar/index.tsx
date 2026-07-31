import { Avatar as AntAvatar, Badge } from "antd";
import { Users } from "lucide-react";

export interface AvatarProps {
  text: string;
  online?: boolean;
  group?: boolean;
  large?: boolean;
  active?: boolean;
}

export default function Avatar({ text, online, group, large, active }: AvatarProps) {
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
      style={{
        backgroundColor,
        color: active ? "#ffffff" : undefined,
        fontSize: large ? 28 : 15,
      }}
      className={
        large
          ? "!rounded-[21px] !shadow-[0_8px_22px_rgba(39,48,67,.15)]"
          : `!rounded-xl ${active ? "!shadow-[0_2px_8px_rgba(20,74,145,.22)]" : ""}`
      }
    >
      {!group && text?.slice(0, 1)}
    </AntAvatar>
  );
  return online ? <Badge dot color="#1ca777" offset={[-2, size - 3]}>{avatar}</Badge> : avatar;
}
