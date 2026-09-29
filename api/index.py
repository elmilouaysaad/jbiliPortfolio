"""
FastAPI backend for the Jebli Portfolio.
Deployed as a Vercel serverless function via api/index.py.

Storage:
- On Vercel: data is persisted to Vercel Blob via REST API.
- Locally:   data is persisted to api/data/*.json.
On first read, if Blob is empty, the local seed files are copied to Blob.
"""

import os
import json
import base64
import secrets
import time
import asyncio
import hmac
import hashlib
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx

load_dotenv()

# ---------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

IMGBB_API_KEY = os.getenv("IMGBB_API_KEY")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
IMGBB_UPLOAD_URL = "https://api.imgbb.com/1/upload"
MAX_FILE_SIZE = 32 * 1024 * 1024  # 32 MB ImgBB limit

SESSION_TTL_SECONDS = 12 * 60 * 60
LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 15 * 60

# Vercel Blob via REST API — no SDK.
BLOB_API = "https://blob.vercel-storage.com"
BLOB_STATIC_TOKEN = os.getenv("BLOB_READ_WRITE_TOKEN")
BLOB_OIDC_TOKEN = os.getenv("VERCEL_OIDC_TOKEN")
BLOB_STORE_ID = os.getenv("BLOB_STORE_ID")
BLOB_ENABLED = bool(BLOB_STATIC_TOKEN or BLOB_OIDC_TOKEN)

CATEGORIES_BLOB = "categories.json"
PORTFOLIO_BLOB = "portfolio.json"

# Local fallback (dev + seed)
LOCAL_DATA_DIR = os.path.join(BASE_DIR, "data")
LOCAL_CATEGORIES_PATH = os.path.join(LOCAL_DATA_DIR, "categories.json")
LOCAL_PORTFOLIO_PATH = os.path.join(LOCAL_DATA_DIR, "portfolio.json")

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if o.strip()
]

if not IMGBB_API_KEY:
    raise RuntimeError("IMGBB_API_KEY is not set.")
if not ADMIN_PASSWORD or len(ADMIN_PASSWORD) < 12:
    raise RuntimeError("ADMIN_PASSWORD must be at least 12 characters.")

# ---------------------------------------------------------------
# App + CORS
# ---------------------------------------------------------------
app = FastAPI(title="Jebli Portfolio API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# ---------------------------------------------------------------
# Vercel Blob REST helpers
# ---------------------------------------------------------------
_blob_url_cache: dict[str, str] = {}
_blob_api_token_cache: Optional[str] = None


async def _blob_api_token() -> Optional[str]:
    """Return a token to use against the Blob REST API.

    Uses the static token if present; otherwise the OIDC token, which
    Vercel's Blob API accepts directly as a Bearer credential.
    """
    global _blob_api_token_cache
    if _blob_api_token_cache:
        return _blob_api_token_cache

    if BLOB_STATIC_TOKEN:
        _blob_api_token_cache = BLOB_STATIC_TOKEN
        return _blob_api_token_cache

    if BLOB_OIDC_TOKEN:
        _blob_api_token_cache = BLOB_OIDC_TOKEN
        return _blob_api_token_cache

    return None


async def _read_blob(pathname: str) -> Optional[bytes]:
    if not BLOB_ENABLED:
        return None

    token = await _blob_api_token()
    if not token:
        return None

    try:
        url = _blob_url_cache.get(pathname)
        if not url:
            headers = {
                "Authorization": f"Bearer {token}",
                "x-api-version": "7",
            }
            if BLOB_STORE_ID:
                headers["x-vercel-blob-store-id"] = BLOB_STORE_ID

            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    BLOB_API,
                    params={"prefix": pathname, "limit": 100},
                    headers=headers,
                )

            if r.status_code != 200:
                print(f"[blob] list failed {r.status_code}: {r.text[:300]}")
                return None

            try:
                payload = r.json()
            except Exception:
                print(f"[blob] list non-JSON: {r.text[:300]}")
                return None

            blobs = payload.get("blobs", [])
            for b in blobs:
                if b.get("pathname") == pathname and b.get("url"):
                    url = b["url"]
                    _blob_url_cache[pathname] = url
                    break

        if not url:
            return None

        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url)
            if r.status_code == 200:
                return r.content
            print(f"[blob] download failed {r.status_code}")
    except Exception as e:
        print(f"[blob] read error for {pathname}: {e}")
    return None


