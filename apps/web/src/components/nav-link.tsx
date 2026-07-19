'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Пункт сайдбара: активное состояние по текущему пути (как в мокапе). */
export function NavLink({
  href,
  children,
  badge,
  badgeTone = 'coral',
}: {
  href: string;
  children: ReactNode;
  badge?: number | undefined;
  badgeTone?: 'coral' | 'teal';
}) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={`relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13.5px] font-medium transition ${
        active
          ? 'bg-[rgba(31,200,192,0.14)] text-white'
          : 'text-[#AEBCD6] hover:bg-white/5 hover:text-[#E6ECF7]'
      }`}
    >
      {active && (
        <span className="absolute -left-3.5 top-2 bottom-2 w-[3px] rounded-r bg-teal" aria-hidden />
      )}
      {children}
      {badge !== undefined && badge > 0 && (
        <span
          className={`ml-auto rounded-full px-1.5 py-px text-[10.5px] font-semibold ${
            badgeTone === 'coral' ? 'bg-coral text-white' : 'bg-teal text-[#04322f]'
          }`}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
