"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

async function call(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function GrantButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          await call(`/api/admin/requests/${id}/grant`);
          router.refresh();
        })
      }
      className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium hover:bg-emerald-500 disabled:opacity-50"
    >
      {pending ? "Granting…" : "Grant"}
    </button>
  );
}

export function RejectButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const reason = window.prompt("Optional rejection reason (visible to requester):") ?? "";
          await call(`/api/admin/requests/${id}/reject`, reason ? { reason } : {});
          router.refresh();
        })
      }
      className="rounded border border-white/10 bg-zinc-800 px-3 py-1.5 text-xs font-medium hover:bg-zinc-700 disabled:opacity-50"
    >
      {pending ? "Rejecting…" : "Reject"}
    </button>
  );
}
