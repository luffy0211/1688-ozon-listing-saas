"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "./ui";

export function AdminTenantCreator() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInviteCode("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/admin/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? "创建客户失败");
      setName("");
      setInviteCode(payload.data.inviteCode);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建客户失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="border-y border-[#e3ebf5] bg-white/75 px-4 py-4 md:px-5">
      <form onSubmit={createTenant} className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1 text-sm font-medium text-[#26334d]">
          客户名称
          <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required className="mt-1 h-9 w-full rounded-md border border-[#d8e4f2] bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder="输入客户或公司名称" />
        </label>
        <Button type="submit" disabled={submitting}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {submitting ? "创建中" : "新建客户"}
        </Button>
      </form>
      {error ? <p role="alert" className="mt-2 text-sm text-red-600">{error}</p> : null}
      {inviteCode ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[#52627b]">
          <span>一次性邀请码（7 天有效）：</span>
          <input aria-label="一次性邀请码" readOnly value={inviteCode} onClick={(event) => event.currentTarget.select()} className="h-9 w-[240px] rounded-md border border-[#d8e4f2] bg-white px-3 font-mono text-sm text-[#17223d]" />
        </div>
      ) : null}
    </section>
  );
}
