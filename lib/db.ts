import { createClient } from "@/lib/supabase/client";

export type Document = {
  id: string;
  title: string;
  userId: string;
  isArchived: boolean;
  isDraft: boolean;
  parentDocument: string | null;
  content: string | null;
  coverImage: string | null;
  icon: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
};

/** 侧边栏用，不含 content 和 coverImage */
export type SidebarDocument = Omit<Document, "content" | "coverImage">;

function supabase() {
  return createClient();
}

// ---- Queries ----

/** 一次性拉取侧边栏全部文档（不含正文），前端本地按 parentDocument 建树 */
export async function getSidebarAll(userId: string): Promise<SidebarDocument[]> {
  const { data } = await supabase()
    .from("documents")
    .select("id, title, userId, isArchived, isDraft, parentDocument, icon, isPublished, createdAt, updatedAt")
    .eq("userId", userId)
    .eq("isArchived", false)
    .order("createdAt", { ascending: false });

  return (data || []) as SidebarDocument[];
}

/** @deprecated 使用 getSidebarAll 替代 */
export async function getSidebar(userId: string, parentDocument?: string | null) {
  const query = supabase()
    .from("documents")
    .select("*")
    .eq("userId", userId)
    .eq("isArchived", false)
    .order("createdAt", { ascending: false });

  if (parentDocument) {
    query.eq("parentDocument", parentDocument);
  } else {
    query.is("parentDocument", null);
  }

  const { data } = await query;
  return data || [];
}

export async function getTrash(userId: string) {
  const { data } = await supabase()
    .from("documents")
    .select("*")
    .eq("userId", userId)
    .eq("isArchived", true)
    .order("createdAt", { ascending: false });

  return data || [];
}

export async function getSearch(userId: string) {
  const { data } = await supabase()
    .from("documents")
    .select("*")
    .eq("userId", userId)
    .eq("isArchived", false)
    .order("createdAt", { ascending: false });

  return data || [];
}

// 请求去重：Navbar 和 Page 同时请求同一个文档时共用同一个 promise
const pendingById = new Map<string, Promise<Document>>();

export async function getById(documentId: string) {
  if (pendingById.has(documentId)) return pendingById.get(documentId)!;
  const promise = _getById(documentId);
  pendingById.set(documentId, promise);
  promise.finally(() => pendingById.delete(documentId));
  return promise;
}

async function _getById(documentId: string) {
  const { data, error } = await supabase()
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !data) throw new Error("Not found");
  return data as Document;
}

// ---- Mutations ----

export async function create(userId: string, title: string, parentDocument?: string | null) {
  const { data, error } = await supabase()
    .from("documents")
    .insert({
      title,
      userId,
      parentDocument: parentDocument || null,
      isArchived: false,
      isPublished: false,
    })
    .select("id")
    .single();

  if (error || !data) throw error;
  return data.id;
}

export async function update(id: string, fields: Partial<Pick<Document, "title" | "content" | "coverImage" | "icon" | "isPublished" | "isDraft">>) {
  const { error } = await supabase()
    .from("documents")
    .update(fields)
    .eq("id", id);

  if (error) throw error;
}

export async function archive(userId: string, id: string) {
  // Recursively archive children first
  const { data: children } = await supabase()
    .from("documents")
    .select("id")
    .eq("userId", userId)
    .eq("parentDocument", id);

  if (children) {
    for (const child of children) {
      await archive(userId, child.id);
    }
  }

  const { error } = await supabase()
    .from("documents")
    .update({ isArchived: true })
    .eq("id", id);

  if (error) throw error;
}

export async function restore(userId: string, id: string) {
  // Recursively restore children
  const { data: children } = await supabase()
    .from("documents")
    .select("id")
    .eq("userId", userId)
    .eq("parentDocument", id);

  if (children) {
    for (const child of children) {
      await restore(userId, child.id);
    }
  }

  // Check if parent is archived — if so, detach
  const { data: doc } = await supabase()
    .from("documents")
    .select("parentDocument")
    .eq("id", id)
    .single();

  const updateFields: Record<string, any> = { isArchived: false };
  if (doc?.parentDocument) {
    const { data: parent } = await supabase()
      .from("documents")
      .select("isArchived")
      .eq("id", doc.parentDocument)
      .single();
    if (parent?.isArchived) {
      updateFields.parentDocument = null;
    }
  }

  const { error } = await supabase()
    .from("documents")
    .update(updateFields)
    .eq("id", id);

  if (error) throw error;
}

export async function remove(id: string) {
  const { error } = await supabase()
    .from("documents")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

export async function removeIcon(id: string) {
  const { error } = await supabase()
    .from("documents")
    .update({ icon: null })
    .eq("id", id);

  if (error) throw error;
}

export async function removeCoverImage(id: string) {
  const { error } = await supabase()
    .from("documents")
    .update({ coverImage: null })
    .eq("id", id);

  if (error) throw error;
}
