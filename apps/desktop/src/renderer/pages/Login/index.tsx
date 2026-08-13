import { Alert, Button, Input, Tabs } from "antd";
import { Check, MessageCircleMore, Settings } from "lucide-react";
import { useAuthForm } from "./hooks";
import { useServerStore } from "../../stores/server-store";
import { useAppStore } from "../../stores/app-store";
import styles from "./style.module.less";

export default function LoginPage() {
  const { mode, error, pending, changeMode, submit } = useAuthForm();
  const health = useServerStore((state) => state.health);
  const serverStatus = useServerStore((state) => state.status);
  const serverError = useServerStore((state) => state.error);
  const setServerSettingsOpen = useAppStore(
    (state) => state.setServerSettingsOpen,
  );
  const registrationEnabled = health?.features.companyRegistration !== false;
  return (
    <div className={`${styles.loginPage} grid h-full grid-cols-[minmax(420px,1.05fr)_minmax(440px,.95fr)] gap-3 bg-[var(--app-canvas)] p-3 max-md:grid-cols-1 max-md:overflow-y-auto max-md:p-0`}>
      <section className={`${styles.storyPanel} relative overflow-hidden rounded-3xl bg-[linear-gradient(145deg,#0958b8_0%,#1677ff_52%,#69a8ff_100%)] px-[7vw] py-[54px] text-white shadow-[0_20px_55px_rgba(22,119,255,.20)] max-md:hidden`}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_78%,rgba(255,255,255,.18),transparent_29%)]" />
        <div className="absolute -top-24 -left-24 size-72 rounded-full border border-white/10" />
        <div className="absolute top-12 right-8 size-24 rounded-full bg-white/8 blur-sm" />
        <div className="relative z-10 flex items-center gap-3 text-2xl font-bold tracking-widest">
          <span className="grid size-11 place-items-center rounded-2xl bg-white/16 shadow-lg ring-1 ring-white/20 backdrop-blur-lg">
            <MessageCircleMore size={26} />
          </span>
          同频
        </div>
        <div className="relative z-10 mt-40 max-w-xl">
          <span className="text-xs font-bold tracking-widest text-white/72">
            为团队而生的协作空间
          </span>
          <h1 className="my-4 text-5xl leading-tight tracking-tight xl:text-6xl">
            沟通更清晰，
            <br />
            协作更同频。
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-white/70">
            把组织通讯录、即时消息和团队文件放在一个安静、可靠的工作空间里。
          </p>
          <div className="mt-10 grid gap-4 text-white/85">
            <span className="flex items-center gap-2.5">
              <Check size={16} /> 企业通讯录与部门架构
            </span>
            <span className="flex items-center gap-2.5">
              <Check size={16} /> 单聊、群聊与实时状态
            </span>
            <span className="flex items-center gap-2.5">
              <Check size={16} /> 文件安全保存在企业空间
            </span>
          </div>
        </div>
      </section>

      <section className={`${styles.formPanel} relative flex items-center justify-center rounded-3xl border border-[var(--app-line)] bg-[var(--app-surface)] p-10 shadow-[var(--app-shadow-panel)] max-md:min-h-dvh max-md:rounded-none max-md:px-6 max-md:pt-8 max-md:pb-16`}>
        <div className="w-full max-w-md">
          <Tabs
            activeKey={mode}
            onChange={(key) => changeMode(key as "login" | "register")}
            items={[
              { key: "login", label: "员工登录" },
              ...(registrationEnabled
                ? [{ key: "register", label: "创建企业" }]
                : []),
            ]}
            tabBarExtraContent={
              <Button
                type="text"
                size="small"
                icon={<Settings size={15} />}
                onClick={() => setServerSettingsOpen(true)}
              >
                服务器设置
              </Button>
            }
            className="mb-7"
          />
          <div>
            <h2 className="mb-2 text-3xl font-semibold tracking-[-0.8px] text-[var(--app-text)]">
              {mode === "login" ? "欢迎回来" : "创建你的企业空间"}
            </h2>
            <p className="mb-8 text-sm text-[var(--app-text-secondary)]">
              {mode === "login"
                ? "使用管理员为你创建的账号登录"
                : "完成后即可邀请同事开始协作"}
            </p>
          </div>
          <form onSubmit={submit} className="grid gap-4">
            {mode === "register" && (
              <>
                <label className="grid gap-2 text-sm font-semibold text-[var(--app-text)]">
                  企业名称
                  <Input
                    name="companyName"
                    placeholder="例如：星海科技"
                    required
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-[var(--app-text)]">
                  你的姓名
                  <Input name="name" placeholder="请输入真实姓名" required />
                </label>
              </>
            )}
            <label className="grid gap-2 text-sm font-semibold text-[var(--app-text)]">
              手机号
              <Input
                name="phone"
                placeholder="11 位手机号"
                inputMode="numeric"
                required
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-[var(--app-text)]">
              密码
              <Input.Password
                name="password"
                placeholder="至少 6 位"
                minLength={6}
                required
              />
            </label>
            {error && <Alert type="error" message={error} showIcon />}
            {serverStatus === "offline" && !error && (
              <Alert
                type="error"
                message={serverError || "服务器连接失败，请检查设置"}
                showIcon
              />
            )}
            <Button
              type="primary"
              htmlType="submit"
              loading={pending}
              disabled={serverStatus !== "online"}
              block
            >
              {mode === "login" ? "登录企业空间" : "创建并进入"}
            </Button>
          </form>
          {mode === "login" && (
            <p className={`${styles.demoAccount} mt-6 rounded-xl border border-[var(--app-line)] bg-[var(--app-surface-soft)] px-3.5 py-3 text-center text-xs text-[var(--app-text-secondary)]`}>
              演示账号：13800000001 / 123456
            </p>
          )}
        </div>
        <p className="absolute bottom-6 text-xs text-[var(--app-text-tertiary)]">
          本地企业协作原型 · 数据仅保存在当前服务器
        </p>
      </section>
    </div>
  );
}
