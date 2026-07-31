let accessToken: string | null = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string) {
  accessToken = token;
  if (typeof window !== "undefined") {
    void window.desktop?.auth.updateAccessToken(token);
  }
}

export function clearAccessToken() {
  accessToken = null;
  if (typeof window !== "undefined") {
    void window.desktop?.auth.updateAccessToken(null);
  }
}

export function applyHostAccessToken(token: string) {
  accessToken = token;
}
