import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { upsertUser } from "@/lib/db/users";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;

      await upsertUser({
        id: account?.providerAccountId ?? user.id ?? crypto.randomUUID(),
        email: user.email,
        name: user.name ?? null,
        avatar_url: user.image ?? null,
        auth_provider: account?.provider ?? "google",
      });

      return true;
    },

    async jwt({ token, user, account }) {
      if (user?.email) {
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
        token.provider = account?.provider;
      }
      return token;
    },

    async session({ session, token }) {
      if (token.email) {
        session.user.email = token.email as string;
        session.user.name = token.name as string;
        session.user.image = token.picture as string;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
  trustHost: true,
});
