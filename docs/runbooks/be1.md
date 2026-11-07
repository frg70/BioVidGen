# Runbook: BE1 extension client for the backend

Code: `extension/src/backend/client.ts`, `extension/entrypoints/sidepanel/backend.tsx`. Plan: `docs/impl-plans/be1-extension-client.md`. Backend side: `docs/runbooks/be0.md`.

## Set up for development
1. Build the extension: `cd extension && npm run build`. Load `.output/chrome-mv3` unpacked.
2. Copy the extension id from `chrome://extensions`.
3. Start the backend with that id. In PowerShell:
   ```
   cd backend
   $env:BIOVIDGEN_EXTENSION_IDS = "<id>"
   uv run biovidgen
   ```
4. Open the side panel and paste the contents of `%LOCALAPPDATA%\BioVidGen\token` into **Código de enlace**. The panel then says "Conectado".

## What the panel says
| Panel message | Cause | What to do |
|---|---|---|
| "no está en marcha" | Nothing answers on port 8765, or another program does | Start the backend, then Reintentar. Check for another program with `netstat -ano \| findstr 8765` |
| "no reconoce esta extensión" | The backend runs without this extension's id | Restart it with the `BIOVIDGEN_EXTENSION_IDS` value shown in the panel. Unpacked ids change with the folder path |
| Código de enlace field | No token stored | Paste the token |
| "no parece un código de enlace" | The input is not 64 lowercase hex characters. Nothing was sent | Copy the whole file |
| "no lo aceptó" | The backend answered 401, usually because the token file was recreated | Copy the token again |

The backend can only run on port 8765 for the extension. With another `BIOVIDGEN_PORT`, the panel says "no está en marcha".

## The token is a secret
- Never paste it into an issue, log or chat.
- It is stored in `chrome.storage.local` under `backendToken`.
- To re-pair after a leak: stop the backend, delete `<data dir>/token`, start it again, paste the new token.

## Logs
Each check writes one entry, `backend.check` or `backend.pair`, with the run id, duration and error code. The same run id reaches the backend's log through `X-BVG-Run-Id` on API calls, so the two logs can be matched. `/health` carries no run id.

## Checking real CORS by hand
Automated e2e runs against a stub, because Playwright answers CORS itself on routed requests. So after changing `client.ts`, or the backend's Host, Origin or CORS checks, run this in Google Chrome against the real backend:

| Step | Expected |
|---|---|
| Backend stopped | "no está en marcha" |
| Backend running without this id | "no reconoce esta extensión", with the id |
| Backend running with this id, no token | Código de enlace field |
| Wrong 64-character token | "no lo aceptó", and the working token (if any) stays stored |
| Right token | "Conectado" |
| Reload the panel | Still "Conectado" |
| Stop the backend, reload | "no está en marcha" |

Last run 2026-11-06, Chrome 156 and bundled Chromium 156: all as expected, no permission prompt. The extension page ran in a tab, not in the side panel itself.
