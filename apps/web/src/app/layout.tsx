import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { NavLink } from '../components/nav-link';
import { ensureFirstRun, getCaller } from '../lib/server';

export const metadata: Metadata = {
  title: 'Sana — учёт и налоги РК',
  description: 'Sana ведёт учёт и следит за рисками. Вам остаётся подтверждать — не считать.',
};

export const dynamic = 'force-dynamic';

function NavLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5D6B8C]">
      {children}
    </div>
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  await ensureFirstRun();
  const caller = await getCaller();
  // Живые бейджи сайдбара — из тех же use-case, что и экраны.
  const [overview, company] = await Promise.all([caller.overview(), caller.company()]);

  return (
    <html lang="ru">
      <body>
        <div className="grid min-h-screen grid-cols-[236px_1fr]">
          <aside className="sticky top-0 flex h-screen flex-col overflow-y-auto bg-indigo-deep px-3.5 py-5 text-[#C7D2E6]">
            <div className="flex items-center gap-2.5 px-2 pb-4">
              <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-teal text-base font-bold text-[#04322f]">
                S
              </div>
              <div>
                <div className="text-[19px] font-semibold tracking-tight text-white">Sana</div>
                <div className="text-[10.5px] uppercase tracking-[0.04em] text-slate-light">
                  Учёт и налоги РК
                </div>
              </div>
            </div>

            <NavLabel>Учёт</NavLabel>
            <NavLink href="/">Обзор</NavLink>
            <NavLink href="/autopost" badge={overview.наПодтверждении}>
              Автопроводки
            </NavLink>
            <NavLink href="/reports">Отчётность</NavLink>
            <NavLink href="/declarations">Декларации ФНО</NavLink>
            <NavLink href="/payroll">Зарплата и кадры</NavLink>

            <NavLabel>Контроль</NavLabel>
            <NavLink href="/guard" badge={overview.открытыхРисков}>
              Sana Guard
            </NavLink>
            <NavLink href="/counterparties">Контрагенты</NavLink>
            <NavLink href="/documents">Документы</NavLink>
            <NavLink href="/calendar">Календарь сроков</NavLink>

            <NavLabel>Инструменты</NavLabel>
            <NavLink href="/banks">Банковские счета</NavLink>
            <NavLink href="/cpcheck">Проверка контрагента</NavLink>
            <NavLink href="/reconcile">Сверка данных</NavLink>
            <NavLink href="/calc">Калькуляторы</NavLink>

            <NavLabel>Помощь</NavLabel>
            <NavLink href="/ask">Спроси Sana</NavLink>

            <div className="mt-auto flex items-center gap-2 border-t border-white/10 px-2 pt-3">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-teal to-teal-700 text-xs font-bold text-[#04322f]">
                АТ
              </div>
              <div>
                <div className="text-[12.5px] font-medium text-[#E6ECF7]">Айгерим Т.</div>
                <div className="text-[10.5px] text-slate-light">Владелец</div>
              </div>
            </div>
          </aside>

          <div className="flex min-w-0 flex-col">
            <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border-mock bg-white px-6 py-3.5">
              <span className="text-sm text-slate-mock">
                {company.name} · БИН {company.bin}
              </span>
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-teal/30 bg-teal-050 px-2.5 py-0.5 text-[11.5px] font-semibold text-teal-700">
                <i className="h-1.5 w-1.5 rounded-full bg-teal" /> Sana на связи
              </span>
            </header>
            <main className="w-full max-w-[1120px] px-7 pb-12 pt-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
