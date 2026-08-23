import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createAsset, createAssetVersion, getAssetVersion } from "../src/db/assets.ts";
import { registerModel } from "../src/db/models.ts";
import { srtTimestamp, synthesizeSrt } from "../src/services/adapters.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";
import { resetContentStore } from "../src/storage/content_store.ts";

// ---------------------------------------------------------------------------
// SRT synthesis units (mock transcribe output shape)
// ---------------------------------------------------------------------------

function parseSrtBlocks(srt: string): string[][] {
  return srt.trim().split("\n\n").map((block) => block.split("\n"));
}

describe("srt synthesis units", () => {
  it("formats timestamps with millisecond precision", () => {
    assertEquals(srtTimestamp(0), "00:00:00,000");
    assertEquals(srtTimestamp(5.5), "00:00:05,500");
    assertEquals(srtTimestamp(59.999), "00:00:59,999");
    assertEquals(srtTimestamp(3661.25), "01:01:01,250");
    assertEquals(srtTimestamp(-3), "00:00:00,000");
  });

  it("produces deterministic, well-formed SRT blocks", () => {
    const a = synthesizeSrt("seed-1", 12, 0);
    const again = synthesizeSrt("seed-1", 12, 0);
    const other = synthesizeSrt("seed-1", 12, 1);
    assertEquals(a, again);
    assert(a !== other);

    const blocks = parseSrtBlocks(a);
    assert(blocks.length >= 2 && blocks.length <= 5);
    let prevEnd = "";
    blocks.forEach((lines, i) => {
      assertEquals(lines.length, 3);
      assertEquals(lines[0], String(i + 1));
      const match = lines[1].match(
        /^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})$/,
      );
      assert(match, `bad timestamp line: ${lines[1]}`);
      assert(lines[2].length > 0);
      const [start, end] = [match[1], match[2]];
      assert(start <= end);
      // fixed-width timestamps compare lexicographically; cues in order
      if (i > 0) assert(start >= prevEnd);
      prevEnd = end;
    });
    assertEquals(blocks[0][1].split(" --> ")[0], "00:00:00,000");
  });

  it("caps the last cue at the source duration", () => {
    const srt = synthesizeSrt("seed-2", 7.5, 0);
    const blocks = parseSrtBlocks(srt);
    const lastEnd = blocks[blocks.length - 1][1].split(" --> ")[1];
    assert(lastEnd <= "00:00:07,500");
  });
});

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

