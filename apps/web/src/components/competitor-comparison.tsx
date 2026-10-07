"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, ExternalLink, ImageOff, RefreshCw, ScanSearch, X, ZoomIn } from "lucide-react";
import { Button, cn } from "./ui";
import { displayProductImageUrl } from "@/lib/product-image";
import { extractOfferId } from "@/lib/agent/chat-input";
import type { AgentInsightSource } from "./agent-insight-panel";

type Data = Record<string, unknown>;
export type ComparisonAction = {
  type: string;
  id?: string;
  storeId?: string | null;
  offerId?: string | null;
  status?: string;
  payload?: unknown;
  updatedAt?: string;
};
const record = (value: unknown): Data => value && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const price = (value: unknown) => number(value) === null ? "价格暂未获取" : `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;

export function safeExternalUrl(value: unknown) {
  const url = text(value);
  if (!url) return null;
  try { return ["https:", "http:"].includes(new URL(url).protocol) ? url : null; } catch { return null; }
}

export function comparisonSamples(value: unknown) {
  return list(record(value).samples).map(record).filter((sample) => Object.keys(sample).length > 0);
}

export function matchingContentDraft(sample: Data, actions: ComparisonAction[]) {
  const storeId = text(sample.storeId);
  const offerId = text(sample.offerId);
  if (!storeId || !offerId) return undefined;
  return actions.filter((action) => action.type === "CONTENT_DRAFT" && action.id
    && action.storeId === storeId && action.offerId === offerId && action.status === "PENDING_APPROVAL")
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
}

export function refreshComparisonPrompt(sample: Data) {
  const count = list(sample.competitors).length;
  return `分析竞品：仅重新采集当前店铺的 ${text(sample.categoryName) ?? "该商品所属"} 类目竞品，参考自家商品 ${text(sample.offerId) ?? "未指定"}，采集 ${count || 1} 个竞品。其他类目继续复用已有数据。`;
}

function categoryKey(sample: Data) {
  return `${text(sample.storeId) ?? "unknown"}:${sample.descriptionCategoryId ?? ""}:${sample.typeId ?? text(sample.categoryName) ?? "unknown"}`;
}

function capturedDate(value: unknown) {
  const date = text(value) ? new Date(String(value)) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "采集时间未知";
}

function ExpandableText({ value, empty = "暂未获取", summary = false }: { value: unknown; empty?: string; summary?: boolean }) {
  const content = text(value);
  if (!content) return <p className="text-sm text-gray-500">{empty}</p>;
  return <div className="min-w-0 text-sm leading-6 text-gray-800 [overflow-wrap:anywhere]">
    {summary ? <div className="mb-1 text-xs text-amber-700">仅有摘要</div> : null}
    {content.length > 140 ? <details className="group">
      <summary className="cursor-pointer list-none rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
        <span className="group-open:hidden">{content.slice(0, 140)}… </span>
        <span className="text-xs font-medium text-blue-700 group-open:hidden">{summary ? "展开摘要" : "展开全文"}</span>
        <span className="hidden text-xs font-medium text-blue-700 group-open:inline">收起</span>
      </summary>
      <p className="mt-1 whitespace-pre-wrap">{content}</p>
    </details> : <p className="whitespace-pre-wrap">{content}</p>}
  </div>;
}

function ProductImage({ url, label, missing, analysis, onZoom }: { url: unknown; label: string; missing: string; analysis?: unknown; onZoom: (src: string, label: string) => void }) {
  const [failed, setFailed] = useState(false);
  const safe = safeExternalUrl(url);
  const src = safe ? displayProductImageUrl(safe) : null;
  const advice = safe && record(analysis).imageUrl === safe ? text(record(analysis).recommendationZh) : null;
  return <>
    <div className="flex h-56 w-full items-center justify-center bg-gray-50 sm:h-64">
    {src && !failed ? <button type="button" title={`放大${label}`} aria-label={`放大${label}`} onClick={() => onZoom(src, label)}
      className="group relative h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
      <img src={src} alt={label} onError={() => setFailed(true)} className="h-full w-full object-contain p-2" />
      <ZoomIn className="absolute bottom-3 right-3 h-7 w-7 rounded bg-white p-1 text-gray-600 shadow-sm" aria-hidden="true" />
    </button> : <div className="flex flex-col items-center gap-2 text-sm text-gray-500"><ImageOff className="h-7 w-7" aria-hidden="true" />{failed ? "图片加载失败" : missing}</div>}
    </div>
    {advice ? <div className="mt-2 border-l-2 border-emerald-300 pl-2"><p className="mb-1 text-xs text-emerald-700">主图观察</p><ExpandableText value={advice} /></div> : null}
  </>;
}

function ImagePreview({ image, onClose }: { image: { src: string; label: string }; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    ref.current?.showModal();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} aria-label={image.label} onCancel={onClose} onClose={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) ref.current?.close(); }}
    className="fixed m-auto max-h-[94vh] w-[min(960px,94vw)] max-w-none rounded-lg border border-gray-200 bg-white p-3 shadow-xl backdrop:bg-black/60">
    <div className="mb-2 flex items-center justify-between gap-2"><span className="text-sm font-semibold">{image.label}</span>
      <button type="button" autoFocus title="关闭图片" aria-label="关闭图片" onClick={() => ref.current?.close()} className="flex h-9 w-9 items-center justify-center rounded border hover:bg-gray-100 focus-visible:outline-blue-500"><X className="h-5 w-5" /></button>
    </div>
    <img src={image.src} alt={image.label} className="max-h-[80vh] w-full object-contain" />
  </dialog>;
}

function Keywords({ product }: { product: Data }) {
  const tags = list(product.tags).map(text).filter(Boolean);
  const terms = list(product.extractedKeywords).map((value) => text(record(value).term)).filter(Boolean);
  return <div className="space-y-2 text-sm leading-6 [overflow-wrap:anywhere]">
    <div><span className="text-xs text-gray-500">主题标签</span><p>{tags.length ? tags.join(" · ") : "暂无标签数据"}</p></div>
    <div><span className="text-xs text-gray-500">文案关键词（提取）</span><p>{terms.length ? terms.join(" · ") : "暂未提取"}</p></div>
  </div>;
}

function Description({ product, readState }: { product: Data; readState?: unknown }) {
  const full = text(product.fullDescription);
  return <ExpandableText value={full ?? product.description} summary={!full && Boolean(text(product.description)) && product.descriptionIsSummary !== false}
    empty={readState === "missing" ? "确认未填写简介" : "暂未获取简介"} />;
}

function ComparisonRow({ label, own, competitor }: { label: string; own: React.ReactNode; competitor: React.ReactNode }) {
  return <div className="border-b border-gray-200 py-4 last:border-b-0">
    <h4 className="mb-2 text-xs font-semibold text-gray-500">{label}</h4>
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
      <div className="min-w-0"><div className="mb-1 text-xs font-semibold text-blue-700 sm:hidden">自家商品</div>{own}</div>
      <div className="min-w-0"><div className="mb-1 text-xs font-semibold text-emerald-700 sm:hidden">竞品参考</div>{competitor}</div>
    </div>
  </div>;
}

function ReferenceNotes({ sample, competitor, draft, onOpenDraft }: { sample: Data; competitor: Data; draft?: ComparisonAction; onOpenDraft?: (id: string) => void }) {
  const own = record(sample.own);
  const ownPrice = number(own.priceRub);
  const competitorPrice = number(competitor.priceRub);
  const suggestions = list(record(draft?.payload).suggestions).map(record)
    .filter((item) => ["title", "description"].includes(String(item.field)) && text(item.suggestedRu)).slice(0, 3);
  return <div className="mt-4 border-l-2 border-blue-500 bg-blue-50/60 px-4 py-3">
    <h4 className="text-sm font-semibold text-gray-950">{suggestions.length ? "建议改什么" : "参考观察"}</h4>
    {suggestions.length ? <div className="mt-2 space-y-3">{suggestions.map((item, index) => <div key={index}>
      <div className="mb-1 text-xs font-semibold text-blue-700">{item.field === "title" ? "标题" : "简介"} · 待确认修改</div>
      <ExpandableText value={item.suggestedRu} />
      {text(item.reasonZh) ? <p className="mt-1 text-xs text-gray-600">{String(item.reasonZh)}</p> : null}
    </div>)}</div> : <p className="mt-2 text-sm leading-6 text-gray-700">当前显示双方实际内容；尚无关联的待确认修改草案，不会修改商品。</p>}
    {ownPrice !== null && competitorPrice !== null ? <p className="mt-2 text-sm text-gray-700">当前参考商品价格{competitorPrice === ownPrice ? "与自家相同" : `比自家${competitorPrice > ownPrice ? "高" : "低"} ${price(Math.abs(competitorPrice - ownPrice))}`}。价格差异不代表销量或质量差异。</p> : null}
    {draft?.id && suggestions.length && onOpenDraft ? <div className="mt-3">
      <Button variant="outline" onClick={() => onOpenDraft(draft.id!)} className="h-auto min-h-9 whitespace-normal text-left"><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />查看并编辑修改内容</Button>
    </div> : null}
  </div>;
}

export function CompetitorComparison({ source, actions = [], activeStoreId, onOpenDraft, onRun }: {
  source?: AgentInsightSource | null;
  actions?: ComparisonAction[];
  activeStoreId?: string;
  onOpenDraft?: (id: string) => void;
  onRun?: (prompt: string) => void;
}) {
  const samples = comparisonSamples(source?.contentDiagnosis);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [productIndex, setProductIndex] = useState(0);
  const [competitorIndex, setCompetitorIndex] = useState(0);
  const [image, setImage] = useState<{ src: string; label: string } | null>(null);
  const categories = [...new Map(samples.map((sample) => [categoryKey(sample), text(sample.categoryName) ?? "类目待核实"])).entries()];
  const category = categories.some(([key]) => key === selectedCategory) ? selectedCategory : categories[0]?.[0];
  const products = samples.filter((sample) => categoryKey(sample) === category);
  const sample = products[productIndex] ?? products[0];
  const own = record(sample?.own);
  const competitors = list(sample?.competitors).map(record);
  const competitor = competitors[competitorIndex] ?? competitors[0];
  const comparison = record(sample?.comparison);
  const timestamp = Date.parse(text(sample?.capturedAt) ?? "");
  const outdated = Number.isFinite(timestamp) && Date.now() - timestamp > 7 * 86400000;
  const matchingStore = Boolean(activeStoreId && activeStoreId === text(sample?.storeId));
  const refreshTargetValid = Boolean(sample && text(sample.offerId)
    && extractOfferId(refreshComparisonPrompt(sample)) === text(sample.offerId)
    && competitors.length >= 1 && competitors.length <= 10);
  const draft = sample ? matchingContentDraft(sample, actions) : undefined;
  const zoom = (src: string, label: string) => setImage({ src, label });

  return <section aria-label="同类竞品对比" className="min-w-0 border-t border-gray-200 py-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-base font-semibold text-gray-950"><ScanSearch className="h-5 w-5 text-emerald-700" aria-hidden="true" />同类竞品对比</h3>
      {sample ? <span className="text-xs text-gray-500">{categories.length} 个类目 · 当前 {competitors.length} 个参考商品</span> : null}
    </div>
    {!sample ? <p className="mt-3 text-sm text-gray-500">本次未取得同类竞品数据，暂时无法对比。</p> : <>
      <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-xs font-medium text-gray-600">类目
          <select aria-label="对比类目" value={category} onChange={(event) => { setSelectedCategory(event.target.value); setProductIndex(0); setCompetitorIndex(0); }} className="mt-1 block h-10 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-900 focus-visible:outline-blue-500">
            {categories.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-xs font-medium text-gray-600">自家商品
          <select aria-label="对比自家商品" value={products.indexOf(sample)} onChange={(event) => { setProductIndex(Number(event.target.value)); setCompetitorIndex(0); }} className="mt-1 block h-10 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-900 focus-visible:outline-blue-500">
            {products.map((item, index) => <option key={index} value={index}>{text(record(item.own).title) ?? text(item.offerId) ?? "未命名商品"} · {text(item.offerId) ?? "编号暂未获取"}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <span>竞品采集于 {capturedDate(sample.capturedAt)}</span>
        {outdated ? <span className="text-amber-800">竞品数据已超过 7 天，仍可参考</span> : null}
        {outdated && onRun ? <Button variant="ghost" disabled={!matchingStore || !refreshTargetValid} title={!matchingStore ? "先切换到该报告的店铺；旧报告缺少店铺标识时请重新诊断" : !refreshTargetValid ? "无法确认更新范围，请在对话中指定商品和数量" : "按当前类目和数量更新竞品"}
          onClick={() => { if (matchingStore && refreshTargetValid) onRun(refreshComparisonPrompt(sample)); }}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />更新竞品</Button> : null}
      </div>
      {competitors.length ? <div className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-2" aria-label="选择参考竞品">
        {competitors.map((item, index) => {
          const src = safeExternalUrl(item.imageUrl);
          return <button key={`${item.sku ?? item.url ?? index}`} type="button" aria-label={`对比竞品 ${index + 1}：${text(item.title) ?? "未命名商品"}`} aria-pressed={item === competitor}
            onClick={() => setCompetitorIndex(index)} className={cn("flex h-16 w-48 shrink-0 items-center gap-2 rounded-lg border bg-white p-2 text-left focus-visible:outline-blue-500", item === competitor ? "border-emerald-600 ring-1 ring-emerald-600" : "border-gray-200 hover:border-gray-400")}>
            {src ? <img src={displayProductImageUrl(src)} alt="" className="h-12 w-10 shrink-0 object-contain" /> : <ImageOff className="h-10 w-10 shrink-0 text-gray-400" aria-hidden="true" />}
            <span className="min-w-0"><span className="block text-[11px] text-gray-500">竞品 {index + 1}</span><span className="line-clamp-2 break-words text-xs text-gray-800">{text(item.title) ?? "标题暂未获取"}</span></span>
          </button>;
        })}
      </div> : <p className="mt-3 text-sm text-gray-500">该类目暂未取得有效竞品，暂时无法对比。</p>}
      {competitor ? <div key={`${category}:${sample.offerId}:${competitor.sku ?? competitor.url ?? competitorIndex}`}>
        <div className="mt-3 hidden grid-cols-2 gap-6 border-b border-gray-200 pb-2 sm:grid"><h4 className="text-sm font-semibold text-blue-700">自家商品</h4><h4 className="text-sm font-semibold text-emerald-700">竞品参考</h4></div>
        <ComparisonRow label="主图" own={<ProductImage key={String(own.imageUrl)} url={own.imageUrl} analysis={own.imageAnalysis} label="自家商品主图" missing={record(comparison.mainImage).ownReadState === "missing" ? "确认未上传主图" : "图片暂未获取"} onZoom={zoom} />}
          competitor={<ProductImage key={String(competitor.imageUrl)} url={competitor.imageUrl} analysis={competitor.imageAnalysis} label="竞品主图" missing="图片暂未获取" onZoom={zoom} />} />
        <ComparisonRow label="标题" own={<><ExpandableText value={own.title} /><p className="mt-2 break-all text-xs text-gray-500">{text(sample.offerId) ?? "商品编号暂未获取"}</p></>}
          competitor={<><ExpandableText value={competitor.title} />{safeExternalUrl(competitor.url) ? <a href={safeExternalUrl(competitor.url)!} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-blue-700 underline">查看原商品<ExternalLink className="h-3 w-3" aria-hidden="true" /></a> : null}</>} />
        <ComparisonRow label="价格" own={<p className="text-lg font-semibold text-gray-950">{price(own.priceRub)}</p>} competitor={<p className="text-lg font-semibold text-gray-950">{price(competitor.priceRub)}</p>} />
        <ComparisonRow label="销量" own={<p className="text-sm text-gray-500">暂无销量数据</p>} competitor={<p className="text-sm text-gray-500">暂无销量数据</p>} />
        <ComparisonRow label="评分与评价（不代表销量）" own={<p className="text-sm text-gray-700">评分 {number(own.rating) ?? "暂未获取"} · 评价 {number(own.reviewCount) ?? "暂未获取"}</p>}
          competitor={<p className="text-sm text-gray-700">评分 {number(competitor.rating) ?? "暂未获取"} · 评价 {number(competitor.reviewCount) ?? "暂未获取"}</p>} />
        <ComparisonRow label="标签与关键词" own={<Keywords product={own} />} competitor={<Keywords product={competitor} />} />
        <ComparisonRow label="简介" own={<Description product={own} readState={record(comparison.description).ownReadState} />} competitor={<Description product={competitor} />} />
        {number(record(comparison.price).competitorMedianRub) !== null ? <p className="mt-2 text-xs text-gray-500">类目汇总 · 参考商品价格中位数 {price(record(comparison.price).competitorMedianRub)}</p> : null}
        <ReferenceNotes sample={sample} competitor={competitor} draft={draft} onOpenDraft={onOpenDraft} />
      </div> : null}
    </>}
    {image ? <ImagePreview image={image} onClose={() => setImage(null)} /> : null}
  </section>;
}
