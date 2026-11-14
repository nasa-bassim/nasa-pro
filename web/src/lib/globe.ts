// 3D 달을 돌리고 지점을 화면에 찍기 위한 최소한의 회전 수학.
//
// 달 좌표계(world): +y가 북극, +z가 경도 0°(지구를 향한 면의 중심), +x가 동경 90°.
// 화면 좌표계(view): +x가 오른쪽, +y가 위, +z가 보는 사람 쪽.
// 방향(orientation)은 world → view 회전을 단위 사원수로 들고 있다.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w
/** world → view 회전 행렬, 행 우선(row-major) 9칸. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

const DEG = Math.PI / 180;

/** 위도·동경(도)을 달 좌표계의 단위 벡터로. */
export function siteVector(lat: number, lonE: number): Vec3 {
  const phi = lat * DEG;
  const lam = lonE * DEG;
  return [Math.cos(phi) * Math.sin(lam), Math.sin(phi), Math.cos(phi) * Math.cos(lam)];
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** a 다음에 b가 아니라, b를 먼저 적용하고 a를 적용하는 회전 (a ∘ b). */
export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const [x, y, z] = normalize(axis);
  const s = Math.sin(angle / 2);
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
}

export function quatToMat3(q: Quat): Mat3 {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ];
}

export function rotate(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function mat3ToQuat(m: Mat3): Quat {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return quatNormalize([(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]);
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return quatNormalize([s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]);
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return quatNormalize([(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]);
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return quatNormalize([(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]);
}

/** dir이 화면 한가운데(보는 사람 쪽)로 오고, up이 화면 위쪽을 향하는 방향. */
export function lookAt(dir: Vec3, up: Vec3): Quat {
  const z = normalize(dir);
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return mat3ToQuat([x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]]);
}

/** 지금 방향 q에서, 달 위의 점 target이 화면 한가운데로 오도록 가장 짧게 돌린 방향. */
export function centerOn(q: Quat, target: Vec3): Quat {
  const v = rotate(quatToMat3(q), normalize(target));
  const axis = cross(v, [0, 0, 1]);
  const sin = Math.hypot(axis[0], axis[1], axis[2]);
  if (sin < 1e-9) return q; // 이미 한가운데거나 정반대
  return quatNormalize(quatMul(quatFromAxisAngle(axis, Math.atan2(sin, v[2])), q));
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (dot < 0) {
    dot = -dot;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (dot > 0.9995)
    return quatNormalize([
      a[0] + (bb[0] - a[0]) * t,
      a[1] + (bb[1] - a[1]) * t,
      a[2] + (bb[2] - a[2]) * t,
      a[3] + (bb[3] - a[3]) * t,
    ]);
  const th = Math.acos(dot);
  const sa = Math.sin((1 - t) * th) / Math.sin(th);
  const sb = Math.sin(t * th) / Math.sin(th);
  return [a[0] * sa + bb[0] * sb, a[1] * sa + bb[1] * sb, a[2] * sa + bb[2] * sb, a[3] * sa + bb[3] * sb];
}

/** 화면에 그려지는 달의 반지름. 그림 영역의 반폭을 1로 본 값이고 zoom 1일 때의 크기다. */
export const BASE_RADIUS = 0.82;
export const CAMERA_DISTANCE = 4;
export const CAMERA_FOCAL = BASE_RADIUS * Math.sqrt(CAMERA_DISTANCE ** 2 - 1);

export interface ScreenPoint {
  x: number; // 그림 영역 가운데가 0, 오른쪽 끝이 1
  y: number; // 아래쪽이 +
  visible: boolean; // 달의 앞쪽에 있고 그림 영역 안에 있다
}

/** 달 위의 한 점이 화면 어디에 찍히는지. 렌더러의 원근 카메라와 같은 투영식이다. */
export function projectToScreen(m: Mat3, zoom: number, world: Vec3): ScreenPoint {
  const v = rotate(m, world);
  const scale = CAMERA_FOCAL * zoom / (CAMERA_DISTANCE - v[2]);
  const x = v[0] * scale;
  const y = -v[1] * scale;
  return { x, y, visible: v[2] > 1 / CAMERA_DISTANCE && Math.abs(x) < 0.96 && Math.abs(y) < 0.96 };
}
