import { redirect } from "next/navigation";
import { auth } from "@/auth";

// For server components / route handlers: returns the logged-in user or
// redirects to /login.
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session.user;
}

// Non-redirecting variant for API routes that return 401 JSON.
export async function getUser() {
  const session = await auth();
  return session?.user ?? null;
}