async def _write_blob(pathname: str, data: bytes) -> bool:
    if not BLOB_ENABLED:
        return False

    token = await _blob_api_token()
    if not token:
        return False

    try:
        headers = {
            "Authorization": f"Bearer {token}",
            "x-api-version": "7",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.put(
                f"{BLOB_API}/{pathname}",
                content=data,
                headers=headers,
            )

        if r.status_code not in (200, 201):
            # Print the exact rejection so we can see it in Vercel logs
            print(f"[blob] put failed {r.status_code}: {r.text[:500]}")
            return False

        _blob_url_cache.pop(pathname, None)
        return True
    except Exception as e:
        print(f"[blob] write error for {pathname}: {e}")
        return False


# ---------------------------------------------------------------
# JSON I/O
# ---------------------------------------------------------------
async def _load_json(blob_pathname: str, local_path: str, default: dict) -> dict:
    content = await _read_blob(blob_pathname)
    if content is not None:
        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            print(f"[json] bad blob {blob_pathname}: {e}")

    if os.path.exists(local_path):
        try:
            with open(local_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            await _write_blob(
                blob_pathname,
                json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8"),
            )
            return data
        except (OSError, json.JSONDecodeError) as e:
            print(f"[json] local read error for {local_path}: {e}")

    return default


async def _save_json(blob_pathname: str, local_path: str, data: dict) -> None:
    payload = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")

    if BLOB_ENABLED:
        if await _write_blob(blob_pathname, payload):
            return
        print(f"[json] blob write failed for {blob_pathname}, falling back to local")

    try:
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        with open(local_path, "wb") as f:
            f.write(payload)
    except OSError as e:
        print(f"[json] local write error for {local_path}: {e}")
        raise HTTPException(status_code=500, detail="Failed to persist data.")


async def _load_categories() -> dict:
    return await _load_json(
        CATEGORIES_BLOB, LOCAL_CATEGORIES_PATH, {"categories": [], "images": []}
    )


async def _load_portfolio() -> dict:
    return await _load_json(
        PORTFOLIO_BLOB, LOCAL_PORTFOLIO_PATH, {"favorites": []}
    )


async def _save_categories(data: dict) -> None:
    await _save_json(CATEGORIES_BLOB, LOCAL_CATEGORIES_PATH, data)


async def _save_portfolio(data: dict) -> None:
    await _save_json(PORTFOLIO_BLOB, LOCAL_PORTFOLIO_PATH, data)


def _next_order(favorites: list) -> int:
    return max((f.get("order", 0) for f in favorites), default=0) + 1


# ---------------------------------------------------------------
# Auth — stateless HMAC-signed tokens
# ---------------------------------------------------------------
_login_attempts: dict[str, list[float]] = {}


def _prune_attempts(ip: str):
    cutoff = time.time() - LOGIN_WINDOW_SECONDS
    _login_attempts[ip] = [t for t in _login_attempts.get(ip, []) if t > cutoff]


def _is_rate_limited(ip: str) -> bool:
    _prune_attempts(ip)
    return len(_login_attempts.get(ip, [])) >= LOGIN_MAX_ATTEMPTS


def _record_failed_attempt(ip: str):
    _prune_attempts(ip)
    _login_attempts.setdefault(ip, []).append(time.time())


def _sign(payload: str) -> str:
    return hmac.new(
        ADMIN_PASSWORD.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _make_token() -> str:
    expiry = int(time.time()) + SESSION_TTL_SECONDS
    payload = str(expiry)
    return f"{payload}.{_sign(payload)}"


def _verify_token(token: str) -> bool:
    if not token or "." not in token:
        return False
    payload, _, signature = token.partition(".")
    if not hmac.compare_digest(signature, _sign(payload)):
        return False
    try:
        expiry = int(payload)
    except ValueError:
        return False
    return expiry > time.time()


async def require_auth(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed token.")
    token = authorization.removeprefix("Bearer ").strip()
    if not _verify_token(token):
        raise HTTPException(status_code=401, detail="Session expired or invalid.")
    return token


# ---------------------------------------------------------------
# Models
# ---------------------------------------------------------------
class LoginRequest(BaseModel):
    password: str


class CategoryCreate(BaseModel):
    name: str


class ThumbnailUpdate(BaseModel):
    category_id: str
    image_url: str


class CategoryDelete(BaseModel):
    category_id: str
    force: bool = False


class ImageDelete(BaseModel):
    image_id: str


class PortfolioToggle(BaseModel):
    image_id: str
    featured: bool


# ---------------------------------------------------------------
# Public routes
# ---------------------------------------------------------------
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "blob": BLOB_ENABLED,
        "has_static_token": bool(BLOB_STATIC_TOKEN),
        "has_oidc_token": bool(BLOB_OIDC_TOKEN),
        "has_store_id": bool(BLOB_STORE_ID),
    }


@app.get("/api/data/categories")
async def get_categories():
    return await _load_categories()


@app.get("/api/data/portfolio")
async def get_portfolio():
    return await _load_portfolio()


# ---------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------
@app.post("/api/login")
async def login(
    req: LoginRequest,
    request_ip: str = Header(None, alias="X-Forwarded-For"),
):
    ip = request_ip or "local"
    if _is_rate_limited(ip):
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Try again in a few minutes.",
        )
    if not secrets.compare_digest(req.password, ADMIN_PASSWORD):
        _record_failed_attempt(ip)
        raise HTTPException(status_code=401, detail="Invalid password.")
    token = _make_token()
    _login_attempts.pop(ip, None)
    return {"token": token, "expires_in": SESSION_TTL_SECONDS}


@app.post("/api/logout")
async def logout(_token: str = Depends(require_auth)):
    return {"status": "ok"}


# ---------------------------------------------------------------
# Upload
# ---------------------------------------------------------------
@app.post("/api/upload")
async def upload_image(
    file: UploadFile = File(...),
    category: str = Form(...),
    description: str = Form(...),
    add_to_portfolio: bool = Form(False),
    _token: str = Depends(require_auth),
):
    contents = await file.read()

    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Image is {len(contents) / 1024 / 1024:.1f} MB — "
                "exceeds ImgBB's 32 MB limit."
            ),
        )

    b64_image = base64.b64encode(contents).decode("utf-8")

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            IMGBB_UPLOAD_URL,
            params={"key": IMGBB_API_KEY},
            data={"image": b64_image},
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=502, detail=f"ImgBB upload failed: {response.text[:200]}"
        )

    payload = response.json()
    if not payload.get("success"):
        err = payload.get("error", {}).get("message", "Unknown ImgBB error")
        raise HTTPException(status_code=502, detail=f"ImgBB error: {err}")

    data = payload["data"]
    imgbb_id = data["id"]
    image_url = data["url"]
    thumb_url = data.get("thumb", {}).get("url", image_url)
    medium_url = data.get("medium", {}).get("url", image_url)

    categories_data = await _load_categories()
    images = categories_data.get("images", [])
    images.append(
        {
            "id": f"img_{imgbb_id}",
            "filename": image_url,
            "url": image_url,
            "thumb": thumb_url,
            "medium": medium_url,
            "category": category,
            "description": description,
        }
    )
    categories_data["images"] = images
    await _save_categories(categories_data)

    if add_to_portfolio:
        portfolio = await _load_portfolio()
        favorites = portfolio.get("favorites", [])
        favorites.append(
            {
                "id": f"img_{imgbb_id}",
                "filename": image_url,
                "url": image_url,
                "thumb": thumb_url,
                "medium": medium_url,
                "category": category,
                "order": _next_order(favorites),
                "description": description,
            }
        )
        portfolio["favorites"] = favorites
        await _save_portfolio(portfolio)

    return {"status": "ok", "id": imgbb_id, "url": image_url, "thumb_url": thumb_url}


