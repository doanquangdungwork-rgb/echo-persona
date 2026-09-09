import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { uploadedScreenshots } from '@/db/schema';
import { getOrCreateUser } from '@/lib/current-user';

export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 20;

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await getOrCreateUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error('BLOB_READ_WRITE_TOKEN is missing');
      return NextResponse.json({ error: 'Vercel Blob is not configured for this deployment.' }, { status: 500 });
    }

    const form = await req.formData();
    const files = form.getAll('files').filter((value): value is File => value instanceof File);
    const legacyFile = form.get('file');
    const selectedFiles = files.length ? files : legacyFile instanceof File ? [legacyFile] : [];

    if (!selectedFiles.length) {
      return NextResponse.json({ error: 'At least one image file is required.' }, { status: 400 });
    }
    if (selectedFiles.length > MAX_FILES) {
      return NextResponse.json({ error: `You can upload up to ${MAX_FILES} screenshots at once.` }, { status: 400 });
    }

    for (const file of selectedFiles) {
      if (!file.type.startsWith('image/')) {
        return NextResponse.json({ error: `${file.name} is not an image file.` }, { status: 400 });
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: `${file.name} is larger than 10MB.` }, { status: 400 });
      }
    }

    const db = getDb();
    const uploaded: Array<{ screenshotId: string; pathname: string }> = [];

    for (const file of selectedFiles) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
      const pathname = `users/${user.id}/screenshots/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
      const blob = await put(pathname, file, { access: 'private', addRandomSuffix: true });

      const [record] = await db.insert(uploadedScreenshots).values({
        userId: user.id,
        pathname: blob.pathname,
        contentType: file.type,
        sizeBytes: file.size,
      }).returning();

      uploaded.push({ screenshotId: record.id, pathname: record.pathname });
    }

    return NextResponse.json({ screenshots: uploaded, screenshotIds: uploaded.map(x => x.screenshotId) });
  } catch (error) {
    console.error('Screenshot upload error:', error);
    const message = error instanceof Error ? error.message : 'Unknown upload error';
    return NextResponse.json({ error: `Failed to upload screenshot(s): ${message}` }, { status: 500 });
  }
}
