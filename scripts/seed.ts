// Create (or update) the single app login from SEED_* env vars.
// Run: npx tsx scripts/seed.ts

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

async function main() {
  const email = (process.env.SEED_EMAIL ?? "").toLowerCase().trim();
  const password = process.env.SEED_PASSWORD ?? "";
  const name = process.env.SEED_NAME ?? "Alex";
  if (!email || !password) {
    throw new Error("Set SEED_EMAIL and SEED_PASSWORD in .env first.");
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash },
    create: { email, name, passwordHash },
  });
  console.log(`Seeded user ${user.email} (${user.id}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
