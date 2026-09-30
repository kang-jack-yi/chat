import { Alert, Button, Input, Tabs } from "antd";
import {
  ArrowRight,
  FolderLock,
  LockKeyhole,
  MessageCircleMore,
  Settings,
  Users,
} from "lucide-react";
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
    <div className={styles.loginPage}>
      <div className={styles.loginShell}>
        <section className={styles.storyPanel}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}>
              <MessageCircleMore size={26} />
            </span>
            同频
          </div>
          <div className={styles.storyContent}>
            <span className={styles.eyebrow}>为团队而生的协作空间</span>
            <h1 className={styles.headline}>
              沟通更清晰，
              <br />
              协作更同频。
            </h1>
            <p className={styles.description}>
              把组织通讯录、即时消息和团队文件放在一个安静、可靠的工作空间里。
            </p>
            <ul className={styles.features}>
              <li>
                <span>
                  <Users size={18} />
                </span>
                企业通讯录与部门架构
              </li>
              <li>
                <span>
                  <MessageCircleMore size={18} />
                </span>
                单聊、群聊与实时状态
              </li>
              <li>
                <span>
                  <FolderLock size={18} />
                </span>
                文件安全保存在企业空间
              </li>
            </ul>
          </div>
          <p className={styles.storyFooter}>连接团队，让每一次协作更简单。</p>
        </section>

        <section className={styles.formPanel}>
          <header className={styles.formToolbar}>
            <div className={styles.mobileBrand}>
              <MessageCircleMore size={22} />
              同频
            </div>
            <Button
              type="text"
              icon={<Settings size={16} />}
              onClick={() => setServerSettingsOpen(true)}
              className={styles.serverButton}
            >
              服务器设置
            </Button>
          </header>
          <div className={styles.formBody}>
            <div className={styles.formContent}>
              <Tabs
                activeKey={mode}
                onChange={(key) => changeMode(key as "login" | "register")}
                items={[
                  { key: "login", label: "员工登录" },
                  ...(registrationEnabled
                    ? [{ key: "register", label: "创建企业" }]
                    : []),
                ]}
                className={styles.authTabs}
              />
              <div className={styles.formHeading}>
                <h2>{mode === "login" ? "欢迎回来" : "创建你的企业空间"}</h2>
                <p>
                  {mode === "login"
                    ? "使用管理员为你创建的账号登录"
                    : "完成后即可邀请同事开始协作"}
                </p>
              </div>
              <form onSubmit={submit} className={styles.authForm}>
                {mode === "register" && (
                  <>
                    <label className={styles.field}>
                      企业名称
                      <Input
                        name="companyName"
                        placeholder="例如：星海科技"
                        autoComplete="organization"
                        required
                      />
                    </label>
                    <label className={styles.field}>
                      你的姓名
                      <Input
                        name="name"
                        placeholder="请输入真实姓名"
                        autoComplete="name"
                        required
                      />
                    </label>
                  </>
                )}
                <label className={styles.field}>
                  手机号
                  <Input
                    name="phone"
                    placeholder="11 位手机号"
                    inputMode="numeric"
                    autoComplete="username"
                    required
                  />
                </label>
                <label className={styles.field}>
                  密码
                  <Input.Password
                    name="password"
                    placeholder="至少 6 位"
                    minLength={6}
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
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
                  className={styles.submitButton}
                >
                  {mode === "login" ? "登录企业空间" : "创建并进入"}
                  <ArrowRight size={17} aria-hidden="true" />
                </Button>
              </form>
              {mode === "login" && (
                <div className={styles.demoAccount}>
                  <span>演示账号</span>
                  <p>
                    13800000001 <span>/</span> 123456
                  </p>
                </div>
              )}
            </div>
          </div>
          <p className={styles.formFooter}>
            <LockKeyhole size={13} aria-hidden="true" />
            数据仅保存在当前服务器
          </p>
        </section>
      </div>
    </div>
  );
}
