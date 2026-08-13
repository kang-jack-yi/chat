import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Form,
  Input,
  Modal,
  Radio,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Upload,
  message,
} from "antd";
import type { User } from "@chat/shared";
import {
  Brush,
  Check,
  ChevronRight,
  CircleUserRound,
  Database,
  FolderOpen,
  Info,
  Keyboard,
  Laptop,
  MessageSquareText,
  MonitorCog,
  Moon,
  Server,
  Settings2,
  ShieldCheck,
  Sun,
  Trash2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Avatar from "../Avatar";
import { useAppStore } from "../../stores/app-store";
import { useUserStore } from "../../stores/user-store";
import { authService } from "../../services/auth";
import { queryKeys } from "../../constants/query-keys";
import { useDesktopPreferences } from "../../hooks/useDesktopPreferences";
import { localDatabase } from "../../services/local-database";
import { prepareDesktopSession } from "../../services/desktop-session";
import styles from "./style.module.less";

type SectionKey = "profile" | "chat" | "appearance" | "general";

const sections: Array<{
  key: SectionKey;
  label: string;
  description: string;
  icon: typeof CircleUserRound;
  tone: string;
}> = [
  { key: "profile", label: "个人资料", description: "头像、状态与个人信息", icon: CircleUserRound, tone: "blue" },
  { key: "chat", label: "聊天设置", description: "发送、显示与截图偏好", icon: MessageSquareText, tone: "violet" },
  { key: "appearance", label: "外观设置", description: "主题、缩放与动态效果", icon: Brush, tone: "amber" },
  { key: "general", label: "通用设置", description: "启动、存储与客户端信息", icon: Settings2, tone: "green" },
];

const presenceOptions = [
  { value: "available", label: "在线", color: "#1aa981" },
  { value: "busy", label: "忙碌", color: "#ef9f27" },
  { value: "dnd", label: "请勿打扰", color: "#e35d6a" },
  { value: "away", label: "离开", color: "#98a2b3" },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

type StatusDuration = "never" | "1h" | "4h" | "today";

export function inferStatusDuration(expiresAt?: string | null): StatusDuration {
  if (!expiresAt) return "never";
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 90 * 60 * 1000) return "1h";
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 0, 0);
  if (Math.abs(new Date(expiresAt).getTime() - tomorrow.getTime()) < 60_000) return "today";
  return "4h";
}

export function resolveStatusExpiry(duration: StatusDuration) {
  if (duration === "never") return null;
  if (duration === "today") {
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    return tomorrow.toISOString();
  }
  return new Date(Date.now() + (duration === "1h" ? 1 : 4) * 60 * 60 * 1000).toISOString();
}

function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.settingsRow}>
      <div className={styles.rowCopy}>
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

