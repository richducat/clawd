import { cookies } from 'next/headers';
import TheLabUltimate from './TheLabUltimate';
import { dbConfigured, getOrCreateUser } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function MembersHome() {
  const jar = await cookies();
  const uid = jar.get('labstudio_uid')?.value;

  let initialUser: { display_name?: string; xp?: number; level?: number } | null = null;
  if (uid && dbConfigured()) {
    try {
      const u = await getOrCreateUser(uid);
      initialUser = { display_name: u.display_name ?? undefined, xp: u.xp, level: u.level };
    } catch {
      initialUser = null;
    }
  }

  return <TheLabUltimate initialUser={initialUser} />;
}
