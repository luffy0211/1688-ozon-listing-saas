"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";
import { Button, Card, Input, Select } from "./ui";

type CreditTenant = {
  id: string;
  name: string;
  balance: number;
};

export function AdminCreditAdjuster({ tenants }: { tenants: CreditTenant[] }) {
  const router = useRouter();
  const [visibleTenants, setVisibleTenants] = useState(tenants);
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? "");
  const [mode, setMode] = useState<"grant" | "deduct">("grant");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedTenant = useMemo(
    () => visibleTenants.find((tenant) => tenant.id === tenantId),
    [tenantId, visibleTenants],
  );

  useEffect(() => {
    setVisibleTenants(tenants);
  }, [tenants]);

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/admin/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          mode,
          amount: Number(amount),
          reason,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "积分调整失败");
      }
      const nextBalance = payload?.data?.account?.balance;
      if (typeof nextBalance === "number") {
        setVisibleTenants((current) =>
          current.map((tenant) =>
            tenant.id === tenantId ? { ...tenant, balance: nextBalance } : tenant,
          ),
        );
      }
      setAmount("");
      setReason("");
      setMessage("积分已更新，流水已记录。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "积分调整失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="h-full">
      <form onSubmit={submitAdjustment} className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-950">手动调整积分</h2>
          <p className="mt-1 text-sm leading-6 text-gray-500">
            第一版用于管理员手动加积分、扣积分和留痕。支付接入后会自动写入同一套流水。
          </p>
        </div>

        <Select label="租户" value={tenantId} onChange={setTenantId}>
          {visibleTenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}（余额 {tenant.balance}）
            </option>
          ))}
        </Select>

        <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
          <Select label="操作" value={mode} onChange={(value) => setMode(value === "deduct" ? "deduct" : "grant")}>
            <option value="grant">加积分</option>
            <option value="deduct">扣积分</option>
          </Select>
          <Input
            label="数量"
            type="number"
            value={amount}
            onChange={setAmount}
            placeholder="例如 1000"
            required
          />
        </div>

        <Input
          label="原因"
          value={reason}
          onChange={setReason}
          placeholder="例如：线下收款、测试赠送、异常扣回"
          required
        />

        <div className="rounded-xl border border-[#e1eaf4] bg-[#f9fbfe] px-3 py-2 text-sm text-gray-600">
          当前租户余额：
          <span className="ml-1 font-semibold text-gray-950">{selectedTenant?.balance ?? 0}</span>
        </div>

        {message ? (
          <div className="rounded-xl border border-[#dbe6fb] bg-[#f2f6fd] px-3 py-2 text-sm font-medium text-[#52627b]">
            {message}
          </div>
        ) : null}

        <Button type="submit" disabled={submitting || visibleTenants.length === 0} className="w-full">
          {mode === "grant" ? <Plus className="h-4 w-4" aria-hidden="true" /> : <Minus className="h-4 w-4" aria-hidden="true" />}
          {submitting ? "提交中" : mode === "grant" ? "确认加积分" : "确认扣积分"}
        </Button>
      </form>
    </Card>
  );
}