function ProfileSection() {
  const queryClient = useQueryClient();
  const session = useUserStore((state) => state.session)!;
  const setCurrentUser = useUserStore((state) => state.setCurrentUser);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const user = session.user;

  useEffect(() => {
    form.setFieldsValue({
      name: user.name,
      email: user.email,
      bio: user.bio,
      presenceStatus: user.presenceStatus || "available",
      statusText: user.statusText,
      statusDuration: inferStatusDuration(user.statusExpiresAt),
    });
  }, [form, user]);

  async function saveProfile(values: Record<string, string>) {
    setSaving(true);
    try {
      const statusExpiresAt = resolveStatusExpiry(values.statusDuration as StatusDuration);
      const next = await authService.updateProfile({
        name: values.name,
        email: values.email,
        bio: values.bio,
        presenceStatus: values.presenceStatus as User["presenceStatus"],
        statusText: values.statusText,
        statusExpiresAt,
      });
      setCurrentUser(next);
      queryClient.setQueryData<User[]>(queryKeys.users, (old) =>
        old?.map((item) => item.id === next.id ? next : item));
      message.success("个人资料已保存");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "个人资料保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    setUploading(true);
    try {
      const next = await authService.uploadAvatar(file);
      setCurrentUser(next);
      queryClient.setQueryData<User[]>(queryKeys.users, (old) =>
        old?.map((item) => item.id === next.id ? next : item));
      message.success("头像已更新");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "头像上传失败");
    } finally {
      setUploading(false);
    }
    return false;
  }

  return (
    <div className={styles.sectionContent}>
      <div className={styles.sectionHeading}>
        <div><h2>个人资料</h2><p>让同事更容易认识你，也可以设置当前工作状态。</p></div>
        <Tag bordered={false} color="blue">企业成员</Tag>
      </div>
      <section className={`${styles.card} ${styles.profileHero}`}>
        <div className={styles.avatarWrap}>
          <Avatar text={user.avatar} src={user.avatarUrl} large online={user.online} />
        </div>
        <div className={styles.profileIdentity}>
          <strong>{user.name}</strong>
          <span>{user.title || "企业成员"} · {user.departmentName || "未分配部门"}</span>
          <Upload
            accept="image/png,image/jpeg,image/webp"
            showUploadList={false}
            beforeUpload={(file) => {
              if (file.size > 2 * 1024 * 1024) {
                message.error("头像不能超过 2 MB");
                return Upload.LIST_IGNORE;
              }
              void uploadAvatar(file);
              return false;
            }}
          >
            <Button loading={uploading}>更换头像</Button>
          </Upload>
        </div>
        <div className={styles.identityMeta}>
          <span><ShieldCheck size={14} />{user.role === "owner" ? "企业所有者" : user.role === "admin" ? "管理员" : "成员"}</span>
          <span>{user.phone}</span>
        </div>
      </section>
      <Form form={form} layout="vertical" onFinish={saveProfile} requiredMark={false}>
        <section className={styles.card}>
          <div className={styles.cardTitle}>基础信息</div>
          <div className={styles.formGrid}>
            <Form.Item name="name" label="姓名" rules={[{ required: true, message: "请输入姓名" }, { max: 40 }]}>
              <Input placeholder="你的姓名" />
            </Form.Item>
            <Form.Item name="email" label="工作邮箱" rules={[{ type: "email", message: "邮箱格式不正确" }, { max: 120 }]}>
              <Input placeholder="name@company.com" />
            </Form.Item>
            <div className={styles.readonlyField}><span>部门</span><strong>{user.departmentName || "未分配部门"}</strong></div>
            <div className={styles.readonlyField}><span>职位</span><strong>{user.title || "未设置"}</strong></div>
          </div>
          <Form.Item name="bio" label="个人简介" rules={[{ max: 300 }]}>
            <Input.TextArea rows={3} showCount maxLength={300} placeholder="介绍你的职责、擅长领域或协作偏好" />
          </Form.Item>
        </section>
        <section className={styles.card}>
          <div className={styles.cardTitle}>工作状态</div>
          <div className={styles.formGrid}>
            <Form.Item name="presenceStatus" label="当前状态">
              <Select options={presenceOptions.map((item) => ({
                value: item.value,
                label: <span className={styles.statusOption}><i style={{ background: item.color }} />{item.label}</span>,
              }))} />
            </Form.Item>
            <Form.Item name="statusDuration" label="状态有效期">
              <Select options={[
                { value: "never", label: "持续有效" },
                { value: "1h", label: "1 小时" },
                { value: "4h", label: "4 小时" },
                { value: "today", label: "今天" },
              ]} />
            </Form.Item>
          </div>
          <Form.Item name="statusText" label="状态说明" rules={[{ max: 80 }]}>
            <Input showCount maxLength={80} placeholder="例如：正在专注处理季度方案" />
          </Form.Item>
        </section>
        <div className={styles.saveBar}><Button type="primary" htmlType="submit" loading={saving}>保存更改</Button></div>
      </Form>
    </div>
  );
}

function ChatSection() {
  const { preferences, update } = useDesktopPreferences();
  const [hideMainWindow, setHideMainWindow] = useState(true);
  useEffect(() => {
    void window.desktop?.screenshot.getPreferences().then((value) => setHideMainWindow(value.hideMainWindow));
  }, []);
  if (!preferences) return null;
  return (
    <div className={styles.sectionContent}>
      <div className={styles.sectionHeading}><div><h2>聊天设置</h2><p>调整发送方式和消息阅读体验，仅影响当前账号。</p></div></div>
      <section className={styles.card}>
        <div className={styles.cardTitle}><Keyboard size={16} /> 输入与发送</div>
        <SettingsRow title="发送消息快捷键" description="换行快捷键会自动使用另一组按键">
          <Select
            value={preferences.chat.sendKey}
            className={styles.mediumControl}
            options={[{ value: "enter", label: "Enter 发送" }, { value: "ctrlEnter", label: "Ctrl + Enter 发送" }]}
            onChange={(sendKey) => void update({ chat: { sendKey } })}
          />
        </SettingsRow>
        <SettingsRow title="隐藏聊天窗口截图" description="截图前短暂隐藏主窗口，避免截入聊天内容">
          <Switch
            checked={hideMainWindow}
            onChange={(checked) => {
              setHideMainWindow(checked);
              void window.desktop?.screenshot.setPreferences({ hideMainWindow: checked });
            }}
          />
        </SettingsRow>
      </section>
      <section className={styles.card}>
        <div className={styles.cardTitle}><MessageSquareText size={16} /> 消息显示</div>
        <SettingsRow title="消息字号" description="只调整聊天消息正文，不影响系统界面">
          <Segmented
            value={preferences.chat.fontSize}
            options={[13, 14, 15, 16].map((value) => ({ value, label: `${value}px` }))}
            onChange={(fontSize) => void update({ chat: { fontSize: fontSize as 13 | 14 | 15 | 16 } })}
          />
        </SettingsRow>
        <SettingsRow title="消息密度" description="紧凑模式适合在一屏内查看更多消息">
          <Radio.Group
            value={preferences.chat.density}
            optionType="button"
            buttonStyle="solid"
            options={[{ value: "comfortable", label: "舒适" }, { value: "compact", label: "紧凑" }]}
            onChange={(event) => void update({ chat: { density: event.target.value } })}
          />
        </SettingsRow>
      </section>
    </div>
  );
}

