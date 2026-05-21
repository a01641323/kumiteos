import { AuthGate } from "@/components/auth-gate";

// The audience scoreboard runs without a login UI, but requires an ACTIVE or
// GRACE license to display ANY tournament data. In DEGRADED / UNLICENSED the
// gate replaces the view with a generic "Display Unavailable" message so no
// competitor names or scores leak.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate allowAnonymous isPublicView>
      {children}
    </AuthGate>
  );
}
