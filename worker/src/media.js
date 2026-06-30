const MEDIA_PREFIX = "uploads/";
const GENERATED_PREFIX = "generated/";
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function safeName(value = "file") {
  const cleaned = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 100) || "file";
}

function allowedType(file) {
  return file.type.startsWith("image/")
    || file.type === "application/pdf"
    || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

export async function uploadMedia(request, env) {
  if (!env.MEDIA) {
    const error = new Error("Media storage is not connected yet.");
    error.status = 503;
    throw error;
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    const error = new Error("Choose a file to upload.");
    error.status = 400;
    throw error;
  }
  if (!allowedType(file)) {
    const error = new Error("Use an image, PDF, or Word document.");
    error.status = 400;
    throw error;
  }
  if (file.size > MAX_FILE_BYTES) {
    const error = new Error("This file is too large to upload.");
    error.status = 413;
    throw error;
  }

  const now = new Date();
  const key = `${MEDIA_PREFIX}${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}-${safeName(file.name)}`;
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
      cacheControl: "public, max-age=31536000, immutable"
    },
    customMetadata: { originalName: file.name }
  });
  return { key, url: `/media/${key}`, name: file.name, type: file.type, size: file.size };
}

export async function readMedia(env, key) {
  if (!env.MEDIA || (!key.startsWith(MEDIA_PREFIX) && !key.startsWith(GENERATED_PREFIX))) return null;
  return env.MEDIA.get(key);
}
