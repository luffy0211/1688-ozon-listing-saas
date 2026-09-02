"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  PackageCheck,
  PackageSearch,
  RefreshCw,
  Store,
} from "lucide-react";
import { PublishDraftButton } from "./api-actions";
import { RunButton } from "./run-button";
import { StatusBadge } from "./status";
import { Badge, Button, Card, EmptyState, Table, cn } from "./ui";

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
  imageUrl: string | null;
  shopName: string;
  assetCount: number;
  latestJobId: string | null;
  latestJobStatus: string | null;
  latestDraftStatus: string | null;
};

type Draft = {
  id: string;
  productId: string;
  title: string;
  offerId: string;
  imageUrl: string | null;
  storeName: string;
  priceRub: string | null;
  status: string;
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

const steps = [
  { id: 1, title: "选品", subtitle: "1688 采集", icon: Store },
  { id: 2, title: "审核", subtitle: "商品筛选", icon: ClipboardCheck },
  { id: 3, title: "上架", subtitle: "Ozon 发布", icon: PackageCheck },
  { id: 4, title: "监控", subtitle: "效果追踪", icon: BarChart3 },
];

function ProductImage({ src }: { src: string | null }) {
  return src ? (
    <img src={src} alt="" className="h-28 w-full rounded-md object-cover" />
  ) : (
    <div className="flex h-28 w-full items-center justify-center rounded-md bg-gray-100 text-xs text-gray-400">
      无图片
    </div>
  );
}

export function WorkflowWizard({
  snapshots,
  products,
  drafts,
  jobs,
}: {
  snapshots: Snapshot[];
  products: Product[];
  drafts: Draft[];
  jobs: Job[];
}) {
  const [currentStep, setCurrentStep] = useState(1);
  const [monitorTab, setMonitorTab] = useState<"listed" | "pending" | "failed">("listed");

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
            <Link href="/shops">
              <Button>
                <PackageSearch className="h-4 w-4" />
                去采集
              </Button>
            </Link>
          </div>
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
                  {item.url ? (
                    <a href={item.url} target="_blank" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-700">
                      查看来源 <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无待选新品" description="先进入采集页面，同步 1688 店铺商品。" />
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
            <Link href="/products" className="text-sm font-medium text-blue-700 hover:underline">商品池</Link>
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
                  <div className="mt-3 flex items-center gap-2">
                    <RunButton productId={product.id} />
                    <Link href={`/products/${product.id}`} className="text-sm font-medium text-blue-700 hover:underline">详情</Link>
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
            <Link href="/drafts" className="text-sm font-medium text-blue-700 hover:underline">待发布列表</Link>
          </div>
          {drafts.length ? (
            <Table head={["商品", "店铺", "状态", "价格", "操作"]}>
              {drafts.map((draft) => (
                <tr key={draft.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex min-w-[280px] items-center gap-3">
                      {draft.imageUrl ? <img src={draft.imageUrl} alt="" className="h-12 w-12 rounded-md object-cover" /> : <div className="h-12 w-12 rounded-md bg-gray-100" />}
                      <div className="min-w-0">
                        <Link href={`/products/${draft.productId}`} className="line-clamp-2 font-medium text-gray-950 hover:text-blue-700">{draft.title}</Link>
                        <div className="text-xs text-gray-500">{draft.offerId}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{draft.storeName}</td>
                  <td className="px-4 py-3"><StatusBadge status={draft.status} /></td>
                  <td className="px-4 py-3">{draft.priceRub ? `${draft.priceRub} RUB` : "-"}</td>
                  <td className="px-4 py-3">
                    {draft.status === "COMPILED" ? <PublishDraftButton draftId={draft.id} /> : <Link href={`/products/${draft.productId}`} className="text-sm font-medium text-blue-700 hover:underline">查看</Link>}
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
            <Link href="/jobs">
              <Button variant="outline">
                <RefreshCw className="h-4 w-4" />
                任务记录
              </Button>
            </Link>
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
              <Table head={["商品", "店铺", "状态", "错误", "操作"]}>
                {failedJobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{job.title}<div className="text-xs text-gray-500">{job.offerId}</div></td>
                    <td className="px-4 py-3">{job.storeName}</td>
                    <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                    <td className="max-w-md truncate px-4 py-3 text-red-700">{job.error ?? job.stepName ?? "-"}</td>
                    <td className="px-4 py-3"><Link href={`/jobs/${job.id}`} className="text-sm font-medium text-blue-700 hover:underline">查看任务</Link></td>
                  </tr>
                ))}
              </Table>
            ) : <EmptyState title="没有失败任务" />
          ) : (
            <Table head={["商品", "店铺", "状态", "价格", "操作"]}>
              {(monitorTab === "listed" ? submittedDrafts : compiledDrafts).map((draft) => (
                <tr key={draft.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{draft.title}<div className="text-xs text-gray-500">{draft.offerId}</div></td>
                  <td className="px-4 py-3">{draft.storeName}</td>
                  <td className="px-4 py-3"><StatusBadge status={draft.status} /></td>
                  <td className="px-4 py-3">{draft.priceRub ? `${draft.priceRub} RUB` : "-"}</td>
                  <td className="px-4 py-3"><Link href={`/products/${draft.productId}`} className="text-sm font-medium text-blue-700 hover:underline">查看商品</Link></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : null}
    </div>
  );
}
