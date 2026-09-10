import { NextResponse } from 'next/server';

export function proxy() {
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
export const config = { matcher: ['/', '/teacher/:path*', '/api/:path*'] };
