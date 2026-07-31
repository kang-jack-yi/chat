import { Button, Card, Descriptions, Tag, Typography } from "antd";
import { Building2, ContactRound, MessageCircleMore, Phone, ShieldCheck, UserRound } from "lucide-react";
import type { User } from "@chat/shared";
import Avatar from "../../../components/Avatar";
import EmptyState from "../../../components/EmptyState";
import { roleText } from "../../../utils/format";

export interface ContactDetailProps {
  user: User | null;
  currentUser: User;
  starting: boolean;
  onStartChat: (id: number) => void;
}

export default function ContactDetail({ user, currentUser, starting, onStartChat }: ContactDetailProps) {
  if (!user) {
    return <EmptyState icon={<ContactRound size={34} />} title="选择一位同事" text="查看企业成员资料并发起会话" />;
  }

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_72%_12%,#e8f2ff_0%,#f8fafc_30%,#f2f5fa_68%)] px-[clamp(20px,5vw,72px)] py-[clamp(28px,7vh,72px)] max-md:px-4 max-md:pt-[70px]">
      <div className="mx-auto w-full max-w-[820px]">
        <div className="mb-5">
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.5px] text-[var(--app-text)]">成员资料</h1>
        </div>
        <Card
          className="overflow-hidden !rounded-[22px] !border-white/80 shadow-[0_22px_60px_rgba(39,48,67,.11)]"
          styles={{ body: { padding: 0 } }}
        >
          <div className="relative h-[132px] overflow-hidden bg-[linear-gradient(125deg,#0958b8_0%,#1677ff_52%,#69a8ff_100%)]">
            <div className="absolute -top-20 right-10 size-48 rounded-full border border-white/18" />
            <div className="absolute top-7 right-28 size-28 rounded-full bg-white/8 blur-[1px]" />
            <div className="absolute -right-10 -bottom-20 size-56 rounded-full border border-white/14" />
          </div>
          <div className="px-8 pb-8 max-md:px-5">
            <div className="-mt-10 flex items-end justify-between gap-4 max-sm:items-start">
              <div className="flex items-end gap-5 max-sm:items-start">
                <div className="rounded-[25px] border-4 border-white bg-white shadow-[0_12px_28px_rgba(39,48,67,.18)]">
                  <Avatar text={user.avatar} large online={user.online} />
                </div>
                <div className="pb-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <h2 className="m-0 text-[26px] font-semibold tracking-[-0.4px] text-[var(--app-text)]">{user.name}</h2>
                    <Tag bordered={false} color={user.online ? "success" : "default"}>{user.online ? "在线" : "离线"}</Tag>
                  </div>
                  <p className="m-0 text-sm text-[var(--app-text-secondary)]">{user.title || "企业成员"} · {user.departmentName || "未分配部门"}</p>
                </div>
              </div>
              {user.id !== currentUser.id && (
                <Button
                  type="primary"
                  icon={<MessageCircleMore size={18} />}
                  loading={starting}
                  onClick={() => onStartChat(user.id)}
                  className="!shadow-[0_9px_22px_rgba(22,119,255,.22)] max-sm:!hidden"
                >
                  发消息
                </Button>
              )}
            </div>

            <div className="my-7 h-px bg-[var(--app-line)]" />

            <Descriptions
              column={{ xs: 1, sm: 2 }}
              colon={false}
              labelStyle={{ color: "var(--app-text-tertiary)", paddingBottom: 6 }}
              contentStyle={{ color: "var(--app-text)", fontWeight: 550, paddingBottom: 24 }}
              items={[
                {
                  key: "company",
                  label: <span className="flex items-center gap-1.5"><Building2 size={14} />企业</span>,
                  children: user.companyId === currentUser.companyId ? "当前企业" : "-",
                },
                {
                  key: "department",
                  label: <span className="flex items-center gap-1.5"><UserRound size={14} />所属部门</span>,
                  children: user.departmentName || "未分配部门",
                },
                {
                  key: "phone",
                  label: <span className="flex items-center gap-1.5"><Phone size={14} />手机号</span>,
                  children: <Typography.Text copyable>{user.phone}</Typography.Text>,
                },
                {
                  key: "role",
                  label: <span className="flex items-center gap-1.5"><ShieldCheck size={14} />企业角色</span>,
                  children: <Tag bordered={false} color={user.role === "owner" ? "gold" : user.role === "admin" ? "blue" : "default"}>{roleText(user.role)}</Tag>,
                },
              ]}
            />
            {user.id !== currentUser.id && (
              <Button
                type="primary"
                block
                icon={<MessageCircleMore size={18} />}
                loading={starting}
                onClick={() => onStartChat(user.id)}
                className="!hidden max-sm:!inline-flex"
              >
                发消息
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
