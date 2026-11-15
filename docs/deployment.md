# Vercel + Render deployment

## Render API

Create a Docker Web Service from this repository, using `backend/Dockerfile`
and repository root `.` as its Docker context. `render.yaml` provides the same
configuration for a Blueprint deployment. The Docker build runs backend tests
before packaging the Java 21 application.

- Health check: `/api/health` (expected JSON: `{"status":"ok"}`).
- Set `CORS_ALLOWED_ORIGINS` to the exact frontend origin, e.g.
  `https://your-project.vercel.app` (no trailing slash). Separate additional
  explicitly trusted origins with commas.
- Render supplies `PORT`; the application reads it automatically.
- Free instances can sleep and their local ephemeris cache is temporary.
  A cold start can delay the first custom-coordinate request.

## Vercel frontend

Import the repository with Root Directory `web` and framework Vite.
`web/vercel.json` supplies the install/build commands and `dist` output.
Set `VITE_API_BASE_URL=https://your-service.onrender.com` before building.
This is a public API URL, not a credential. Changing it requires a new build.

The frontend calls Render directly; only exact origins configured on Render
are permitted. Static site comparisons continue to use bundled data.
The Python model pipeline and model weights are not required on either host.

## Verify after deploying

1. Open the Render `/api/health` endpoint and check HTTP 200.
2. Open the Vercel app and compare predefined landing sites.
3. Add a custom coordinate and verify both Sun and Earth API requests succeed.
4. Verify an unapproved origin receives no CORS permission.

Repository-linked deployments require these deployment files to exist in the
remote repository. Do not commit or push without repository-owner authorization.
