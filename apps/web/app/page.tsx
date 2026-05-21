"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { AuthGate } from "@/components/auth-gate";

export default function Home() {
  const router = useRouter();
  const { status, user } = useAuth();

  useEffect(() => {
    if (status.kind !== "authed" && status.kind !== "guest") return;
    if (!user) return;
    router.replace("/area-select");
  }, [router, status, user]);

  return (
    <AuthGate>
      <div className="auth-screen">
        <div className="auth-card auth-loading">Loading…</div>
      </div>
    </AuthGate>
  );
}
