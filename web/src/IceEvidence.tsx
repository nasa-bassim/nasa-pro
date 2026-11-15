import { useEffect, useState } from 'react';
import type { Language } from './i18n';
import { findIceSite, ICE_DATA_URL, ICE_MODEL_URL, parseIceEvidence } from './lib/iceEvidence';
import type { IceEvidence as Evidence } from './lib/iceEvidence';
import './ice-evidence.css';

export function IceEvidence({ lat, lonE, language }: { lat: number; lonE: number; language: Language }) {
  const [data, setData] = useState<Evidence | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ko = language === 'ko';
  const inRange = lat >= -90 && lat <= -80;
  useEffect(() => {
    if (!inRange) return;
    const controller = new AbortController();
    void fetch(`${import.meta.env.BASE_URL}evidence/ice.json`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<unknown>; })
      .then(parseIceEvidence)
      .then((d) => { if (!controller.signal.aborted) { setData(d); setFailed(false); } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [inRange, attempt]);
  const site = data ? findIceSite(data, lat, lonE) : undefined;
  const score = inRange && !failed && site?.status === 'ok' ? site.score : null;
  const message = !inRange
    ? (ko ? '남위 80~90° 적용 범위 밖입니다.' : 'Outside the supported 80–90°S region.')
    : failed
      ? (ko ? '추론 근거 데이터를 불러오지 못했습니다.' : 'Could not load inference evidence.')
      : !data
        ? (ko ? '추론 근거를 불러오는 중…' : 'Loading inference evidence…')
        : !site
          ? (ko ? '이 좌표는 아직 추론하지 않았습니다.' : 'This coordinate has not been evaluated yet.')
          : site.status === 'no-data'
            ? (ko ? '유효한 입력 또는 추론 결과가 없어 평가할 수 없습니다.' : 'Valid inputs or predictions are unavailable.')
            : null;
  return <section className="ice-evidence" aria-label={ko ? '얼음 탐사 근거' : 'Ice exploration evidence'}>
    <div className="ice-evidence-heading"><h3>{ko ? '얼음 탐사 유망도' : 'Ice exploration prospectivity'}</h3>
      <span>{ko ? 'AI 보조 근거' : 'AI supporting evidence'}</span></div>
    {score !== null ? <p className="ice-score"><strong>{score.toFixed(3)}</strong><span> / 1</span></p>
      : <p role="status">{message}</p>}
    {failed && inRange ? <button onClick={() => { setFailed(false); setData(null); setAttempt((n) => n + 1); }}>
      {ko ? '다시 시도' : 'Retry'}</button> : null}
    <p>{ko ? '환경 지도를 종합한 탐사 유망도입니다. 얼음 존재 확률·매장량이나 착륙 안전성을 뜻하지 않습니다.'
      : 'An environmental prospectivity estimate, not an ice probability, resource estimate or landing-safety assessment.'}</p>
    <p>{ko ? '전력·통신 순위에는 합산하지 않습니다. 날짜와 무관한 지점별 보조 정보입니다.'
      : 'Supporting site information independent of the date; excluded from power and communication rankings.'}</p>
    {score !== null && site?.datasetSplit === 'train' ? <p>{ko
      ? '학습에 사용된 지역의 시범 추론 결과입니다. 새로운 지역에 대한 정확도 검증은 아닙니다.'
      : 'Demonstration on a training-region tile, not an accuracy test on unseen terrain.'}</p> : null}
    <details><summary>{ko ? '데이터와 분석 출처' : 'Data and analysis sources'}</summary>
      <p><a href={ICE_MODEL_URL} target="_blank" rel="noreferrer">NASA–IBM Lunar FM · Ice Prospectivity</a></p>
      <p><a href={ICE_DATA_URL} target="_blank" rel="noreferrer">SomBench · Polar Ice Prospectivity</a></p>
      <p>{ko ? '약 240m/픽셀 · 온도, 얼음 안정 깊이, 영구음영과 지형 8종 입력. 전문가 모델 지도를 재현한 결과입니다.'
        : 'About 240 m/pixel · Eight thermal, ice-stability, shadow and terrain inputs. Reproduces an expert-model map.'}</p>
      <p>{ko ? '공개 벤치마크 입력을 사용한 시범 적용입니다. 학습에 사용된 지역이 포함될 수 있으며, 실제 얼음 관측에 대한 독립 검증은 아닙니다.'
        : 'A demonstration using public benchmark inputs, which may include training regions. Not independent validation against observed ice.'}</p>
      {data && site ? <p className="ice-provenance">{site.patch}<br />
        {ko ? '모델 버전' : 'Model revision'}: {data.modelRevision.slice(0, 12)}<br />
        {ko ? '생성 시각' : 'Generated'}: {data.generatedAt}</p> : null}
    </details>
  </section>;
}
