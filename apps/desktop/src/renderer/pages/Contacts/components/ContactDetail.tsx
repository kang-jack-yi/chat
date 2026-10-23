import { Button, Card, Descriptions, Tag, Typography } from "antd";
import {
  Building2,
  ContactRound,
  MessageCircleMore,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";
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

/** 展示成员身份与联系方式，并保留复制手机号和发起会话能力。 */
export default function ContactDetail({
  user,
  currentUser,
  starting,
  onStartChat,
}: ContactDetailProps) {
  if (!user) {
    return (
      <EmptyState
        icon={<ContactRound size={34} />}
        title="选择一位同事"
        text="查看企业成员资料并发起会话"
      />
    );
  }

  return (
    <div className="workspace-page contacts-profile">
      <div className="mx-auto w-full max-w-3xl">
        <header className="workspace-page-header">
          <div className="workspace-page-heading">
            <span className="workspace-eyebrow">企业通讯录</span>
            <h1 className="workspace-page-title">成员资料</h1>
            <p className="workspace-page-description">了解同事，开启高效协作</p>
          </div>
        </header>
        <Card
          className="contacts-profile-card"
          styles={{ body: { padding: 0 } }}
        >
          <div className="contacts-profile-content">
            <div className="contacts-profile-intro">
              <div className="contacts-profile-identity">
                <div className="contacts-profile-avatar">
                  <Avatar
                    text={user.avatar}
                    src={user.avatarUrl}
                    large
                    online={user.online}
                  />
                </div>
                <div className="pb-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <h2 className="m-0 text-2xl font-semibold tracking-[-0.4px] text-[var(--app-text)]">
                      {user.name}
                    </h2>
                    <Tag
                      bordered={false}
                      color={user.online ? "success" : "default"}
                    >
                      {user.online ? "在线" : "离线"}
                    </Tag>
                  </div>
                  <p className="m-0 text-sm text-[var(--app-text-secondary)]">
                    {user.title || "企业成员"} ·{" "}
                    {user.departmentName || "未分配部门"}
                  </p>
                </div>
              </div>
              {user.id !== currentUser.id && (
                <Button
                  type="primary"
                  icon={<MessageCircleMore size={18} />}
                  loading={starting}
                  onClick={() => onStartChat(user.id)}
                  className="max-sm:!hidden"
                >
                  发消息
                </Button>
              )}
            </div>

            <div className="contacts-profile-divider" />

            <Descriptions
              layout="vertical"
              column={{ xs: 1, sm: 2 }}
              colon={false}
              labelStyle={{
                color: "var(--app-text-secondary)",
                paddingBottom: 6,
              }}
              contentStyle={{
                color: "var(--app-text)",
                fontWeight: 550,
                paddingBottom: 24,
              }}
              items={[
                {
                  key: "company",
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Building2 size={14} />
                      企业
                    </span>
                  ),
                  children:
                    user.companyId === currentUser.companyId ? "当前企业" : "-",
                },
                {
                  key: "department",
                  label: (
                    <span className="flex items-center gap-1.5">
                      <UserRound size={14} />
                      所属部门
                    </span>
                  ),
                  children: user.departmentName || "未分配部门",
                },
                {
                  key: "phone",
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Phone size={14} />
                      手机号
                    </span>
                  ),
                  children: (
                    <Typography.Text copyable>{user.phone}</Typography.Text>
                  ),
                },
                {
                  key: "role",
                  label: (
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck size={14} />
                      企业角色
                    </span>
                  ),
                  children: (
                    <Tag
                      bordered={false}
                      color={
                        user.role === "owner"
                          ? "gold"
                          : user.role === "admin"
                            ? "blue"
                            : "default"
                      }
                    >
                      {roleText(user.role)}
                    </Tag>
                  ),
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
