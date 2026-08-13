import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { CheckCircle2, Server, Wifi } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { ServerHealth } from "@chat/shared";
import { serverService, type CheckedServer } from "../../services/server";
import { configureHttpClient } from "../../services/request";
import { clearAccessToken } from "../../services/token";
import { useServerStore } from "../../stores/server-store";
import { useAppStore } from "../../stores/app-store";
import { useUserStore } from "../../stores/user-store";
import { useSyncStore } from "../../stores/sync-store";
import { ROUTES } from "../../constants/routes";

export default function ServerSettingsModal() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const server = useServerStore((state) => state.server);
  const currentHealth = useServerStore((state) => state.health);
  const status = useServerStore((state) => state.status);
  const setChecking = useServerStore((state) => state.setChecking);
  const setOnline = useServerStore((state) => state.setOnline);
  const setOffline = useServerStore((state) => state.setOffline);
  const manuallyOpen = useAppStore((state) => state.serverSettingsOpen);
  const setOpen = useAppStore((state) => state.setServerSettingsOpen);
  const session = useUserStore((state) => state.session);
  const clearSession = useUserStore((state) => state.clearSession);
  const [url, setUrl] = useState(server?.url || "");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checked, setChecked] = useState<CheckedServer | null>(null);
  const [error, setError] = useState("");
  const required = !server;
  const open = manuallyOpen || required;

  useEffect(() => {
    if (open) {
      setUrl(server?.url || "");
      setChecked(null);
      setError("");
    }
  }, [open, server?.url]);

  const normalized = useMemo(() => url.trim().replace(/\/+$/, ""), [url]);

  async function testServer() {
    setTesting(true);
    setError("");
    try {
      const result = await serverService.test(normalized);
      setChecked(result);
      return result;
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : "无法连接服务器";
      setChecked(null);
      setError(text);
      throw reason;
    } finally {
      setTesting(false);
    }
  }

  async function confirmSwitch() {
    if (!session || normalized === server?.url) return true;
    return new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: "切换服务器并退出当前账号？",
        content:
          "切换后会断开实时连接并清空当前登录状态，本地历史仍保留在原服务器的数据目录中。",
        okText: "确认切换",
        cancelText: "取消",
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }

  async function save() {
    if (!(await confirmSwitch())) return;
    setSaving(true);
    setChecking();
    try {
      const verified =
        checked?.config.url === normalized ? checked : await testServer();
      const result = await serverService.switch(verified.config.url);
      configureHttpClient(result.config.url);
      queryClient.clear();
      clearAccessToken();
      clearSession();
      useAppStore.getState().reset();
      useSyncStore.getState().reset();
      setOnline(result.config, result.health);
      message.success("服务器已切换");
      navigate(ROUTES.login, { replace: true });
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : "服务器切换失败";
      if (server && currentHealth) {
        configureHttpClient(server.url);
        setOnline(server, currentHealth);
      } else {
        setOffline(text);
      }
      setError(text);
      setOpen(true);
    } finally {
      setSaving(false);
    }
  }

  const health: ServerHealth | null = checked?.health || null;

  return (
    <Modal
      title={
        <Space>
          <Server size={18} />
          服务器设置
        </Space>
      }
      open={open}
      width={520}
      closable={!required}
      maskClosable={false}
      keyboard={!required}
      onCancel={() => setOpen(false)}
      footer={[
        <Button
          key="test"
          icon={<Wifi size={15} />}
          loading={testing}
          onClick={() => void testServer()}
        >
          检测连接
        </Button>,
        !required && (
          <Button key="cancel" onClick={() => setOpen(false)}>
            取消
          </Button>
        ),
        <Button
          key="save"
          type="primary"
          loading={saving}
          disabled={!normalized}
          onClick={() => void save()}
        >
          保存并切换
        </Button>,
      ]}
    >
      <Form layout="vertical" className="pt-2">
        <Form.Item
          label="服务地址"
          required
          extra="正式客户端仅支持 HTTPS；本地开发可使用 127.0.0.1。"
        >
          <Input
            value={url}
            placeholder="https://chat.example.com"
            onChange={(event) => {
              setUrl(event.target.value);
              setChecked(null);
              setError("");
            }}
            onBlur={() => setUrl(normalized)}
          />
        </Form.Item>
      </Form>
      {error && (
        <Alert type="error" showIcon message="连接失败" description={error} />
      )}
      {health && (
        <div className="rounded-[14px] border border-[var(--app-line)] bg-[var(--app-surface-soft)] p-4">
          <div className="mb-3 flex items-center gap-2 font-semibold text-[#178761]">
            <CheckCircle2 size={17} />
            连接正常
          </div>
          <Space direction="vertical" size={6}>
            <Typography.Text>服务：{health.name}</Typography.Text>
            <Typography.Text type="secondary">
              服务器 ID：{health.serverId}
            </Typography.Text>
            <Typography.Text type="secondary">
              版本：<Tag color="blue">API v{health.apiVersion}</Tag>
            </Typography.Text>
          </Space>
        </div>
      )}
      {status === "checking" && !health && (
        <Alert type="info" showIcon message="正在检测服务器…" />
      )}
    </Modal>
  );
}
