"""
Google Drive uploader using service account credentials.
Uploads zipped chapter files to a specified folder.
"""

import os
import io
import json
import re
from typing import Optional

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload


SCOPES = ["https://www.googleapis.com/auth/drive"]


def _get_service():
    raw_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
    if not raw_json:
        raise ValueError("GOOGLE_SERVICE_ACCOUNT_JSON is not set.")
    info = json.loads(raw_json)
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _safe_filename(name: str) -> str:
    return re.sub(r'[\\/*?:"<>|]', "_", name)


def get_or_create_folder(service, name: str, parent_id: str) -> str:
    """Get folder by name under parent, or create it."""
    query = (
        f"name = '{name}' and mimeType = 'application/vnd.google-apps.folder' "
        f"and '{parent_id}' in parents and trashed = false"
    )
    results = service.files().list(q=query, fields="files(id, name)").execute()
    files = results.get("files", [])
    if files:
        return files[0]["id"]

    meta = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    folder = service.files().create(body=meta, fields="id").execute()
    return folder["id"]


def upload_bytes(
    data: bytes,
    filename: str,
    mimetype: str,
    folder_id: str,
) -> str:
    """Upload bytes to Drive folder. Returns the file's web view URL."""
    service = _get_service()
    meta = {"name": filename, "parents": [folder_id]}
    media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mimetype, resumable=True)
    f = service.files().create(body=meta, media_body=media, fields="id, webViewLink").execute()

    # Make it publicly viewable
    service.permissions().create(
        fileId=f["id"],
        body={"role": "reader", "type": "anyone"},
    ).execute()

    return f.get("webViewLink", f"https://drive.google.com/file/d/{f['id']}/view")


def upload_chapter(
    zip_data: bytes,
    stitched_data: Optional[bytes],
    manga_title: str,
    chapter: float,
    root_folder_id: str,
) -> dict:
    """
    Upload chapter zip + optional stitched image.
    Organises into: root_folder / manga_title / Chapter_XX /
    Returns {"zip_url": str, "stitched_url": str | None}
    """
    service = _get_service()
    safe_title = _safe_filename(manga_title)
    ch_str = f"{chapter:g}"

    # Create folder hierarchy
    manga_folder = get_or_create_folder(service, safe_title, root_folder_id)
    ch_folder = get_or_create_folder(service, f"Chapter_{ch_str}", manga_folder)

    result = {}

    if zip_data:
        zip_name = f"{safe_title}_Ch{ch_str}.zip"
        url = upload_bytes(zip_data, zip_name, "application/zip", ch_folder)
        result["zip_url"] = url
        print(f"[Drive] Uploaded ZIP: {zip_name}")

    if stitched_data:
        img_name = f"{safe_title}_Ch{ch_str}_stitched.jpg"
        url = upload_bytes(stitched_data, img_name, "image/jpeg", ch_folder)
        result["stitched_url"] = url
        print(f"[Drive] Uploaded stitched image: {img_name}")

    return result
