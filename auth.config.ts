import type { NextAuthConfig } from "next-auth";

// Edge-safe base config (no Prisma / bcrypt). The Credentials provider that
// touches the DB lives in auth.ts, which composes this.

const PUBLIC_PREFIXES = ["/login", "/signup", "/api/auth", "/api/signup", "/api/cron"];

export const authConfig = {
  trustHost: true,
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      const isPublic =
        pathname === "/" ||
        PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

      if (isPublic) {
        if (isLoggedIn && (pathname.startsWith("/login") || pathname.startsWith("/signup"))) {
          return Response.redirect(new URL("/dashboard", nextUrl));
        }
        return true;
      }
      return isLoggedIn;
    },
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
