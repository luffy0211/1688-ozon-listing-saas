"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, Play, Search } from "lucide-react";
import { PublishDraftButton } from "./api-actions";
import { RunButton } from "./run-button";
import { StatusBadge } from "./status";
import { Button, EmptyState, Select, cn } from "./ui";

export type ProductTableRow = {
  id: string;
  title: string;
  offerId: string;
  sourceUrl: string | null;
  shopName: string;
  imageUrl: string | null;
  assetCount: number;
  draftCount: number;
  latestJobId: string | null;
  latestJobStatus: string | null;
  latestDraftId: string | null;
  latestDraftStatus: string | null;
  priceRub: string | null;
  updatedAt: string;
};

async function postRun(productId: string) {
  const res = await fetch(`/api/v1/products/${productId}/run`, { method: "POST" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message ?? "启动失败");
  return json.data?.jobId as string | undefined;
}

export function ProductDataTable({ rows }: { rows: ProductTableRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const [query, setQuery] = useState("");
  const [shop, setShop] = useState("all");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkLoading, setBulkLoading] = useState(false);

  const shopOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.shopName).filter(Boolean))).sort(),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery = !q || `${row.title} ${row.offerId} ${row.shopName}`.toLowerCase().includes(q);
      const matchesShop = shop === "all" || row.shopName === shop;
      const currentStatus = row.latestDraftStatus ?? row.latestJobStatus ?? "none";
      const matchesStatus = status === "all" || currentStatus === status;
      return matchesQuery && matchesShop && matchesStatus;
    });
  }, [query, rows, shop, status]);

  const columns = useMemo<ColumnDef<ProductTableRow>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="全选商品"
            checked={table.getIsAllPageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`选择 ${row.original.offerId}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: "title",
        header: "商品",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex min-w-[320px] items-center gap-3">
              {item.imageUrl ? (
                <img src={item.imageUrl} alt="" className="h-14 w-14 rounded-md border object-cover" />
              ) : (
                <div className="h-14 w-14 rounded-md border bg-gray-100" />
              )}
              <div className="min-w-0">
                <Link href={`/products/${item.id}`} className="line-clamp-2 font-medium text-gray-950 hover:text-blue-700">
                  {item.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>{item.offerId}</span>
                  {item.sourceUrl ? (
                    <a href={item.sourceUrl} target="_blank" className="text-blue-700 hover:underline">
                      1688
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "shopName",
        header: "来源店铺",
        cell: ({ row }) => <span className="whitespace-nowrap">{row.original.shopName || "-"}</span>,
      },
      {
        accessorKey: "assetCount",
        header: ({ column }) => (
          <button type="button" className="inline-flex items-center gap-1" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            图片
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
      },
      {
        id: "job",
        header: "最近任务",
        cell: ({ row }) => {
          const item = row.original;
          return item.latestJobId ? (
            <Link href={`/jobs/${item.latestJobId}`} className="inline-flex">
              <StatusBadge status={item.latestJobStatus} />
            </Link>
          ) : (
            <span className="text-gray-400">-</span>
          );
        },
      },
      {
        id: "draft",
        header: "草稿",
        cell: ({ row }) => <StatusBadge status={row.original.latestDraftStatus} />,
      },
      {
        accessorKey: "priceRub",
        header: "售价",
        cell: ({ row }) => row.original.priceRub ?? "-",
      },
      {
        accessorKey: "updatedAt",
        header: ({ column }) => (
          <button type="button" className="inline-flex items-center gap-1" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            更新
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => new Date(row.original.updatedAt).toLocaleString("zh-CN"),
      },
      {
        id: "actions",
        header: "操作",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex flex-wrap items-center gap-2">
              <RunButton productId={item.id} />
              {item.latestDraftId && item.latestDraftStatus === "COMPILED" ? (
                <PublishDraftButton draftId={item.latestDraftId} />
              ) : null}
            </div>
          );
        },
        enableSorting: false,
      },
    ],
    [],
  );

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting, rowSelection: selected },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onSortingChange: setSorting,
    onRowSelectionChange: setSelected,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const selectedIds = table.getSelectedRowModel().rows.map((row) => row.original.id);

  async function runSelected() {
    setBulkLoading(true);
    try {
      for (const productId of selectedIds) {
        await postRun(productId);
      }
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      setBulkLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-3 md:grid-cols-[minmax(0,1fr)_220px_180px_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题、Offer ID、店铺"
            className="h-9 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <Select value={shop} onChange={setShop}>
          <option value="all">全部店铺</option>
          {shopOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </Select>
        <Select value={status} onChange={setStatus}>
          <option value="all">全部状态</option>
          <option value="RUNNING">处理中</option>
          <option value="FAILED">失败</option>
          <option value="SUCCEEDED">已完成</option>
          <option value="COMPILED">待发布</option>
          <option value="SUBMITTED">已提交</option>
        </Select>
        <Button onClick={runSelected} disabled={selectedIds.length === 0 || bulkLoading} className="w-full md:w-auto">
          <Play className="h-4 w-4" aria-hidden="true" />
          {bulkLoading ? "批量生成中..." : `批量生成${selectedIds.length ? ` (${selectedIds.length})` : ""}`}
        </Button>
      </div>

      {filteredRows.length === 0 ? (
        <EmptyState title="没有匹配的商品" description="调整搜索词、店铺或状态筛选后再查看。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} className="px-4 py-3 font-semibold">
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-gray-100">
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className={cn("hover:bg-gray-50", row.getIsSelected() && "bg-blue-50/50")}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
