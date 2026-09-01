"use client";

import { useState } from "react";
import { RefreshCcw } from "lucide-react";
import { Button, Select } from "./ui";

export function OzonAnalyticsControls({
  storeId,
  stores,
}: {
  storeId: string | null;
  stores: Array<{ id: string; name: string; isDefault: boolean }>;
}) {
  const [selectedStoreId, setSelectedStoreId] = useState(storeId ?? stores[0]?.id ?? "");
  const [loading, setLoading] = useState(false);

  function changeStore(id: string) {
    setSelectedStoreId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("storeId", id);
    else url.searchParams.delete("storeId");
    window.location.href = url.toString();
  }

  async function sync() {
    if (!selectedStoreId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/v1/ozon/analytics/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStoreId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error?.message ?? "同步失败");
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      setLoading(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
      {stores.length > 1 ? (
        <div className="w-full sm:w-56">
          <Select label="Ozon 店铺" value={selectedStoreId} onChange={changeStore}>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}{store.isDefault ? " · 默认" : ""}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <Button onClick={sync} disabled={loading || !selectedStoreId} className="w-full sm:w-auto">
        <RefreshCcw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
        {loading ? "同步中" : "刷新 Ozon 数据"}
      </Button>
    </div>
  );
}
