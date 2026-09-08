export const STOREFRONT_IMAGE_BUCKET = "storefront-images";

export const DEFAULT_PROTECTED_PATHS = Object.freeze([
  "hero-snack-illustration-v1.webp",
  "footer-composite-v1.webp",
  "footer-snack-illustration-v1.webp",
]);

export function normalizeStoragePath(value) {
  const path = String(value ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (
    !path ||
    path.length > 1024 ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path)
  )
    return null;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".."))
    return null;
  return parts.join("/");
}

export function storagePathFromUrl(
  value,
  bucket = STOREFRONT_IMAGE_BUCKET,
) {
  if (typeof value !== "string" || !value.includes("/storage/v1/"))
    return null;
  let pathname;
  try {
    pathname = new URL(value).pathname;
  } catch {
    return null;
  }
  const encodedBucket = encodeURIComponent(bucket);
  const markers = [
    `/storage/v1/object/public/${encodedBucket}/`,
    `/storage/v1/object/sign/${encodedBucket}/`,
    `/storage/v1/object/authenticated/${encodedBucket}/`,
    `/storage/v1/render/image/public/${encodedBucket}/`,
    `/storage/v1/render/image/sign/${encodedBucket}/`,
    `/storage/v1/render/image/authenticated/${encodedBucket}/`,
  ];
  const marker = markers.find((candidate) => pathname.includes(candidate));
  if (!marker) return null;
  try {
    return normalizeStoragePath(
      decodeURIComponent(pathname.slice(pathname.indexOf(marker) + marker.length)),
    );
  } catch {
    return null;
  }
}

export function collectStorageReferences(
  value,
  references = new Set(),
  bucket = STOREFRONT_IMAGE_BUCKET,
) {
  const visit = (entry) => {
    if (typeof entry === "string") {
      const path = storagePathFromUrl(entry, bucket);
      if (path) references.add(path);
      return;
    }
    if (!entry || typeof entry !== "object") return;
    if (Array.isArray(entry)) entry.forEach(visit);
    else Object.values(entry).forEach(visit);
  };
  visit(value);
  return references;
}

export function isDefaultProtectedPath(
  value,
  extraPaths = [],
  defaultPaths = DEFAULT_PROTECTED_PATHS,
) {
  const path = normalizeStoragePath(value);
  if (!path) return true;
  if (path === ".keep" || path.startsWith("defaults/")) return true;
  const protectedPaths = new Set(
    [...defaultPaths, ...extraPaths]
      .map(normalizeStoragePath)
      .filter(Boolean),
  );
  return protectedPaths.has(path);
}

export function classifyStorageFile(
  file,
  references,
  {
    now = Date.now(),
    graceMs = 24 * 60 * 60 * 1000,
    extraProtectedPaths = [],
  } = {},
) {
  const path = normalizeStoragePath(file?.path);
  if (!path)
    return { eligible: false, protectedReason: "invalid_path", path: null };
  if (references.has(path))
    return { eligible: false, protectedReason: "database_reference", path };
  if (isDefaultProtectedPath(path, extraProtectedPaths))
    return { eligible: false, protectedReason: "default_asset", path };
  const timestamp = Date.parse(file?.updatedAt || file?.createdAt || "");
  if (!Number.isFinite(timestamp))
    return { eligible: false, protectedReason: "unknown_age", path };
  if (now - timestamp < graceMs)
    return { eligible: false, protectedReason: "recent_upload", path };
  return { eligible: true, protectedReason: null, path };
}

export async function deleteOrphanFilesSafely({
  selectedPaths,
  readReferences,
  listFiles,
  deleteFiles,
  classificationOptions = {},
}) {
  // Bracket the Storage listing with two complete reference scans. Taking the
  // union means a URL saved while this request is running becomes protected
  // before the destructive call is reached.
  const referencesBefore = await readReferences();
  const files = await listFiles();
  const referencesAfter = await readReferences();
  const references = new Set([...referencesBefore, ...referencesAfter]);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const deletable = [];
  const skipped = [];
  const now = classificationOptions.now ?? Date.now();
  for (const path of selectedPaths) {
    const file = byPath.get(path);
    if (!file) {
      skipped.push({ path, reason: "not_found" });
      continue;
    }
    const classification = classifyStorageFile(file, references, {
      ...classificationOptions,
      now,
    });
    if (!classification.eligible) {
      skipped.push({
        path,
        reason: classification.protectedReason ?? "protected",
      });
      continue;
    }
    deletable.push(path);
  }
  if (deletable.length) await deleteFiles(deletable);
  return { deleted: deletable, skipped };
}
