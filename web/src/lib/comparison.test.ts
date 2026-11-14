import { describe, expect, it } from 'vitest';
import { comparisonSummary } from './comparison';
import type { ComparisonColumn } from './comparison';

const ready = (no: number, hours: number): ComparisonColumn => ({ no, status: 'ready', ms: hours * 3600_000 });
const summary = (columns: ComparisonColumn[]) => comparisonSummary(columns, 14);

describe('전체 열 비교 준비 상태', () => {
  it.each(['missing', 'loading', 'error'] as const)('%s 열이 있으면 순위와 배지를 보류한다', (status) => {
    const result = summary([ready(1, 10), ready(2, 5), { no: 3, status }]);
    expect(result.finding).not.toContain('가장 길');
    expect(result.finding).toContain('3열');
    expect(result.bestNos.size).toBe(0);
  });
  it('실패·미입력·로딩 안내가 서로 가려지지 않는다', () => {
    const result = summary([{ no: 1, status: 'error' }, { no: 2, status: 'missing' }, { no: 3, status: 'loading' }]);
    expect(result.finding).toContain('1열 데이터를 불러오지 못했습니다');
    expect(result.finding).toContain('2열의 좌표를 입력');
    expect(result.finding).toContain('3열 데이터를 불러오는 중');
  });
  it('0개와 1개 열에는 비교 대상 추가를 안내한다', () => {
    expect(summary([]).finding).toContain('지점을 추가');
    expect(summary([ready(1, 10)]).finding).toContain('하나 더');
    expect(summary([ready(1, 10)]).bestNos.size).toBe(0);
  });
  it('재시도 중에는 이전 순위가 없고 성공 후 새 승자를 표시한다', () => {
    expect([...summary([ready(1, 10), ready(2, 5)]).bestNos]).toEqual([1]);
    for (const status of ['error', 'loading'] as const)
      expect(summary([ready(1, 10), { no: 2, status }]).bestNos.size).toBe(0);
    expect([...summary([ready(1, 10), ready(2, 20)]).bestNos]).toEqual([2]);
  });
  it('실패한 열을 제거하면 남은 열로 다시 비교한다', () => {
    const columns: ComparisonColumn[] = [ready(1, 10), ready(2, 5), { no: 3, status: 'error' }];
    expect(summary(columns).bestNos.size).toBe(0);
    expect([...summary(columns.slice(0, 2)).bestNos]).toEqual([1]);
  });
  it('전원 동률이면 배지 없이 같은 값임을 표시한다', () => {
    const result = summary([ready(1, 0), ready(2, 0)]);
    expect(result.finding).toContain('모두 0일 0시간으로 같다');
    expect(result.bestNos.size).toBe(0);
  });
  it('일부 공동 1위에는 해당 열에만 배지를 표시한다', () => {
    expect([...summary([ready(1, 10), ready(2, 5), ready(3, 10)]).bestNos]).toEqual([1, 3]);
  });
});
