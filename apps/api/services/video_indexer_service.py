"""
Azure AI Video Indexer integration: upload, poll, insights, mapping.

Uses ARM generateAccessToken (Contributor + Account) and api.videoindexer.ai.
Tokens stay server-side; callers must not log token values.
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from pathlib import Path

import httpx

from services import azure_vi_config as cfg
from services.azure_vi_diag import azure_vi_line
from services.azure_vi_errors import brief_exception_for_fallback
from services.job_timing import job_timing_add_phase
from services.video_indexer_mapping import map_video_indexer_results_to_castweave_entities
from services.video_indexer_token import (
    TOKEN_MODULE_DIAG_VERSION,
    get_video_indexer_access_token,
)

logger = logging.getLogger(__name__)

# Progress bands for episode_media job (see episode_media_worker).
PROG_TOKEN = 0.56
PROG_UPLOADING = 0.58
PROG_UPLOAD_OK = 0.62
_POLL_PROGRESS_MIN = 0.70
_POLL_PROGRESS_MAX = 0.84
PROG_INSIGHTS = 0.85
PROG_MAPPING = 0.92
PROG_MAPPED = 0.96

_UPLOAD_CONNECT_TIMEOUT = 30.0
_UPLOAD_READ_TIMEOUT = 600.0
_POLL_HTTP_TIMEOUT = 120.0

_API_ROOT = "https://api.videoindexer.ai"


def generate_video_indexer_token() -> str:
    """Return a fresh or cached Video Indexer account access token (JWT)."""
    return get_video_indexer_access_token()


def _get_vi_token_with_timeout(seconds: float | None = None) -> str:
    """ARM + generateAccessToken can hang on az login / network; never block the worker forever."""
    total = cfg.vi_token_acquire_total_timeout_sec() if seconds is None else seconds
    azure_vi_line(
        "token step: starting (timeout %.0fs) — ARM DefaultAzureCredential + generateAccessToken",
        total,
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        fut = pool.submit(get_video_indexer_access_token)
        try:
            tok = fut.result(timeout=total)
        except FuturesTimeout as e:
            azure_vi_line(
                "token step: TIMEOUT after %.0fs — check az login, network, ARM RBAC",
                total,
            )
            raise TimeoutError(
                f"Azure Video Indexer token acquisition timed out after {total:.0f}s "
                "(DefaultAzureCredential or ARM generateAccessToken)",
            ) from e
    azure_vi_line("token step: finished OK")
    return tok


def _base_url() -> str:
    return f"{_API_ROOT}/{cfg.region()}/Accounts/{cfg.account_id()}"


def upload_video_to_video_indexer(
    media_path: Path,
    video_name: str,
    *,
    privacy: str = "private",
    access_token: str | None = None,
) -> str:
    """
    Multipart upload of a local file. Returns Video Indexer video id.
    If access_token is set, skips an extra get_video_indexer_access_token() call.
    """
    if not media_path.is_file():
        raise FileNotFoundError(str(media_path))
    azure_vi_line(
        "upload step: preparing POST multipart name=%s size_bytes=%s",
        video_name[:80],
        media_path.stat().st_size,
    )
    token = access_token if access_token is not None else get_video_indexer_access_token()
    url = f"{_base_url()}/Videos"
    params = {
        "accessToken": token,
        "name": video_name[:80],
        "privacy": privacy,
    }
    logger.info(
        "Azure VI: uploading file name=%s size_bytes=%s",
        video_name[:80],
        media_path.stat().st_size,
    )
    azure_vi_line("upload step: HTTP POST /Videos (timeout read=%.0fs)", _UPLOAD_READ_TIMEOUT)
    azure_vi_line("upload step: opening local file for multipart body")
    with media_path.open("rb") as f:
        azure_vi_line("upload step: sending request (this can take a while for large files)")
        with httpx.Client(
            timeout=httpx.Timeout(_UPLOAD_READ_TIMEOUT, connect=_UPLOAD_CONNECT_TIMEOUT),
        ) as client:
            r = client.post(url, params=params, files={"file": (media_path.name, f)})
    azure_vi_line("upload step: HTTP response status=%s", r.status_code)
    if r.status_code >= 400:
        try:
            r.raise_for_status()
        except Exception as e:
            azure_vi_line("upload step: FAILED — %s", brief_exception_for_fallback(e))
            logger.error(
                "Azure VI: upload failed — %s",
                brief_exception_for_fallback(e),
            )
            raise RuntimeError(brief_exception_for_fallback(e)) from e
    data = r.json()
    vid = data.get("id")
    if not vid:
        azure_vi_line("upload step: response missing video id")
        raise RuntimeError("Video Indexer upload response missing id")
    azure_vi_line("upload step: OK video_id=%s", vid)
    logger.info("Azure VI: upload accepted video_id=%s", vid)
    return str(vid)


def poll_video_indexer_status(
    video_id: str,
    *,
    job_id: str | None = None,
    access_token: str | None = None,
    poll_interval_sec_override: float | None = None,
) -> dict:
    """
    GET Videos/{videoId}/Index until state is terminal or timeout.
    """
    from db.store import store

    azure_vi_line(
        "poll step: first GET /Videos/%s/Index (timeout %.0fs per request)",
        video_id,
        _POLL_HTTP_TIMEOUT,
    )
    token = access_token if access_token is not None else get_video_indexer_access_token()
    url = f"{_base_url()}/Videos/{video_id}/Index"
    # Do not pass language=English: that returns English translations instead of
    # source-language transcript (e.g. Hindi clips would show English text).
    params = {"accessToken": token}
    deadline = cfg.poll_timeout_sec()
    interval = cfg.poll_interval_sec()
    start = time.time()
    last: dict = {}
    logger.info(
        "Azure VI: polling index status video_id=%s timeout_sec=%.0f interval_sec=%.1f",
        video_id,
        deadline,
        interval,
    )
    poll_n = 0
    while True:
        poll_n += 1
        azure_vi_line("poll step: iteration=%s GET Index", poll_n)
        with httpx.Client(timeout=_POLL_HTTP_TIMEOUT) as client:
            r = client.get(url, params=params)
            if r.status_code >= 400:
                try:
                    r.raise_for_status()
                except Exception as e:
                    azure_vi_line(
                        "poll step: HTTP error — %s",
                        brief_exception_for_fallback(e),
                    )
                    logger.error(
                        "Azure VI: poll Index failed — %s",
                        brief_exception_for_fallback(e),
                    )
                    raise RuntimeError(brief_exception_for_fallback(e)) from e
            last = r.json()
        state = (last.get("state") or "").strip()
        elapsed = time.time() - start
        azure_vi_line(
            "poll step: state=%s elapsed=%.1fs / deadline=%.0fs",
            state or "…",
            elapsed,
            deadline,
        )
        logger.info(
            "Azure VI: poll state=%s video_id=%s elapsed_sec=%.1f",
            state,
            video_id,
            elapsed,
        )
        if job_id:
            try:
                span = _POLL_PROGRESS_MAX - _POLL_PROGRESS_MIN
                frac = _POLL_PROGRESS_MIN + min(
                    span,
                    (elapsed / max(deadline, 1.0)) * span,
                )
                store.update_job(
                    job_id,
                    progress=frac,
                    message=(
                        f"AI video analysis in progress ({state or 'working'}). "
                        "Longer clips may need a few minutes."
                    )[:500],
                )
            except Exception:
                logger.warning(
                    "Azure VI: job progress update failed job_id=%s",
                    job_id,
                    exc_info=True,
                )
        if state in ("Processed", "Failed"):
            if state == "Failed":
                err_hint = (
                    last.get("processingProgress")
                    or last.get("failureReason")
                    or last.get("message")
                )
                azure_vi_line("poll step: terminal FAILED hint=%s", err_hint)
                logger.error(
                    "Azure VI: indexing terminal Failed video_id=%s hint=%s",
                    video_id,
                    err_hint,
                )
            else:
                azure_vi_line("poll step: terminal PROCESSED")
            return last
        if elapsed > deadline:
            azure_vi_line(
                "poll step: TIMEOUT after %.0fs (video_id=%s)",
                deadline,
                video_id,
            )
            raise TimeoutError(
                f"Video Indexer indexing timed out after {deadline:.0f}s (video_id={video_id})",
            )
        time.sleep(interval)


def fetch_video_indexer_insights(
    video_id: str,
    *,
    access_token: str | None = None,
) -> dict:
    """Fetch index / insights for a video (GET /Videos/{id}/Index)."""
    azure_vi_line(
        "insights step: GET /Videos/%s/Index (timeout %.0fs)",
        video_id,
        _POLL_HTTP_TIMEOUT,
    )
    token = access_token if access_token is not None else get_video_indexer_access_token()
    url = f"{_base_url()}/Videos/{video_id}/Index"
    params = {"accessToken": token}
    try:
        with httpx.Client(timeout=_POLL_HTTP_TIMEOUT) as client:
            r = client.get(url, params=params)
            if r.status_code >= 400:
                try:
                    r.raise_for_status()
                except Exception as e:
                    azure_vi_line(
                        "insights step: FAILED — %s",
                        brief_exception_for_fallback(e),
                    )
                    logger.error(
                        "Azure VI: fetch insights failed — %s",
                        brief_exception_for_fallback(e),
                    )
                    raise RuntimeError(brief_exception_for_fallback(e)) from e
            payload = r.json()
    except Exception as e:
        azure_vi_line("insights step: FAILED — %s", brief_exception_for_fallback(e))
        raise
    azure_vi_line(
        "insights step: OK state=%s",
        (payload.get("state") or "")[:80] or "…",
    )
    logger.info(
        "Azure VI: insights fetch OK video_id=%s top_state=%s",
        video_id,
        (payload.get("state") or "")[:80],
    )
    return payload


def index_local_file_for_episode(
    media_path: Path,
    episode_id: str,
    video_name: str,
    job_id: str | None = None,
) -> tuple[str | None, list]:
    """
    Upload, wait for processing, map to CastWeave transcript segments.
    """
    from db.store import store

    azure_vi_line(
        "pipeline: START episode_id=%s file=%s job_id=%s",
        episode_id,
        media_path.name,
        job_id or "—",
    )
    logger.info(
        "Azure VI: pipeline start episode_id=%s file=%s",
        episode_id,
        media_path.name,
    )

    t_pipeline = time.perf_counter()

    if job_id:
        store.update_job(
            job_id,
            progress=PROG_TOKEN,
            message="Connecting to AI video analysis…",
        )

    token = _get_vi_token_with_timeout()

    if job_id:
        store.update_job(
            job_id,
            progress=PROG_UPLOADING,
            message="Uploading for cloud analysis…",
        )

    vid = upload_video_to_video_indexer(
        media_path,
        video_name,
        access_token=token,
    )

    if job_id:
        store.update_job(
            job_id,
            progress=PROG_UPLOAD_OK,
            message="Video received; analyzing speech and speakers…",
        )

    azure_vi_line("pipeline: polling until Processed/Failed…")
    try:
        size_b = media_path.stat().st_size
    except OSError:
        size_b = 0
    # Smaller uploads tend to index quickly; poll a bit faster to reduce idle waits.
    fast_poll = min(cfg.poll_interval_sec(), 3.5) if size_b < 15 * 1024 * 1024 else None
    payload = poll_video_indexer_status(
        vid,
        job_id=job_id,
        access_token=token,
        poll_interval_sec_override=fast_poll,
    )

    if (payload.get("state") or "").strip() != "Processed":
        st = (payload.get("state") or "").strip()
        hint = payload.get("failureReason") or payload.get("message") or ""
        azure_vi_line("pipeline: bad terminal state=%r hint=%r", st, hint)
        raise RuntimeError(
            f"Video Indexer did not complete successfully (state={st!r} hint={hint!r})",
        )

    if job_id:
        store.update_job(
            job_id,
            progress=PROG_INSIGHTS,
            message="Reading transcript and speaker cues…",
        )

    insights_payload = fetch_video_indexer_insights(vid, access_token=token)

    t_pre_map = time.perf_counter()
    if job_id:
        job_timing_add_phase(job_id, "analysis", t_pre_map - t_pipeline)

    azure_vi_line("map step: mapping transcript / speaker groups to CastWeave segments")
    if job_id:
        store.update_job(
            job_id,
            progress=PROG_MAPPING,
            message="Building transcript and cast candidates…",
        )

    t_map = time.perf_counter()
    language, segments = map_video_indexer_results_to_castweave_entities(
        insights_payload,
        episode_id,
    )
    if job_id:
        job_timing_add_phase(job_id, "mapping", time.perf_counter() - t_map)

    if job_id:
        store.update_job(
            job_id,
            progress=PROG_MAPPED,
            message=f"Prepared {len(segments)} transcript lines",
        )

    azure_vi_line(
        "pipeline: DONE segments=%s language=%s",
        len(segments),
        language or "—",
    )
    logger.info(
        "Azure VI: mapping done episode_id=%s segments=%s language=%s",
        episode_id,
        len(segments),
        language,
    )
    return language, segments
