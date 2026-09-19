import { redirect } from "next/navigation";

// The app lives under /dashboard (which requires a session). Landing bounces
// there; unauthenticated users get sent on to /login by requireUser.
export default function Home() {
  redirect("/dashboard");
}
