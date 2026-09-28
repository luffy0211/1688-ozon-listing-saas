import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentInsightPanel, type AgentInsightSource } from "../../apps/web/src/components/agent-insight-panel";
import { ContentDraftGroup } from "../../apps/web/src/components/content-agent-drafts";
import "../../apps/web/src/app/globals.css";

const image = "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&auto=format&fit=crop";
const description = "Мужская футболка для повседневного гардероба. Прямой крой, круглый вырез и однотонный дизайн. Хорошо сочетается с джинсами и брюками. ";
const samples = ["Футболка / T恤", "Поло / Polo衫", "Рубашка / 衬衫", "Худи / 连帽衫", "Платье / 连衣裙"].map((categoryName, index) => ({
  storeId: "preview-store", offerId: `DEMO-${index}`, typeId: index + 1, categoryName,
  capturedAt: "2020-01-01T00:00:00Z",
  own: { title: `自家示例 ${index + 1} · Футболка мужская`, imageUrl: image, priceRub: 1299, rating: 4.6, reviewCount: 28, fullDescription: description, extractedKeywords: [{ term: "футболка", count: 1 }] },
  competitors: Array.from({ length: 8 }, (_, item) => ({
    sku: `demo-${index}-${item}`, title: `参考示例 ${index + 1}-${item + 1} · Футболка мужская базовая`,
    imageUrl: item === 7 ? null : image, priceRub: item === 6 ? null : 1399 + item * 100,
    rating: 4.8, reviewCount: 180 + item, fullDescription: item === 7 ? null : description.repeat(5),
    description: item === 7 ? "旧报告仅保留的简介摘要" : description,
    extractedKeywords: [{ term: "базовая", count: 2 }, { term: "повседневная", count: 1 }],
  })),
  comparison: { price: { competitorMedianRub: 1699 } },
}));
const source: AgentInsightSource = { toolName: "analyze_ozon_competitors", label: "同类商品参考", status: "ok", at: "2020-01-01", contentDiagnosis: { samples } };
const initialActions = samples.slice(0, 2).map((sample, index) => ({
  id: `preview-draft-${index}`, type: "CONTENT_DRAFT", status: "PENDING_APPROVAL", riskLevel: "MEDIUM", title: `优化 ${sample.offerId}`, rationale: "演示：标题更明确地说明商品类型和使用场景。",
  storeId: "preview-store", offerId: sample.offerId, error: null, updatedAt: "2026-09-28T00:00:00Z",
  payload: { suggestions: [{ field: "title", current: sample.own.title, suggestedRu: "Футболка мужская однотонная для повседневного гардероба", reasonZh: "保留商品类型，补充已有商品信息能够支持的穿搭场景。" }] },
}));

function Preview() {
  const [focus, setFocus] = useState<{ actionId: string } | null>(null);
  const [notice, setNotice] = useState("");
  return <main className="min-h-screen bg-[#f3f6fa] px-3 py-4 sm:px-8">
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900">本地交互预览 · 演示数据 · 不调用店铺 API，不采集、不扣费</div>
      <h1 className="text-xl font-semibold text-gray-950">Ozon 运营 Agent</h1>
      <div className="mt-4 bg-white p-4 sm:p-6">
        <p className="text-sm text-gray-700">已整理同类商品参考。先看双方内容，再核对标题修改建议。</p>
        <AgentInsightPanel sources={[source]} requestPrompt="分析同类竞品" actions={initialActions} activeStoreId="preview-store" onOpenDraft={(actionId) => setFocus({ actionId })} onRun={() => setNotice("演示：已选择更新竞品，未发起任何请求。")} />
      </div>
      <ContentDraftGroup actions={initialActions} focusRequest={focus} onCommand={async () => { setNotice("演示：确认按钮已触发，未写入 Ozon。"); return false; }} />
      <p role="status" className="mt-3 text-sm text-blue-700">{notice}</p>
    </div>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
