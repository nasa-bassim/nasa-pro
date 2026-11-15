import { describe, expect, it } from 'vitest';
import { copy, eventDuration } from './i18n';

const days = (ms: number) => ms / 86_400_000;

describe('이벤트 대기 시간 표시', () => {
  it.each([1, 24_190, 46_041, 59_999])('미래 %dms를 0일이나 0분으로 표시하지 않는다', (ms) => {
    expect(eventDuration(days(ms), 'ko')).toBe('1분 미만');
    expect(eventDuration(days(ms), 'en')).toBe('Less than 1 min');
  });
  it('분·시간 경계와 기존 일 단위 표시를 유지한다', () => {
    expect(eventDuration(days(60_000), 'ko')).toBe('약 1분');
    expect(eventDuration(days(3_600_000), 'ko')).toBe('약 1시간 0분');
    expect(eventDuration(days(23 * 3_600_000 + 59 * 60_000), 'ko')).toBe('약 23시간 59분');
    expect(eventDuration(1, 'ko')).toBe('1.0일');
    expect(eventDuration(17.6, 'ko')).toBe('17.6일');
    expect(eventDuration(days(60_000), 'en')).toBe('About 1 min');
    expect(eventDuration(days(3_600_000), 'en')).toBe('About 1h 0m');
    expect(eventDuration(17.6, 'en')).toBe('17.6 days');
  });
});

describe('언어 전환 문구 분리', () => {
  it('영문 정적 문구에 한글이 섞이지 않는다', () => {
    for (const value of Object.values(copy.en)) {
      if (typeof value === 'string') expect(value).not.toMatch(/[가-힣]/);
    }
  });

  it('핵심 한글 화면 문구에 영문 UI 라벨이 남지 않는다', () => {
    expect(copy.ko.languageSwitch).toBe('영어');
    expect(copy.ko.brandName).toBe('루나 내비게이터');
    expect(copy.ko.siteInsight).toBe('후보지 분석');
    expect(copy.ko.lunarPulse).toBe('시간 조건');
  });
});
