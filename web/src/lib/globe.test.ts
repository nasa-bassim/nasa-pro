import { describe, expect, it } from 'vitest';

import {
  CAMERA_DISTANCE,
  CAMERA_FOCAL,
  centerOn,
  lookAt,
  projectToScreen,
  quatFromAxisAngle,
  quatMul,
  quatSlerp,
  quatToMat3,
  rotate,
  siteVector,
} from './globe';
import type { Vec3 } from './globe';

const close = (a: Vec3, b: Vec3) => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
  expect(a[2]).toBeCloseTo(b[2], 6);
};

describe('siteVector', () => {
  it('북극은 +y, 경도 0° 적도는 +z, 동경 90° 적도는 +x다', () => {
    close(siteVector(90, 0), [0, 1, 0]);
    close(siteVector(0, 0), [0, 0, 1]);
    close(siteVector(0, 90), [1, 0, 0]);
    close(siteVector(-90, 123), [0, -1, 0]);
  });
});

describe('lookAt', () => {
  it('고른 지점이 화면 한가운데로 온다', () => {
    const d = siteVector(-84.78, 29.13);
    close(rotate(quatToMat3(lookAt(d, [0, 0, 1])), d), [0, 0, 1]);
  });

  it('앞면을 북쪽이 위로 보면 동쪽이 화면 오른쪽이다', () => {
    const m = quatToMat3(lookAt(siteVector(0, 0), [0, 1, 0]));
    close(rotate(m, siteVector(0, 90)), [1, 0, 0]);
    close(rotate(m, siteVector(90, 0)), [0, 1, 0]);
  });

  it('남극을 경도 0°가 위로 보면 동경 90°가 화면 오른쪽이다', () => {
    const m = quatToMat3(lookAt(siteVector(-90, 0), [0, 0, 1]));
    close(rotate(m, siteVector(0, 0)), [0, 1, 0]);
    close(rotate(m, siteVector(0, 90)), [1, 0, 0]);
  });
});

describe('centerOn', () => {
  it('어느 방향에서든 고른 점을 한가운데로 돌린다', () => {
    const q = lookAt(siteVector(-25, 12), [0, 1, 0]);
    const target = siteVector(-89.4679, -137.411);
    close(rotate(quatToMat3(centerOn(q, target)), target), [0, 0, 1]);
  });

  it('이미 한가운데면 그대로다', () => {
    const d = siteVector(10, 20);
    const q = lookAt(d, [0, 1, 0]);
    expect(centerOn(q, d)).toEqual(q);
  });
});

describe('quatSlerp', () => {
  it('양 끝에서 원래 방향과 같다', () => {
    const a = lookAt(siteVector(-25, 12), [0, 1, 0]);
    const b = lookAt(siteVector(-85, 15), [0, 0, 1]);
    const v = siteVector(-69.37, 32.32);
    close(rotate(quatToMat3(quatSlerp(a, b, 0)), v), rotate(quatToMat3(a), v));
    close(rotate(quatToMat3(quatSlerp(a, b, 1)), v), rotate(quatToMat3(b), v));
  });

  it('반쯤 돌린 회전은 절반 각도다', () => {
    const a = quatFromAxisAngle([0, 1, 0], 0);
    const b = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
    close(rotate(quatToMat3(quatSlerp(a, b, 0.5)), [0, 0, 1]), [Math.SQRT1_2, 0, Math.SQRT1_2]);
  });
});

describe('끌어서 돌리기', () => {
  it('화면 y축으로 양의 각도만큼 돌리면 앞의 점이 오른쪽으로 간다', () => {
    const q = quatMul(quatFromAxisAngle([0, 1, 0], 0.1), [0, 0, 0, 1]);
    expect(rotate(quatToMat3(q), [0, 0, 1])[0]).toBeGreaterThan(0);
  });

  it('화면 x축으로 양의 각도만큼 돌리면 앞의 점이 아래로 간다', () => {
    const q = quatFromAxisAngle([1, 0, 0], 0.1);
    expect(rotate(quatToMat3(q), [0, 0, 1])[1]).toBeLessThan(0);
  });
});

describe('projectToScreen', () => {
  const m = quatToMat3(lookAt(siteVector(0, 0), [0, 1, 0]));

  it('한가운데 점은 (0, 0)에, 북쪽 점은 화면 위쪽(y 음수)에 찍힌다', () => {
    const c = projectToScreen(m, 1, siteVector(0, 0));
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
    expect(c.visible).toBe(true);
    expect(projectToScreen(m, 1, siteVector(30, 0)).y).toBeCloseTo(-CAMERA_FOCAL * 0.5 / (CAMERA_DISTANCE - Math.cos(Math.PI / 6)));
  });

  it('뒷면의 점은 보이지 않는다', () => {
    expect(projectToScreen(m, 1, siteVector(0, 180)).visible).toBe(false);
  });

  it('확대해서 그림 영역 밖으로 나간 점은 보이지 않는다', () => {
    expect(projectToScreen(m, 1, siteVector(0, 60)).visible).toBe(true);
    expect(projectToScreen(m, 4, siteVector(0, 60)).visible).toBe(false);
  });
});

describe('원근 투영 경계', () => {
  const m = quatToMat3([0, 0, 0, 1]);
  it('원근 카메라에서 구 뒤에 가려진 가장자리 지점을 숨긴다', () => {
    expect(projectToScreen(m, 1, siteVector(0, 80)).visible).toBe(false);
    expect(projectToScreen(m, 1, siteVector(0, 60)).visible).toBe(true);
  });
  it('확대해도 표면 점의 중심 방향을 유지한다', () => {
    const v = siteVector(10, 10);
    const a = projectToScreen(m, 1, v);
    const b = projectToScreen(m, 2, v);
    expect(b.x).toBeCloseTo(a.x * 2);
    expect(b.y).toBeCloseTo(a.y * 2);
  });
});
