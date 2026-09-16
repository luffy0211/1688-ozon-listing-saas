import { Badge } from "./ui";

type BadgeTone = "gray" | "green" | "red" | "amber" | "blue" | "violet";

const labels: Record<string, string> = {
  NEW: "待选品",
  KNOWN: "已采集",
  IMPORTED_TO_PRODUCT_POOL: "已入商品池",
  IGNORED: "已忽略",
  NOT_SEEN_IN_LATEST_SYNC: "本次未出现",
  PENDING: "等待处理",
  RUNNING: "处理中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  SKIPPED: "已跳过",
  DRAFT: "未完成",
  COMPILED: "待提交",
  SUBMITTED: "已提交",
};

const tones: Record<string, BadgeTone> = {
  NEW: "blue",
  KNOWN: "gray",
  IMPORTED_TO_PRODUCT_POOL: "green",
  IGNORED: "amber",
  NOT_SEEN_IN_LATEST_SYNC: "gray",
  PENDING: "gray",
  RUNNING: "amber",
  SUCCEEDED: "green",
  FAILED: "red",
  SKIPPED: "amber",
  DRAFT: "gray",
  COMPILED: "blue",
  SUBMITTED: "green",
};

export function statusLabel(status?: string | null) {
  return status ? labels[status] ?? status : "-";
}

export function statusTone(status?: string | null): BadgeTone {
  return status ? tones[status] ?? "gray" : "gray";
}

export function StatusBadge({ status }: { status?: string | null }) {
  return <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>;
}

export function stepLabel(step: string) {
  const labelsByStep: Record<string, string> = {
    validate_import: "检查商品资料",
    download_assets: "准备图片",
    normalize_product_facts: "整理商品信息",
    translate_product_info: "翻译商品内容",
    match_ozon_category: "匹配 Ozon 类目",
    generate_ozon_content: "生成 Ozon 内容",
    generate_pricing: "计算售价",
    create_xiangji_pdp_design: "生成详情图设计",
    poll_xiangji_design: "等待详情图设计",
    create_xiangji_pdp_preview: "生成详情图预览",
    create_xiangji_pdp_images: "生成详情图",
    qc_check: "上架前检查",
    compile_ozon_payload: "生成 Ozon 数据",
    submit_ozon: "提交 Ozon",
  };
  return labelsByStep[step] ?? step;
}
