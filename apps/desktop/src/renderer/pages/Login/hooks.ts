import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import type { AuthMode } from "../../types/ui";
import { ROUTES } from "../../constants/routes";
import { authService, type LoginPayload, type RegisterPayload } from "../../services/auth";
import { useUserStore } from "../../stores/user-store";

export function useAuthForm() {
  const navigate = useNavigate();
  const setSession = useUserStore((state) => state.setSession);
  const [mode, setMode] = useState<AuthMode>("login");
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: (payload: LoginPayload | RegisterPayload) =>
      mode === "login" ? authService.login(payload as LoginPayload) : authService.register(payload as RegisterPayload),
    onSuccess: (session) => {
      setSession(session);
      navigate(ROUTES.chat, { replace: true });
    },
    onError: (reason: Error) => setError(reason.message),
  });

  function changeMode(next: AuthMode) {
    setMode(next);
    setError("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    mutation.mutate(Object.fromEntries(new FormData(event.currentTarget).entries()) as unknown as LoginPayload | RegisterPayload);
  }

  return { mode, error, pending: mutation.isPending, changeMode, submit };
}
