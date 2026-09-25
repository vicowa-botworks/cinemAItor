// The Scripts page demo (docs/demo.md) — drives script-detail's real
// handlers: the editor's `content` property and `_save()`. Pure data →
// functions; no DOM of its own.
import { DEMO_FILM } from "./demo-content.js";

// The demo's first scene heading — marks "the editor already holds the demo
// script" (or the user's own text containing the demo's scenes).
const DEMO_MARKER = "EXT. LIGHTHOUSE COAST - NIGHT";

const FOUNTAIN_EXPLAIN =
  'Watch how Fountain-lite maps to the script: "FADE IN:" opens it; each ALL-CAPS line (' +
  '"EXT. LIGHTHOUSE COAST - NIGHT", "INT. LIGHTHOUSE GALLERY - NIGHT", "EXT. LIGHTHOUSE COAST - DAWN") ' +
  "is a scene heading; the plain lines are action; EAMONN on its own line followed by quoted lines is a " +
  "character cue with dialogue. The Scenes page can parse exactly this text into scene rows in bulk.";

/**
 * Build the Scripts page demo steps.
 *
 * @param {object} host the <script-detail> element
 * @param {object} preflight demoPreflight() result
 */
export function buildScriptDemoSteps(host, preflight) {
  const film = DEMO_FILM;
  return [
    {
      id: "script-intro",
      title: "The screenplay editor",
      async describe() {
        const llm = preflight?.llm_configured
          ? " The ✦ AI buttons (Write from idea, Continue existing) are wired to your LLM assistant — they draft Fountain-lite text that you review here before saving."
          : " Once an LLM is configured in the Model Manager, the ✦ AI buttons draft Fountain-lite text here (write from an idea, or continue an existing script) that you review before saving.";
        return (
          "The script is the source document for the whole pipeline — the storyboard, the scenes, and the timeline all hang off it. " +
          "The editor is plain Fountain-lite text, and every save is a new immutable version. " +
          llm
        );
      },
    },
    {
      id: "script-fill",
      title: "The demo screenplay",
      async prepare(ctx) {
        const hadDemo = host.content.includes(DEMO_MARKER);
        ctx.scratch.scriptKept = hadDemo;
        if (!hadDemo) host.content = film.script.text;
      },
      async describe(ctx) {
        return (
          (ctx.scratch.scriptKept
            ? "The editor already held the lighthouse screenplay (or your own text with the demo's first scene heading), so I kept it as-is. "
            : `I typed in the 3-scene demo screenplay, ${film.script.name}. `) + FOUNTAIN_EXPLAIN
        );
      },
    },
    {
      id: "script-save",
      title: "Save it as a version",
      async describe() {
        return (
          "Pressing Save version through the page's real handler appends a snapshot to the history below — it never overwrites. " +
          "You can save as often as you like, mid-thought; that's what the history is for."
        );
      },
      async execute() {
        await host._save();
        if (host.error) throw new Error(host.error);
        return { kind: "none", versions: host.versions.length };
      },
    },
    {
      id: "script-history",
      title: "The version history",
      async describe() {
        const n = host.versions.length;
        return (
          `The history now holds ${n} version${
            n === 1 ? "" : "s"
          }, newest first, the latest marked "current". ` +
          "View expands any version read-only; Restore re-activates an older one (it becomes the editor content, and saving again keeps everything). " +
          "Next in the pipeline: the Assets demo builds the images this script talks about, and the Storyboard demo turns these three scenes into image panels."
        );
      },
    },
  ];
}
