"use client";

import { LogOut } from "lucide-react";

export function LogoutButton({ redirectTo = "/login" }: { redirectTo?: string }) {
  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    window.location.href = redirectTo;
  }

  return (
    <button
      onClick={logout}
      className="inline-flex h-8 items-center gap-2 rounded-xl border border-[#d8e4f2] bg-white/90 px-2.5 text-sm font-medium text-[#52627b] shadow-sm transition-colors hover:bg-white hover:text-[#245fcf]"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      退出
    </button>
  );
}