# ---------------------------------------------------------------
# Categories
# ---------------------------------------------------------------
@app.post("/api/category")
async def create_category(category: CategoryCreate, _token: str = Depends(require_auth)):
    data = await _load_categories()
    categories = data.get("categories", [])

    if any(c.get("name", "").lower() == category.name.lower() for c in categories):
        raise HTTPException(status_code=409, detail="Category already exists.")

    category_id = category.name.lower().replace(" ", "_")
    next_order = max((c.get("displayOrder", 0) for c in categories), default=0) + 1

    new_category = {
        "id": category_id,
        "name": category.name,
        "displayOrder": next_order,
        "thumbnail": "",
    }
    categories.append(new_category)
    data["categories"] = categories
    await _save_categories(data)

    return {"status": "ok", "category": new_category}


@app.post("/api/category/thumbnail")
async def update_category_thumbnail(
    req: ThumbnailUpdate,
    _token: str = Depends(require_auth),
):
    data = await _load_categories()
    categories = data.get("categories", [])

    for c in categories:
        if c.get("id") == req.category_id:
            c["thumbnail"] = req.image_url
            data["categories"] = categories
            await _save_categories(data)
            return {
                "status": "ok",
                "category_id": req.category_id,
                "thumbnail": req.image_url,
            }

    raise HTTPException(status_code=404, detail="Category not found.")


