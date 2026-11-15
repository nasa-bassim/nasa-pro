import * as THREE from 'three';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

import {
  BASE_RADIUS,
  CAMERA_DISTANCE,
  CAMERA_FOCAL,
  centerOn,
  lookAt,
  normalize,
  projectToScreen,
  quatFromAxisAngle,
  quatMul,
  quatNormalize,
  quatSlerp,
  quatToMat3,
  siteVector,
} from './lib/globe';
import type { Quat, Vec3 } from './lib/globe';
import { localizedSiteName, SITES, shortSiteName } from './sites';
import { copy } from './i18n';
import type { Language } from './i18n';

// 달 전체 표면(등장방형 지도)과, 80°S 이남을 더 자세히 담은 남극 모자이크.
const SURFACE = '/img/moon-surface.jpg';
const SOUTH_CAP = '/img/lunar-south-pole.jpg';
// 고도 자료(LOLA)에서 미리 계산한 경사 지도. R은 동쪽, G는 북쪽 경사이고 0.5가 평지다.


const MAX_ZOOM = 16;
const CLUSTER_PX = 18; // 이보다 가까이 찍히는 지점은 하나로 묶는다

interface View {
  q: Quat; // world → view 회전
  zoom: number;
}

// 전체 보기: 지구에서 보는 앞면을 남쪽으로 조금 기울여 여덟 지점이 모두 보이게 한다.
const WHOLE: View = { q: lookAt(siteVector(-25, 12), [0, 1, 0]), zoom: 1 };
// 남극 보기: 경도 0°(지구 쪽)가 위로 오게 남극 지방을 내려다본다.
const POLE: View = { q: lookAt(siteVector(-85, 15), [0, 0, 1]), zoom: 2.6 };

interface Renderer {
  draw: (q: Quat, zoom: number, size: number) => void;
  dispose: () => void;
}

