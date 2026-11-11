// middleware.js
import { NextResponse } from 'next/server';

const LEGACY_PRODUCTION_HOST = 'nyeocare-nicosheg.vercel.app';
const CANONICAL_PRODUCTION_HOST = 'nyeocare.vercel.app';

export function middleware(request) {
  const hostname = request.nextUrl.hostname.toLowerCase();

  if (hostname !== LEGACY_PRODUCTION_HOST) {
    return NextResponse.next();
  }

  // Preserve the full path and query (including Supabase's PKCE code) while
  // moving the browser to the one canonical origin before app code executes.
  const destination = request.nextUrl.clone();
  destination.protocol = 'https:';
  destination.hostname = CANONICAL_PRODUCTION_HOST;
  destination.port = '';

  return NextResponse.redirect(destination, 308);
}

export const config = {
  matcher: ['/:path*'],
};
