import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getOrCreateUser } from '@/lib/current-user';
export async function GET() { const { userId } = await auth(); if (!userId) return NextResponse.json({ user: null }); const user = await getOrCreateUser(); return NextResponse.json({ user }); }
