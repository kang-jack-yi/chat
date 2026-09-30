import type { DocumentComment } from "@chat/shared";

export type CommentThreadFilter = "all" | "unresolved" | "resolved";

export interface CommentThread {
  root: DocumentComment;
  replies: DocumentComment[];
}

/** 沿旧评论的父链寻找根评论，缺失父评论或循环引用时保留可展示的线程。 */
function findRoot(
  comment: DocumentComment,
  commentsById: Map<number, DocumentComment>,
): DocumentComment {
  const path: DocumentComment[] = [];
  const visited = new Map<number, number>();
  let current = comment;
  while (current.parentId !== null) {
    const cycleStart = visited.get(current.id);
    if (cycleStart !== undefined) {
      return path.slice(cycleStart).reduce((root, item) =>
        item.id < root.id ? item : root,
      );
    }
    visited.set(current.id, path.length);
    path.push(current);
    const parent = commentsById.get(current.parentId);
    if (!parent || parent.documentId !== comment.documentId) break;
    current = parent;
  }
  return current;
}

/** 按发布时间排序，同一时间用评论 ID 保持稳定顺序。 */
function compareComments(left: DocumentComment, right: DocumentComment): number {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id - right.id;
}

/** 将平铺评论归根为线程，并仅按根评论的解决状态筛选整个线程。 */
export function buildCommentThreads(
  comments: DocumentComment[],
  filter: CommentThreadFilter = "all",
): CommentThread[] {
  const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
  const threadsById = new Map<number, CommentThread>();
  for (const comment of comments) {
    const root = findRoot(comment, commentsById);
    let thread = threadsById.get(root.id);
    if (!thread) {
      thread = { root, replies: [] };
      threadsById.set(root.id, thread);
    }
    if (comment.id !== root.id) thread.replies.push(comment);
  }
  return [...threadsById.values()]
    .filter(({ root }) => filter === "all" || root.resolved === (filter === "resolved"))
    .sort((left, right) => compareComments(left.root, right.root))
    .map((thread) => ({ ...thread, replies: thread.replies.sort(compareComments) }));
}
