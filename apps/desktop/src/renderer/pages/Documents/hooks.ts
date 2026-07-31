import { useDeferredValue, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { message } from "antd";
import type {
  CloudDocument,
  CloudDocumentListView,
  CloudDocumentType,
} from "@chat/shared";
import { queryKeys } from "../../constants/query-keys";
import { documentsService } from "../../services/documents";

export function useDocuments() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<CloudDocumentListView>("recent");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const documents = useQuery({
    queryKey: queryKeys.documents(view, deferredQuery),
    queryFn: () => documentsService.list(view, deferredQuery),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["documents"] });

  const createDocument = useMutation({
    mutationFn: (type: CloudDocumentType) => documentsService.create(type),
    onSuccess: async (document) => {
      await refresh();
      await window.desktop?.windows.openDocument(document.id);
    },
    onError: (error: Error) => message.error(error.message),
  });
  const updateDocument = useMutation({
    mutationFn: ({ id, payload }: {
      id: number;
      payload: Parameters<typeof documentsService.update>[1];
    }) => documentsService.update(id, payload),
    onSuccess: refresh,
    onError: (error: Error) => message.error(error.message),
  });
  const deleteDocument = useMutation({
    mutationFn: (document: CloudDocument) => documentsService.remove(document.id),
    onSuccess: refresh,
    onError: (error: Error) => message.error(error.message),
  });

  return {
    view,
    setView,
    query,
    setQuery,
    documents,
    createDocument,
    updateDocument,
    deleteDocument,
    refresh,
  };
}
