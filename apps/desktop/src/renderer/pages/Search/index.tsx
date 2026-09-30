import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Input, Select, Spin, Tag, message } from "antd";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { WorkspaceSearchHit, WorkspaceSearchType } from "@chat/shared";
import { searchService, workspaceSearchKey } from "../../services/search";
import { searchResultRoute } from "./helpers";

const typeLabels: Record<WorkspaceSearchType, string> = {
  message: "消息",
  document: "文档",
  member: "成员",
  task: "任务",
  notification: "通知",
};
const pageSize = 20;

/** 统一检索工作区内容，防抖输入并按类型分页展示结果。 */
export default function SearchPage() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState<"all" | WorkspaceSearchType>("all");
  const [offset, setOffset] = useState(0);
  const pendingInput = input.trim() !== keyword;
  const query = { q: keyword, type, limit: pageSize, offset };
  const results = useQuery({
    queryKey: workspaceSearchKey(query),
    queryFn: ({ signal }) => searchService.search(query, signal),
    enabled: Boolean(keyword) && !pendingInput,
    retry: false,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setKeyword(input.trim());
      setOffset(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [input]);

  /** 打开对应资源；文档走现有桌面窗口接口，其余保留定位参数。 */
  async function openResult(hit: WorkspaceSearchHit) {
    try {
      if (hit.type === "document") {
        if (!window.desktop) throw new Error("请在桌面客户端中打开文档");
        await window.desktop.windows.openDocument(hit.documentId ?? hit.id);
        return;
      }
      const route = searchResultRoute(hit);
      if (!route) throw new Error("搜索结果缺少定位信息");
      navigate(route);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "无法打开搜索结果");
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--app-canvas)] px-[clamp(20px,4vw,64px)] py-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6">
          <h1 className="m-0 flex items-center gap-2 text-2xl font-semibold text-[var(--app-text)]">
            <Search size={24} />工作区搜索
          </h1>
          <p className="mb-0 mt-1 text-sm text-[var(--app-text-secondary)]">
            搜索消息全文、文档标题与正文、成员、任务和通知。
          </p>
        </header>
        <section className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--app-line)] bg-[var(--app-surface)] p-4 shadow-[var(--app-shadow-panel)]">
          <Input
            className="min-w-[220px] flex-1"
            prefix={<Search size={16} />}
            aria-label="搜索关键词"
            placeholder="输入关键词搜索工作区"
            allowClear
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <Select
            className="w-[120px]"
            aria-label="搜索类型"
            value={type}
            onChange={(value) => { setType(value); setOffset(0); }}
            options={[
              { value: "all", label: "全部类型" },
              ...Object.entries(typeLabels).map(([value, label]) => ({ value, label })),
            ]}
          />
        </section>
        {!input.trim() ? (
          <Empty description="输入关键词开始搜索" />
        ) : pendingInput || results.isLoading ? (
          <div className="py-10 text-center" role="status" aria-label="正在搜索"><Spin /></div>
        ) : results.isError ? (
          <Alert
            type="error"
            showIcon
            message={results.error.message || "搜索失败，请重试"}
            action={<Button size="small" onClick={() => void results.refetch()}>重试</Button>}
          />
        ) : !results.data?.items.length ? (
          <Empty description="没有找到匹配结果" />
        ) : (
          <>
            <p className="text-sm text-[var(--app-text-secondary)]" aria-live="polite">
              共 {results.data.total} 条结果{results.isFetching ? " · 正在更新" : ""}
            </p>
            <div className="grid gap-3">
              {results.data.items.map((hit) => (
                <button
                  key={`${hit.type}:${hit.id}`}
                  type="button"
                  className="w-full rounded-xl border border-[var(--app-line)] bg-[var(--app-surface)] p-4 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-[var(--app-primary)]"
                  onClick={() => void openResult(hit)}
                >
                  <div className="flex items-center gap-2">
                    <Tag>{typeLabels[hit.type]}</Tag>
                    <strong className="min-w-0 flex-1 truncate text-sm text-[var(--app-text)]">{hit.title}</strong>
                    <time className="shrink-0 text-xs text-[var(--app-text-tertiary)]" dateTime={hit.updatedAt}>
                      {new Date(hit.updatedAt).toLocaleDateString("zh-CN")}
                    </time>
                  </div>
                  <p className="mb-0 mt-2 line-clamp-3 break-words text-sm text-[var(--app-text-secondary)]">{hit.snippet}</p>
                </button>
              ))}
            </div>
          </>
        )}
        {keyword && !pendingInput && results.data && !results.isError && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button disabled={offset === 0 || results.isFetching} onClick={() => setOffset(Math.max(0, offset - pageSize))}>上一页</Button>
            <span className="text-sm text-[var(--app-text-secondary)]">第 {offset / pageSize + 1} 页</span>
            <Button disabled={!results.data.hasMore || results.isFetching} onClick={() => setOffset(offset + pageSize)}>下一页</Button>
          </div>
        )}
      </div>
    </div>
  );
}
