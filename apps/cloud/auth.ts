// Auth.js v5 — single-superadmin GitHub OAuth.
// Only the GitHub user whose numeric id matches SUPERADMIN_GITHUB_ID
// gets a session; everyone else is rejected at sign-in.
//
// Defensive init: if GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET aren't
// set yet, we still export valid handlers but with zero providers.
// That keeps the public surface (landing, request form, /api/activate)
// working before the operator finishes configuring the Vercel
// environment. The /admin routes themselves report the misconfig.

import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

const ghId = process.env.GITHUB_CLIENT_ID;
const ghSecret = process.env.GITHUB_CLIENT_SECRET;
export const oauthConfigured = Boolean(ghId && ghSecret && process.env.SUPERADMIN_GITHUB_ID);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: oauthConfigured
    ? [GitHub({ clientId: ghId!, clientSecret: ghSecret! })]
    : [],
  secret: process.env.AUTH_SECRET ?? "unset-auth-secret-replace-in-env-vars",
  trustHost: true,
  callbacks: {
    async signIn({ profile }) {
      const allowed = process.env.SUPERADMIN_GITHUB_ID;
      if (!allowed) return false;
      return String((profile as { id?: number | string } | undefined)?.id ?? "") === allowed;
    },
    async session({ session, token }) {
      (session as { ghId?: string }).ghId = String(token.sub ?? "");
      return session;
    },
  },
  pages: {
    signIn: "/admin/login",
  },
});
