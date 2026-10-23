import { useEffect } from "react";
import { Alert, Button, Spin } from "antd";
import { ChevronLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "../../constants/routes";
import { useAppStore } from "../../stores/app-store";
import { useUserStore } from "../../stores/user-store";
import ContactDetail from "./components/ContactDetail";
import ContactsList from "./components/ContactsList";
import { useContacts, useStartDirectChat } from "./hooks";
import "./page.less";

/** 将通讯录列表和成员资料分区展示，并保留窄屏的返回与会话导航。 */
export default function ContactsPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const session = useUserStore((state) => state.session)!;
  const mobileDetailOpen = useAppStore((state) => state.mobileDetailOpen);
  const setMobileDetailOpen = useAppStore((state) => state.setMobileDetailOpen);
  const contacts = useContacts();
  const selectedId = Number(userId) || undefined;
  const selectedUser =
    contacts.users.data?.find((user) => user.id === selectedId) ?? null;
  const startChat = useStartDirectChat((conversationId) =>
    navigate(ROUTES.chatDetail(conversationId)),
  );

  useEffect(() => {
    // 窄屏先展示列表；桌面仍默认选中第一位同事。
    if (
      !selectedId &&
      contacts.users.data?.length &&
      !window.matchMedia("(max-width: 767px)").matches
    ) {
      const first =
        contacts.users.data.find((user) => user.id !== session.user.id) ??
        contacts.users.data[0];
      navigate(ROUTES.contactDetail(first.id), { replace: true });
    }
  }, [contacts.users.data, navigate, selectedId, session.user.id]);

  useEffect(() => {
    // 直接打开资料链接和浏览器前进、后退时，保持面板与路由一致。
    setMobileDetailOpen(Boolean(selectedId));
  }, [selectedId, setMobileDetailOpen]);

  /** 选择同事并在窄屏展开资料区域。 */
  function selectUser(id: number) {
    navigate(ROUTES.contactDetail(id));
    setMobileDetailOpen(true);
  }

  return (
    <div className="contacts-page">
      <section className="contacts-directory" aria-label="企业通讯录">
        {contacts.users.isError && (
          <Alert
            type="error"
            title="通讯录加载失败"
            showIcon
            action={
              <Button
                size="small"
                onClick={() => void contacts.users.refetch()}
              >
                重试
              </Button>
            }
          />
        )}
        {contacts.users.isLoading && (
          <div
            className="contacts-loading"
            role="status"
            aria-label="正在加载通讯录"
          >
            <Spin />
          </div>
        )}
        <ContactsList
          company={session.company}
          users={contacts.filteredUsers}
          query={contacts.query}
          selectedId={selectedId}
          onQueryChange={contacts.setQuery}
          onSelect={selectUser}
        />
      </section>
      <main
        className={`contacts-detail ${mobileDetailOpen ? "contacts-detail-open" : ""}`}
      >
        <Button
          type="text"
          icon={<ChevronLeft size={20} />}
          aria-label="返回通讯录"
          onClick={() => navigate(ROUTES.contacts)}
          className="contacts-back"
        />
        <ContactDetail
          user={selectedUser}
          currentUser={session.user}
          starting={startChat.isPending}
          onStartChat={(id) => startChat.mutate(id)}
        />
      </main>
    </div>
  );
}
