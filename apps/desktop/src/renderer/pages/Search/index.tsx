import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Input, Select, Spin, Tag, message } from "antd";
import {
  ArrowUpRight,
  Bell,
  FileText,
  ListTodo,
  MessageSquare,
  Search,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { WorkspaceSearchHit, WorkspaceSearchType } from "@chat/shared";
import { searchService, workspaceSearchKey } from "../../services/search";
import { searchResultRoute } from "./helpers";
import "./index.less";

const typeLabels: Record<WorkspaceSearchType, string> = {
  message: "消息",
  document: "文档",
  member: "成员",
  task: "任务",
  notification: "通知",
};
const pageSize = 20;
const typeIcons = {
  message: MessageSquare,
  document: FileText,
  member: Users,
  task: ListTodo,
  notification: Bell,
};

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
      message.error(
        error instanceof Error ? error.message : "无法打开搜索结果",
      );
    }
  }

  return (
    <div className="workspace-page search-page">
      <div className="workspace-page-body search-page-content">
        <header className="workspace-page-header">
          <div className="workspace-page-heading">
            <span className="workspace-eyebrow">
              <Search size={14} /> 统一检索
            </span>
            <h1 className="workspace-page-title">工作区搜索</h1>
            <p className="workspace-page-description">
              搜索消息全文、文档标题与正文、成员、任务和通知。
            </p>
          </div>
        </header>
        <section
          className="workspace-panel search-filter-panel"
          aria-label="工作区搜索筛选"
        >
          <div className="workspace-toolbar search-filter-toolbar">
            <label className="search-keyword-field">
              <span>搜索关键词</span>
              <Input
                prefix={<Search size={16} />}
                aria-label="搜索关键词"
                placeholder="输入关键词搜索工作区"
                allowClear
                value={input}
                onChange={(event) => setInput(event.target.value)}
              />
            </label>
            <label className="search-type-field">
              <span>内容类型</span>
              <Select
                aria-label="搜索类型"
                value={type}
                onChange={(value) => {
                  setType(value);
                  setOffset(0);
                }}
                options={[
                  { value: "all", label: "全部类型" },
                  ...Object.entries(typeLabels).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
            </label>
          </div>
          <p className="search-filter-hint">
            跨消息与工作内容检索，点击结果可直接前往对应位置。
          </p>
        </section>
        <section
          className="workspace-panel search-results-panel"
          aria-label="搜索结果"
          aria-busy={
            Boolean(input.trim()) && (pendingInput || results.isLoading)
          }
        >
          <div className="search-results-heading">
            <h2>{input.trim() ? "搜索结果" : "从关键词开始"}</h2>
            <span aria-live="polite">
              {keyword && !pendingInput && results.data && !results.isError
                ? `共 ${results.data.total} 条结果${results.isFetching ? " · 正在更新" : ""}`
                : "消息 · 文档 · 成员 · 任务 · 通知"}
            </span>
          </div>
          {!input.trim() ? (
            <div className="search-state">
              <Empty
                image={<Search size={40} strokeWidth={1.4} />}
                description={
                  <>
                    <strong>输入关键词开始搜索</strong>
                    <p>快速找到讨论记录、协作文档与待办事项。</p>
                  </>
                }
              />
              <div className="search-content-types">
                {Object.entries(typeLabels).map(([value, label]) => {
                  const Icon = typeIcons[value as WorkspaceSearchType];
                  return (
                    <span key={value}>
                      <Icon size={14} />
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : pendingInput || results.isLoading ? (
            <div
              className="search-state search-loading"
              role="status"
              aria-label="正在搜索"
            >
              <Spin />
              <span>正在查找相关内容…</span>
            </div>
          ) : results.isError ? (
            <Alert
              type="error"
              showIcon
              title={results.error.message || "搜索失败，请重试"}
              action={
                <Button size="small" onClick={() => void results.refetch()}>
                  重试
                </Button>
              }
            />
          ) : !results.data?.items.length ? (
            <div className="search-state">
              <Empty
                image={<Search size={40} strokeWidth={1.4} />}
                description={
                  <>
                    <strong>没有找到匹配结果</strong>
                    <p>试试更简短的关键词，或切换为全部类型。</p>
                  </>
                }
              />
            </div>
          ) : (
            <>
              <div className="search-results-list">
                {results.data.items.map((hit) => {
                  const Icon = typeIcons[hit.type];
                  return (
                    <button
                      key={`${hit.type}:${hit.id}`}
                      type="button"
                      className="search-result-card"
                      onClick={() => void openResult(hit)}
                    >
                      <span className="search-result-icon" aria-hidden="true">
                        <Icon size={19} />
                      </span>
                      <div className="search-result-content">
                        <div className="search-result-heading">
                          <Tag>{typeLabels[hit.type]}</Tag>
                          <strong>{hit.title}</strong>
                          <time dateTime={hit.updatedAt}>
                            {new Date(hit.updatedAt).toLocaleDateString(
                              "zh-CN",
                            )}
                          </time>
                        </div>
                        <p className="search-result-snippet">{hit.snippet}</p>
                      </div>
                      <ArrowUpRight
                        size={16}
                        className="search-result-arrow"
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {keyword && !pendingInput && results.data && !results.isError && (
            <nav className="search-pagination" aria-label="搜索结果分页">
              <Button
                disabled={offset === 0 || results.isFetching}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
              >
                上一页
              </Button>
              <span>第 {offset / pageSize + 1} 页</span>
              <Button
                disabled={!results.data.hasMore || results.isFetching}
                onClick={() => setOffset(offset + pageSize)}
              >
                下一页
              </Button>
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
