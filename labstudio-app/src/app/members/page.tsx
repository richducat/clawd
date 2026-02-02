import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import TheLabUltimate from './TheLabUltimate';
import { dbConfigured, getOrCreateUser, getUserProfile } from '@/lib/db';
import type { InitialProfile } from './types';

export const dynamic = 'force-dynamic';

export default async function MembersHome() {
  const jar = await cookies();
  const uid = jar.get('labstudio_uid')?.value;

  let initialUser: { display_name?: string; xp?: number; level?: number } | null = null;
  let initialProfile: InitialProfile = null;
  if (uid && dbConfigured()) {
    try {
      const u = await getOrCreateUser(uid);
      const p = await getUserProfile(uid);

      const onboarded = u.onboarding_complete || Boolean(p);
      if (!onboarded) {
        redirect('/onboarding');
      }

      initialProfile = p;
      initialUser = { display_name: u.display_name ?? undefined, xp: u.xp, level: u.level };
    } catch {
      initialUser = null;
    }
  }

  return <TheLabUltimate initialUser={initialUser} initialProfile={initialProfile} />;
}
