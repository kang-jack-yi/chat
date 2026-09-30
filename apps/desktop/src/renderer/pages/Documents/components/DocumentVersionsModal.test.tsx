// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Modal, message } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudDocument, DocumentVersion, DocumentVersionPreview } from "@chat/shared";
import { documentsService } from "../../../services/documents";
import DocumentVersionsModal from "./DocumentVersionsModal";

vi.mock("../../../services/documents", () => ({
  documentsService: {
    versions: vi.fn(),
    previewVersion: vi.fn(),
    createVersion: vi.fn(),
    restoreVersion: vi.fn(),
  },
}));

vi.mock("antd", async (importOriginal) => ({
  ...await importOriginal<typeof import("antd")>(),
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

/** 创建字段完整的文档样本，并允许按测试场景切换权限。 */
function cloudDocument(id = 1, permission: CloudDocument["permission"] = "editor"): CloudDocument {
  return {
    id,
    companyId: 1,
    ownerId: 1,
    title: `文档 ${id}`,
    type: "doc",
    icon: "",
    color: "",
    permission,
    favorite: false,
    members: [],
    createdAt: "2026-09-30T10:00:00.000Z",
    updatedAt: "2026-09-30T10:00:00.000Z",
  };
}

/** 创建具有独立标题、标签和正文的历史版本样本。 */
function version(id: number, documentId = 1): DocumentVersionPreview {
  return {
    id,
    documentId,
    title: `历史标题 ${documentId}-${id}`,
    label: `里程碑 ${id}`,
    author: { id: 1, name: "林远", avatar: "林" },
    createdAt: "2026-09-30T10:00:00.000Z",
    text: `历史正文 ${documentId}-${id}\n第二行内容`,
  };
}

/** 控制服务响应的完成时机，确定性复现文档切换时的异步竞态。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("DocumentVersionsModal", () => {
  let host: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  let versionsByDocument: Map<number, DocumentVersion[]>;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })));
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const getComputedStyle = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
    versionsByDocument = new Map([
      [1, [version(11), version(12)]],
      [2, [version(21, 2)]],
    ]);
    vi.mocked(documentsService.versions).mockImplementation(async (id) => versionsByDocument.get(id) ?? []);
    vi.mocked(documentsService.previewVersion).mockImplementation(async (id, versionId) => version(versionId, id));
    vi.mocked(documentsService.createVersion).mockResolvedValue(version(13));
    vi.mocked(documentsService.restoreVersion).mockResolvedValue({ documentId: 1, restoredVersionId: 12 });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    onClose = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      Modal.destroyAll();
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    host.remove();
    client.clear();
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  /** 保持真实组件与查询缓存挂载，通过属性模拟父页面打开或切换文档。 */
  async function renderDocument(value: CloudDocument | null = cloudDocument()) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <DocumentVersionsModal document={value} onClose={onClose} />
        </QueryClientProvider>,
      );
    });
  }

  /** 等待真实查询通知及弹窗更新，断言超时时保留具体的失败证据。 */
  async function waitFor(check: () => void) {
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      check();
    });
  }

  /** 根据可见文案寻找真实按钮，兼容组件添加的中文字符间距。 */
  function button(label: string): HTMLButtonElement {
    const target = [...document.body.querySelectorAll("button")]
      .find((item) => item.textContent?.replace(/\s/g, "") === label.replace(/\s/g, ""));
    if (!target) throw new Error(`找不到按钮：${label}`);
    return target;
  }

  /** 在 React 更新范围内点击真实按钮，不调用组件内部处理函数。 */
  async function click(label: string) {
    await act(async () => {
      button(label).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  /** 返回当前文档的版本名称输入框。 */
  function labelInput(): HTMLInputElement {
    const target = document.body.querySelector<HTMLInputElement>('input[aria-label="版本名称"]');
    if (!target) throw new Error("找不到版本名称输入框");
    return target;
  }

  /** 以原生输入事件更新受控名称草稿，模拟用户输入。 */
  async function typeLabel(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(labelInput(), value);
      labelInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /** 获取当前预览区域，避免将历史列表的文案误判为预览内容。 */
  function previewText() {
    return document.body.querySelector("section")?.textContent ?? "";
  }

  /** 等待列表载入，再通过真实版本按钮选择历史快照。 */
  async function selectVersion(id: number) {
    let target: HTMLButtonElement | undefined;
    await waitFor(() => {
      target = [...document.body.querySelectorAll("button")]
        .find((item) => item.querySelector("strong")?.textContent?.replace(/\s/g, "") === `里程碑${id}#${id}`);
      expect(target).toBeDefined();
    });
    await act(async () => {
      target!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("载入版本列表并展示标签、作者和版本号，选择前不请求预览", async () => {
    const pending = deferred<DocumentVersion[]>();
    vi.mocked(documentsService.versions).mockReturnValueOnce(pending.promise);
    await renderDocument();
    expect(documentsService.versions).toHaveBeenCalledWith(1);
    expect(document.body.querySelector(".ant-skeleton")).not.toBeNull();
    expect(documentsService.previewVersion).not.toHaveBeenCalled();
    await act(async () => pending.resolve([version(11), version(12)]));
    await waitFor(() => expect(document.body.textContent).toContain("里程碑 12"));
    expect(document.body.textContent).toContain("#11");
    expect(document.body.textContent).toContain("林远");
    expect(previewText()).toContain("选择版本查看内容");
    expect(document.body.querySelector(".ant-skeleton")).toBeNull();
  });

  it("列表载入失败显示错误，点击重试能恢复列表", async () => {
    vi.mocked(documentsService.versions).mockRejectedValueOnce(new Error("版本列表载入失败"));
    await renderDocument();
    await waitFor(() => expect(document.body.textContent).toContain("版本列表载入失败"));
    expect(document.body.textContent).not.toContain("暂无版本");
    await click("重试");
    await waitFor(() => expect(document.body.textContent).toContain("里程碑 11"));
    expect(documentsService.versions).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain("版本列表载入失败");
  });

  it("选择不同版本请求对应预览，展示快照标题和完整纯文本", async () => {
    await renderDocument();
    await selectVersion(11);
    await waitFor(() => expect(previewText()).toContain("历史正文 1-11"));
    expect(documentsService.previewVersion).toHaveBeenLastCalledWith(1, 11);
    expect(previewText()).toContain("历史标题 1-11");
    expect(document.body.querySelector("pre")?.textContent).toBe("历史正文 1-11\n第二行内容");
    await selectVersion(12);
    await waitFor(() => expect(previewText()).toContain("历史正文 1-12"));
    expect(documentsService.previewVersion).toHaveBeenLastCalledWith(1, 12);
    expect(previewText()).not.toContain("历史正文 1-11");
  });

  it("空版本列表展示开始记录提示，不请求不存在的预览", async () => {
    versionsByDocument.set(1, []);
    await renderDocument();
    await waitFor(() => expect(document.body.textContent).toContain("暂无版本，保存当前版本开始记录"));
    expect(previewText()).toContain("选择版本查看内容");
    expect(documentsService.previewVersion).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("恢复此版本");
  });

  it("预览失败显示错误且不能恢复，选择另一版本可正常查看", async () => {
    vi.mocked(documentsService.previewVersion).mockRejectedValueOnce(new Error("预览载入失败"));
    await renderDocument();
    await selectVersion(11);
    await waitFor(() => expect(previewText()).toContain("预览载入失败"));
    expect(document.body.textContent).not.toContain("恢复此版本");
    expect(documentsService.restoreVersion).not.toHaveBeenCalled();
    await selectVersion(12);
    await waitFor(() => expect(previewText()).toContain("历史正文 1-12"));
    expect(previewText()).not.toContain("预览载入失败");
    expect(button("恢复此版本").disabled).toBe(false);
  });

  it("viewer 可以预览但没有版本名称、保存或恢复入口", async () => {
    await renderDocument(cloudDocument(1, "viewer"));
    await selectVersion(11);
    await waitFor(() => expect(previewText()).toContain("历史正文 1-11"));
    expect(document.body.querySelector('input[aria-label="版本名称"]')).toBeNull();
    expect(document.body.textContent).not.toContain("保存当前版本");
    expect(document.body.textContent).not.toContain("恢复此版本");
    expect(documentsService.createVersion).not.toHaveBeenCalled();
    expect(documentsService.restoreVersion).not.toHaveBeenCalled();
  });

  it("editor 提交去除首尾空白的名称，保存后清空草稿并选中新版本", async () => {
    const created = { ...version(13), label: "发布候选" };
    vi.mocked(documentsService.createVersion).mockImplementationOnce(async () => {
      versionsByDocument.set(1, [created, version(11), version(12)]);
      return created;
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await renderDocument();
    await selectVersion(11);
    await waitFor(() => expect(previewText()).toContain("历史正文 1-11"));
    await typeLabel("  发布候选  ");
    await click("保存当前版本");
    await waitFor(() => expect(previewText()).toContain("历史正文 1-13"));
    expect(documentsService.createVersion).toHaveBeenCalledExactlyOnceWith(1, "发布候选");
    expect(documentsService.previewVersion).toHaveBeenLastCalledWith(1, 13);
    expect(labelInput().value).toBe("");
    expect(document.body.textContent).toContain("发布候选");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["document-versions", 1] });
    expect(documentsService.versions).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(message.success).toHaveBeenCalledWith("版本已保存"));
  });

  it("创建失败保留名称和原预览，不提示保存成功或刷新列表", async () => {
    vi.mocked(documentsService.createVersion).mockRejectedValueOnce(new Error("版本保存失败"));
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await renderDocument();
    await selectVersion(11);
    await waitFor(() => expect(previewText()).toContain("历史正文 1-11"));
    await typeLabel("待重试的名称");
    await click("保存当前版本");
    await waitFor(() => expect(message.error).toHaveBeenCalledWith("版本保存失败"));
    expect(labelInput().value).toBe("待重试的名称");
    expect(previewText()).toContain("历史正文 1-11");
    expect(message.success).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("恢复必须先确认，取消不请求 API；确认后使用文档和版本 ID 并刷新相关缓存", async () => {
    const pending = deferred<{ documentId: number; restoredVersionId: number }>();
    vi.mocked(documentsService.restoreVersion).mockReturnValueOnce(pending.promise);
    client.setQueryData(["documents", "all"], [cloudDocument()]);
    client.setQueryData(["documents", "favorites"], []);
    client.setQueryData(["document-versions", 2], [version(21, 2)]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await renderDocument();
    await selectVersion(12);
    await waitFor(() => expect(previewText()).toContain("历史正文 1-12"));
    await click("恢复此版本");
    await waitFor(() => expect(document.body.textContent).toContain("恢复此版本？"));
    expect(document.body.textContent).toContain("关闭该文档编辑窗口并等待保存完成");
    expect(document.body.textContent).toContain("当前内容会自动保留为备份版本");
    expect(documentsService.restoreVersion).not.toHaveBeenCalled();
    await click("取消");
    await waitFor(() => expect(document.body.textContent).not.toContain("确认恢复"));
    expect(documentsService.restoreVersion).not.toHaveBeenCalled();
    await click("恢复此版本");
    await waitFor(() => expect(button("确认恢复")).toBeDefined());
    await click("确认恢复");
    expect(documentsService.restoreVersion).toHaveBeenCalledExactlyOnceWith(1, 12);
    expect(message.success).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ documentId: 1, restoredVersionId: 12 }));
    await waitFor(() => expect(message.success).toHaveBeenCalledWith("已恢复，可重新打开文档查看"));
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey))
      .toEqual([["document-versions", 1], ["documents"]]);
    expect(documentsService.versions).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(["documents", "all"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["documents", "favorites"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["document-versions", 2])?.isInvalidated).toBe(false);
  });

  it("恢复返回 409 时提示冲突，不误报成功或刷新缓存，并可取消确认框", async () => {
    const conflict = Object.assign(new Error("文档仍有协作者在线，请关闭编辑窗口后重试"), {
      response: { status: 409 },
    });
    vi.mocked(documentsService.restoreVersion).mockRejectedValueOnce(conflict);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await renderDocument();
    await selectVersion(12);
    await waitFor(() => expect(previewText()).toContain("历史正文 1-12"));
    await click("恢复此版本");
    await waitFor(() => expect(button("确认恢复")).toBeDefined());
    await click("确认恢复");
    await waitFor(() => expect(message.error).toHaveBeenCalledWith(conflict.message));
    expect(documentsService.restoreVersion).toHaveBeenCalledExactlyOnceWith(1, 12);
    expect(message.success).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(previewText()).toContain("历史正文 1-12");
    await click("取消");
    await waitFor(() => expect(document.body.textContent).not.toContain("确认恢复"));
  });

  it("切换文档不继承名称草稿或选中版本，切回原文档也重新选择", async () => {
    await renderDocument();
    await selectVersion(11);
    await waitFor(() => expect(previewText()).toContain("历史正文 1-11"));
    await typeLabel("第一份草稿");
    await renderDocument(cloudDocument(2));
    await waitFor(() => expect(document.body.textContent).toContain("里程碑 21"));
    expect(labelInput().value).toBe("");
    expect(previewText()).toContain("选择版本查看内容");
    expect(previewText()).not.toContain("历史正文 1-11");
    await selectVersion(21);
    await waitFor(() => expect(previewText()).toContain("历史正文 2-21"));
    await typeLabel("第二份草稿");
    await renderDocument(cloudDocument());
    expect(labelInput().value).toBe("");
    expect(previewText()).toContain("选择版本查看内容");
    expect(previewText()).not.toContain("历史正文 2-21");
  });

  it("点击关闭通知父页面，关闭后重新打开同一文档不继承草稿或选中版本", async () => {
    await renderDocument();
    await selectVersion(11);
    await waitFor(() => expect(previewText()).toContain("历史正文 1-11"));
    await typeLabel("关闭前草稿");
    await act(async () => {
      const close = document.body.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
      if (!close) throw new Error("找不到关闭按钮");
      close.click();
    });
    expect(onClose).toHaveBeenCalledOnce();
    await renderDocument(null);
    expect(document.body.querySelector('input[aria-label="版本名称"]')).toBeNull();
    await renderDocument();
    expect(labelInput().value).toBe("");
    expect(previewText()).toContain("选择版本查看内容");
    expect(previewText()).not.toContain("历史正文 1-11");
  });

  it("旧文档列表迟到不会覆盖新文档的版本列表", async () => {
    const pending = deferred<DocumentVersion[]>();
    vi.mocked(documentsService.versions).mockReturnValueOnce(pending.promise);
    await renderDocument();
    expect(documentsService.versions).toHaveBeenCalledWith(1);
    await renderDocument(cloudDocument(2));
    await waitFor(() => expect(document.body.textContent).toContain("里程碑 21"));
    await act(async () => pending.resolve([version(11)]));
    await waitFor(() => expect(client.getQueryData(["document-versions", 1])).toEqual([version(11)]));
    expect(document.body.textContent).toContain("里程碑 21");
    expect(document.body.textContent).not.toContain("里程碑 11");
    expect(previewText()).toContain("选择版本查看内容");
  });

  it("同一文档旧版本预览迟到不会覆盖后来选择的版本", async () => {
    const pending = deferred<DocumentVersionPreview>();
    vi.mocked(documentsService.previewVersion).mockReturnValueOnce(pending.promise);
    await renderDocument();
    await selectVersion(11);
    expect(documentsService.previewVersion).toHaveBeenCalledWith(1, 11);
    await selectVersion(12);
    await waitFor(() => expect(previewText()).toContain("历史正文 1-12"));
    await act(async () => pending.resolve(version(11)));
    await waitFor(() => expect(client.getQueryData(["document-version", 1, 11])).toEqual(version(11)));
    expect(previewText()).toContain("历史正文 1-12");
    expect(previewText()).not.toContain("历史正文 1-11");
  });

  it("旧文档预览迟到不会覆盖新文档已选版本或名称草稿", async () => {
    const pending = deferred<DocumentVersionPreview>();
    vi.mocked(documentsService.previewVersion).mockReturnValueOnce(pending.promise);
    await renderDocument();
    await selectVersion(11);
    await renderDocument(cloudDocument(2));
    await selectVersion(21);
    await waitFor(() => expect(previewText()).toContain("历史正文 2-21"));
    await typeLabel("新文档草稿");
    await act(async () => pending.resolve(version(11)));
    await waitFor(() => expect(client.getQueryData(["document-version", 1, 11])).toEqual(version(11)));
    expect(previewText()).toContain("历史正文 2-21");
    expect(previewText()).not.toContain("历史正文 1-11");
    expect(labelInput().value).toBe("新文档草稿");
    expect(documentsService.previewVersion).not.toHaveBeenCalledWith(2, 11);
  });

  it("旧文档创建响应迟到只刷新原文档，不清空新文档草稿或选中旧版本", async () => {
    const pending = deferred<DocumentVersion>();
    vi.mocked(documentsService.createVersion).mockReturnValueOnce(pending.promise);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await renderDocument();
    await typeLabel("旧文档版本");
    await click("保存当前版本");
    expect(documentsService.createVersion).toHaveBeenCalledWith(1, "旧文档版本");
    await renderDocument(cloudDocument(2));
    await selectVersion(21);
    await waitFor(() => expect(previewText()).toContain("历史正文 2-21"));
    await typeLabel("新文档草稿");
    await act(async () => pending.resolve(version(13)));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["document-versions", 1] }));
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["document-versions", 2] });
    expect(labelInput().value).toBe("新文档草稿");
    expect(previewText()).toContain("历史正文 2-21");
    expect(documentsService.previewVersion).not.toHaveBeenCalledWith(2, 13);
  });

  it("关闭再打开同一文档时，上次创建的迟到响应不影响新草稿或选中版本", async () => {
    const pending = deferred<DocumentVersion>();
    vi.mocked(documentsService.createVersion).mockReturnValueOnce(pending.promise);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await renderDocument();
    await typeLabel("第一次打开时的版本");
    await click("保存当前版本");
    await renderDocument(null);
    await renderDocument();
    await selectVersion(12);
    await waitFor(() => expect(previewText()).toContain("历史正文 1-12"));
    await typeLabel("重新打开后的草稿");
    await act(async () => pending.resolve(version(13)));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["document-versions", 1] }));
    expect(labelInput().value).toBe("重新打开后的草稿");
    expect(previewText()).toContain("历史正文 1-12");
    expect(documentsService.previewVersion).not.toHaveBeenCalledWith(1, 13);
  });

  it("旧文档恢复响应迟到只刷新原版本列表和文档缓存，不污染新文档状态", async () => {
    const pending = deferred<{ documentId: number; restoredVersionId: number }>();
    vi.mocked(documentsService.restoreVersion).mockReturnValueOnce(pending.promise);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await renderDocument();
    await selectVersion(12);
    await waitFor(() => expect(previewText()).toContain("历史正文 1-12"));
    await click("恢复此版本");
    await waitFor(() => expect(button("确认恢复")).toBeDefined());
    await click("确认恢复");
    expect(documentsService.restoreVersion).toHaveBeenCalledWith(1, 12);
    await renderDocument(cloudDocument(2));
    await selectVersion(21);
    await waitFor(() => expect(previewText()).toContain("历史正文 2-21"));
    await typeLabel("新文档草稿");
    await act(async () => pending.resolve({ documentId: 1, restoredVersionId: 12 }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["documents"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["document-versions", 1] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["document-versions", 2] });
    expect(labelInput().value).toBe("新文档草稿");
    expect(previewText()).toContain("历史正文 2-21");
    expect(previewText()).not.toContain("历史正文 1-12");
  });
});
