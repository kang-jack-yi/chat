import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../constants/query-keys";
import { chatService } from "../../services/chat";
import { organizationService } from "../../services/organization";

export function useContacts() {
  const [query, setQuery] = useState("");
  const users = useQuery({
    queryKey: queryKeys.users,
    queryFn: organizationService.users,
  });
  const filteredUsers = useMemo(
    () =>
      (users.data ?? []).filter(
        (user) =>
          user.status === "active" &&
          (!query ||
            `${user.name}${user.phone}${user.title}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [query, users.data],
  );

  return { filteredUsers, query, setQuery, users };
}

export function useStartDirectChat(
  onSuccess: (conversationId: number) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: chatService.createDirect,
    onSuccess: async (conversation) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations,
      });
      onSuccess(conversation.id);
    },
  });
}
