import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import TheLabUltimate from './TheLabUltimate';
import { dbConfigured, getOrCreateUser, getUserProfile } from '@/lib/db';
import type { InitialProfile } from './types';

export const dynamic = 'force-dynamic';

export default async function MembersHome({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const jar = await cookies();
  const uid = jar.get('labstudio_uid')?.value;

  let initialUser: { display_name?: string; xp?: number; level?: number } | null = null;
  let initialProfile: InitialProfile = null;
  let needsOnboarding = false;

  if (uid && dbConfigured()) {
    try {
      const u = await getOrCreateUser(uid);
      const p = await getUserProfile(uid);

      // Rule B: treat onboarding as incomplete unless required profile fields exist.
      const profileComplete = Boolean(p?.first_name?.trim()) && Boolean(p?.last_name?.trim()) && Boolean(p?.goal?.trim());

      // If there is no profile at all, force onboarding.
      if (!p) {
        redirect('/onboarding');
      }

      // If onboarding flag is false OR profile is incomplete, allow members but show a banner (Rule C).
      needsOnboarding = !u.onboarding_complete || !profileComplete;

      initialProfile = p;
      initialUser = { display_name: u.display_name ?? undefined, xp: u.xp, level: u.level };
    } catch {
      initialUser = null;
    }
  }

  const checkout = typeof searchParams?.checkout === 'string' ? searchParams?.checkout : null;

  return (
    <TheLabUltimate
      initialUser={initialUser}
      initialProfile={initialProfile}
      needsOnboarding={needsOnboarding}
      checkoutStatus={checkout === 'success' || checkout === 'cancel' ? checkout : null}
    />
  );
}

