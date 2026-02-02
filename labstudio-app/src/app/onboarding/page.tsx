import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { dbConfigured, getOrCreateUser, getUserProfile } from '@/lib/db';
import OnboardingForm from './OnboardingForm';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const jar = await cookies();
  const uid = jar.get('labstudio_uid')?.value;

  if (uid && dbConfigured()) {
    try {
      const user = await getOrCreateUser(uid);
      const profile = await getUserProfile(uid);

      // Only skip onboarding if required profile fields exist.
      const profileComplete = Boolean(profile?.first_name?.trim()) && Boolean(profile?.last_name?.trim()) && Boolean(profile?.goal?.trim());
      if (user.onboarding_complete && profileComplete) {
        redirect('/members');
      }
    } catch {
      // If DB is temporarily unavailable, still allow rendering the form.
    }
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6">
          <div className="text-sm font-semibold text-zinc-400">Lab Studio</div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-zinc-50">Welcome — quick intake</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Tell us a bit about you so we can personalize your experience. You can update this later.
          </p>
        </div>

        <OnboardingForm />

        <p className="mt-6 text-xs text-zinc-500">
          By continuing, you confirm this information is accurate to the best of your knowledge.
        </p>
      </div>
    </main>
  );
}