let baseUrl = "";
let ownerToken: string;
let memberToken: string;
let ownerId: number;
let transcribeModelId: string;
let unrelatedModelId: string;
let audioAssetId: string;
let audioVersionId: string;
let imageAssetId: string;
let appDataDir = "";

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function req(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: headers(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as unknown;
  return { status: res.status, json };
}

async function waitJob(
  jobId: string,
  token: string,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
    const { status, json } = await req(
      "GET",
      `/api/v1/jobs/${jobId}`,
      undefined,
      token,
    );
    assertEquals(status, 200);
    const job = json as Record<string, unknown>;
    if (job.status === "succeeded" || job.status === "failed") {
      assertEquals(job.status, "succeeded");
      return job;
    }
    if (Date.now() - start > 8000) throw new Error("job stuck");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("subtitle generation api", () => {
  beforeEach(async () => {
    appDataDir = Deno.makeTempDirSync({ prefix: "cinemaitor_subtitle_api_" });
    Deno.env.set("APP_DATA_DIR", appDataDir);
    resetContentStore();

    freshMemoryDb();
    await withServer(async (base) => {
      baseUrl = base;
      const health = await fetchWithRetry(`${baseUrl}/api/v1/health`);
      assertEquals(health.status, 200);

      const res = await req(
        "POST",
        "/api/v1/auth/bootstrap",
        {
          email: `admin.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Studio Admin",
        },
      );
      assertEquals(res.status, 201);
      const user = res.json as { token: string; user: { id: number } };
      ownerToken = user.token;
      ownerId = user.user.id;

      transcribeModelId = registerModel(ownerId, {
        name: "api-mock-transcribe",
        version: "1.0",
        backend: "mock",
        task_types: ["transcribe"],
        enabled: true,
      }).id;
      unrelatedModelId = registerModel(ownerId, {
        name: "api-mock-t2i",
        version: "1.0",
        backend: "mock",
        task_types: ["text_to_image"],
        enabled: true,
      }).id;

      const wavPath = `${appDataDir}/source.wav`;
      await Deno.writeTextFile(wavPath, "RIFF....WAVEfmt ");
      audioAssetId = createAsset(
        {
          unique_slug: `voice_${Math.random().toString(36).slice(2, 8)}`,
          display_name: "VO Take 1",
          asset_type: "voiceover",
          library_scope: "global",
        },
        ownerId,
      ).id;
      audioVersionId = createAssetVersion(
        audioAssetId,
        ownerId,
        {
          content_hash: null,
          file_path: wavPath,
          format: "wav",
          mime_type: "audio/wav",
          file_size: 16,
          technical_metadata_json: JSON.stringify({ audio: { duration: 7.5 } }),
        },
      ).id;

      imageAssetId = createAsset(
        {
          unique_slug: `img_${Math.random().toString(36).slice(2, 8)}`,
          display_name: "Frame",
          asset_type: "image",
          library_scope: "global",
        },
        ownerId,
      ).id;

      const memberRes = await req(
        "POST",
        "/api/auth/register",
        {
          email: `member.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Member",
        },
      );
      assertEquals(memberRes.status, 201);
      memberToken = (memberRes.json as { token: string }).token;
    });
  });

  afterEach(() => {
    closeDb();
    Deno.removeSync(appDataDir, { recursive: true });
  });

  it("transcribes an audio version into SRT candidates on a fresh subtitle asset", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await req(
          "POST",
          `/api/v1/audio/assets/${audioAssetId}/versions/${audioVersionId}/subtitles`,
          {},
          ownerToken,
        );
        assertEquals(res.status, 202);
        const body = res.json as {
          job_id: string;
          job_type: string;
          asset_id: string;
          source_asset_id: string;
          source_version_id: string;
          source_version_number: number;
        };
        assertEquals(body.job_type, "transcribe");
        assertEquals(body.source_asset_id, audioAssetId);
        assertEquals(body.source_version_id, audioVersionId);
        assertEquals(body.source_version_number, 1);
        assert(body.asset_id !== audioAssetId);

        const job = await waitJob(body.job_id, ownerToken);
        assertEquals(job.candidate_count, 1);
        assert(typeof job.output_asset_version_id === "string");

        const assetRes = await req(
          "GET",
          `/api/v1/assets/${body.asset_id}`,
          undefined,
          ownerToken,
        );
        assertEquals(assetRes.status, 200);
        const asset = assetRes.json as Record<string, unknown>;
        assertEquals(asset.asset_type, "subtitle");
        assertEquals(asset.display_name, "Subtitles: VO Take 1");

        const srt = await (
          await fetch(
            `${baseUrl}/api/v1/assets/${body.asset_id}/preview`,
            { headers: headers(ownerToken) },
          )
        ).text();
        assert(srt.startsWith("1\n00:00:00,000 --> "));
        const blocks = parseSrtBlocks(srt);
        for (const lines of blocks) {
          assert(lines[1].split(" --> ")[1] <= "00:00:07,500");
        }
        assert(srt.includes("Mock transcription line 1 of"));
      })();
    });
  });

  it("honours the candidates setting", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await req(
          "POST",
          `/api/v1/audio/assets/${audioAssetId}/versions/${audioVersionId}/subtitles`,
          { seed: "42", settings: { candidates: 2 } },
          ownerToken,
        );
        assertEquals(res.status, 202);
        const body = res.json as { job_id: string; asset_id: string };
        const job = await waitJob(body.job_id, ownerToken);
        assertEquals(job.candidate_count, 2);

        const versionsRes = await req(
          "GET",
          `/api/v1/assets/${body.asset_id}/versions`,
          undefined,
          ownerToken,
        );
        assertEquals(versionsRes.status, 200);
        const versions = versionsRes.json as {
          version_number: number;
          format: string;
        }[];
        assertEquals(versions.length, 2);
        assert(versions.every((v) => v.format === "srt"));
      })();
    });
  });

  it("rejects invalid requests", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        // Non-audio asset.
        const imageRes = await req(
          "POST",
          `/api/v1/audio/assets/${imageAssetId}/versions/x/subtitles`,
          {},
          ownerToken,
        );
        assertEquals(imageRes.status, 400);
        assertEquals(
          (imageRes.json as { error: { message: string } }).error.message,
          "Asset is not an audio asset",
        );

        // Unknown asset.
        const missing = await req(
          "POST",
          "/api/v1/audio/assets/nope/versions/x/subtitles",
          {},
          ownerToken,
        );
        assertEquals(missing.status, 404);

        // Version that belongs to a different (audio) asset.
        const otherAudioId = createAsset(
          {
            unique_slug: `voice_other_${Math.random().toString(36).slice(2, 8)}`,
            display_name: "Other VO",
            asset_type: "voiceover",
            library_scope: "global",
          },
          ownerId,
        ).id;
        const crossAsset = await req(
          "POST",
          `/api/v1/audio/assets/${otherAudioId}/versions/${audioVersionId}/subtitles`,
          {},
          ownerToken,
        );
        assertEquals(crossAsset.status, 404);

        // Model without the transcribe task.
        const wrongModel = await req(
          "POST",
          `/api/v1/audio/assets/${audioAssetId}/versions/${audioVersionId}/subtitles`,
          { model_id: unrelatedModelId },
          ownerToken,
        );
        assertEquals(wrongModel.status, 400);
        assert(
          (wrongModel.json as { error: { message: string } }).error.message
            .includes("transcribe"),
        );

        // No model available with the transcribe task at all.
        const disable = await req(
          "PATCH",
          `/api/v1/models/${transcribeModelId}`,
          { enabled: false },
          ownerToken,
        );
        assertEquals(disable.status, 200);
        const noModel = await req(
          "POST",
          `/api/v1/audio/assets/${audioAssetId}/versions/${audioVersionId}/subtitles`,
          {},
          ownerToken,
        );
        assertEquals(noModel.status, 400);
        const reenable = await req(
          "PATCH",
          `/api/v1/models/${transcribeModelId}`,
          { enabled: true },
          ownerToken,
        );
        assertEquals(reenable.status, 200);
      })();
    });
  });

  it("hides foreign assets from non-writers", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await req(
          "POST",
          `/api/v1/audio/assets/${audioAssetId}/versions/${audioVersionId}/subtitles`,
          {},
          memberToken,
        );
        assertEquals(res.status, 404);
      })();
    });
  });

  it("stores source metadata on the produced version", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await req(
          "POST",
          `/api/v1/audio/assets/${audioAssetId}/versions/${audioVersionId}/subtitles`,
          {},
          ownerToken,
        );
        assertEquals(res.status, 202);
        const body = res.json as { job_id: string };
        const job = await waitJob(body.job_id, ownerToken);
        const versionId = job.output_asset_version_id as string;

        // The stored version carries the job settings incl. source info and
        // the probed source duration.
        const version = getAssetVersion(versionId);
        assert(version);
        const meta = JSON.parse(version.technical_metadata_json ?? "{}") as {
          settings: Record<string, unknown>;
        };
        const source = meta.settings?.source as Record<string, unknown>;
        assertEquals(source?.asset_id, audioAssetId);
        assertEquals(source?.display_name, "VO Take 1");
        assertEquals(
          (meta.settings as Record<string, unknown>).source_duration,
          7.5,
        );
      })();
    });
  });
});
