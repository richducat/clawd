'use client';

import Card from '../components/Card';

export default function PlaceholderView({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="space-y-4 pb-20">
      <div className="px-1">
        <h1 className="text-2xl font-black italic uppercase">{title}</h1>
        {subtitle ? <div className="text-xs text-zinc-500 mt-1">{subtitle}</div> : null}
      </div>

      <Card className="p-4">
        <div className="text-sm text-zinc-300">Nothing here yet.</div>
        <div className="text-xs text-zinc-500 mt-2">
          This screen is live, but it will only show real data once you create it.
        </div>
      </Card>
    </div>
  );
}
