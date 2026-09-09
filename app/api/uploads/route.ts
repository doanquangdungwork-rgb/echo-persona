import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { uploadedScreenshots } from '@/db/schema';
import { getOrCreateUser } from '@/lib/current-user';
export const runtime = 'nodejs';
const MAX_BYTES = 10 * 1024 * 1024;
export async function POST(req: Request) { const { userId } = await auth(); if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); const user = await getOrCreateUser(); if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); const form = await req.formData(); const file = form.get('file'); if (!(file instanceof File)) return NextResponse.json({ error: 'Image file is required' }, { status: 400 }); if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Only image files are supported' }, { status: 400 }); if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image must be 10MB or smaller' }, { status: 400 }); const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-'); const blob = await put(`users/${user.id}/screenshots/${Date.now()}-${safeName}`, file, { access: 'private', addRandomSuffix: true }); const db = getDb(); const [record] = await db.insert(uploadedScreenshots).values({ userId: user.id, pathname: blob.pathname, contentType: file.type, sizeBytes: file.size }).returning(); return NextResponse.json({ screenshotId: record.id, pathname: record.pathname }); }
