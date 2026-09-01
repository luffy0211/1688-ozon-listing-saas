"use client";

import { LogOut } from "lucide-react";

export function LogoutButton() {
  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <button
      onClick={logout}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-gray-300 bg-white px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      退出
    </button>
  );
}
