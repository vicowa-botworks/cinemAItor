export interface MediaType {
  mime: string | null;
  format: string | null;
}

const TYPES_BY_EXT: Record<string, MediaType> = {
  png: { mime: "image/png", format: "png" },
  jpg: { mime: "image/jpeg", format: "jpeg" },
  jpeg: { mime: "image/jpeg", format: "jpeg" },
  webp: { mime: "image/webp", format: "webp" },
  gif: { mime: "image/gif", format: "gif" },
  bmp: { mime: "image/bmp", format: "bmp" },
  tiff: { mime: "image/tiff", format: "tiff" },
  heic: { mime: "image/heic", format: "heic" },
  svg: { mime: "image/svg+xml", format: "svg" },

  mp4: { mime: "video/mp4", format: "mp4" },
  mov: { mime: "video/quicktime", format: "mov" },
  webm: { mime: "video/webm", format: "webm" },
  mkv: { mime: "video/x-matroska", format: "mkv" },
  avi: { mime: "video/x-msvideo", format: "avi" },
  m4v: { mime: "video/x-m4v", format: "m4v" },

  wav: { mime: "audio/wav", format: "wav" },
  mp3: { mime: "audio/mpeg", format: "mp3" },
  flac: { mime: "audio/flac", format: "flac" },
  ogg: { mime: "audio/ogg", format: "ogg" },
  m4a: { mime: "audio/mp4", format: "m4a" },
  aac: { mime: "audio/aac", format: "aac" },

  txt: { mime: "text/plain", format: "txt" },
  json: { mime: "application/json", format: "json" },
  srt: { mime: "application/x-subrip", format: "srt" },
  vtt: { mime: "text/vtt", format: "vtt" },
  fbx: { mime: "application/octet-stream", format: "fbx" },
  glb: { mime: "model/gltf-binary", format: "glb" },
  gltf: { mime: "model/gltf+json", format: "gltf" },
  obj: { mime: "model/obj", format: "obj" },
};

/** Infer MIME type and format name from a filename or extension. */
export function mediaTypeFor(filename: string): MediaType {
  const idx = filename.lastIndexOf(".");
  const ext = (
    idx > 0 && idx < filename.length - 1 ? filename.slice(idx + 1) : ""
  ).toLowerCase();
  return TYPES_BY_EXT[ext] ?? { mime: "application/octet-stream", format: ext || null };
}
