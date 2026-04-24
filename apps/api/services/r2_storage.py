"""Cloudflare R2 storage abstraction (S3-compatible).

When R2 env vars are not set, all operations are no-ops and the caller
falls back to local disk.  This keeps local dev working without credentials.

Env vars:
  R2_ACCOUNT_ID          - Cloudflare account ID
  R2_ACCESS_KEY_ID       - R2 API token access key
  R2_SECRET_ACCESS_KEY   - R2 API token secret
  R2_BUCKET_UPLOADS      - bucket for original uploads
  R2_BUCKET_ARTIFACTS    - bucket for generated artifacts
  R2_ENDPOINT            - (optional) override endpoint URL
"""

from __future__ import annotations

import logging
import mimetypes
import os
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

logger = logging.getLogger("castweave.r2")

_client: "S3Client | None" = None
_initialized = False


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def r2_configured() -> bool:
    return bool(_env("R2_ACCESS_KEY_ID") and _env("R2_SECRET_ACCESS_KEY"))


def uploads_bucket() -> str:
    return _env("R2_BUCKET_UPLOADS", "castweave-uploads")


def artifacts_bucket() -> str:
    return _env("R2_BUCKET_ARTIFACTS", "castweave-artifacts")


def bucket_for_key(key: str) -> str:
    """Resolve which bucket a relative key belongs to."""
    if key.startswith("uploads/"):
        return uploads_bucket()
    return artifacts_bucket()


def _get_client() -> "S3Client | None":
    global _client, _initialized
    if _initialized:
        return _client
    _initialized = True

    if not r2_configured():
        logger.info("R2 not configured; media stays on local disk")
        return None

    try:
        import boto3
    except ImportError:
        logger.warning("boto3 not installed; R2 disabled")
        return None

    account_id = _env("R2_ACCOUNT_ID")
    endpoint = _env("R2_ENDPOINT") or f"https://{account_id}.r2.cloudflarestorage.com"

    _client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=_env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=_env("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )
    logger.info("R2 client initialized endpoint=%s", endpoint)
    return _client


def _guess_content_type(path: Path) -> str:
    ct, _ = mimetypes.guess_type(str(path))
    return ct or "application/octet-stream"


def upload_file(
    local_path: Path,
    bucket: str,
    key: str,
    content_type: str | None = None,
) -> bool:
    """Upload a local file to R2. Returns True on success, False if R2 is off."""
    client = _get_client()
    if client is None:
        return False
    ct = content_type or _guess_content_type(local_path)
    client.upload_file(
        Filename=str(local_path),
        Bucket=bucket,
        Key=key,
        ExtraArgs={"ContentType": ct},
    )
    size_mb = local_path.stat().st_size / (1024 * 1024)
    logger.info("r2_upload bucket=%s key=%s size_mb=%.2f", bucket, key, size_mb)
    return True


def upload_bytes(
    data: bytes,
    bucket: str,
    key: str,
    content_type: str = "application/octet-stream",
) -> bool:
    """Upload raw bytes to R2."""
    client = _get_client()
    if client is None:
        return False
    from io import BytesIO

    client.upload_fileobj(BytesIO(data), bucket, key, ExtraArgs={"ContentType": content_type})
    logger.info("r2_upload_bytes bucket=%s key=%s bytes=%d", bucket, key, len(data))
    return True


def download_file(bucket: str, key: str, local_path: Path) -> bool:
    """Download an R2 object to a local path. Returns True on success."""
    client = _get_client()
    if client is None:
        return False
    local_path.parent.mkdir(parents=True, exist_ok=True)
    client.download_file(bucket, key, str(local_path))
    logger.info("r2_download bucket=%s key=%s -> %s", bucket, key, local_path)
    return True


def delete_object(bucket: str, key: str) -> bool:
    """Delete a single object from R2."""
    client = _get_client()
    if client is None:
        return False
    client.delete_object(Bucket=bucket, Key=key)
    logger.debug("r2_delete bucket=%s key=%s", bucket, key)
    return True


def delete_prefix(bucket: str, prefix: str) -> int:
    """Delete all objects under a prefix. Returns count deleted."""
    client = _get_client()
    if client is None:
        return 0
    deleted = 0
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        objects = page.get("Contents", [])
        if not objects:
            continue
        keys = [{"Key": obj["Key"]} for obj in objects]
        client.delete_objects(Bucket=bucket, Delete={"Objects": keys})
        deleted += len(keys)
    if deleted:
        logger.info("r2_delete_prefix bucket=%s prefix=%s count=%d", bucket, prefix, deleted)
    return deleted


def generate_presigned_url(bucket: str, key: str, expires: int = 3600) -> str | None:
    """Generate a presigned GET URL. Returns None if R2 is off."""
    client = _get_client()
    if client is None:
        return None
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires,
    )
    return url


def key_exists(bucket: str, key: str) -> bool:
    """Check whether a key exists in R2."""
    client = _get_client()
    if client is None:
        return False
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except Exception:
        return False


def upload_local_and_clean(local_path: Path, key: str) -> None:
    """Upload to the appropriate R2 bucket and delete the local file.

    If R2 is not configured, the local file is kept (dev mode).
    """
    bucket = bucket_for_key(key)
    if upload_file(local_path, bucket, key):
        try:
            local_path.unlink()
            logger.debug("cleaned local after R2 upload: %s", local_path)
        except OSError:
            pass
