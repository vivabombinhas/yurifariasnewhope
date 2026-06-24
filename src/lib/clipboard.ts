/**
 * Copy text using the Clipboard API.
 * Resolves true on success. Throws on failure so callers can show a fallback.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) throw new Error("Nothing to copy");
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  // Legacy fallback
  if (typeof document !== "undefined") {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.("copy");
    document.body.removeChild(ta);
    if (ok) return true;
  }
  throw new Error("Clipboard not available");
}

export async function readClipboardText(): Promise<string | null> {
  try {
    if (navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
  } catch {
    /* permission denied */
  }
  return null;
}

export function canShareFiles(files: File[]): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files })
    );
  } catch {
    return false;
  }
}
