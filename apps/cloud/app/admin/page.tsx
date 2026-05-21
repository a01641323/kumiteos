import Link from "next/link";
import { oauthConfigured } from "@/auth";
import { listPending } from "@/lib/requests";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  if (!oauthConfigured) return null; // The layout renders the misconfig screen.
  const pending = await listPending();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Pending requests" value={pending.length} />
        <Stat label="Granted (today)" value="—" hint="(KV histogram TODO)" />
        <Stat label="Revoked codes" value="—" hint="(KV histogram TODO)" />
      </div>
      <p>
        <Link href="/admin/requests" className="text-blue-400 hover:underline">
          Review pending requests →
        </Link>
      </p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-900 p-4">
      <div className="text-sm text-zinc-400">{label}</div>
      <div className="mt-1 text-3xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}
