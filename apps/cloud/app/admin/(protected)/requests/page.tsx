import { oauthConfigured } from "@/auth";
import { listPending } from "@/lib/requests";
import { GrantButton, RejectButton } from "./actions-ui";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  if (!oauthConfigured) return null; // Layout shows the misconfig screen.
  const pending = await listPending();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Pending requests</h1>
      {pending.length === 0 ? (
        <p className="text-zinc-400">No pending requests right now.</p>
      ) : (
        <table className="w-full overflow-hidden rounded-lg border border-white/10 text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Org</th>
              <th className="px-3 py-2 text-left">Tournament</th>
              <th className="px-3 py-2 text-left">Notes</th>
              <th className="px-3 py-2 text-left">Requested</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((r) => (
              <tr key={r.id} className="border-t border-white/5">
                <td className="px-3 py-2">{r.email}</td>
                <td className="px-3 py-2 text-zinc-300">{r.org ?? "—"}</td>
                <td className="px-3 py-2 text-zinc-300">{r.tournamentDate ?? "—"}</td>
                <td className="px-3 py-2 max-w-xs truncate text-zinc-400">{r.notes ?? "—"}</td>
                <td className="px-3 py-2 text-zinc-400">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <GrantButton id={r.id} />
                    <RejectButton id={r.id} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
