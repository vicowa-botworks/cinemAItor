// Demo mode content (docs/demo.md) — the "The Lighthouse" demo film: a small,
// fixed set of creative objects (script text, image assets, storyboard panels,
// shots, a music score) that the demo runners fill into the real pages. Pure
// data + a model preflight; no DOM, no Lit — unit-tested in
// frontend/tests/demo-mode.test.js. Step builders that drive the real page
// components live with each page (see the page demos in docs/demo.md).

// The demo film. Prompts are deliberately simple and model-agnostic: the demo's
// job is to show the flow, and the model-skill auto-enhance (prompt-enhance.js)
// polishes them per the selected model when the user has that on.
export const DEMO_FILM = {
  title: "The Lighthouse",
  project: {
    name: "The Lighthouse (demo)",
    description:
      "A three-scene demo short: a keeper on a stormy night, a rescue, and a calm dawn. Created by the demo mode so you can learn the app's full pipeline.",
    aspect_ratio: "16:9",
  },
  script: {
    name: "The Lighthouse — screenplay",
    text: [
      "FADE IN:",
      "",
      "EXT. LIGHTHOUSE COAST - NIGHT",
      "",
      "A stone lighthouse stands on a rocky cliff. Its beam sweeps across a",
      "storm-black sea. Waves crash against the rocks below.",
      "",
      "A small fishing boat batters through the swell, its cabin light flickering.",
      "",
      "INT. LIGHTHOUSE GALLERY - NIGHT",
      "",
      "The keeper EAMONN, fifty, weathered, watches the storm through the lens.",
      "",
      "EAMONN",
      "There she is, taking water.",
      "",
      "He grabs the horn and blows it toward the sea.",
      "",
      "EAMONN",
      "Hold your course. Keep the light on her.",
      "",
      "EXT. LIGHTHOUSE COAST - DAWN",
      "",
      "The sea is calm. The fishing boat lies beached on the rocks, hull cracked",
      "but holding. EAMONN stands on the cliff with his coat over his arm, watching",
      "the sun come up over the water.",
      "",
      "FADE OUT.",
    ].join("\n"),
  },
  // Image assets generated on the assets page. Slugs are referenced from the
  // panel prompts below via @slug tokens (the demo doubles as a tour of
  // @references).
  assets: [
    {
      slug: "lighthouse",
      display_name: "Lighthouse",
      kind: "image",
      asset_type: "location",
      prompt:
        "A tall stone lighthouse on a rugged cliff at night, its beam sweeping a stormy black sea, crashing waves, cinematic wide shot, moody film still",
    },
    {
      slug: "keeper",
      display_name: "Lighthouse keeper",
      kind: "image",
      asset_type: "character",
      prompt:
        "A weathered lighthouse keeper in his fifties, deep lines on his face, old oilskin coat, standing in a lamp room, warm lamp light on his face, cinematic film still",
    },
    {
      slug: "boat",
      display_name: "Fishing boat",
      kind: "image",
      asset_type: "prop",
      prompt:
        "A small wooden fishing boat in rough night seas, waves breaking over the bow, a faint lamp glowing in the cabin, cinematic film still",
    },
  ],
  // Storyboard panels. scene_index is the 1-based index of the scene (from the
  // script above) each panel belongs to; the demo links them after creating
  // both. Prompts use @references to the demo assets.
  panels: [
    {
      name: "The coast at night",
      scene_index: 1,
      prompt:
        "Night, wide establishing shot: @lighthouse on a rocky cliff, its beam cutting through storm clouds and sea spray; a dark, churning sea below. Cinematic.",
    },
    {
      name: "The boat in the swell",
      scene_index: 1,
      prompt:
        "Night: @boat battling heavy swell, waves crashing over its bow, a tiny cabin light flickering; the lighthouse beam passes over it. Cinematic.",
    },
    {
      name: "The keeper at the horn",
      scene_index: 2,
      prompt:
        "Night, interior lamp room: @keeper, weathered, blowing a brass fog horn, lamp glow across his face, the great lens swirling above. Cinematic.",
    },
    {
      name: "Dawn after the storm",
      scene_index: 3,
      prompt:
        "Dawn: calm sea in soft pink light; @boat beached safely on the rocks; @lighthouse on the cliff in the distance. Cinematic, hopeful.",
    },
  ],
  // One scene per script scene. The scenes demo treats the open scene as the
  // film's first scene (the others exist for the full-movie demo). The prompt
  // is the scene clip's generation prompt (motion + lens language).
  scenes: [
    {
      name: "EXT. Lighthouse head - DUSK",
      description:
        "The lighthouse on its head at dusk. The beam sweeps empty water as the keeper climbs in — the film opens on the machine and its keeper.",
      target_duration: 12,
      prompt:
        "Slow aerial push-in on the lighthouse as the beam completes its sweep; sea spray catches the light. Handheld energy, natural dusk light, 24mm wide.",
    },
    {
      name: "INT. Keeper's quarters - NIGHT",
      description:
        "A small room lit by lamp and log. The keeper and his daughter argue about leaving; the light still turns through the round window.",
      target_duration: 30,
      prompt:
        "Slow dolly around the lamplit room as the two argue; the beam sweeps the wall in long passes. Practical lamp light, 35mm, restrained moves.",
    },
    {
      name: "EXT. Shingle beach - DAWN",
      description:
        "Dawn, the storm passed. The keeper finds the beached boat and walks out to it; the lighthouse light no longer turns.",
      target_duration: 20,
      prompt:
        "Wide static shot as the keeper walks out across the shingle to the beached boat; the light stands dark in the background. Flat dawn light, 50mm.",
    },
  ],
  // One shot per scene. The demo links each shot's scene to its first panel,
  // so clip generation runs image-to-video off the panel preview when an
  // image-to-video model is enabled (text-to-video otherwise).
  shots: [
    {
      scene_index: 1,
      name: "Beam over the storm",
      prompt: "Slow push-in on the lighthouse as the beam sweeps; storm spray in the dark.",
    },
    {
      scene_index: 2,
      name: "The horn",
      prompt:
        "Interior lamp room: the keeper turns and blows the horn; lamp light flickers across his face.",
    },
    {
      scene_index: 3,
      name: "Calm dawn",
      prompt:
        "Slow pull-back over the calm dawn sea; the beached boat, the lighthouse far off, sun breaking.",
    },
  ],
  music: {
    kind: "music",
    prompt:
      "A slow, moody ambient film score: lone cello and sparse piano over soft wind and distant surf, tense and dark, resolving into calm, hopeful warmth by the end. No vocals.",
  },
  // The Timeline demo (timeline-detail.js) places one clip per scene —
  // generated from that scene's shot prompt — back-to-back on a single video
  // track, lays the music score on an audio track under it, then runs a draft
  // render. Clips are project-scoped assets discovered by these slugs.
  timeline: {
    video_track: "Scenes",
    audio_track: "Score",
    render_preset: "preset-draft",
    clip_slugs: [
      "lighthouse_clip_1",
      "lighthouse_clip_2",
      "lighthouse_clip_3",
    ],
  },
};