@app.post("/api/category/delete")
async def delete_category(req: CategoryDelete, _token: str = Depends(require_auth)):
    data = await _load_categories()
    categories = data.get("categories", [])
    images = data.get("images", [])

    target = next((c for c in categories if c.get("id") == req.category_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Category not found.")

    attached = [img for img in images if img.get("category") == req.category_id]

    if attached and not req.force:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{len(attached)} image(s) are still in this category. "
                "Pass force=true to uncategorize them and delete."
            ),
        )

    if req.force:
        for img in images:
            if img.get("category") == req.category_id:
                img["category"] = ""

    data["categories"] = [c for c in categories if c.get("id") != req.category_id]
    data["images"] = images
    await _save_categories(data)

    return {
        "status": "ok",
        "removed": req.category_id,
        "uncategorized": len(attached) if req.force else 0,
    }


# ---------------------------------------------------------------
# Images
# ---------------------------------------------------------------
@app.post("/api/image/delete")
async def delete_image(req: ImageDelete, _token: str = Depends(require_auth)):
    data = await _load_categories()
    images = data.get("images", [])

    target = next((i for i in images if i.get("id") == req.image_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Image not found.")

    data["images"] = [i for i in images if i.get("id") != req.image_id]
    await _save_categories(data)

    portfolio = await _load_portfolio()
    favorites = portfolio.get("favorites", [])
    kept = [f for f in favorites if f.get("id") != req.image_id]
    if len(kept) != len(favorites):
        portfolio["favorites"] = kept
        await _save_portfolio(portfolio)

    return {"status": "ok", "removed": req.image_id}


# ---------------------------------------------------------------
# Portfolio
# ---------------------------------------------------------------
@app.post("/api/portfolio/toggle")
async def toggle_portfolio(req: PortfolioToggle, _token: str = Depends(require_auth)):
    categories_data = await _load_categories()
    images = categories_data.get("images", [])

    target = next((i for i in images if i.get("id") == req.image_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Image not found.")

    portfolio = await _load_portfolio()
    favorites = portfolio.get("favorites", [])
    existing = next((f for f in favorites if f.get("id") == req.image_id), None)

    if req.featured and not existing:
        new_entry = {
            "id": target["id"],
            "filename": target.get("filename", target.get("url", "")),
            "url": target.get("url", ""),
            "thumb": target.get("thumb", ""),
            "medium": target.get("medium", ""),
            "category": target.get("category", ""),
            "order": _next_order(favorites),
            "description": target.get("description", ""),
        }
        favorites.append(new_entry)
        portfolio["favorites"] = favorites
        await _save_portfolio(portfolio)
        return {"status": "ok", "featured": True, "order": new_entry["order"]}

    if not req.featured and existing:
        portfolio["favorites"] = [f for f in favorites if f.get("id") != req.image_id]
        await _save_portfolio(portfolio)
        return {"status": "ok", "featured": False}

    return {"status": "ok", "featured": req.featured, "no_change": True}