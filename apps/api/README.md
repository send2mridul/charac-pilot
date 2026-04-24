# CharacPilot API

FastAPI service with **in-memory** data. Episode uploads are stored on disk under `storage/`; FFmpeg preprocesses video locally (no cloud, no Postgres/Redis).

## FFmpeg (required for episode upload pipeline)

Install **FFmpeg** so both `ffmpeg` and `ffprobe` are on your `PATH`.

- **Windows:** [ffmpeg.org](https://ffmpeg.org/download.html) (e.g. gyan.dev builds) or `winget install FFmpeg`
- **macOS:** `brew install ffmpeg`

Verify:

```powershell
ffmpeg -version
ffprobe -version
```


### PATH from IDEs (Windows)

If those commands work in PowerShell but the API still cannot find FFmpeg, the process may have a shorter `PATH` (common when launching from an IDE). This API **merges** `PATH` with the User and Machine entries from the Windows registry when resolving binaries.

You can also set explicit paths (no registry lookup needed for these):

```powershell
$env:FFMPEG_PATH = "C:\path\to\ffmpeg.exe"
$env:FFPROBE_PATH = "C:\path\to\ffprobe.exe"
.\.venv\Scripts\uvicorn main:app --reload --reload-exclude storage --host 127.0.0.1 --port 8000
```

On startup the API logs either `FFmpeg OK: ffmpeg=... ffprobe=...` or the effective `PATH` / augmented `PATH` for debugging.

**Video-only files** (no audio track): extraction falls back to a **silent stereo WAV** with the same duration as the video so downstream steps always have `audio.wav`.

If FFmpeg is missing, `POST /projects/{id}/episodes/upload` still saves the file, but the background job moves to **`failed`** with an error message.

## Setup (Windows)

From `apps/api`:

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
```

## Run

```powershell
.\.venv\Scripts\uvicorn main:app --reload --reload-exclude storage --host 127.0.0.1 --port 8000
```

`--reload-exclude storage` is required: uploads and FFmpeg write under `storage/`, and without this uvicorn’s file watcher would restart the process and **clear the in-memory job store**, causing `GET /jobs/{id}` to return **404 Job not found** on the next poll.

Open docs: http://127.0.0.1:8000/docs

## Local storage layout

Uploaded videos and derived assets:

`storage/uploads/{project_id}/{episode_id}/`

- `source.{ext}` — uploaded video (ext from client, e.g. `.mp4`)
- `audio.wav` — PCM WAV extracted via FFmpeg
- `thumb_01.jpg` … `thumb_06.jpg` — evenly spaced thumbnails

Static HTTP: `GET /media/...` (root is the `storage/` directory), e.g.  
`http://127.0.0.1:8000/media/uploads/p1/ep-xxxxxxxxxx/thumb_01.jpg`

## Layout

| Path | Role |
|------|------|
| `main.py` | App factory, CORS, router includes, `/media` static mount |
| `routers/` | HTTP endpoints |
| `schemas/` | Pydantic request/response models |
| `services/` | Business logic + `episode_media_worker` (FFmpeg) |
| `models/` | Domain enums / future ORM hooks |
| `db/` | In-memory store (`store.py`) |
| `storage_paths.py` | Resolved paths under `storage/` |

## CORS

Allowed origins: `http://localhost:3000`, `http://127.0.0.1:3000` (Next.js dev).

## Endpoints (summary)

- `GET /health`
- `GET /projects`, `POST /projects`, `GET /projects/{id}`
- `GET /projects/{id}/episodes`, `POST /projects/{id}/episodes/upload` — **multipart form field `file`** (video)
- `GET /projects/{id}/characters`
- `POST /characters/{id}/voice`, `POST /characters/{id}/generate`
- `POST /episodes/{id}/segments/{segment_id}/replace`
- `POST /episodes/{id}/export`
- `GET /jobs/{id}` — for **`episode_media`** jobs, returns live status from the FFmpeg worker; other job types still advance via poll simulation
