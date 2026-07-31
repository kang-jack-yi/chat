import type { AuthData, SessionData } from "@chat/shared";
import { get, post } from "./request";
import { clearAccessToken, setAccessToken } from "./token";
import { prepareDesktopSession } from "./desktop-session";
import { localDatabase } from "./local-database";

export interface LoginPayload {
  phone: string;
  password: string;
}

export interface RegisterPayload extends LoginPayload {
  companyName: string;
  name: string;
}

async function acceptAuth(data: AuthData): Promise<SessionData> {
  setAccessToken(data.accessToken);
  const { accessToken: _accessToken, ...session } = data;
  await prepareDesktopSession(session);
  return session;
}

export const authService = {
  me: () => get<SessionData>("/api/auth/me"),
  login: (payload: LoginPayload) => post<AuthData>("/api/auth/login", payload).then(acceptAuth),
  register: (payload: RegisterPayload) => post<AuthData>("/api/auth/company-register", payload).then(acceptAuth),
  async logout() {
    try {
      return await post<boolean>("/api/auth/logout");
    } finally {
      clearAccessToken();
      await localDatabase.close();
    }
  },
};
