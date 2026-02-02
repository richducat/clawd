import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE = 'labstudio_session';
const UID_COOKIE = 'labstudio_uid';

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

  const session = req.cookies.get(SESSION_COOKIE)?.value;

  // Protect /members and server APIs used by members.
  if (pathname.startsWith('/members') || pathname.startsWith('/api/lab')) {
    if (!session) {
      // For API calls, return 401. For page nav, redirect to login.
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      }
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }

    // Ensure stable user id cookie exists (some older sessions may only have labstudio_session).
    const uid = req.cookies.get(UID_COOKIE)?.value;
    if (!uid) {
      const res = NextResponse.next();
      res.cookies.set({
        name: UID_COOKIE,
        value: crypto.randomUUID(),
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      });
      return res;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/members/:path*', '/api/lab/:path*'],
};
