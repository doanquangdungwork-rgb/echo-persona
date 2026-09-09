import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { uploadedScreenshots } from '@/db/schema';
import { getOrCreateUser } from '@/lib/current-user';

export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const user = await getOrCreateUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Vercel automatically provides this when the Blob store is connected
    // to the Vercel project. Keeping this check here gives a useful error
    // instead of a generic Blob SDK failure.
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error('BLOB_READ_WRITE_TOKEN is missing');
      return NextResponse.json(
        {
          error:
            'Vercel Blob is not connected to this project. Please connect the EchoBlob store to the Echo Persona Vercel project.',
        },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Image file is required' },
        { status: 400 }
      );
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Only image files are supported' },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'Image must be 10MB or smaller' },
        { status: 400 }
      );
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const pathname = `users/${user.id}/screenshots/${Date.now()}-${safeName}`;

    const blob = await put(pathname, file, {
      access: 'private',
      addRandomSuffix: true,
    });

    const db = getDb();

    const [record] = await db
      .insert(uploadedScreenshots)
      .values({
        userId: user.id,
        pathname: blob.pathname,
        contentType: file.type,
        sizeBytes: file.size,
      })
      .returning();

    return NextResponse.json({
      screenshotId: record.id,
      pathname: record.pathname,
    });
  } catch (error) {
    console.error('Screenshot upload error:', error);

    return NextResponse.json(
      {
        error: 'Failed to upload screenshot to Vercel Blob',
      },
      { status: 500 }
    );
  }
}
