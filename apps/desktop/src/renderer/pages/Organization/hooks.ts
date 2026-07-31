import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Department, User } from "@chat/shared";
import { queryKeys } from "../../constants/query-keys";
import { organizationService } from "../../services/organization";

export type OrganizationMode = "members" | "departments";
export type OrganizationModalState =
  | { kind: "member-create" }
  | { kind: "department-create"; parentId: number | null; asChild: boolean }
  | { kind: "department-edit"; department: Department }
  | null;

export function useOrganization() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<OrganizationMode>("members");
  const [modal, setModal] = useState<OrganizationModalState>(null);
  const [error, setError] = useState("");
  const users = useQuery({ queryKey: queryKeys.users, queryFn: organizationService.users });
  const departments = useQuery({
    queryKey: queryKeys.departments,
    queryFn: organizationService.departments,
  });

  const closeModal = () => setModal(null);
  const createUser = useMutation({
    mutationFn: organizationService.createUser,
    onSuccess: async () => {
      closeModal();
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
    onError: (reason: Error) => setError(reason.message),
  });
  const createDepartment = useMutation({
    mutationFn: organizationService.createDepartment,
    onSuccess: async () => {
      closeModal();
      await queryClient.invalidateQueries({ queryKey: queryKeys.departments });
    },
    onError: (reason: Error) => setError(reason.message),
  });
  const updateDepartment = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: { name: string; parentId: number | null } }) =>
      organizationService.updateDepartment(id, payload),
    onSuccess: async () => {
      closeModal();
      await queryClient.invalidateQueries({ queryKey: queryKeys.departments });
    },
    onError: (reason: Error) => setError(reason.message),
  });
  const setStatus = useMutation({
    mutationFn: ({ userId, status }: { userId: number; status: User["status"] }) =>
      organizationService.setUserStatus(userId, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
    onError: (reason: Error) => window.alert(reason.message),
  });

  function openCreateModal() {
    setError("");
    if (mode === "members") {
      setModal({ kind: "member-create" });
      return;
    }
    setModal({
      kind: "department-create",
      parentId: rootDepartmentId(departments.data ?? []) ?? null,
      asChild: false,
    });
  }

  function openChildDepartment(parent: Department) {
    setError("");
    setModal({ kind: "department-create", parentId: parent.id, asChild: true });
  }

  function openEditDepartment(department: Department) {
    setError("");
    setModal({ kind: "department-edit", department });
  }

  function submit(data: Record<string, unknown>) {
    setError("");
    if (modal?.kind === "member-create") {
      createUser.mutate({
        ...data,
        departmentId: Number(data.departmentId) || null,
      });
      return;
    }
    const payload = {
      name: String(data.name),
      parentId: Number(data.parentId) || null,
    };
    if (modal?.kind === "department-edit") {
      updateDepartment.mutate({ id: modal.department.id, payload });
      return;
    }
    createDepartment.mutate(payload);
  }

  return {
    closeModal,
    departments,
    error,
    modal,
    mode,
    openChildDepartment,
    openCreateModal,
    openEditDepartment,
    pending: createUser.isPending || createDepartment.isPending || updateDepartment.isPending,
    setMode,
    setStatus,
    submit,
    users,
  };
}

export function rootDepartmentId(departments: Department[]) {
  return departments.find((item) => item.parentId === null)?.id ?? departments[0]?.id;
}
