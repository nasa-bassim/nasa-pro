import { afterEach, expect, it, vi } from 'vitest';
import { apiUrl } from './api';

afterEach(() => vi.unstubAllEnvs());

it('uses the local proxy when no production endpoint is configured', () => {
  vi.stubEnv('VITE_API_BASE_URL', '');
  expect(apiUrl('/api/health')).toBe('/api/health');
});

it('uses the configured backend without duplicate slashes', () => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://example.onrender.com/');
  expect(apiUrl('/api/health')).toBe('https://example.onrender.com/api/health');
});