// Task types the demo needs, grouped by what they drive. Preflight checks each
// one against the enabled models so a demo run can announce (and skip) the
// parts the user's model set cannot produce instead of failing mid-run.
export const DEMO_TASKS = [
  {
    key: "assets",
    task_type: "text_to_image",
    label: "image assets and storyboard panel previews",
  },
  {
    key: "clips",
    task_type: "image_to_video",
    label: "scene clips (image-to-video from panel previews)",
  },
  {
    key: "clips_text",
    task_type: "text_to_video",
    label: "scene clips (text-to-video fallback)",
  },
  { key: "music", task_type: "music", label: "the music score" },
];

/**
 * Check which demo parts the user's enabled models can produce.
 *
 * @param {object} api
 * @returns {Promise<{
 *   ok: boolean,
 *   llm_configured: boolean,
 *   tasks: Array<{key: string, task_type: string, label: string, ok: boolean, model_id: string|null, error: string|null}>,
 * }> }
 * `ok` is true when every part has at least one path (a clips part counts when
 * EITHER the i2v or the t2v fallback has a model). `llm_configured` is an
 * optional-signal only (prompt auto-enhance) and never gates the demo.
 */
export async function demoPreflight(api) {
  const tasks = [];
  for (const task of DEMO_TASKS) {
    let row;
    try {
      const models = await api.listModels({
        task_type: task.task_type,
        enabled: "true",
      });
      row = {
        ...task,
        ok: models.length > 0,
        model_id: models.length > 0 ? models[0].id : null,
        error: null,
      };
    } catch (err) {
      row = {
        ...task,
        ok: false,
        model_id: null,
        error: String(err?.message ?? err),
      };
    }
    tasks.push(row);
  }
  const byKey = Object.fromEntries(tasks.map((t) => [t.key, t.ok]));
  let llm_configured = false;
  try {
    const status = await api.getLlmStatus();
    llm_configured = Boolean(status?.configured);
  } catch {
    llm_configured = false;
  }
  const ok = byKey.assets && (byKey.clips || byKey.clips_text) && byKey.music;
  return { ok, llm_configured, tasks };
}

/** One-line per-object tally used in the demo intro narration. */
export function demoFilmSummary(film = DEMO_FILM) {
  const parts = [
    `1 script (${film.script.name})`,
    `${film.assets.length} image assets`,
    `${film.panels.length} storyboard panels`,
    `${film.shots.length} scene clips`,
    "1 music score",
    "1 timeline render",
  ];
  return parts.join(", ") + ".";
}
