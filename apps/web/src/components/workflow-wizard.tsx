"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Eye,
  ExternalLink,
  PackageCheck,
  PackageSearch,
  RefreshCw,
  Store,
  X,
} from "lucide-react";
import { PublishDraftButton } from "./api-actions";
import { StatusBadge } from "./status";
import { Badge, Button, Card, EmptyState, Input, Select, Table, cn } from "./ui";

type Snapshot = {
  id: string;
  title: string;
  offerId: string;
  imageUrl: string | null;
  priceText: string | null;
  shopName: string;
  url: string | null;
  lastSeenAt: string;
};

type Product = {
  id: string;
  title: string;
  offerId: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  shopName: string;
  assetCount: number;
  latestJobId: string | null;
  latestJobStatus: string | null;
  latestDraftId: string | null;
  latestDraftStatus: string | null;
  priceRub: string | null;
  attributes: Array<{ name: string; value: string }>;
  skus: Array<{ name: string; priceCny: string | null; stockText: string | null }>;
};

type Draft = {
  id: string;
  productId: string;
  title: string;
  offerId: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  storeName: string;
  priceRub: string | null;
  status: string;
  attributes: Array<{ name: string; value: string }>;
  skus: Array<{ name: string; priceCny: string | null; stockText: string | null }>;
};

type Job = {
  id: string;
  productId: string;
  title: string;
  offerId: string;
  storeName: string;
  status: string;
  stepName: string | null;
  error: string | null;
};

type Credential = {
  id: string;
  name: string;
};

type DetailItem = {
  id: string;
  productId: string;
  title: string;
  offerId: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  shopName: string;
  assetCount: number;
  jobStatus: string | null;
  draftId: string | null;
  draftStatus: string | null;
  priceRub: string | null;
  attributes: Array<{ name: string; value: string }>;
  skus: Array<{ name: string; priceCny: string | null; stockText: string | null }>;
};

const steps = [
  { id: 1, title: "选品", subtitle: "1688 采集", icon: Store },
  { id: 2, title: "审核", subtitle: "商品筛选", icon: ClipboardCheck },
  { id: 3, title: "上架", subtitle: "Ozon 发布", icon: PackageCheck },
  { id: 4, title: "监控", subtitle: "效果追踪", icon: BarChart3 },
];

function ProductImage({ src }: { src: string | null }) {
  return src ? (
    <img src={src} alt="" className="h-36 w-full rounded-md border bg-white object-contain" />
  ) : (
    <div className="flex h-28 w-full items-center justify-center rounded-md bg-gray-100 text-xs text-gray-400">
      无图片
    </div>
  );
}

async function postJson(path: string, payload: unknown = {}) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message ?? "请求失败");
  return json.data;
}