function createRenderer(canvas: HTMLCanvasElement, onTexture: () => void): Renderer | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(2 * Math.atan(1 / CAMERA_FOCAL) * 180 / Math.PI, 1, 0.01, 100);
  camera.position.z = CAMERA_DISTANCE;
  const geometry = new THREE.SphereGeometry(1, 128, 96);
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  let alive = true;
  const loader = new THREE.TextureLoader();
  const loaded = () => { if (alive) onTexture(); };
  const surface = loader.load(SURFACE, loaded);
  const cap = loader.load(SOUTH_CAP, loaded);
  surface.colorSpace = cap.colorSpace = THREE.SRGBColorSpace;
  surface.flipY = cap.flipY = false;
  surface.wrapS = THREE.RepeatWrapping;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.moonSurface = { value: surface };
    shader.uniforms.moonCap = { value: cap };
    shader.vertexShader = 'varying vec3 moonLocal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nmoonLocal = position;');
    shader.fragmentShader = 'varying vec3 moonLocal; uniform sampler2D moonSurface; uniform sampler2D moonCap;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec3 n = normalize(moonLocal);
      float lat = asin(clamp(n.y, -1.0, 1.0));
      vec2 uv = vec2(atan(n.x, n.z) / 6.2831853 + 0.5, 0.5 - lat / 3.14159265);
      vec3 color = texture2D(moonSurface, uv).rgb;
      float capWeight = 1.0 - smoothstep(-1.5010, -1.3963, lat);
      if (capWeight > 0.0) {
        vec2 capUv = 0.5 + 0.5 * vec2(n.x, -n.z) / ((1.0 - n.y) * 0.0874887);
        color = mix(color, texture2D(moonCap, capUv).rgb, capWeight);
      }
      diffuseColor.rgb *= color;
    `);
  };
  const moon = new THREE.Mesh(geometry, material);
  scene.add(moon);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-3, 2, 4);
  scene.add(key);
  return {
    draw(q, zoom, size) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(size, size, false);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      moon.quaternion.set(...q);
      renderer.render(scene, camera);
    },
    dispose() {
      alive = false;
      surface.dispose();
      cap.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}

// 레이블이 이웃 지점과 겹치지 않게 지점마다 방향을 정해 둔다 (남극 보기 기준).
type Side = 'right' | 'left' | 'top' | 'bottom';
const LABEL_SIDE: Record<string, Side> = {
  mp2: 'left',
  cr1: 'bottom',
  gr2: 'left',
};

interface MapColumn {
  site: string; // 큐레이션 slug 또는 'custom'
  lat?: number;
  lonE?: number;
}

interface Mark {
  key: string;
  slug: string | null; // null이면 직접 입력 좌표라 누를 수 없다
  label: string;
  title: string;
  world: Vec3;
  cols: number[]; // 이 지점을 쓰는 열 번호
  side: Side;
}

const pct = (v: number) => `${50 + 50 * v}%`;

function SelectionBadge({ cols, selectedColumnNo, language }: { cols: number[]; selectedColumnNo?: number; language: Language }) {
  if (cols.length === 0) return null;
  return <span
    className={`selection-badge${selectedColumnNo !== undefined && cols.includes(selectedColumnNo) ? ' is-selected' : ''}`}
    aria-label={language === 'ko' ? `${cols.length}개 시나리오에서 선택됨` : `Selected in ${cols.length} scenarios`}
  >✓{cols.length > 1 ? ` ${cols.length}` : ''}</span>;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const Moon3D = memo(function Moon3D({
  columns,
  selectedSite,
  selectedColumnNo,
  onSelect,
  onSelectColumn,
  onReady,
  introToPole,
  roundWindow,
  language,
}: {
  columns: MapColumn[];
  selectedSite?: string;
  selectedColumnNo?: number;
  onSelect: (slug: string) => void;
  onSelectColumn?: (no: number) => void;
  // Lets the parent wait for the first rendered Moon frame before opening dependent UI.
  onReady?: () => void;
  // 첫 화면이 그려진 뒤 후보지가 모인 남극으로 돌아간다.
  introToPole?: boolean;
  // 확대했을 때 달을 네모가 아닌 둥근 창으로 보여 주고, 창 밖의 지점 표시는 숨긴다.
  roundWindow?: boolean;
  language: Language;
}) {
  const t = copy[language];
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState(0);
  const [textures, setTextures] = useState(0);
  const [view, setView] = useState<View>(WHOLE);
  const didReportReady = useRef(false);

  // 애니메이션과 끌기 핸들러가 최신 값을 읽을 수 있게 거울을 둔다.
  const viewRef = useRef(view);
  const sizeRef = useRef(size);
  useEffect(() => {
    viewRef.current = view;
    sizeRef.current = size;
  });

  const raf = useRef(0);
  const stopAnimation = () => cancelAnimationFrame(raf.current);
  const animateTo = (to: View, ms: number) => {
    stopAnimation();
    if (reducedMotion()) {
      setView(to);
      return;
    }
    const from = viewRef.current;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / ms);
      const e = easeInOut(t);
      setView({
        q: quatSlerp(from.q, to.q, e),
        zoom: Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e),
      });
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;
    const r = createRenderer(canvas, () => {
      if (alive) setTextures((n) => n + 1);
    });
    rendererRef.current = r;
    if (!r) setFailed(true);
    return () => {
      alive = false;
      r?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Native listener must be non-passive so a wheel gesture zooms the map.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      cancelAnimationFrame(raf.current);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
      setView((v) => ({ ...v, zoom: Math.min(MAX_ZOOM, Math.max(1, v.zoom * Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.003))) }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  // 조작이나 텍스처 로딩 시에만 그린다.
  useEffect(() => {
    const r = rendererRef.current;
    const canvas = canvasRef.current;
    if (!r || !canvas || size <= 0) return;
    r.draw(view.q, view.zoom, size);
  });

  useEffect(() => {
    // The textures and measured canvas are ready, so the first Moon frame is on screen.
    if (didReportReady.current || size <= 0 || (!failed && textures < 2)) return;
    didReportReady.current = true;
    onReady?.();
  }, [failed, onReady, size, textures]);

  // 첫 화면이 그려지면 후보지가 모인 남극으로 한 번 돌아간다. 타이머로 한 박자 늦춰,
  // 개발 모드의 이펙트 재실행이나 언마운트에 애니메이션이 끊기지 않게 한다.
  const ready = size > 0 && (failed || textures >= 2);
  const introDone = useRef(false);
  useEffect(() => {
    if (!introToPole || !ready || introDone.current) return;
    const id = window.setTimeout(() => {
      introDone.current = true;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setView(POLE);
      else animateTo(POLE, 1400);
    }, 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introToPole, ready]);

  const marks = useMemo(() => {
    const out: Mark[] = SITES.map((s) => ({
      key: s.slug,
      slug: s.slug,
      label: shortSiteName(s.slug, language),
      title: localizedSiteName(s, language),
      world: siteVector(s.lat, s.lon_e),
      cols: columns.flatMap((c, i) => (c.site === s.slug ? [i + 1] : [])),
      side: LABEL_SIDE[s.slug] ?? 'right',
    }));
    // 직접 입력 좌표도 찍는다. 같은 좌표를 쓰는 열은 한 점으로 모은다.
    const custom = new Map<string, Mark>();
    columns.forEach((c, i) => {
      if (c.site !== 'custom' || c.lat === undefined || c.lonE === undefined) return;
      const key = `custom:${c.lat}:${c.lonE}`;
      const existing = custom.get(key);
      if (existing) existing.cols.push(i + 1);
      else
        custom.set(key, {
          key,
          slug: null,
          label: t.customSite,
          title: language === 'ko' ? `직접 입력 좌표 (위도 ${c.lat}°, 동경 ${c.lonE}°)` : `Custom coordinates (lat ${c.lat}°, E ${c.lonE}°)`,
          world: siteVector(c.lat, c.lonE),
          cols: [i + 1],
          side: 'right',
        });
    });
    return [...out, ...custom.values()];
  }, [columns, language, t.customSite]);

  // 화면에서 너무 가까운 지점은 하나로 묶는다. 묶음을 누르면 그쪽으로 확대된다.
  const m = quatToMat3(view.q);
  const half = size / 2;
  const groups: { x: number; y: number; members: Mark[] }[] = [];
  for (const mk of marks) {
    const s = projectToScreen(m, view.zoom, mk.world);
    if (!s.visible) continue;
    if (roundWindow && s.x * s.x + s.y * s.y > 0.97 * 0.97) continue;
    const g = groups.find((o) => Math.hypot((o.x - s.x) * half, (o.y - s.y) * half) < CLUSTER_PX);
    if (g) g.members.push(mk);
    else groups.push({ x: s.x, y: s.y, members: [mk] });
  }

  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const spin = (dx: number, dy: number) =>
    setView((v) => ({
      zoom: v.zoom,
      q: quatNormalize(
        quatMul(quatFromAxisAngle([0, 1, 0], dx), quatMul(quatFromAxisAngle([1, 0, 0], dy), v.q))
      ),
    }));
  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    stopAnimation();
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    // 표면이 손가락을 그대로 따라오도록 화면 위 달 반지름으로 나눈다.
    const rpx = Math.max(1, (sizeRef.current / 2) * BASE_RADIUS * viewRef.current.zoom);
    spin((e.clientX - d.x) / rpx, (e.clientY - d.y) / rpx);
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const onPointerEnd = (e: PointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const step = 0.12 / view.zoom;
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = by[e.key];
    if (!d) return;
    e.preventDefault();
    stopAnimation();
    spin(d[0], d[1]);
  };

  const zoomBy = (f: number) =>
    animateTo({ q: view.q, zoom: Math.min(MAX_ZOOM, Math.max(1, view.zoom * f)) }, 300);

  if (failed)
    return (
      <div className="moon">
        <img
          className="moon-fallback"
          src={SOUTH_CAP}
          width={1920}
          height={1920}
          alt={t.fallbackAlt}
        />
      </div>
    );

  return (
    <div className={`moon${expanded ? ' is-expanded' : ''}${roundWindow ? ' is-round' : ''}`} ref={wrapRef}>
      <div className="moon-heading"><div><strong>{t.moonTitle}</strong><span>{t.moonHelp}</span></div>
        <button type="button" aria-pressed={expanded} onClick={() => setExpanded((v) => !v)}>{expanded ? t.collapse : t.expand}</button>
      </div>
      <div className="zoom-readout" aria-label={`${t.zoomLevel} ${view.zoom.toFixed(1)}×`}>{view.zoom.toFixed(1)}×</div>
      <div className="moon-view">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label={t.moonCanvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onKeyDown}
        />
      </div>

      {(size > 0 ? groups : []).map((g) => {
        const style = { left: pct(g.x), top: pct(g.y) };
        const first = g.members[0]!;
        if (g.members.length > 1) {
          const cols = [...new Set(g.members.flatMap((x) => x.cols))].sort((a, b) => a - b);
          const center = normalize(
            g.members.reduce<Vec3>((acc, x) => [acc[0] + x.world[0], acc[1] + x.world[1], acc[2] + x.world[2]], [0, 0, 0])
          );
          const names = g.members.map((x) => x.label).join(', ');
          return (
            <span key={`group:${first.key}`} className="marker-group side-right" style={style}>
              <button
                type="button"
                className="marker cluster"
                onClick={() =>
                  animateTo({ q: centerOn(view.q, center), zoom: Math.min(MAX_ZOOM, view.zoom * 2.6) }, 800)
                }
                aria-label={`${names} ${t.zoomTo}`}
                title={`${names} ${t.zoomTo}`}
              >
                {g.members.length}
              </button>
              <span className="marker-label">
                {g.members.length} {t.sites} · {t.tapToZoom}
                <SelectionBadge cols={cols} selectedColumnNo={selectedColumnNo} language={language} />
              </span>
            </span>
          );
        }
        const cls = `marker side-${first.side}${first.cols.length > 0 ? ' used' : ''}${selectedSite === first.slug ? ' is-selected' : ''}`;
        const label = (
          <span className="marker-label">
            {first.label}
            <SelectionBadge cols={first.cols} selectedColumnNo={selectedColumnNo} language={language} />
          </span>
        );
        if (first.slug === null)
          return (
            <span key={first.key} className={`${cls} reference`} style={style} title={first.title}>
              {label}
            </span>
          );
        const slug = first.slug;
        return (
          <span key={first.key} className={`marker-group side-${first.side}`} style={style}>
            <button
              type="button"
              className={cls}
              aria-pressed={selectedSite === slug}
              onClick={() => {
                onSelect(slug);
                if (first.cols[0] !== undefined) onSelectColumn?.(first.cols[0]);
                animateTo({ q: centerOn(view.q, first.world), zoom: Math.max(2.6, Math.min(MAX_ZOOM, view.zoom * 1.7)) }, 700);
              }}
              aria-label={`${first.title} ${t.selectSite}`}
              title={`${first.title} ${t.selectSite}`}
            />
            {label}
          </span>
        );
      })}

      <div className="moon-tools moon-tools-view" role="group" aria-label={t.moonView}>
        <button type="button" onClick={() => animateTo(POLE, 900)}>
          {t.southPole}
        </button>
        <button type="button" onClick={() => animateTo(WHOLE, 900)}>
          {t.wholeMoon}
        </button>
      </div>
      <div className="moon-tools moon-tools-zoom" role="group" aria-label={t.zoomControls}>
        <button type="button" onClick={() => zoomBy(1 / 1.6)} disabled={view.zoom <= 1} aria-label={t.zoomOut}>
          −
        </button>
        <button type="button" onClick={() => zoomBy(1.6)} disabled={view.zoom >= MAX_ZOOM} aria-label={t.zoomIn}>
          +
        </button>
      </div>
    </div>
  );
});
