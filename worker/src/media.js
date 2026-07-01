const MEDIA_PREFIX = "uploads/";
const GENERATED_PREFIX = "generated/";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const SAFE_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const PDF_TYPE = "application/pdf";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function safeName(value = "file") {
  const cleaned = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 100) || "file";
}

function startsWith(bytes, signature) {
  return signature.every((value, index) => bytes[index] === value);
}

function detectedType(file, bytes) {
  if (file.type === "image/png" && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (file.type === "image/jpeg" && startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (file.type === "image/gif" && new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/)) return "image/gif";
  if (
    file.type === "image/webp"
    && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
    && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  if (file.type === PDF_TYPE && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") return PDF_TYPE;
  if (file.type === DOCX_TYPE && startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return DOCX_TYPE;
  return "";
}

function attachmentName(value = "download") {
  return safeName(value).replace(/"/g, "") || "download";
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
  if (file.size > MAX_FILE_BYTES) {
    const error = new Error("This file is too large to upload.");
    error.status = 413;
    throw error;
  }
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const contentType = detectedType(file, bytes);
  if (!contentType) {
    const error = new Error("Use a verified PNG, JPEG, GIF, WebP, PDF, or Word document. SVG and active files are not accepted.");
    error.status = 400;
    throw error;
  }

  const now = new Date();
  const key = `${MEDIA_PREFIX}${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const contentDisposition = SAFE_IMAGES.has(contentType)
    ? "inline"
    : `attachment; filename="${attachmentName(file.name)}"`;
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
      contentDisposition
    },
    customMetadata: { originalName: file.name, verifiedType: contentType }
  });
  return { key, url: `/media/${key}`, name: file.name, type: contentType, size: file.size };
}

export async function readMedia(env, key) {
  if (!env.MEDIA || (!key.startsWith(MEDIA_PREFIX) && !key.startsWith(GENERATED_PREFIX))) return null;
  return env.MEDIA.get(key);
}

export function safeMediaHeaders(object, key = "") {
  const originalType = object?.httpMetadata?.contentType || "application/octet-stream";
  const verifiedType = object?.customMetadata?.verifiedType || "";
  const safeImage = SAFE_IMAGES.has(originalType)
    && (verifiedType === originalType || (!verifiedType && key.startsWith(MEDIA_PREFIX)));
  const generatedSvg = originalType === "image/svg+xml"
    && key.startsWith(GENERATED_PREFIX);
  const downloadable = originalType === PDF_TYPE || originalType === DOCX_TYPE;
  const contentType = safeImage || generatedSvg || downloadable
    ? originalType
    : "application/octet-stream";
  const name = attachmentName(object?.customMetadata?.originalName || "download");
  return {
    "content-type": contentType,
    "cache-control": object?.httpMetadata?.cacheControl || "public, max-age=31536000, immutable",
    "content-disposition": safeImage || generatedSvg
      ? "inline"
      : object?.httpMetadata?.contentDisposition || `attachment; filename="${name}"`,
    "x-content-type-options": "nosniff"
  };
}
