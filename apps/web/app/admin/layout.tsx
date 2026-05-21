import { AuthGate } from "@/components/auth-gate";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate roles={["superadmin", "referee"]}>{children}</AuthGate>;
}
