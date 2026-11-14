export type ComparisonColumn =
  | { no: number; status: 'ready'; ms: number }
  | { no: number; status: 'missing' | 'loading' | 'error' };

export function fmtDuration(ms: number): string {
  const days = Math.floor(ms / 86400_000);
  const hours = Math.round((ms - days * 86400_000) / 3600_000);
  return `${days}일 ${hours}시간`;
}

// Derive both the conclusion and badges together; never retain a previous winner.
export type ComparisonSummary = {
  finding: string;
  state: 'empty' | 'pending' | 'single' | 'tie' | 'winner';
  bestNos: Set<number>;
  columns: number[];
  ms: number | null;
  days: number;
};

export function comparisonSummary(columns: ComparisonColumn[], days: number): ComparisonSummary {
  const pending = (state: 'empty' | 'pending' | 'single', finding: string, pendingColumns: number[] = []) => ({
    state,
    finding,
    bestNos: new Set<number>(),
    columns: pendingColumns,
    ms: null,
    days,
  });
  if (columns.length === 0) return pending('empty', '비교할 지점을 추가하세요.');
  const notices: string[] = [];
  for (const c of columns) {
    if (c.status === 'missing') notices.push(`${c.no}열의 좌표를 입력하세요.`);
    if (c.status === 'error') notices.push(`${c.no}열 데이터를 불러오지 못했습니다. 다시 시도하거나 열을 제거하세요.`);
    if (c.status === 'loading') notices.push(`${c.no}열 데이터를 불러오는 중입니다.`);
  }
  if (notices.length > 0) return pending('pending', `${notices.join(' ')} 모든 열이 준비되면 비교합니다.`, columns.filter((c) => c.status !== 'ready').map((c) => c.no));
  if (columns.length === 1) return pending('single', '비교할 지점을 하나 더 추가하세요.');
  const ready = columns.filter((c): c is Extract<ComparisonColumn, { status: 'ready' }> => c.status === 'ready');
  const best = Math.max(...ready.map((c) => c.ms));
  const top = ready.filter((c) => c.ms === best);
  const topNos = top.map((c) => c.no);
  const dur = fmtDuration(best);
  if (top.length === columns.length)
    return { state: 'tie', finding: `태양과 지구가 함께 보이는 시간은 ${columns.length}개 열 모두 ${dur}으로 같다.`, bestNos: new Set<number>(), columns: topNos, ms: best, days };
  const who = topNos.map((no) => `${no}열`).join(', ');
  return {
    state: 'winner',
    finding: `태양과 지구가 함께 보이는 시간은 ${who}에서 ${days}일 중 ${dur}으로 가장 길다.`,
    bestNos: new Set(topNos),
    columns: topNos,
    ms: best,
    days,
  };
}
