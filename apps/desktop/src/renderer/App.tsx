import { Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import BasicLayout from "./layouts/BasicLayout";
import BlankLayout from "./layouts/BlankLayout";
import WorkspaceSectionLayout from "./layouts/WorkspaceSectionLayout";
import LoadingScreen from "./components/LoadingScreen";
import { ROUTES } from "./constants/routes";
import { useSession } from "./hooks/useSession";
import { SocketProvider } from "./providers/SocketProvider";
import type { SessionData } from "@chat/shared";

const ChatPage = lazy(() => import("./pages/Chat"));
const ContactsPage = lazy(() => import("./pages/Contacts"));
const LoginPage = lazy(() => import("./pages/Login"));
const OrganizationPage = lazy(() => import("./pages/Organization"));
const DocumentsPage = lazy(() => import("./pages/Documents"));
const TasksPage = lazy(() => import("./pages/Tasks"));
const NotificationsPage = lazy(() => import("./pages/Notifications"));
const SearchPage = lazy(() => import("./pages/Search"));
const ReviewsPage = lazy(() => import("./pages/Reviews"));

export function defaultRoute(session: SessionData | null) {
  return session ? ROUTES.chat : ROUTES.login;
}

export function canAccessOrganization(session: SessionData | null) {
  return Boolean(session && ["owner", "admin"].includes(session.user.role));
}

function ProtectedLayout({ session }: { session: SessionData | null }) {
  if (!session) return <Navigate to={ROUTES.login} replace />;
  return (
    <SocketProvider>
      <BasicLayout />
    </SocketProvider>
  );
}

function LoginGuard({
  session,
  children,
}: {
  session: SessionData | null;
  children: ReactNode;
}) {
  return session ? <Navigate to={ROUTES.chat} replace /> : children;
}

function OrganizationGuard({ session }: { session: SessionData | null }) {
  return canAccessOrganization(session) ? (
    <OrganizationPage />
  ) : (
    <Navigate to={ROUTES.chat} replace />
  );
}

export default function App() {
  const { session, bootstrapped } = useSession();
  if (!bootstrapped) return <LoadingScreen />;

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route element={<BlankLayout />}>
          <Route
            path={ROUTES.login}
            element={
              <LoginGuard session={session}>
                <LoginPage />
              </LoginGuard>
            }
          />
        </Route>
        <Route element={<ProtectedLayout session={session} />}>
          <Route path={ROUTES.chat} element={<ChatPage />} />
          <Route path="/chat/:conversationId" element={<ChatPage />} />
          <Route element={<WorkspaceSectionLayout section="team" />}>
            <Route path={ROUTES.contacts} element={<ContactsPage />} />
            <Route path="/contacts/:userId" element={<ContactsPage />} />
            <Route
              path={ROUTES.organization}
              element={<OrganizationGuard session={session} />}
            />
          </Route>
          <Route path={ROUTES.documents} element={<DocumentsPage />} />
          <Route element={<WorkspaceSectionLayout section="work" />}>
            <Route path={ROUTES.reviews} element={<ReviewsPage />} />
            <Route path={ROUTES.tasks} element={<TasksPage />} />
            <Route
              path={ROUTES.notifications}
              element={<NotificationsPage />}
            />
          </Route>
          <Route path={ROUTES.search} element={<SearchPage />} />
        </Route>
        <Route
          path="*"
          element={<Navigate to={defaultRoute(session)} replace />}
        />
      </Routes>
    </Suspense>
  );
}
