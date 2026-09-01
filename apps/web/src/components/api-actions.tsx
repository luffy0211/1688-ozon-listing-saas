"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { Check, Download, EyeOff, RefreshCcw, Save } from "lucide-react";
import { statusLabel, StatusBadge } from "./status";
import { Button, Input, Select } from "./ui";

async function postJson(path: string, payload: unknown = {}) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message ?? "请求失败");
  return json;
}

async function patchJson(path: string, payload: unknown = {}) {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message ?? "请求失败");
  return json;
}

export function PostButton({
  path,
  label,
  payload,
}: {
  path: string;
  label: string;
  payload?: unknown;
}) {
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      await postJson(path, payload);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      setLoading(false);
    }
  }

  return (
    <Button onClick={submit} disabled={loading}>
      {loading ? "处理中..." : label}
    </Button>
  );
}

export type Source1688CredentialView = {
  id: string;
  name: string | null;
  status: string;
  lastVerifiedAt: string | null;
  createdAt: string;
};

export function Source1688CookieForm({
  credentials,
}: {
  credentials: Source1688CredentialView[];
}) {
  const [name, setName] = useState("默认 1688 账号");
  const [cookie, setCookie] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const json = await postJson("/api/v1/1688-credentials", { name, cookie });
      const markerText = json.data?.hasLoginMarkers ? "" : "，但没有识别到常见登录标记";
      alert(`已保存 ${json.data?.cookieCount ?? 0} 个 Cookie${markerText}`);
      window.location.href = "/shops";
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <form className="space-y-3" onSubmit={submit}>
        <Input label="名称" value={name} onChange={setName} placeholder="默认 1688 账号" />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">1688 Cookie</span>
          <textarea
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            placeholder="cna=...; aui=...; _m_h5_tk=..."
            required
            className="min-h-28 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <Button type="submit" disabled={loading}>
          <Save className="h-4 w-4" aria-hidden="true" />
          {loading ? "保存中..." : "保存登录信息"}
        </Button>
      </form>
      <div className="space-y-2 text-sm">
        <div className="font-medium text-gray-700">已保存登录信息</div>
        {credentials.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-4 text-gray-500">暂无登录信息</div>
        ) : (
          credentials.map((cred) => (
            <div key={cred.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
              <span>{cred.name || cred.id}</span>
              <span className="text-gray-500">
                {statusLabel(cred.status)} / {cred.lastVerifiedAt ? new Date(cred.lastVerifiedAt).toLocaleString("zh-CN") : "未验证"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function ShopImportForm({
  credentials,
}: {
  credentials: Source1688CredentialView[];
}) {
  const activeCredentials = credentials.filter((cred) => cred.status === "active");
  const [shopUrl, setShopUrl] = useState("");
  const [limit, setLimit] = useState("50");
  const [credentialId, setCredentialId] = useState(activeCredentials[0]?.id ?? "");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const json = await postJson("/api/v1/shops/import-by-url", {
        shopUrl,
        limit: Number(limit),
        credentialId: credentialId || undefined,
      });
      window.location.href = "/products";
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      setLoading(false);
    }
  }

  return (
    <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_220px_auto]" onSubmit={submit}>
      <Input
        label="1688 店铺链接"
        value={shopUrl}
        onChange={setShopUrl}
        placeholder="https://shop...1688.com/"
        required
      />
      <Input
        label="采集数量"
        type="number"
        value={limit}
        onChange={setLimit}
        placeholder="50"
        required
      />
      <Select label="登录信息" value={credentialId} onChange={setCredentialId}>
        <option value="">使用最新登录信息</option>
        {activeCredentials.map((cred) => (
          <option key={cred.id} value={cred.id}>
            {cred.name || cred.id}
          </option>
        ))}
      </Select>
      <div className="flex items-end">
        <Button type="submit" disabled={loading} className="w-full md:w-auto">
          <Download className="h-4 w-4" aria-hidden="true" />
          {loading ? "采集中..." : "开始采集"}
        </Button>
      </div>
    </form>
  );
}

export type ShopSnapshotView = {
  id: string;
  offerId: string;
  title: string;
  url: string | null;
  imageUrl: string | null;
  priceText: string | null;
  followStatus: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export function ShopSnapshotActions({
  shopId,
  snapshots,
}: {
  shopId: string;
  snapshots: ShopSnapshotView[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = snapshots.length > 0 && snapshots.every((s) => selectedSet.has(s.id));

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  function toggleAll() {
    setSelected(allSelected ? [] : snapshots.map((s) => s.id));
  }

  async function importSelected() {
    setLoading("import");
    try {
      const json = await postJson(`/api/v1/shops/${shopId}/import-new-products`, {
        snapshotIds: selected,
      });
      const failures = json.data?.failures ?? [];
      if (failures.length > 0) {
        alert(`已处理 ${json.data.scanned} 个，失败 ${failures.length} 个。第一个错误：${failures[0].error}`);
      }
      window.location.href = "/products";
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      setLoading("");
    }
  }

  async function changeStatus(action: "ignore" | "restore") {
    setLoading(action);
    try {
      await patchJson(`/api/v1/shops/${shopId}/snapshots`, {
        snapshotIds: selected,
        action,
      });
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      setLoading("");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={toggleAll} variant="outline">
          {allSelected ? "取消全选" : "全选"}
        </Button>
        <Button onClick={importSelected} disabled={selected.length === 0 || Boolean(loading)}>
          <Check className="h-4 w-4" aria-hidden="true" />
          {loading === "import" ? "导入中..." : "导入商品池"}
        </Button>
        <Button
          onClick={() => changeStatus("ignore")}
          disabled={selected.length === 0 || Boolean(loading)}
          variant="outline"
        >
          <EyeOff className="h-4 w-4" aria-hidden="true" />
          {loading === "ignore" ? "忽略中..." : "忽略"}
        </Button>
        <Button
          onClick={() => changeStatus("restore")}
          disabled={selected.length === 0 || Boolean(loading)}
          variant="outline"
        >
          <RefreshCcw className="h-4 w-4" aria-hidden="true" />
          {loading === "restore" ? "恢复中..." : "恢复"}
        </Button>
        <span className="text-sm text-gray-500">已选 {selected.length} 个</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="w-10 px-4 py-3">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全选商品快照" />
              </th>
              <th className="px-4 py-3 font-semibold">商品</th>
              <th className="px-4 py-3 font-semibold">状态</th>
              <th className="px-4 py-3 font-semibold">价格</th>
              <th className="px-4 py-3 font-semibold">最后采集</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {snapshots.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(item.id)}
                    onChange={() => toggle(item.id)}
                    aria-label={`选择 ${item.offerId}`}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
                    ) : (
                      <div className="h-12 w-12 rounded-md bg-gray-100" />
                    )}
                    <div className="min-w-0">
                      <a href={item.url ?? "#"} target="_blank" className="line-clamp-2 font-medium text-blue-700">
                        {item.title || item.offerId}
                      </a>
                      <div className="mt-0.5 text-xs text-gray-500">{item.offerId}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3"><StatusBadge status={item.followStatus} /></td>
                <td className="px-4 py-3">{item.priceText ?? "-"}</td>
                <td className="px-4 py-3 text-gray-500">{new Date(item.lastSeenAt).toLocaleString("zh-CN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PublishDraftButton({ draftId }: { draftId: string }) {
  const [loading, setLoading] = useState(false);

  async function publish() {
    if (!window.confirm("确认提交这个商品到 Ozon？")) return;
    setLoading(true);
    try {
      await postJson(`/api/v1/drafts/${draftId}/publish`);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      setLoading(false);
    }
  }

  return (
    <Button onClick={publish} disabled={loading} variant="success">
      <Check className="h-4 w-4" aria-hidden="true" />
      {loading ? "提交中..." : "确认上架"}
    </Button>
  );
}

export function StoreForm() {
  const [form, setForm] = useState({
    name: "",
    clientId: "",
    apiKey: "",
    sellerId: "",
    translationVendor: "DeepL",
    isDefault: true,
  });
  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <form
      className="grid gap-3 md:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await postJson("/api/v1/stores/ozon", form);
          window.location.reload();
        } catch (error) {
          alert(error instanceof Error ? error.message : String(error));
        }
      }}
    >
      <Input label="店铺名称" value={form.name} onChange={(v) => set("name", v)} required />
      <Input label="Ozon Client ID" value={form.clientId} onChange={(v) => set("clientId", v)} required />
      <Input label="Ozon API Key" type="password" value={form.apiKey} onChange={(v) => set("apiKey", v)} required />
      <Input label="Seller ID" value={form.sellerId} onChange={(v) => set("sellerId", v)} />
      <Input label="翻译供应商" value={form.translationVendor} onChange={(v) => set("translationVendor", v)} />
      <label className="flex items-center gap-2 pt-6 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(e) => set("isDefault", e.target.checked)}
        />
        默认店铺
      </label>
      <div className="md:col-span-2">
        <Button type="submit">
          <Save className="h-4 w-4" aria-hidden="true" />
          保存 Ozon 店铺
        </Button>
      </div>
    </form>
  );
}

export function XiangjiForm() {
  const [name, setName] = useState("默认象寄账号");
  const [apiKey, setApiKey] = useState("");

  return (
    <form
      className="grid gap-3 md:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await postJson("/api/v1/xiangji-credentials", { name, apiKey });
          window.location.reload();
        } catch (error) {
          alert(error instanceof Error ? error.message : String(error));
        }
      }}
    >
      <Input label="名称" value={name} onChange={setName} />
      <Input label="X-API-Key" type="password" value={apiKey} onChange={setApiKey} required />
      <div className="md:col-span-2">
        <Button type="submit">
          <Save className="h-4 w-4" aria-hidden="true" />
          保存象寄 Key
        </Button>
      </div>
    </form>
  );
}

export function PricingRuleForm() {
  const [form, setForm] = useState({
    name: "默认定价规则",
    domesticShippingCny: "0",
    packagingCny: "1",
    cnyToRub: "12",
    internationalShippingRub: "120",
    commissionRate: "0.15",
    targetMarginRate: "0.2",
    isDefault: true,
  });
  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <form
      className="grid gap-3 md:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await postJson("/api/v1/pricing-rules", {
            ...form,
            domesticShippingCny: Number(form.domesticShippingCny),
            packagingCny: Number(form.packagingCny),
            cnyToRub: Number(form.cnyToRub),
            internationalShippingRub: Number(form.internationalShippingRub),
            commissionRate: Number(form.commissionRate),
            targetMarginRate: Number(form.targetMarginRate),
          });
          window.location.reload();
        } catch (error) {
          alert(error instanceof Error ? error.message : String(error));
        }
      }}
    >
      <Input label="规则名称" value={form.name} onChange={(v) => set("name", v)} required />
      <Input label="国内运费 CNY" value={form.domesticShippingCny} onChange={(v) => set("domesticShippingCny", v)} />
      <Input label="包材 CNY" value={form.packagingCny} onChange={(v) => set("packagingCny", v)} />
      <Input label="CNY/RUB" value={form.cnyToRub} onChange={(v) => set("cnyToRub", v)} />
      <Input label="国际物流 RUB" value={form.internationalShippingRub} onChange={(v) => set("internationalShippingRub", v)} />
      <Input label="Ozon 佣金率" value={form.commissionRate} onChange={(v) => set("commissionRate", v)} />
      <Input label="目标毛利率" value={form.targetMarginRate} onChange={(v) => set("targetMarginRate", v)} />
      <label className="flex items-center gap-2 pt-6 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(e) => set("isDefault", e.target.checked)}
        />
        默认规则
      </label>
      <div className="md:col-span-3">
        <Button type="submit">
          <Save className="h-4 w-4" aria-hidden="true" />
          保存定价规则
        </Button>
      </div>
    </form>
  );
}

export function InviteForm() {
  const [role, setRole] = useState("operator");

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await postJson("/api/v1/invites", { role });
          window.location.reload();
        } catch (error) {
          alert(error instanceof Error ? error.message : String(error));
        }
      }}
    >
      <Select label="角色" value={role} onChange={setRole}>
        <option value="operator">operator</option>
        <option value="owner">owner</option>
      </Select>
      <Button type="submit">生成邀请码</Button>
    </form>
  );
}
