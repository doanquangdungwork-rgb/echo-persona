import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = { title: 'Echo — Persona Chat', description: 'Create a conversational AI persona from your chat history.' };

export default function RootLayout({children}:{children:React.ReactNode}){
  return <ClerkProvider><html lang="en"><body>{children}</body></html></ClerkProvider>;
}
