// MVP acceptance flow (Milestone 6): the entire studio journey over real
// HTTP against a live server, in-memory database, and a real app_data
// layout. This is the end-to-end proof that the product works top to
// bottom:
//
//   auth (bootstrap / login / logout / session revocation / register)
// -> project CRUD
// -> admin model registration (mock backend)
// -> asset uploads (image / audio / video) + aliases + tags
// -> @reference parsing
// -> storyboard + scene + shot + panel with versioned prompts
// -> panel preview job (t2i) -> queue -> linked candidate + provenance
// -> batch scene generation (i2v) -> queue -> linked shot + clip
// -> review approval (candidate promotion to active)
// -> timeline (video / music / text tracks, items, markers,
//    snapshot, delete, snapshot restore)
// -> render (Audio WAV preset) -> queue -> export asset -> media fetch
// -> diagnostics (hardware / storage / logs / bundle export)
// -> project backup (JSON + media bundle) -> restore -> verify -> delete
// -> permission isolation for a non-admin user
import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertGreater, assertStringIncludes } from "@std/assert";
import { freshMemoryDb, withServer } from "./helpers/http.ts";
import { resetContentStore } from "../src/storage/content_store.ts";
import { ensureDefaultPresets } from "../src/db/renders.ts";

const APP_DATA = `/tmp/opencode/mvp-acceptance-${Date.now()}`;
const ADMIN_EMAIL = "admin@acceptance.test";
const ADMIN_PASSWORD = "acceptance-admin-password";
const VIEWER_EMAIL = "viewer@acceptance.test";
const VIEWER_PASSWORD = "acceptance-viewer-password";

// ---------------------------------------------------------------------------
// Shared journey state (phases run sequentially inside one server session).

interface State {
  adminToken: string;
  viewerToken: string;
  projectId: string;
  modelId: string;
  heroAssetId: string;
  heroVersionId: string;
  musicAssetId: string;
  musicVersionId: string;
  videoAssetId: string;
  videoVersionId: string;
  boardId: string;
  sceneId: string;
  shotId: string;
  panelId: string;
  previewJobId: string;
  previewAssetId: string;
  clipJobId: string;
  clipAssetId: string;
  clipVersionId: string;
  timelineId: string;
  videoTrackId: string;
  musicTrackId: string;
  textTrackId: string;
  videoItemId: string;
  musicItemId: string;
  textItemId: string;
  snapshotId: string;
  renderJobId: string;
  exportAssetId: string;
  backupId: string;
  restoredProjectId: string;
}
const s: State = {} as State;
let base = "";

// ---------------------------------------------------------------------------
// HTTP helpers.

type Body = Record<string, unknown>;
interface Resp {
  status: number;
  body: Body | null;
}

function json(text: string): Body | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Body;
  } catch {
    return null;
  }
}

async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  attempts = 50,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      await sleep(50);
    }
  }
  throw new Error(`Could not reach ${url}: ${lastErr}`);
}

async function raw(
  method: string,
  path: string,
  opts: {
    token?: string;
    jsonBody?: unknown;
    form?: FormData;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const init: RequestInit = { method, headers };
  if (opts.jsonBody !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.jsonBody);
  } else if (opts.form) {
    init.body = opts.form;
  }
  return await fetchWithRetry(`${base}${path}`, init);
}

async function api(
  method: string,
  path: string,
  opts: {
    token?: string;
    jsonBody?: unknown;
    form?: FormData;
  } = {},
): Promise<Resp> {
  const res = await raw(method, path, opts);
  const text = await res.text();
  return { status: res.status, body: json(text) };
}

async function media(
  path: string,
  token: string,
): Promise<{ status: number; type: string; size: number }> {
  const res = await fetchWithRetry(path ? `${base}${path}` : base, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const bytes = await res.arrayBuffer();
  return {
    status: res.status,
    type: res.headers.get("content-type") ?? "",
    size: bytes.byteLength,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TERMINAL = ["succeeded", "failed", "cancelled"];

async function waitFor<T>(
  label: string,
  budgetMs: number,
  probe: () => Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(100);
  }
}

async function terminalJob(jobId: string): Promise<Body | null> {
  const r = await api("GET", `/api/v1/jobs/${jobId}`, { token: s.adminToken });
  if (r.status !== 200 || !r.body) return null;
  return TERMINAL.includes(r.body.status as string) ? r.body : null;
}

function requireField(body: Body | null, field: string): string {
  const value = body?.[field];
  if (typeof value !== "string" || !value) {
    throw new Error(`Expected non-empty string field '${field}' in ${JSON.stringify(body)}`);
  }
  return value;
}

function asArr(value: unknown): Body[] {
  return Array.isArray(value) ? (value as Body[]) : [];
}

async function rmrf(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch {
    // Already gone.
  }
}

// ---------------------------------------------------------------------------
// Media fixtures (generated in-process).

const PNG_1X1 = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52,
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01,
  0x08,
  0x06,
  0x00,
  0x00,
  0x00,
  0x1f,
  0x15,
  0xc4,
  0x89,
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x44,
  0x41,
  0x54,
  0x78,
  0x9c,
  0x63,
  0x00,
  0x01,
  0x00,
  0x00,
  0x05,
  0x00,
  0x01,
  0x0d,
  0x0a,
  0x2d,
  0xb4,
  0x00,
  0x00,
  0x00,
  0x00,
  0x49,
  0x45,
  0x4e,
  0x44,
  0xae,
  0x42,
  0x60,
  0x82,
]);

