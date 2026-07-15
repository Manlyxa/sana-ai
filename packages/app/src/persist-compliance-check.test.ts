import { describe, expect, it } from 'vitest';
import { err, ok, unwrap, type BusinessEvent, type Finding, type LocalDate } from '@sana/domain';
import { LocalDate as LD } from '@sana/domain';
import { buildRuleLawParams, createSeededStore } from '@sana/legal-params';
import {
  DEMO_IBAN,
  FixtureBankAdapter,
  FixtureCounterpartyRegistryAdapter,
  FixtureEnbekAdapter,
  FixtureEsfAdapter,
  FixtureTaxCabinetAdapter,
} from '@sana/adapters';
import { runAndPersistComplianceCheck } from './persist-compliance-check';
import type { ComplianceRepos } from './persistence';
import type { CompliancePorts } from './compliance-check';
import { Bin, createCompany } from '@sana/domain';

const AS_OF = unwrap(LD.parse('2026-05-10'));

function ports(): CompliancePorts {
  return {
    esf: new FixtureEsfAdapter(),
    bank: new FixtureBankAdapter(),
    taxCabinet: new FixtureTaxCabinetAdapter(),
    enbek: new FixtureEnbekAdapter(),
    registry: new FixtureCounterpartyRegistryAdapter(),
  };
}

/** Репозитории-фейки в памяти: @sana/app не зависит от БД (P5). */
function fakeRepos() {
  const events: BusinessEvent[] = [];
  const known = new Set<string>();
  let open: Finding[] = [];
  const repos: ComplianceRepos = {
    events: {
      async appendAll(batch) {
        let added = 0;
        for (const e of batch) {
          if (known.has(e.id)) continue;
          known.add(e.id);
          events.push(e);
          added += 1;
        }
        return ok(added);
      },
    },
    ledger: {
      async replaceJournal() {},
      async replaceTaxRegisters() {},
    },
    findings: {
      async reconcileRun(_companyId, current, _asOf: LocalDate) {
        const prev = new Set(open.map((f) => f.id));
        const curr = new Set(current.map((f) => f.id));
        const summary = {
          added: current.filter((f) => !prev.has(f.id)).length,
          retained: current.filter((f) => prev.has(f.id)).length,
          resolved: open.filter((f) => !curr.has(f.id)).length,
        };
        open = [...current];
        return summary;
      },
      async listOpen() {
        return ok(open);
      },
    },
  };
  return { repos, events };
}

const company = unwrap(
  createCompany({
    id: 'demo-too',
    bin: unwrap(Bin.parse('120540000001')),
    name: 'ТОО «Демо Трейд»',
    oked: ['46739'],
    taxRegime: 'ОУР',
    vatStatus: { registered: true, since: unwrap(LD.parse('2024-01-01')) },
    reportingStandard: 'НСФО',
    accountingPolicy: { vatCreditMethod: 'ПРОПОРЦИОНАЛЬНЫЙ' },
    employeeCount: 12,
  }),
);

describe('runAndPersistComplianceCheck', () => {
  it('сохраняет события/проекции/находки и идемпотентен', async () => {
    const law = unwrap(buildRuleLawParams(createSeededStore(), AS_OF));
    const { repos } = fakeRepos();
    const input = { company, accountIban: DEMO_IBAN, law, asOf: AS_OF };

    const first = unwrap(await runAndPersistComplianceCheck(ports(), repos, input));
    expect(first.eventsIngested).toBe(13);
    expect(first.findings.added).toBeGreaterThanOrEqual(9);
    expect(BigInt(first.openExposureTiyn) > 0n).toBe(true);

    const second = unwrap(await runAndPersistComplianceCheck(ports(), repos, input));
    expect(second.eventsIngested).toBe(0);
    expect(second.findings.added).toBe(0);
    expect(second.findings.retained).toBe(first.findings.added);
  });

  it('ошибка сохранения событий → Err, не тихий пропуск', async () => {
    const law = unwrap(buildRuleLawParams(createSeededStore(), AS_OF));
    const { repos } = fakeRepos();
    const broken: ComplianceRepos = {
      ...repos,
      events: { async appendAll() { return err({ kind: 'IO' }); } },
    };
    const r = await runAndPersistComplianceCheck(ports(), broken, {
      company,
      accountIban: DEMO_IBAN,
      law,
      asOf: AS_OF,
    });
    expect(r.ok).toBe(false);
  });
});
