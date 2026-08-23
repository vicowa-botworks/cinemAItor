import type { Context } from "@oak/oak";
import { badRequest } from "@cinemaItor/errors.ts";

/**
 * Raw-body upload protocol shared by all file upload endpoints.
 *
 * The request body is the raw file bytes (no multipart, so nothing is
 * buffered in memory by the runtime). Metadata travels in headers:
 * X-File-Name (percent-encoded) and X-Upload-Notes (percent-encoded,
 * optional). The declared Content-Length is checked up front; the stream
 * consumption in ContentStore.putStream enforces the same cap while writing.
 */
export function readRawUpload(
  ctx: Context,
  maxBytes: number,
): {
  stream: ReadableStream<Uint8Array>;
  filename: string;
  notes: string | null;
  technicalMetadata: string | null;
} {
  const body = ctx.request.body;
  const bodyType = body.type();
  if (bodyType === "json" || bodyType === "form-data") {
    throw badRequest(
      "Request body must be the raw file bytes (send the file as the body, " +
        "with X-File-Name and optional X-Upload-Notes headers)",
    );
  }
  const stream = body.stream;
  if (!stream) {
    throw badRequest("file is required");
  }
  const lengthHeader = ctx.request.headers.get("content-length");
  const declaredSize = lengthHeader ? Number(lengthHeader) : 0;
  if (declaredSize > maxBytes) {
    throw badRequest(
      `Upload exceeds the maximum size of ${maxBytes} bytes`,
    );
  }
  return {
    stream,
    filename: sanitizeFilename(ctx.request.headers.get("x-file-name")),
    notes: readNotesHeader(ctx.request.headers.get("x-upload-notes")),
    technicalMetadata: readTechnicalMetadataHeader(
      ctx.request.headers.get("x-technical-metadata"),
    ),
  };
}

const MAX_FILENAME_LENGTH = 255;
const MAX_NOTES_LENGTH = 500;
const MAX_TECHNICAL_METADATA_LENGTH = 8192;

/**
 * Parse the optional X-Technical-Metadata header (percent-encoded JSON object)
 * into a normalized JSON string. Stored verbatim as the uploaded version's
 * technical_metadata_json — e.g. provenance for derived media such as images
 * rendered from 3D views.
 */
export function readTechnicalMetadataHeader(raw: string | null): string | null {
  if (!raw) return null;
  const decoded = percentDecode(raw).trim();
  if (!decoded) return null;
  if (decoded.length > MAX_TECHNICAL_METADATA_LENGTH) {
    throw badRequest(
      `X-Technical-Metadata must be at most ${MAX_TECHNICAL_METADATA_LENGTH} characters`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw badRequest("X-Technical-Metadata must be a percent-encoded JSON object");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw badRequest("X-Technical-Metadata must be a JSON object");
  }
  return JSON.stringify(parsed);
}

export function sanitizeFilename(raw: string | null): string {
  if (!raw) return "upload.bin";
  const name = percentDecode(raw)
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.trim() ?? "";
  if (!name || name === "." || name === "..") return "upload.bin";
  return name.length > MAX_FILENAME_LENGTH ? name.slice(-MAX_FILENAME_LENGTH) : name;
}

export function readNotesHeader(raw: string | null): string | null {
  if (!raw) return null;
  const notes = percentDecode(raw).trim();
  if (!notes) return null;
  if (notes.length > MAX_NOTES_LENGTH) {
    throw badRequest(
      `Notes must be at most ${MAX_NOTES_LENGTH} characters`,
    );
  }
  return notes;
}

export function percentDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
