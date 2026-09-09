'use client';

import { useEffect } from 'react';

const MAX_BATCH_BYTES = 3.5 * 1024 * 1024;
const TARGET_IMAGE_BYTES = 700 * 1024;
const MAX_DIMENSION = 2200;

async function compressFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= TARGET_IMAGE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close(); return file; }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    let quality = 0.82;
    let blob: Blob | null = null;
    while (quality >= 0.36) {
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= TARGET_IMAGE_BYTES) break;
      quality -= 0.08;
    }
    if (!blob || blob.size > MAX_BATCH_BYTES) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}

async function uploadInBatches(originalFetch: typeof window.fetch, input: RequestInfo | URL, init: RequestInit) {
  if (typeof init.body === 'string' || !(init.body instanceof FormData)) return originalFetch(input, init);
  const original = init.body;
  const files = Array.from(original.getAll('files')).filter((v): v is File => v instanceof File);
  if (!files.length) return originalFetch(input, init);

  const optimized: File[] = [];
  for (const file of files) optimized.push(await compressFile(file));

  const batches: File[][] = [];
  let current: File[] = [];
  let bytes = 0;
  for (const file of optimized) {
    if (file.size > MAX_BATCH_BYTES) {
      throw new Error(`${file.name} is still too large after compression. Please use a smaller screenshot.`);
    }
    const nextBytes = bytes + file.size;
    if (current.length && nextBytes > MAX_BATCH_BYTES) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.size;
  }
  if (current.length) batches.push(current);

  const allScreenshots: any[] = [];
  const allIds: string[] = [];
  for (const batch of batches) {
    const form = new FormData();
    for (const file of batch) form.append('files', file);
    const response = await originalFetch(input, { ...init, body: form });
    const raw = await response.text();
    let data: any;
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`Upload failed (${response.status}).`); }
    if (!response.ok) throw new Error(data?.error || `Upload failed (${response.status}).`);
    if (Array.isArray(data.screenshots)) allScreenshots.push(...data.screenshots);
    if (Array.isArray(data.screenshotIds)) allIds.push(...data.screenshotIds);
  }
  return new Response(JSON.stringify({ screenshots: allScreenshots, screenshotIds: allIds }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default function UploadOptimizer() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const wrapped = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/uploads') && init.body instanceof FormData) {
        return uploadInBatches(originalFetch, input, init);
      }
      return originalFetch(input, init);
    };
    window.fetch = wrapped;
    return () => { window.fetch = originalFetch; };
  }, []);
  return null;
}
