// Empty in development: Vite proxies /api. Production points directly at Render.
export function apiUrl(path: string): string {
  return `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')}${path}`;
}