function AppearanceSection() {
  const { preferences, update } = useDesktopPreferences();
  if (!preferences) return null;
  const themes = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
    { value: "system", label: "跟随系统", icon: MonitorCog },
  ] as const;
  return (
    <div className={styles.sectionContent}>
      <div className={styles.sectionHeading}><div><h2>外观设置</h2><p>选择适合当前环境的显示方式，修改会立即生效。</p></div></div>
      <section className={styles.card}>
        <div className={styles.cardTitle}><Brush size={16} /> 主题</div>
        <div className={styles.themeGrid}>
          {themes.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-label={`使用${label}主题`}
              aria-pressed={preferences.appearance.theme === value}
              className={`${styles.themeChoice} ${preferences.appearance.theme === value ? styles.selected : ""}`}
              onClick={() => void update({ appearance: { theme: value } })}
            >
              <span className={`${styles.themePreview} ${styles[value]}`}><Icon size={20} /></span>
              <span>{label}</span>
              {preferences.appearance.theme === value && <Check size={15} />}
            </button>
          ))}
        </div>
      </section>
      <section className={styles.card}>
        <div className={styles.cardTitle}><Laptop size={16} /> 显示</div>
        <SettingsRow title="界面缩放" description="同步应用到主窗口、聊天记录和云文档窗口">
          <Segmented
            value={preferences.appearance.zoom}
            options={[0.9, 1, 1.1, 1.25].map((value) => ({ value, label: `${value * 100}%` }))}
            onChange={(zoom) => void update({ appearance: { zoom: zoom as 0.9 | 1 | 1.1 | 1.25 } })}
          />
        </SettingsRow>
        <SettingsRow title="减少动态效果" description="关闭不必要的过渡和动画，降低视觉干扰">
          <Switch
            checked={preferences.appearance.reducedMotion}
            onChange={(reducedMotion) => void update({ appearance: { reducedMotion } })}
          />
        </SettingsRow>
      </section>
    </div>
  );
}

