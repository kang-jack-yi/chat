import type { AccessTokenData, ApiResponse } from "@chat/shared";
import axios, { type AxiosRequestConfig, type InternalAxiosRequestConfig } from "axios";
import { clearAccessToken, getAccessToken, setAccessToken } from "./token";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

function isApiFailure(value: unknown): value is ApiFailure {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ApiFailure>;
  return payload.success === false
    && typeof payload.error?.code === "string"
    && typeof payload.error.message === "string";
}

const clientConfig = {
  baseURL: "",
  timeout: 15_000,
  withCredentials: true,
  headers: {
    Accept: "application/json",
  },
};

export const httpClient = axios.create(clientConfig);
const refreshClient = axios.create(clientConfig);
let activeRequestController = new AbortController();
const publicAuthUrls = new Set([
  "/api/auth/login",
  "/api/auth/company-register",
  "/api/auth/refresh",
]);

let refreshPromise: Promise<string> | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler;
}

function toApiError(error: unknown) {
  if (error instanceof ApiError) return error;
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0;
    if (isApiFailure(error.response?.data)) {
      const { code, message, fields } = error.response.data.error;
      return new ApiError(code, message, status, fields);
    }
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return new ApiError("REQUEST_TIMEOUT", "请求超时，请稍后重试", status);
    }
    if (!error.response) {
      return new ApiError("NETWORK_ERROR", "网络连接失败，请检查服务是否已启动", 0);
    }
    return new ApiError("HTTP_ERROR", `请求失败（${status}）`, status);
  }
  return error instanceof Error ? error : new ApiError("UNKNOWN_ERROR", "请求失败", 0);
}

function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post<ApiResponse<AccessTokenData>>("/api/auth/refresh", {})
      .then((response) => {
        if (!response.data.success) {
          throw new ApiError(
            response.data.error.code,
            response.data.error.message,
            response.status,
            response.data.error.fields,
          );
        }
        setAccessToken(response.data.data.accessToken);
        return response.data.data.accessToken;
      })
      .catch((error) => {
        clearAccessToken();
        unauthorizedHandler?.();
        throw toApiError(error);
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

httpClient.interceptors.request.use((config) => {
  config.signal ??= activeRequestController.signal;
  const token = getAccessToken();
  if (token && !publicAuthUrls.has(config.url || "")) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function configureHttpClient(baseURL: string) {
  activeRequestController.abort();
  activeRequestController = new AbortController();
  const normalized = baseURL.replace(/\/+$/, "");
  httpClient.defaults.baseURL = normalized;
  refreshClient.defaults.baseURL = normalized;
}

httpClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(toApiError(error));

    const config = error.config as RetryableRequestConfig | undefined;
    const isUnauthorized = error.response?.status === 401;
    const canRefresh = config && !config._retry && !publicAuthUrls.has(config.url || "");

    if (isUnauthorized && canRefresh) {
      config._retry = true;
      try {
        const token = await refreshAccessToken();
        config.headers.Authorization = `Bearer ${token}`;
        return await httpClient.request(config);
      } catch (refreshError) {
        return Promise.reject(toApiError(refreshError));
      }
    }

    if (isUnauthorized && config?._retry) {
      clearAccessToken();
      unauthorizedHandler?.();
    }
    return Promise.reject(toApiError(error));
  },
);

type RequestOptions = Omit<AxiosRequestConfig, "url" | "method" | "data">;

export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await httpClient.request<ApiResponse<T>>(config);
  const payload = response.data;
  if (!payload.success) {
    throw new ApiError(payload.error.code, payload.error.message, response.status, payload.error.fields);
  }
  return payload.data;
}

export const get = <T>(url: string, options?: RequestOptions) =>
  request<T>({ ...options, url, method: "GET" });

export const post = <T>(url: string, data: unknown = {}, options?: RequestOptions) =>
  request<T>({ ...options, url, method: "POST", data });

export const patch = <T>(url: string, data: unknown, options?: RequestOptions) =>
  request<T>({ ...options, url, method: "PATCH", data });

export const put = <T>(url: string, data: unknown, options?: RequestOptions) =>
  request<T>({ ...options, url, method: "PUT", data });

export const remove = <T>(url: string, options?: RequestOptions) =>
  request<T>({ ...options, url, method: "DELETE" });
