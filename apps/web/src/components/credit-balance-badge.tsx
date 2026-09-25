"use client";

import { useEffect, useState } from "react";
import { Coins } from "lucide-react";

type BalanceState =
  | { status: "loading"; balance: null }
  | { status: "ready"; balance: number }
  | { status: "hidden"; balance: null };

export function CreditBalanceBadge() {
  const [state, setState] = useState<BalanceState>({ status: "loading", balance: null });

  useEffect(() => {
    let cancelled = false;

    async function loadBalance() {
      try {
        const response = await fetch("/api/v1/credits/balance", {
          cache: "no-store",
        });
        if (!response.ok) {
          if (!cancelled) setState({ status: "hidden", balance: null });
          return;
        }
        const payload = await response.json();
        const balance = Number(payload?.data?.balance ?? 0);
        if (!cancelled) {
          setState({ status: "ready", balance });
        }
      } catch {
        if (!cancelled) setState({ status: "hidden", balance: null });
      }
    }

    loadBalance();
    window.addEventListener("credits:changed", loadBalance);
    window.addEventListener("focus", loadBalance);
    return () => {
      cancelled = true;
      window.removeEventListener("credits:changed", loadBalance);
      window.removeEventListener("focus", loadBalance);
    };
  }, []);

  if (state.status === "hidden") return null;

  return (
    <span
      aria-busy={state.status === "loading"}
      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#dbe6fb] bg-white px-2 text-xs font-semibold text-[#52627b] shadow-[0_4px_14px_rgba(55,84,130,0.08)]"
    >
      <Coins className="h-3.5 w-3.5 text-[#3478f6]" aria-hidden="true" />
      <span className="hidden sm:inline">积分</span>
      <span className="font-bold text-[#17223d]">{state.balance?.toLocaleString("zh-CN") ?? "-"}</span>
    </span>
  );
}
