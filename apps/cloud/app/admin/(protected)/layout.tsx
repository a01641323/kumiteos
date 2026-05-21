import Link from "next/link";
import { auth, signOut, oauthConfigured } from "@/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!oauthConfigured) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6 py-16">
        <h1 className="text-2xl font-semibold">Admin panel not configured</h1>
        <p className="text-zinc-400">
          The deploy is missing one or more required environment variables:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm font-mono text-zinc-300">
          <li>GITHUB_CLIENT_ID</li>
          <li>GITHUB_CLIENT_SECRET</li>
          <li>SUPERADMIN_GITHUB_ID</li>
          <li>AUTH_SECRET</li>
        </ul>
        <p className="text-sm text-zinc-500">
          Set these in Vercel → Settings → Environment Variables, then redeploy.
        </p>
        <Link href="/" className="text-blue-400 hover:underline text-sm">← Back to landing</Link>
      </main>
    );
  }

  const session = await auth();
  if (!session) redirect("/admin/login");

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 bg-zinc-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="text-lg font-semibold">Karate · admin</Link>
            <Link href="/admin/requests" className="text-sm text-zinc-300 hover:text-white">Requests</Link>
          </div>
          <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
            <button className="text-sm text-zinc-400 hover:text-white">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