/** Minimal valid PCM wav (mono 16-bit sine wave). */
function makeWav(seconds: number, sampleRate = 8000, freq = 220): Uint8Array {
  const n = Math.round(seconds * sampleRate);
  const data = new Uint8Array(44 + n * 2);
  const dv = new DataView(data.buffer);
  const wstr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) data[offset + i] = str.charCodeAt(i);
  };
  wstr(0, "RIFF");
  dv.setUint32(4, 36 + n * 2, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  wstr(36, "data");
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    dv.setInt16(
      44 + i * 2,
      Math.round(8000 * Math.sin((2 * Math.PI * freq * i) / sampleRate)),
      true,
    );
  }
  return data;
}

/** A small invalid-bytes mp4 stand-in (probe fails gracefully). */
function makeFakeMp4(): Uint8Array {
  const data = new Uint8Array(96);
  new DataView(data.buffer).setUint32(0, 0x66747970, false); // "ftyp"
  data.set(new TextEncoder().encode("mp42"), 4);
  return data;
}

// ---------------------------------------------------------------------------
// Phases.

async function p01_healthAndAuth() {
  const health = await api("GET", "/api/v1/health");
  assertEquals(health.status, 200);
  assertEquals(health.body!.status, "ok");
  assertEquals(health.body!.name, "cinemaItor");

  const noAuth = await api("GET", "/api/v1/projects");
  assertEquals(noAuth.status, 401);

  // Bootstrap only exists before any user exists: confirm a login for the
  // future admin fails (nobody registered yet), then bootstrap.
  const taken = await api("POST", "/api/v1/auth/login", {
    jsonBody: { email: ADMIN_EMAIL, password: "not-registered-yet-123" },
  });
  assertEquals(taken.status, 401);

  const boot = await api("POST", "/api/v1/auth/bootstrap", {
    jsonBody: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      display_name: "Admin",
    },
  });
  assertEquals(boot.status, 201);
  s.adminToken = requireField(boot.body, "token");
  assertEquals((boot.body!.user as Body).role, "admin");

  const bootAgain = await api("POST", "/api/v1/auth/bootstrap", {
    jsonBody: {
      email: "second@acceptance.test",
      password: "second-password-123",
      display_name: "Second",
    },
  });
  assertEquals(bootAgain.status, 409);

  const me = await api("GET", "/api/v1/auth/me", { token: s.adminToken });
  assertEquals(me.status, 200);
  assertEquals(me.body!.email, ADMIN_EMAIL);
  assertEquals(me.body!.role, "admin");

  // Login, wrong-password rejection, logout revokes the session.
  const login = await api("POST", "/api/v1/auth/login", {
    jsonBody: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  assertEquals(login.status, 200);
  const secondToken = requireField(login.body, "token");

  const badLogin = await api("POST", "/api/v1/auth/login", {
    jsonBody: { email: ADMIN_EMAIL, password: "wrong-password-123" },
  });
  assertEquals(badLogin.status, 401);

  const logout = await api("POST", "/api/v1/auth/logout", { token: secondToken });
  assertEquals(logout.status, 204);
  const dead = await api("GET", "/api/v1/auth/me", { token: secondToken });
  assertEquals(dead.status, 401);
}

async function p02ViewerUser() {
  const reg = await api("POST", "/api/auth/register", {
    jsonBody: {
      email: VIEWER_EMAIL,
      password: VIEWER_PASSWORD,
      display_name: "Viewer",
    },
  });
  assertEquals(reg.status, 201);
  s.viewerToken = requireField(reg.body, "token");
  assertEquals((reg.body!.user as Body).role, "user");

  const dupe = await api("POST", "/api/auth/register", {
    jsonBody: {
      email: VIEWER_EMAIL,
      password: VIEWER_PASSWORD,
      display_name: "Viewer 2",
    },
  });
  assertEquals(dupe.status, 409);
}

async function p03Project() {
  const created = await api("POST", "/api/v1/projects", {
    token: s.adminToken,
    jsonBody: { name: "Acceptance Film" },
  });
  assertEquals(created.status, 201);
  s.projectId = requireField(created.body, "id");

  const updated = await api("PATCH", `/api/v1/projects/${s.projectId}`, {
    token: s.adminToken,
    jsonBody: { description: "E2E acceptance journey" },
  });
  assertEquals(updated.status, 200);
  assertEquals(updated.body!.description, "E2E acceptance journey");

  const viewerDenied = await api("GET", `/api/v1/projects/${s.projectId}`, {
    token: s.viewerToken,
  });
  assertEquals(viewerDenied.status, 404);

  const viewerList = await api("GET", "/api/v1/projects", { token: s.viewerToken });
  assertEquals(viewerList.status, 200);
  assert(!Array.isArray(viewerList.body) || (viewerList.body as Body[]).length === 0);
}

async function p04Model() {
  const payload = {
    name: "E2E Mock",
    version: "0",
    backend: "mock",
    task_types: ["text_to_image", "image_to_video", "text_to_video"],
    enabled: true,
  };
  const reg = await api("POST", "/api/v1/models", {
    token: s.adminToken,
    jsonBody: payload,
  });
  assertEquals(reg.status, 201);
  s.modelId = requireField(reg.body, "id");

  const viewerDenied = await api("POST", "/api/v1/models", {
    token: s.viewerToken,
    jsonBody: payload,
  });
  assertEquals(viewerDenied.status, 403);

  const list = await api("GET", "/api/v1/models", { token: s.adminToken });
  assertEquals(list.status, 200);
  const models = Array.isArray(list.body) ? list.body as Body[] : [
    ...((list.body?.models as Body[]) ?? []),
  ];
  assert(models.some((m) => m.id === s.modelId), "registered model should be listed");
}

async function uploadMediaAsset(
  slug: string,
  displayName: string,
  assetType: string,
  bytes: Uint8Array,
  filename: string,
  mime: string,
): Promise<{ assetId: string; versionId: string }> {
  const asset = await api("POST", "/api/v1/assets", {
    token: s.adminToken,
    jsonBody: {
      unique_slug: slug,
      display_name: displayName,
      asset_type: assetType,
      library_scope: "project",
      project_id: s.projectId,
    },
  });
  assertEquals(asset.status, 201);
  const assetId = requireField(asset.body, "id");

  const form = new FormData();
  form.append("file", new File([bytes as unknown as BlobPart], filename, { type: mime }));
  const upload = await api(`POST`, `/api/v1/assets/${assetId}/upload`, {
    token: s.adminToken,
    form,
  });
  assertEquals(upload.status, 201);
  const version = upload.body!.version as Body;
  const versionId = requireField(version, "id");
  return { assetId, versionId };
}

async function p05Assets() {
  // Image
  const hero = await uploadMediaAsset(
    "hero",
    "Hero Portrait",
    "image",
    PNG_1X1,
    "hero.png",
    "image/png",
  );
  s.heroAssetId = hero.assetId;
  s.heroVersionId = hero.versionId;

  const alias = await api("POST", `/api/v1/assets/${s.heroAssetId}/aliases`, {
    token: s.adminToken,
    jsonBody: { alias_slug: "lead" },
  });
  assertEquals(alias.status, 201);
  assert(
    (alias.body!.aliases as string[]).includes("lead"),
    "aliases should contain the new slug",
  );

  const tag = await api("POST", `/api/v1/assets/${s.heroAssetId}/tags`, {
    token: s.adminToken,
    jsonBody: { tag: "e2e" },
  });
  assertEquals(tag.status, 201);
  assert((tag.body!.tags as string[]).includes("e2e"));

  const preview = await media(
    `/api/v1/assets/${s.heroAssetId}/preview`,
    s.adminToken,
  );
  assertEquals(preview.status, 200);
  assertStringIncludes(preview.type, "image/png");
  assertEquals(preview.size, PNG_1X1.length);

  // Audio (via the dedicated audio upload: ffprobe analysis when available)
  const wav = makeWav(2);
  const audioForm = new FormData();
  audioForm.append(
    "file",
    new File([wav as unknown as BlobPart], "music.wav", { type: "audio/wav" }),
  );
  audioForm.append("display_name", "Score");
  audioForm.append("project_id", s.projectId);
  const audio = await api("POST", "/api/v1/audio/upload", {
    token: s.adminToken,
    form: audioForm,
  });
  assertEquals(audio.status, 201);
  s.musicAssetId = requireField(audio.body!.asset as Body, "id");
  s.musicVersionId = requireField(audio.body!.version as Body, "id");
  const audioMeta = (audio.body!.audio ?? null) as Body | null;
  if (audioMeta !== null) {
    const duration = audioMeta.duration as number;
    assertGreater(duration, 1.8);
    assert(duration < 2.2);
  }

  const waveform = await api(
    "GET",
    `/api/v1/audio/assets/${s.musicAssetId}/versions/${s.musicVersionId}/waveform`,
    { token: s.adminToken },
  );
  if (waveform.status === 200) {
    const wf = waveform.body!.waveform as Body;
    assertEquals(wf.bucket_count, 200);
    assertEquals((wf.peaks as unknown[]).length, 200);
  } else {
    assertEquals(waveform.status, 503);
  }

  // Video
  const video = await uploadMediaAsset(
    "plate",
    "Plate",
    "video",
    makeFakeMp4(),
    "plate.mp4",
    "video/mp4",
  );
  s.videoAssetId = video.assetId;
  s.videoVersionId = video.versionId;

  // Project-scoped media is hidden from other users.
  const viewerAsset = await api("GET", `/api/v1/assets/${s.heroAssetId}`, {
    token: s.viewerToken,
  });
  assertEquals(viewerAsset.status, 404);
}

async function p06References() {
  const parsed = await api("POST", "/api/v1/references/parse", {
    token: s.adminToken,
    jsonBody: { text: "A close shot of @hero for the title card @ghost" },
  });
  assertEquals(parsed.status, 200);
  const tokens = parsed.body!.tokens as Body[];
  assertEquals(tokens.length, 2);

  const heroTok = tokens.find((t) => t.slug === "hero")!;
  assertEquals(heroTok.status, "resolved");
  assertEquals((heroTok.asset as Body).id, s.heroAssetId);

  const ghostTok = tokens.find((t) => t.slug === "ghost")!;
  assertEquals(ghostTok.status, "missing");
  assertEquals(ghostTok.asset, null);

  const audit = await api("GET", "/api/v1/references/audit", {
    token: s.adminToken,
  });
  assertEquals(audit.status, 200);
}

async function p07CreativeAndPreviewJob() {
  const board = await api("POST", "/api/v1/storyboards", {
    token: s.adminToken,
    jsonBody: { project_id: s.projectId, name: "Main Board" },
  });
  assertEquals(board.status, 201);
  s.boardId = requireField(board.body, "id");

  const scene = await api("POST", "/api/v1/scenes", {
    token: s.adminToken,
    jsonBody: {
      project_id: s.projectId,
      name: "Scene 1",
      storyboard_id: s.boardId,
      prompt: "The hero walks into the city. Use @hero.",
    },
  });
  assertEquals(scene.status, 201);
  s.sceneId = requireField(scene.body, "id");

  const shot = await api("POST", `/api/v1/scenes/${s.sceneId}/shots`, {
    token: s.adminToken,
    jsonBody: { shot_order: 1, name: "Wide", prompt: "Wide establishing shot." },
  });
  assertEquals(shot.status, 201);
  s.shotId = requireField(shot.body, "id");

  const panel = await api("POST", `/api/v1/storyboards/${s.boardId}/panels`, {
    token: s.adminToken,
    jsonBody: {
      panel_order: 1,
      name: "P1",
      prompt: "The hero enters frame. @hero",
    },
  });
  assertEquals(panel.status, 201);
  s.panelId = requireField(panel.body, "id");

  // Panel links are only persisted via PATCH (the create route ignores
  // linked_scene_id/linked_shot_id). The link is what makes batch i2v use
  // the panel preview as its source image.
  const linked = await api(
    "PATCH",
    `/api/v1/storyboards/${s.boardId}/panels/${s.panelId}`,
    {
      token: s.adminToken,
      jsonBody: { linked_scene_id: s.sceneId, linked_shot_id: s.shotId },
    },
  );
  assertEquals(linked.status, 200);
  const linkedRow = linked.body! as Body;
  assertEquals(linkedRow.linked_scene_id, s.sceneId);

  // Creative prompts round-trip (versioned content stored on save).
  const boardView = await api("GET", `/api/v1/storyboards/${s.boardId}`, {
    token: s.adminToken,
  });
  assertEquals(boardView.status, 200);
  const panelRow = (boardView.body!.panels as Body[]).find(
    (p) => p.id === s.panelId,
  )!;
  const prompt = panelRow.prompt as Body;
  assertEquals(prompt.content, "The hero enters frame. @hero");
  assertGreater(prompt.version_number as number, 0);

  // t2i preview job.
  const gen = await api(
    "POST",
    `/api/v1/storyboards/${s.boardId}/panels/${s.panelId}/generate-preview`,
    { token: s.adminToken, jsonBody: { model_id: s.modelId } },
  );
  assertEquals(gen.status, 202);
  s.previewJobId = requireField(gen.body, "job_id");
  s.previewAssetId = requireField(gen.body, "asset_id");

  const job = await waitFor("preview job terminal", 30_000, () => terminalJob(s.previewJobId));
  assertEquals(job!.status, "succeeded");
  assertEquals(job!.progress, 100);
  assert(job!.output_asset_version_id, "preview job should link an output version");

  // Panel is linked to the produced version.
  const boardAfter = await api("GET", `/api/v1/storyboards/${s.boardId}`, {
    token: s.adminToken,
  });
  const panelAfter = (boardAfter.body!.panels as Body[]).find(
    (p) => p.id === s.panelId,
  )!;
  assert(panelAfter.preview_asset_version_id, "panel should link the preview version");

  // Review candidates carry provenance.
  const cand = await api("GET", `/api/v1/review/jobs/${s.previewJobId}/candidates`, {
    token: s.adminToken,
  });
  assertEquals(cand.status, 200);
  assertEquals((cand.body!.candidates as Body[]).length, 1);
  const first = (cand.body!.candidates as Body[])[0];
  assertEquals(first.candidate_index, 0);
  const version = await api(
    "GET",
    `/api/v1/assets/${s.previewAssetId}/versions/${job!.output_asset_version_id as string}`,
    { token: s.adminToken },
  );
  assertEquals(version.status, 200);
}

async function p08BatchGenerate() {
  const batch = await api("POST", `/api/v1/scenes/${s.sceneId}/batch-generate`, {
    token: s.adminToken,
    jsonBody: { model_id: s.modelId },
  });
  assertEquals(batch.status, 202);
  assertEquals(batch.body!.job_type, "image_to_video");
  assertEquals((batch.body!.jobs as Body[]).length, 1);
  s.clipJobId = requireField((batch.body!.jobs as Body[])[0], "job_id");
  s.clipAssetId = requireField((batch.body!.jobs as Body[])[0], "asset_id");

  const job = await waitFor("clip job terminal", 30_000, () => terminalJob(s.clipJobId));
  assertEquals(job!.status, "succeeded");
  assert(job!.output_asset_version_id, "clip job should link an output version");

  const sceneView = await api("GET", `/api/v1/scenes/${s.sceneId}`, {
    token: s.adminToken,
  });
  assertEquals(sceneView.status, 200);
  const shotRow = (sceneView.body!.shots as Body[]).find((sh) =>
    sh.id ===
      s.shotId
  )!;
  assertEquals(shotRow.status, "generated");
  s.clipVersionId = shotRow.generated_asset_version_id as string;
  assert(s.clipVersionId, "shot should link the generated clip version");
}

async function p09Review() {
  const cand = await api("GET", `/api/v1/review/jobs/${s.clipJobId}/candidates`, {
    token: s.adminToken,
  });
  assertEquals(cand.status, 200);
  const candidates = cand.body!.candidates as Body[];
  assert(candidates.length >= 1, "clip job should have candidates");
  const candidate = candidates[0];
  const versionId = requireField(candidate.asset_version as Body, "id");

  const rejectProbe = await api(
    "POST",
    `/api/v1/review/candidates/${versionId}/reject`,
    { token: s.adminToken, jsonBody: { notes: "probe, will approve" } },
  );
  assertEquals(rejectProbe.status, 200);

  const approve = await api("POST", `/api/v1/review/candidates/${versionId}/approve`, {
    token: s.adminToken,
    jsonBody: { notes: "looks great" },
  });
  assertEquals(approve.status, 200);
  assertEquals(approve.body!.decision, "approved");

  const asset = await api("GET", `/api/v1/assets/${s.clipAssetId}`, {
    token: s.adminToken,
  });
  assertEquals(asset.status, 200);
  assertEquals(asset.body!.active_version_id, versionId);

  const after = await api("GET", `/api/v1/review/jobs/${s.clipJobId}/candidates`, {
    token: s.adminToken,
  });
  const afterCandidate = (after.body!.candidates as Body[]).find(
    (c) => (c.asset_version as Body).id === versionId,
  )!;
  assertEquals((afterCandidate.decision as Body).decision, "approved");
}

async function p10Timeline() {
  const tl = await api("POST", "/api/v1/timelines", {
    token: s.adminToken,
    jsonBody: { project_id: s.projectId, name: "Final Cut" },
  });
  assertEquals(tl.status, 201);
  s.timelineId = requireField(tl.body, "id");

  const vTrack = await api("POST", `/api/v1/timelines/${s.timelineId}/tracks`, {
    token: s.adminToken,
    jsonBody: { track_type: "video", name: "V1", track_order: 1 },
  });
  assertEquals(vTrack.status, 201);
  s.videoTrackId = requireField(vTrack.body, "id");

  const mTrack = await api("POST", `/api/v1/timelines/${s.timelineId}/tracks`, {
    token: s.adminToken,
    jsonBody: { track_type: "music", name: "M1", track_order: 2 },
  });
  assertEquals(mTrack.status, 201);
  s.musicTrackId = requireField(mTrack.body, "id");

  const tTrack = await api("POST", `/api/v1/timelines/${s.timelineId}/tracks`, {
    token: s.adminToken,
    jsonBody: { track_type: "text", name: "T1", track_order: 3 },
  });
  assertEquals(tTrack.status, 201);
  s.textTrackId = requireField(tTrack.body, "id");

  const vItem = await api("POST", `/api/v1/timelines/${s.timelineId}/items`, {
    token: s.adminToken,
    jsonBody: {
      track_id: s.videoTrackId,
      asset_version_id: s.videoVersionId,
      start_time: 0,
      end_time: 2,
    },
  });
  assertEquals(vItem.status, 201);
  s.videoItemId = requireField(vItem.body, "id");

  const mItem = await api("POST", `/api/v1/timelines/${s.timelineId}/items`, {
    token: s.adminToken,
    jsonBody: {
      track_id: s.musicTrackId,
      asset_version_id: s.musicVersionId,
      start_time: 0,
      end_time: 2,
    },
  });
  assertEquals(mItem.status, 201);
  s.musicItemId = requireField(mItem.body, "id");

  const tItem = await api("POST", `/api/v1/timelines/${s.timelineId}/items`, {
    token: s.adminToken,
    jsonBody: {
      track_id: s.textTrackId,
      asset_version_id: null,
      start_time: 0,
      end_time: 2,
      text: "Acceptance",
      text_style: { font_size: 48, font_color: "#ffffff" },
    },
  });
  assertEquals(tItem.status, 201);
  s.textItemId = requireField(tItem.body, "id");

  // Media-kind guard: an audio version on the video track is rejected.
  const badItem = await api("POST", `/api/v1/timelines/${s.timelineId}/items`, {
    token: s.adminToken,
    jsonBody: {
      track_id: s.videoTrackId,
      asset_version_id: s.musicVersionId,
      start_time: 0,
      end_time: 1,
    },
  });
  assertEquals(badItem.status, 400);

  const marker = await api("POST", `/api/v1/timelines/${s.timelineId}/markers`, {
    token: s.adminToken,
    jsonBody: { time: 1, label: "cue" },
  });
  assertEquals(marker.status, 201);

  const detail = await api("GET", `/api/v1/timelines/${s.timelineId}`, {
    token: s.adminToken,
  });
  assertEquals(detail.status, 200);
  assertEquals((detail.body!.timeline as Body).duration, 2);
  const tracks = detail.body!.tracks as Body[];
  assertEquals(tracks.length, 3);
  const itemCount = tracks.reduce(
    (n: number, tr) => n + ((tr.items as Body[]) ?? []).length,
    0,
  );
  assertEquals(itemCount, 3);
  assertEquals(asArr(detail.body!.markers).length, 1);

  // Snapshot -> destructive edit -> restore must bring the state back.
  const snap = await api("POST", `/api/v1/timelines/${s.timelineId}/snapshots`, {
    token: s.adminToken,
    jsonBody: { name: "before-delete" },
  });
  assertEquals(snap.status, 201);
  s.snapshotId = requireField(snap.body, "id");

  const del = await api(
    "DELETE",
    `/api/v1/timelines/${s.timelineId}/items/${s.textItemId}`,
    { token: s.adminToken },
  );
  assertEquals(del.status, 200);

  const afterDelete = await api("GET", `/api/v1/timelines/${s.timelineId}`, {
    token: s.adminToken,
  });
  const afterDeleteCount = (afterDelete.body!.tracks as Body[]).reduce(
    (n: number, tr) => n + ((tr.items as Body[]) ?? []).length,
    0,
  );
  assertEquals(afterDeleteCount, 2);

  const restore = await api(
    "POST",
    `/api/v1/timelines/${s.timelineId}/snapshots/${s.snapshotId}/restore`,
    { token: s.adminToken },
  );
  assertEquals(restore.status, 200);
  const restored = (restore.body!.tracks as Body[]).find(
    (tr) => tr.id === s.textTrackId,
  )!;
  const restoredText = (restored.items as Body[]).find(
    (i) => i.item_text === "Acceptance",
  );
  assert(restoredText, "snapshot restore should bring the text item back");
}

async function p11Render() {
  const presets = await api("GET", "/api/v1/render-presets", {
    token: s.adminToken,
  });
  assertEquals(presets.status, 200);
  const wavPreset = ((presets.body?.presets ?? presets.body) as Body[]).find(
    (p) => p.output_format === "wav",
  );
  assert(wavPreset, "Audio WAV preset should exist");

  const queued = await api("POST", "/api/v1/renders", {
    token: s.adminToken,
    jsonBody: {
      project_id: s.projectId,
      timeline_id: s.timelineId,
      preset_id: wavPreset.id,
    },
  });
  assertEquals(queued.status, 202);
  s.renderJobId = requireField(queued.body, "id");

  const done = await waitFor("render terminal", 60_000, async () => {
    const r = await api("GET", `/api/v1/renders/${s.renderJobId}`, {
      token: s.adminToken,
    });
    if (r.status !== 200 || !r.body) return null;
    return TERMINAL.includes(r.body.status as string) ? r.body : null;
  });
  assertEquals(done!.status, "succeeded");
  assertEquals(done!.progress, 100);
  assert(done!.validation_report, "render should carry a validation report");

  const log = await api("GET", `/api/v1/renders/${s.renderJobId}/log`, {
    token: s.adminToken,
  });
  assertEquals(log.status, 200);
  assert(Array.isArray(log.body) && (log.body as unknown[]).length >= 1);

  const exports = await api(
    "GET",
    `/api/v1/exports?render_job_id=${s.renderJobId}`,
    { token: s.adminToken },
  );
  assertEquals(exports.status, 200);
  assertEquals(asArr(exports.body).length, 1);
  s.exportAssetId = requireField(asArr(exports.body)[0], "asset_id");

  const file = await media(
    `/api/v1/assets/${s.exportAssetId}/preview`,
    s.adminToken,
  );
  assertEquals(file.status, 200);
  assertStringIncludes(file.type, "audio");
  assertGreater(file.size, 44);
}

async function p12Diagnostics() {
  const hw = await api("GET", "/api/v1/diagnostics/hardware", {
    token: s.adminToken,
  });
  assertEquals(hw.status, 200);
  const storage = await api("GET", "/api/v1/diagnostics/storage", {
    token: s.adminToken,
  });
  assertEquals(storage.status, 200);
  const logs = await api("GET", "/api/v1/diagnostics/logs?limit=50", {
    token: s.adminToken,
  });
  assertEquals(logs.status, 200);
  const exportRes = await api("POST", "/api/v1/diagnostics/export", {
    token: s.adminToken,
    jsonBody: {},
  });
  assertEquals(exportRes.status, 201);
}

async function p13BackupRestore() {
  const created = await api("POST", "/api/v1/diagnostics/backups", {
    token: s.adminToken,
    jsonBody: { project_id: s.projectId },
  });
  assertEquals(created.status, 201);
  s.backupId = requireField(created.body!.backup as Body, "id");
  // Project assets: hero image + music + video (p05) + render export (p11).
  assertEquals((created.body!.counts as Body).assets, 4);
  const manifest = created.body!.media as Body[];
  assertEquals(manifest.length, 4);
  for (const entry of manifest) {
    assertEquals(entry.present, true);
  }

  const jsonPath = `${APP_DATA}/backups/backup-${s.backupId}.json`;
  const st = await Deno.stat(jsonPath);
  assert(st.isFile);
  const bundleDir = `${APP_DATA}/backups/backup-${s.backupId}/media`;
  const bundleEntries = walkSync(bundleDir).filter((p) => Deno.statSync(p).isFile);
  assertEquals(bundleEntries.length, 4);

  const restore = await api(
    "POST",
    `/api/v1/diagnostics/backups/${s.backupId}/restore`,
    { token: s.adminToken, jsonBody: { project_name: "Restored Film" } },
  );
  assertEquals(restore.status, 201);
  s.restoredProjectId = requireField(restore.body, "project_id");
  assertEquals(restore.body!.project_name, "Restored Film");
  assertEquals((restore.body!.counts as Body).assets, 4);
  const mediaReport = restore.body!.media as Body;
  assertEquals(asArr(mediaReport.corrupted).length, 0);
  assertEquals(
    (mediaReport.restored as number) + (mediaReport.reused as number),
    4,
  );
  // The mock-generated candidate assets are global scope and intentionally
  // outside the project backup; any other issue is a restore bug.
  const issues = (restore.body!.issues as string[]) ?? [];
  const unexpected = issues.filter((i) =>
    !i.includes("generated") &&
    !i.includes("dangling") && !i.startsWith("media hash")
  );
  assertEquals(unexpected, []);

  // Verify the restored project's structure.
  const project = await api("GET", `/api/v1/projects/${s.restoredProjectId}`, {
    token: s.adminToken,
  });
  assertEquals(project.status, 200);

  const assets = await api(
    "GET",
    `/api/v1/assets?project_id=${s.restoredProjectId}`,
    { token: s.adminToken },
  );
  assertEquals(asArr(assets.body).length, 4);

  const boards = await api(
    "GET",
    `/api/v1/storyboards?project_id=${s.restoredProjectId}`,
    { token: s.adminToken },
  );
  assertEquals(asArr(boards.body).length, 1);

  const timelines = await api(
    "GET",
    `/api/v1/timelines?project_id=${s.restoredProjectId}`,
    { token: s.adminToken },
  );
  assertEquals(asArr(timelines.body).length, 1);
  const restoredTimeline = asArr(timelines.body)[0];
  const detail = await api(
    "GET",
    `/api/v1/timelines/${requireField(restoredTimeline, "id")}`,
    { token: s.adminToken },
  );
  const itemCount = (detail.body!.tracks as Body[]).reduce(
    (n: number, tr) => n + ((tr.items as Body[]) ?? []).length,
    0,
  );
  assertEquals(itemCount, 3);
  assertEquals(asArr(detail.body!.markers).length, 1);

  // Restored media must be served from the content store.
  const restoredAssetIds = asArr(assets.body).map((a) => a.id as string);
  const restoredAsset = restoredAssetIds[0];
  const restoredPreview = await media(
    `/api/v1/assets/${restoredAsset}/preview`,
    s.adminToken,
  );
  assertEquals(restoredPreview.status, 200);
  assertGreater(restoredPreview.size, 0);
}

function walkSync(dir: string): string[] {
  const out: string[] = [];
  for (const entry of Deno.readDirSync(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) out.push(...walkSync(path));
    else if (entry.isFile) out.push(path);
  }
  return out;
}

async function p14BackupDelete() {
  const del = await api("DELETE", `/api/v1/diagnostics/backups/${s.backupId}`, {
    token: s.adminToken,
  });
  assertEquals(del.status, 200);

  const list = await api("GET", "/api/v1/diagnostics/backups", {
    token: s.adminToken,
  });
  assertEquals(list.status, 200);
  assert(
    !((list.body!.backups as Body[]) ?? []).some((b) => b.id === s.backupId),
  );

  const jsonPath = `${APP_DATA}/backups/backup-${s.backupId}.json`;
  let exists = true;
  try {
    await Deno.stat(jsonPath);
  } catch {
    exists = false;
  }
  assertEquals(exists, false);
}

async function p15WrapUp() {
  // The generation queue shows both jobs, both complete.
  const jobs = await api("GET", "/api/v1/jobs?limit=50", {
    token: s.adminToken,
  });
  assertEquals(jobs.status, 200);
  const rows = asArr(jobs.body);
  const preview = rows.find((j) => j.id === s.previewJobId);
  const clip = rows.find((j) => j.id === s.clipJobId);
  assert(preview && clip, "generation jobs should be listed");
  assertEquals(preview.status, "succeeded");
  assertEquals(clip.status, "succeeded");

  // Non-admin isolation on the render + timeline surfaces: an inaccessible
  // timeline is invisible to the viewer (404), so both surfaces reject it.
  const viewerRender = await api("POST", "/api/v1/renders", {
    token: s.viewerToken,
    jsonBody: {
      project_id: s.projectId,
      timeline_id: s.timelineId,
      preset_id: "preset-audio",
    },
  });
  assertEquals(viewerRender.status, 404);

  const viewerTimeline = await api("GET", `/api/v1/timelines/${s.timelineId}`, {
    token: s.viewerToken,
  });
  assertEquals(viewerTimeline.status, 404);
}

describe("MVP acceptance flow", () => {
  it("completes the full studio journey over HTTP", async () => {
    Deno.env.set("JWT_SECRET", "acceptance-test-secret-0123456789abcdef");
    Deno.env.set("APP_DATA_DIR", APP_DATA);
    Deno.env.set("RENDER_ENGINE", "mock");
    await rmrf(APP_DATA);
    freshMemoryDb();
    resetContentStore();
    try {
      ensureDefaultPresets();
    } catch {
      // Presets table may not exist pre-migration on :memory: in some
      // configurations; the server bootstrap re-ensures them.
    }
    try {
      await withServer(async (baseUrl) => {
        base = baseUrl;
        await p01_healthAndAuth();
        await p02ViewerUser();
        await p03Project();
        await p04Model();
        await p05Assets();
        await p06References();
        await p07CreativeAndPreviewJob();
        await p08BatchGenerate();
        await p09Review();
        await p10Timeline();
        await p11Render();
        await p12Diagnostics();
        await p13BackupRestore();
        await p14BackupDelete();
        await p15WrapUp();
      });
    } finally {
      await rmrf(APP_DATA);
      Deno.env.delete("APP_DATA_DIR");
      Deno.env.delete("RENDER_ENGINE");
      Deno.env.delete("JWT_SECRET");
    }
  });
});
