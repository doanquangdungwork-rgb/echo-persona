import { auth, currentUser } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/db/schema';

export async function getOrCreateUser() {
  const { userId } = await auth();
  if (!userId) return null;

  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.clerkUserId, userId)).limit(1);
  if (existing) return existing;

  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? null;
  const [created] = await db.insert(users).values({ clerkUserId: userId, email }).returning();
  return created;
}