function GeneralSection() {
  const { preferences, update } = useDesktopPreferences();
  const session = useUserStore((state) => state.session)!;
  const setServerSettingsOpen = useAppStore((state) => state.setServerSettingsOpen);
  const queryClient = useQueryClient();
  const [version, setVersion] = useState("");
  const [cacheBytes, setCacheBytes] = useState(0);
  const [cacheCount, setCacheCount] = useState(0);
  const [clearingCache, setClearingCache] = useState(false);
  const [clearingData, setClearingData] = useState(false);
  const refreshStats = () => window.desktop?.preferences.cacheStats().then((stats) => {
    setCacheBytes(stats.attachmentCacheBytes);
    setCacheCount(stats.attachmentFileCount);
  });
  useEffect(() => {
    void window.desktop?.app.getVersion().then(setVersion);
    void refreshStats();
  }, []);
  if (!preferences) return null;

  async function clearAllLocalData() {
    setClearingData(true);
    try {
      await localDatabase.clear();
      await prepareDesktopSession(session);
      queryClient.clear();
      message.success("本地数据已重新同步");
      await refreshStats();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "清除本地数据失败");
    } finally {
      setClearingData(false);
    }
  }

  return (
    <div className={styles.sectionContent}>
      <div className={styles.sectionHeading}><div><h2>通用设置</h2><p>管理客户端启动、下载位置与本机存储。</p></div></div>
      <section className={styles.card}>
        <div className={styles.cardTitle}><Laptop size={16} /> 客户端行为</div>
        <SettingsRow title="开机自动启动" description="登录 Windows 后自动启动企业协作">
          <Switch checked={preferences.general.launchAtLogin} onChange={(launchAtLogin) => void update({ general: { launchAtLogin } })} />
        </SettingsRow>
        <SettingsRow title="关闭窗口时最小化到托盘" description="关闭后继续接收消息和同步数据">
          <Switch checked={preferences.general.closeToTray} onChange={(closeToTray) => void update({ general: { closeToTray } })} />
        </SettingsRow>
        <SettingsRow title="默认下载位置" description={preferences.general.downloadDirectory || "每次下载时询问保存位置"}>
          <Space>
            {preferences.general.downloadDirectory && <Button onClick={() => void update({ general: { downloadDirectory: null } })}>恢复询问</Button>}
            <Button icon={<FolderOpen size={15} />} onClick={async () => {
              const directory = await window.desktop?.preferences.chooseDownloadDirectory();
              if (directory) await update({ general: { downloadDirectory: directory } });
            }}>选择文件夹</Button>
          </Space>
        </SettingsRow>
      </section>
      <section className={styles.card}>
        <div className={styles.cardTitle}><Database size={16} /> 本机存储</div>
        <SettingsRow title="附件缓存" description={`${formatBytes(cacheBytes)} · ${cacheCount} 个文件，不包含草稿和待发送消息`}>
          <Button loading={clearingCache} onClick={async () => {
            setClearingCache(true);
            try {
              const stats = await window.desktop?.preferences.clearAttachmentCache();
              setCacheBytes(stats?.attachmentCacheBytes || 0);
              setCacheCount(stats?.attachmentFileCount || 0);
              message.success("附件缓存已清理");
            } finally { setClearingCache(false); }
          }}>清理缓存</Button>
        </SettingsRow>
        <SettingsRow title="全部本地数据" description="删除此账号的本地消息副本、草稿与附件，随后从服务器重新同步">
          <Button danger loading={clearingData} icon={<Trash2 size={15} />} onClick={() => Modal.confirm({
            title: "清除全部本地数据？",
            content: "未发送草稿和附件也会被删除。服务端消息不会受到影响。",
            okText: "清除并重新同步",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: clearAllLocalData,
          })}>清除本地数据</Button>
        </SettingsRow>
      </section>
      <section className={styles.card}>
        <div className={styles.cardTitle}><Info size={16} /> 关于</div>
        <SettingsRow title="服务器设置" description="查看或切换当前企业协作服务器">
          <Button icon={<Server size={15} />} onClick={() => setServerSettingsOpen(true)}>打开设置</Button>
        </SettingsRow>
        <SettingsRow title="运行日志" description="打开日志目录，便于排查客户端问题">
          <Button onClick={() => void window.desktop?.preferences.openLogs()}>打开日志目录</Button>
        </SettingsRow>
        <SettingsRow title="企业协作桌面端" description={`版本 ${version || "-"}`}>
          <Tag bordered={false}>Windows x64</Tag>
        </SettingsRow>
      </section>
    </div>
  );
}

export default function SettingsCenterModal() {
  const open = useAppStore((state) => state.settingsCenterOpen);
  const setOpen = useAppStore((state) => state.setSettingsCenterOpen);
  const [active, setActive] = useState<SectionKey>("profile");
  const mainRef = useRef<HTMLElement>(null);
  const section = useMemo(() => sections.find((item) => item.key === active)!, [active]);
  useEffect(() => {
    mainRef.current?.querySelector<HTMLElement>(`.${styles.sectionContent}`)?.scrollTo({ top: 0 });
  }, [active]);
  return (
    <Modal
      open={open}
      width={860}
      centered
      destroyOnHidden={false}
      title={null}
      footer={null}
      className={styles.modal}
      onCancel={() => setOpen(false)}
      styles={{ body: { padding: 0 } }}
    >
      <div className={styles.shell}>
        <aside className={styles.navigation}>
          <div className={styles.brand}><span><Settings2 size={18} /></span><div><strong>设置</strong><small>Enterprise Chat</small></div></div>
          <nav>
            {sections.map(({ key, label, description, icon: Icon, tone }) => (
              <button
                key={key}
                type="button"
                aria-current={active === key ? "page" : undefined}
                className={active === key ? styles.active : ""}
                onClick={() => setActive(key)}
              >
                <span className={`${styles.navIcon} ${styles[tone]}`}><Icon size={17} /></span>
                <span><strong>{label}</strong><small>{description}</small></span>
                <ChevronRight size={15} />
              </button>
            ))}
          </nav>
          <div className={styles.navHint}><ShieldCheck size={15} /><span>企业数据按账号与服务器隔离保存</span></div>
        </aside>
        <main ref={mainRef} className={styles.main} aria-label={section.label}>
          {active === "profile" && <ProfileSection />}
          {active === "chat" && <ChatSection />}
          {active === "appearance" && <AppearanceSection />}
          {active === "general" && <GeneralSection />}
        </main>
      </div>
    </Modal>
  );
}
