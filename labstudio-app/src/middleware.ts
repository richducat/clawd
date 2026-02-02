import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const COOKIE_NAME = 'labstudio_session';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow public assets + login endpoints.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth') ||
    pathname === '/login' ||
    pathname === '/' ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  // Protect /members and everything under it (v0).
  if (pathname.startsWith('/members')) {
    const token = req.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/members/:path*'],
};
