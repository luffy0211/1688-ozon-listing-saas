import { requireAdmin } from "@/lib/auth";
import { AdminShell } from "@/components/admin-shell";

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin("/admin/login");
  return <AdminShell user={user}>{children}</AdminShell>;
}
