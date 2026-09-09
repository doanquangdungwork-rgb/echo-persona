import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware();

export const config = {
  matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ico|webp|avif|woff2?|ttf|map|txt|xml|csv|pdf)).*)', '/(api|trpc)(.*)'],
};
