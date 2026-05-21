import { AuthGate } from "@/components/auth-gate";

export default function AreaSelectLayout({ children }: { children: React.ReactNode }) {
  // Superadmins can pass through; the page itself shows additional info for them.
  return <AuthGate roles={["referee", "superadmin"]}>{children}</AuthGate>;
}
