// Keep uploads compatible with AI analysis.
// Supported by AI gateway: JPEG, PNG, WebP, GIF.
// AVIF can often be converted in-browser; HEIC/HEIF is not reliably decodable,
// so it is blocked before upload with a clear message.

const AI_SUPPORTED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const BLOCKED_EXTENSIONS = new Set(["heic", "heif"]);
const CONVERTIBLE_EXTENSIONS = new Set(["avif"]);
const CONVERSION_TIMEOUT_MS = 12_000;

export function isAiSupportedMime(mime: string | undefined | null): boolean {
  return !!mime && AI_SUPPORTED.has(mime.toLowerCase());
}

export function isAiSupportedPath(path: string): boolean {
  const ext = path.toLowerCase().split("?")[0].split("#")[0].split(".").pop() ?? "";
  return ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
}

export function getFileExtension(name: string): string {
  return name.toLowerCase().split("?")[0].split("#")[0].split(".").pop() ?? "";
}

export function getUnsupportedImageMessage(fileName?: string): string {
  const suffix = fileName ? ` (${fileName})` : "";
  return `This image format is not supported for AI analysis${suffix}. Please upload JPEG, PNG, WebP, or GIF.`;
}

export function isBlockedImageFile(file: File): boolean {
  const type = file.type.toLowerCase();
  const ext = getFileExtension(file.name);
  return type === "image/heic" || type === "image/heif" || BLOCKED_EXTENSIONS.has(ext);
}

export function hasUnsupportedStoredPhotos(paths: string[]): boolean {
  return paths.some((path) => !isAiSupportedPath(path));
}

function replaceExt(name: string, ext: string): string {
  const base = name.replace(/\.[^/.]+$/, "");
  return `${base || "photo"}.${ext}`;
}

/**
 * Ensure a File is in a format the AI gateway accepts.
 * If already supported, returns as-is. Otherwise re-encodes to JPEG via canvas.
 * Throws a helpful error if the browser can't decode the source (common for HEIC).
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (isAiSupportedMime(file.type)) return file;
  if (isBlockedImageFile(file)) {
    throw new Error(getUnsupportedImageMessage(file.name));
  }

  const ext = getFileExtension(file.name);
  if (!CONVERTIBLE_EXTENSIONS.has(ext) && file.type.toLowerCase() !== "image/avif") {
    throw new Error(getUnsupportedImageMessage(file.name));
  }

  // Try to decode via <img>. Modern Chrome/Safari decode AVIF; HEIC usually fails.
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      const timeout = setTimeout(
        () => reject(new Error(getUnsupportedImageMessage(file.name))),
        CONVERSION_TIMEOUT_MS,
      );
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(getUnsupportedImageMessage(file.name)));
      el.onload = () => {
        clearTimeout(timeout);
        resolve(el);
      };
      el.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(getUnsupportedImageMessage(file.name)));
      };
      el.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available for image conversion.");
    ctx.drawImage(img, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob) throw new Error("Failed to convert image to JPEG.");

    return new File([blob], replaceExt(file.name, "jpg"), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
