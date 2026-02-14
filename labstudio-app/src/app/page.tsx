import { redirect } from 'next/navigation';

export default function Home() {
  // LabStudio members experience lives under /members.
  // Root should send people to the app, not the Next.js starter page.
  redirect('/members');
}
