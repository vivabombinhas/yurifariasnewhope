// Convert images to AI-supported formats before upload.
// Supported by AI gateway: JPEG, PNG, WebP, GIF.
// Anything else (AVIF, HEIC, HEIF, BMP, TIFF, …) is converted to JPEG via canvas.

const AI_SUPPORTED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function isAiSupportedMime(mime: string | undefined | null): boolean {
  return !!mime && AI_SUPPORTED.has(mime.toLowerCase());
}

export function isAiSupportedPath(path: string): boolean {
  const ext = path.toLowerCase().split("?")[0].split("#")[0].split(".").pop() ?? "";
  return ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
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

  // Try to decode via <img>. Modern Chrome/Safari decode AVIF; HEIC usually fails.
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(
          new Error(
            `This image format (${file.type || "unknown"}) is not supported. Please re-upload as JPEG or PNG.`,
          ),
        );
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