function CollectPanel({
  credentials,
  onDone,
}: {
  credentials: Credential[];
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"product" | "shop">("product");
  const [url, setUrl] = useState("");
  const [limit, setLimit] = useState("20");
  const [credentialId, setCredentialId] = useState(credentials[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const data = await postJson(
        mode === "product" ? "/api/v1/products/import-by-url" : "/api/v1/shops/import-by-url",
        mode === "product"
          ? { url, credentialId: credentialId || undefined }
          : { shopUrl: url, limit: Number(limit), credentialId: credentialId || undefined },
      );
      setMessage(mode === "product" ? "商品已采集到商品池。" : `已采集 ${data?.collectedCount ?? 0} 个商品。`);
      setUrl("");
      onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="mb-3 flex flex-wrap gap-2">
        {[
          ["product", "单品链接"],
          ["shop", "店铺链接"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id as "product" | "shop")}
            className={cn(
              "h-9 rounded-md border px-3 text-sm font-medium",
              mode === id ? "border-blue-500 bg-white text-blue-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-100",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={cn("grid gap-3", mode === "shop" ? "md:grid-cols-[minmax(0,1fr)_150px_200px_auto]" : "md:grid-cols-[minmax(0,1fr)_200px_auto]")}>
        <Input
          label={mode === "product" ? "1688 商品链接 / offerId" : "1688 店铺链接"}
          value={url}
          onChange={setUrl}
          placeholder={mode === "product" ? "https://detail.1688.com/offer/..." : "https://...1688.com/"}
          required
        />
        {mode === "shop" ? <Input label="采集数量" type="number" value={limit} onChange={setLimit} required /> : null}
        <Select label="登录信息" value={credentialId} onChange={setCredentialId}>
          <option value="">使用最新登录态</option>
          {credentials.map((cred) => (
            <option key={cred.id} value={cred.id}>
              {cred.name}
            </option>
          ))}
        </Select>
        <div className="flex items-end">
          <Button type="submit" disabled={loading || !url.trim()} className="w-full">
            <PackageSearch className="h-4 w-4" />
            {loading ? "采集中..." : "采集"}
          </Button>
        </div>
      </div>
      {message ? <div className="mt-3 text-sm text-gray-600">{message}</div> : null}
    </form>
  );
}

function InlineRunButton({
  productId,
  onDone,
}: {
  productId: string;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState("");

  async function run() {
    setLoading(true);
    setError("");
    try {
      const data = await postJson(`/api/v1/products/${productId}/run`);
      setJobId(data?.jobId ?? "");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={run} disabled={loading}>
        <PackageCheck className="h-4 w-4" />
        {loading ? "生成中..." : "生成草稿"}
      </Button>
      {jobId ? <div className="text-xs text-emerald-700">任务已创建：{jobId}</div> : null}
      {error ? <div className="text-xs text-red-600">{error}</div> : null}
    </div>
  );
}

function ProductDetailModal({
  item,
  onClose,
  onRunDone,
}: {
  item: DetailItem | null;
  onClose: () => void;
  onRunDone: () => void;
}) {
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const images = item?.imageUrls.length ? item.imageUrls : item?.imageUrl ? [item.imageUrl] : [];
  const currentImage = activeImage && images.includes(activeImage) ? activeImage : images[0] ?? null;

  useEffect(() => {
    setActiveImage(null);
  }, [item?.id]);

  useEffect(() => {
    if (!item) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/45 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-gray-950">{item.title}</h3>
            <p className="mt-1 text-xs text-gray-500">Offer ID: {item.offerId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            aria-label="关闭详情"
            title="关闭详情"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid max-h-[calc(90vh-73px)] gap-5 overflow-auto p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <div className="flex aspect-square max-h-[58vh] items-center justify-center rounded-md border border-gray-200 bg-white">
              {currentImage ? (
                <img src={currentImage} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-sm text-gray-400">无图片</span>
              )}
            </div>
            {images.length > 1 ? (
              <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
                {images.slice(0, 16).map((src, index) => (
                  <button
                    key={`${src}-${index}`}
                    type="button"
                    onClick={() => setActiveImage(src)}
                    className={cn(
                      "aspect-square rounded-md border bg-white p-1",
                      src === currentImage ? "border-blue-500 ring-2 ring-blue-100" : "border-gray-200 hover:border-gray-300",
                    )}
                    aria-label={`查看第 ${index + 1} 张图片`}
                  >
                    <img src={src} alt="" className="h-full w-full object-contain" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <aside className="space-y-4">
            <div>
              <div className="text-xs font-medium text-gray-500">商品标题</div>
              <div className="mt-1 text-sm font-medium leading-6 text-gray-950">{item.title}</div>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border border-gray-200 p-3">
                <dt className="text-xs text-gray-500">店铺</dt>
                <dd className="mt-1 truncate font-medium text-gray-950">{item.shopName}</dd>
              </div>
              <div className="rounded-md border border-gray-200 p-3">
                <dt className="text-xs text-gray-500">图片</dt>
                <dd className="mt-1 font-medium text-gray-950">{item.assetCount} 张</dd>
              </div>
              <div className="rounded-md border border-gray-200 p-3">
                <dt className="text-xs text-gray-500">任务</dt>
                <dd className="mt-1"><StatusBadge status={item.jobStatus ?? "PENDING"} /></dd>
              </div>
              <div className="rounded-md border border-gray-200 p-3">
                <dt className="text-xs text-gray-500">草稿</dt>
                <dd className="mt-1"><StatusBadge status={item.draftStatus ?? "PENDING"} /></dd>
              </div>
            </dl>
            <div className="rounded-md border border-gray-200 p-3">
              <div className="text-xs text-gray-500">售价</div>
              <div className="mt-1 text-lg font-semibold text-gray-950">{item.priceRub ? `${item.priceRub} RUB` : "-"}</div>
            </div>
            <div className="rounded-md border border-gray-200 p-3">
              <div className="mb-2 text-xs font-medium text-gray-500">商品属性</div>
              {item.attributes.length ? (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  {item.attributes.map((attr) => (
                    <div key={`${attr.name}-${attr.value}`} className="min-w-0">
                      <dt className="truncate text-gray-400">{attr.name}</dt>
                      <dd className="mt-0.5 truncate font-medium text-gray-800" title={attr.value}>{attr.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <div className="text-xs text-gray-400">暂无属性</div>
              )}
            </div>
            <div className="rounded-md border border-gray-200 p-3">
              <div className="mb-2 text-xs font-medium text-gray-500">规格</div>
              {item.skus.length ? (
                <div className="space-y-2">
                  {item.skus.map((sku) => (
                    <div key={`${sku.name}-${sku.priceCny ?? ""}-${sku.stockText ?? ""}`} className="rounded-md bg-gray-50 px-2 py-1.5 text-xs">
                      <div className="truncate font-medium text-gray-800" title={sku.name}>{sku.name}</div>
                      <div className="mt-1 flex gap-2 text-gray-500">
                        {sku.priceCny ? <span>{sku.priceCny} CNY</span> : null}
                        {sku.stockText ? <span>{sku.stockText}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-gray-400">暂无规格</div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-gray-200 pt-4">
              {item.sourceUrl ? (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  打开 1688
                </a>
              ) : null}
              {item.draftId && item.draftStatus === "COMPILED" ? (
                <PublishDraftButton draftId={item.draftId} />
              ) : (
                <InlineRunButton productId={item.productId} onDone={onRunDone} />
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export function WorkflowWizard({
  credentials,
  snapshots,
  products,
  drafts,
  jobs,
}: {
  credentials: Credential[];
  snapshots: Snapshot[];
  products: Product[];
  drafts: Draft[];
  jobs: Job[];
}) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [monitorTab, setMonitorTab] = useState<"listed" | "pending" | "failed">("listed");
  const [detailItem, setDetailItem] = useState<DetailItem | null>(null);

  function refreshOnStep(step: number) {
    setCurrentStep(step);
    router.refresh();
  }

  useEffect(() => {
    const saved = Number(window.sessionStorage.getItem("ozon_workflow_step"));
    if (saved >= 1 && saved <= 4) setCurrentStep(saved);
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem("ozon_workflow_step", String(currentStep));
  }, [currentStep]);

  const completed = useMemo(
    () => new Set([
      ...(snapshots.length || products.length ? [1] : []),
      ...(products.length ? [2] : []),
      ...(drafts.length ? [3] : []),
    ]),
    [snapshots.length, products.length, drafts.length],
  );
  const submittedDrafts = drafts.filter((draft) => draft.status === "SUBMITTED");
  const compiledDrafts = drafts.filter((draft) => draft.status === "COMPILED");
  const failedJobs = jobs.filter((job) => job.status === "FAILED");
  const productDetails = useMemo(
    () =>
      new Map(
        products.map((product) => [
          product.id,
          {
            id: product.id,
            productId: product.id,
            title: product.title,
            offerId: product.offerId,
            sourceUrl: product.sourceUrl,
            imageUrl: product.imageUrl,
            imageUrls: product.imageUrls,
            shopName: product.shopName,
            assetCount: product.assetCount,
            jobStatus: product.latestJobStatus,
            draftId: product.latestDraftId,
            draftStatus: product.latestDraftStatus,
            priceRub: product.priceRub,
            attributes: product.attributes,
            skus: product.skus,
          },
        ]),
      ),
    [products],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm md:grid-cols-4">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const active = currentStep === step.id;
          const done = completed.has(step.id);
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => setCurrentStep(step.id)}
              className={cn(
                "flex min-w-0 items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors",
                active ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white hover:bg-gray-50",
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                  active ? "bg-blue-600 text-white" : done ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500",
                )}
              >
                {done && !active ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-gray-950">{step.title}</span>
                <span className="block truncate text-xs text-gray-500">{step.subtitle}</span>
              </span>
              {index < steps.length - 1 ? <ChevronRight className="ml-auto hidden h-4 w-4 text-gray-300 xl:block" /> : null}
            </button>
          );
        })}
      </div>

      {currentStep === 1 ? (
        <Card>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-950">从 1688 采集商品</h2>
              <p className="mt-1 text-sm text-gray-500">先看店铺新品，再把要上架的商品放进商品池。</p>
            </div>
          </div>
          <CollectPanel credentials={credentials} onDone={() => refreshOnStep(2)} />
          {snapshots.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {snapshots.map((item) => (
                <div key={item.id} className="rounded-md border border-gray-200 p-3">
                  <ProductImage src={item.imageUrl} />
                  <div className="mt-3 line-clamp-2 text-sm font-medium text-gray-950">{item.title}</div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-500">
                    <span className="truncate">{item.shopName}</span>
                    <span>{item.priceText ?? "-"}</span>
                  </div>
                  <div className="mt-3 text-xs text-gray-500">{item.offerId}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无待选新品" description="在上方输入 1688 商品或店铺链接开始采集。" />
          )}
        </Card>
      ) : null}

      {currentStep === 2 ? (
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-950">审核商品并生成草稿</h2>
              <p className="mt-1 text-sm text-gray-500">商品确认后，点击生成草稿进入翻译、定价、详情图和 Ozon payload 编译。</p>
            </div>
          </div>
          {products.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {products.map((product) => (
                <div key={product.id} className="rounded-md border border-gray-200 p-3">
                  <ProductImage src={product.imageUrl} />
                  <div className="mt-3 line-clamp-2 text-sm font-medium text-gray-950">{product.title}</div>
                  <div className="mt-1 text-xs text-gray-500">{product.offerId}</div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge tone="gray">{product.assetCount} 张图</Badge>
                    <StatusBadge status={product.latestDraftStatus ?? product.latestJobStatus ?? "PENDING"} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setDetailItem(productDetails.get(product.id) ?? null)}
                    >
                      <Eye className="h-4 w-4" aria-hidden="true" />
                      详情
                    </Button>
                    <InlineRunButton productId={product.id} onDone={() => refreshOnStep(4)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="商品池为空" description="先从 1688 采集页导入商品。" />
          )}
        </Card>
      ) : null}

      {currentStep === 3 ? (
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-950">确认发布到 Ozon</h2>
              <p className="mt-1 text-sm text-gray-500">只有待发布草稿会显示确认上架按钮。</p>
            </div>
          </div>
          {drafts.length ? (
            <Table head={["商品", "店铺", "状态", "价格", "操作"]}>
              {drafts.map((draft) => (
                <tr key={draft.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex min-w-[280px] items-center gap-3">
                      {draft.imageUrl ? <img src={draft.imageUrl} alt="" className="h-14 w-14 rounded-md border bg-white object-contain" /> : <div className="h-14 w-14 rounded-md bg-gray-100" />}
                      <div className="min-w-0">
                        <div className="line-clamp-2 font-medium text-gray-950">{draft.title}</div>
                        <div className="text-xs text-gray-500">{draft.offerId}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{draft.storeName}</td>
                  <td className="px-4 py-3"><StatusBadge status={draft.status} /></td>
                  <td className="px-4 py-3">{draft.priceRub ? `${draft.priceRub} RUB` : "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() =>
                          setDetailItem({
                            id: draft.id,
                            productId: draft.productId,
                            title: draft.title,
                            offerId: draft.offerId,
                            sourceUrl: draft.sourceUrl,
                            imageUrl: draft.imageUrl,
                            imageUrls: draft.imageUrls,
                            shopName: draft.storeName,
                            assetCount: draft.imageUrls.length,
                            jobStatus: null,
                            draftId: draft.id,
                            draftStatus: draft.status,
                            priceRub: draft.priceRub,
                            attributes: draft.attributes,
                            skus: draft.skus,
                          })
                        }
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        详情
                      </Button>
                      {draft.status === "COMPILED" ? <PublishDraftButton draftId={draft.id} /> : <span className="text-sm text-gray-500">已处理</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="暂无 Ozon 草稿" description="先在审核步骤生成草稿。" />
          )}
        </Card>
      ) : null}

      {currentStep === 4 ? (
        <Card>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-950">上架监控</h2>
              <p className="mt-1 text-sm text-gray-500">看已提交商品、待发布草稿和失败任务。</p>
            </div>
            <Button variant="outline" onClick={() => router.refresh()}>
              <RefreshCw className="h-4 w-4" />
              刷新状态
            </Button>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {([
              ["listed", `已提交 ${submittedDrafts.length}`],
              ["pending", `待发布 ${compiledDrafts.length}`],
              ["failed", `失败 ${failedJobs.length}`],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMonitorTab(id)}
                className={cn(
                  "h-9 rounded-md border px-3 text-sm font-medium",
                  monitorTab === id ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {monitorTab === "failed" ? (
            failedJobs.length ? (
              <Table head={["商品", "店铺", "状态", "错误", "记录"]}>
                {failedJobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{job.title}<div className="text-xs text-gray-500">{job.offerId}</div></td>
                    <td className="px-4 py-3">{job.storeName}</td>
                    <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                    <td className="max-w-md truncate px-4 py-3 text-red-700">{job.error ?? job.stepName ?? "-"}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{job.id}</td>
                  </tr>
                ))}
              </Table>
            ) : <EmptyState title="没有失败任务" />
          ) : (
            <Table head={["商品", "店铺", "状态", "价格", "记录"]}>
              {(monitorTab === "listed" ? submittedDrafts : compiledDrafts).map((draft) => (
                <tr key={draft.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{draft.title}<div className="text-xs text-gray-500">{draft.offerId}</div></td>
                  <td className="px-4 py-3">{draft.storeName}</td>
                  <td className="px-4 py-3"><StatusBadge status={draft.status} /></td>
                  <td className="px-4 py-3">{draft.priceRub ? `${draft.priceRub} RUB` : "-"}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{draft.id}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : null}
      <ProductDetailModal item={detailItem} onClose={() => setDetailItem(null)} onRunDone={() => refreshOnStep(4)} />
    </div>
  );
}
