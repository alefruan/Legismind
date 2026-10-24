import { describe, expect, it } from 'vitest'
import { analyzeCancellationCandidates } from '../../shared/domain/amendments/cancellation'
import { allocation, allocations, demoRules, FY } from './fixtures'

const none = { firmCents: 0, pendingCents: 0, amendmentsCount: 0 }

const candidates = [
  { allocation: allocations.personnel, commitments: none },
  { allocation: allocations.susEarmarked, commitments: none },
  { allocation: allocations.roads, commitments: none },
  { allocation: allocations.publicity, commitments: none },
  { allocation: allocations.generalReserve, commitments: none },
  { allocation: allocations.amendmentReserve, commitments: { firmCents: 0, pendingCents: 30_000_000, amendmentsCount: 1 } },
]

describe('Candidatos a cancelamento compensatório', () => {
  it('exclui despesas protegidas e fontes incompatíveis, priorizando a reserva para emendas', () => {
    const analysis = analyzeCancellationCandidates({
      requestedCents: 15_000_000,
      fiscalYearId: FY,
      destinationSources: [{ code: '1.500.0000', isEarmarked: false }],
      candidates,
      rules: demoRules,
    })
    const excludedIds = analysis.excluded.map((e) => e.allocation.id).sort()
    expect(excludedIds).toEqual(['a-1509', 'a-1510', 'a-1517'])
    expect(analysis.excluded.find((e) => e.allocation.id === 'a-1509')!.exclusionReasons[0]).toMatch(/pessoal/)
    expect(analysis.excluded.find((e) => e.allocation.id === 'a-1510')!.exclusionReasons[0]).toMatch(/vinculada/)

    expect(analysis.eligible[0]!.allocation.id).toBe('a-1518')
    expect(analysis.suggestion).toEqual([
      expect.objectContaining({ allocationId: 'a-1518', amountCents: 15_000_000, availabilityBasis: 'estimated_from_authorized' }),
    ])
    expect(analysis.notes.join(' ')).toMatch(/aprovação explícita/)
  })

  it('nunca presume o valor total disponível: desconta compromissos de outras emendas', () => {
    const analysis = analyzeCancellationCandidates({
      requestedCents: 15_000_000,
      fiscalYearId: FY,
      destinationSources: [{ code: '1.500.0000', isEarmarked: false }],
      candidates,
      rules: demoRules,
    })
    const reserve = analysis.eligible.find((e) => e.allocation.id === 'a-1518')!
    expect(reserve.availability.maxCents).toBe(960_000_000 - 30_000_000)
    expect(reserve.warnings.join(' ')).toMatch(/Sem saldo oficial/)
    const publicity = analysis.eligible.find((e) => e.allocation.id === 'a-1512')!
    expect(publicity.availability.basis).toBe('official_balance')
    expect(publicity.availability.maxCents).toBe(20_000_000)
  })

  it('combina dotações quando nenhuma cobre o valor sozinha e informa cobertura parcial', () => {
    const small = [
      { allocation: allocation({ id: 'x1', authorizedCents: 5_000_000 }), commitments: none },
      { allocation: allocation({ id: 'x2', authorizedCents: 4_000_000 }), commitments: none },
    ]
    const analysis = analyzeCancellationCandidates({
      requestedCents: 12_000_000,
      fiscalYearId: FY,
      destinationSources: [{ code: '1.500.0000', isEarmarked: false }],
      candidates: small,
      rules: demoRules,
    })
    expect(analysis.suggestion.map((s) => s.amountCents)).toEqual([5_000_000, 4_000_000])
    expect(analysis.coveredCents).toBe(9_000_000)
    expect(analysis.notes.join(' ')).toMatch(/cobrem R\$\s?90\.000,00 de R\$\s?120\.000,00/)
  })

  it('exclui dotações de outro exercício e a própria dotação de destino', () => {
    const other = allocation({ id: 'y-2026', fiscalYearId: 'fy-2026', fiscalYear: 2026 })
    const analysis = analyzeCancellationCandidates({
      requestedCents: 1_000_000,
      fiscalYearId: FY,
      destinationSources: [{ code: '1.500.0000', isEarmarked: false }],
      candidates: [{ allocation: other, commitments: none }, { allocation: allocations.roads, commitments: none }],
      rules: demoRules,
      excludeAllocationIds: ['a-1511'],
    })
    expect(analysis.eligible).toHaveLength(0)
    expect(analysis.notes[0]).toMatch(/Nenhuma dotação elegível/)
  })
})
