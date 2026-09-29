import { getToken, authHeaders, handleAuthError } from "./auth.js";

const API_BASE =
  location.port === "5500" || location.port === "3000"
    ? `${location.protocol}//${location.hostname}:8000`
    : "";

export async function uploadImage(file, metadata) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", metadata.category);
  formData.append("description", metadata.description);
  formData.append("add_to_portfolio", metadata.addToPortfolio ? "true" : "false");

  const res = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });

  if (handleAuthError(res)) throw new Error("Session expired. Please log in again.");

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Upload failed (${res.status})`);
  }

  return res.json();
}

export async function createCategory(name) {
  const res = await fetch(`${API_BASE}/api/category`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name }),
  });

  if (handleAuthError(res)) throw new Error("Session expired. Please log in again.");

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to create category (${res.status})`);
  }

  return res.json();
}

export async function compressIfNeeded(file, limitMB = 30) {
  if (file.size / 1024 / 1024 <= limitMB) return file;
  try {
    const mod = await import(
      "https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.mjs"
    );
    return await mod.default(file, {
      maxSizeMB: limitMB,
      maxWidthOrHeight: 6000,
      useWebWorker: true,
    });
  } catch (err) {
    console.warn("Compression failed, uploading original.", err);
    return file;
  }
}
export async function setCategoryThumbnail(categoryId, imageUrl) {
  const res = await fetch(`${API_BASE}/api/category/thumbnail`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ category_id: categoryId, image_url: imageUrl }),
  });

  if (handleAuthError(res)) throw new Error("Session expired. Please log in again.");

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to update thumbnail (${res.status})`);
  }

  return res.json();
}
export async function deleteCategory(categoryId, force = false) {
  const res = await fetch(`${API_BASE}/api/category/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ category_id: categoryId, force }),
  });

  if (handleAuthError(res)) throw new Error("Session expired. Please log in again.");

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.detail || `Failed to delete category (${res.status})`);
    e.status = res.status;   // so the caller can detect the 409 case
    throw e;
  }

  return res.json();
}
export async function deleteImage(imageId) {
  const res = await fetch(`${API_BASE}/api/image/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ image_id: imageId }),
  });

  if (handleAuthError(res)) throw new Error("Session expired. Please log in again.");

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to delete image (${res.status})`);
  }

  return res.json();
}
export async function togglePortfolio(imageId, featured) {
  const res = await fetch(`${API_BASE}/api/portfolio/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ image_id: imageId, featured }),
  });

  if (handleAuthError(res)) throw new Error("Session expired. Please log in again.");

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to update portfolio (${res.status})`);
  }

  return res.json();
}