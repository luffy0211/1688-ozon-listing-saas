"use client";

import { Play } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui";

export function RunButton({ productId }: { productId: string }) {
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/products/${productId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoPublish: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data?.jobId) {
        window.location.reload();
      } else {
        alert(json.error?.message ?? "启动失败");
        setLoading(false);
      }
    } catch {
      alert("启动失败");
      setLoading(false);
    }
  }

  return (
    <Button onClick={run} disabled={loading}>
      <Play className="h-4 w-4" aria-hidden="true" />
      {loading ? "上架中..." : "立即上架"}
    </Button>
  );
}
