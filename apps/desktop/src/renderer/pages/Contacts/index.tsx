import { useEffect } from "react";
import { Button } from "antd";
import { ChevronLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "../../constants/routes";
import { useAppStore } from "../../stores/app-store";
import { useUserStore } from "../../stores/user-store";
import ContactDetail from "./components/ContactDetail";
import ContactsList from "./components/ContactsList";
import { useContacts, useStartDirectChat } from "./hooks";

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
    if (!selectedId && contacts.users.data?.length) {
      const first =
        contacts.users.data.find((user) => user.id !== session.user.id) ??
        contacts.users.data[0];
      navigate(ROUTES.contactDetail(first.id), { replace: true });
    }
  }, [contacts.users.data, navigate, selectedId, session.user.id]);

  function selectUser(id: number) {
    navigate(ROUTES.contactDetail(id));
    setMobileDetailOpen(true);
  }

  return (
    <div className="relative grid h-full grid-cols-[300px_minmax(0,1fr)] bg-[var(--app-canvas)] max-lg:grid-cols-[280px_minmax(0,1fr)] max-md:grid-cols-1">
      <section className="flex min-w-0 flex-col overflow-hidden border-r border-[var(--app-line)] bg-[var(--app-surface-soft)]">
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
        className={`relative min-h-0 min-w-0 overflow-hidden bg-[var(--app-canvas)] transition-transform duration-200 max-md:absolute max-md:inset-0 max-md:z-10 ${mobileDetailOpen ? "max-md:translate-x-0" : "max-md:translate-x-full"}`}
      >
        <Button
          type="text"
          icon={<ChevronLeft size={20} />}
          aria-label="返回通讯录"
          onClick={() => setMobileDetailOpen(false)}
          className="!absolute !top-4 !left-2 !z-10 !hidden max-md:!inline-flex"
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
