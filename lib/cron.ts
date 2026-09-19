// Shared guard for cron endpoints. Vercel Cron sends
// `Authorization: Bearer <CRON_SECRET>`. We also accept it for manual/local
// triggering (curl -H "Authorization: Bearer $CRON_SECRET").
export function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if unconfigured
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}
