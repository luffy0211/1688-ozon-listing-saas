export type ContentDraftEdit = {
  field: "title" | "description";
  suggestedRu: string;
};

type ContentDraftEditError = {
  field: string | null;
  message: string;
};

const fieldLabels: Record<ContentDraftEdit["field"], string> = {
  title: "标题",
  description: "描述",
};

export function validateContentDraftEdits(
  value: unknown,
  allowedFields?: ReadonlySet<string>,
): { success: true; edits: ContentDraftEdit[] } | { success: false; error: ContentDraftEditError } {
  if (!Array.isArray(value) || value.length === 0) {
    return { success: false, error: { field: null, message: "没有可以写入 Ozon 的标题或描述" } };
  }
  const seen = new Set<string>();
  const edits: ContentDraftEdit[] = [];
  for (const raw of value) {
    const item = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const field = typeof item.field === "string" ? item.field.trim() : "";
    if (field !== "title" && field !== "description") {
      return { success: false, error: { field: field || null, message: "只能修改这份草案的标题或描述" } };
    }
    const label = fieldLabels[field];
    if (allowedFields && !allowedFields.has(field)) {
      return { success: false, error: { field, message: `${label}不属于这份草案` } };
    }
    if (seen.has(field)) {
      return { success: false, error: { field, message: `${label}重复提交` } };
    }
    seen.add(field);
    const suggestedRu = typeof item.suggestedRu === "string" ? item.suggestedRu.trim() : "";
    if (!suggestedRu) {
      return { success: false, error: { field, message: `${label}不能为空` } };
    }
    if (suggestedRu.length > 3000) {
      return { success: false, error: { field, message: `${label}不能超过 3000 个字符` } };
    }
    edits.push({ field, suggestedRu });
  }
  return { success: true, edits };
}
