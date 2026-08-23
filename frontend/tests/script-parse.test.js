import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import { formatDialogue, parseScript, scriptToSceneInputs } from "../src/script-parse.js";

describe("script-parse", () => {
  describe("parseScript", () => {
    it("parses a simple two-scene script with action and dialogue", () => {
      const { scenes, warnings } = parseScript(
        "FADE IN:\n\nINT. LIVING ROOM - NIGHT\n\nA candlelit table. Two chairs.\n\nMARA\nWe need to talk.\n\nJON\nI know.\n\nEXT. DOCK - DAWN\n\nFog rolls over the water.",
      );
      assertEquals(warnings, []);
      assertEquals(scenes.length, 2);
      assertEquals(scenes[0].heading, "INT. LIVING ROOM - NIGHT");
      assertEquals(scenes[0].action, "A candlelit table. Two chairs.");
      assertEquals(scenes[0].dialogue, [
        { name: "MARA", lines: ["We need to talk."] },
        { name: "JON", lines: ["I know."] },
      ]);
      assertEquals(scenes[1].heading, "EXT. DOCK - DAWN");
      assertEquals(scenes[1].action, "Fog rolls over the water.");
      assertEquals(scenes[1].dialogue.length, 0);
    });

    it("folds parentheticals into the spoken line", () => {
      const { scenes } = parseScript("INT. CAFE - DAY\n\nAVA\n(quietly)\nhello\n");
      assertEquals(scenes[0].dialogue, [{ name: "AVA", lines: ["hello (quietly)"] }]);
    });

    it("requires a blank line before a character cue", () => {
      const { scenes } = parseScript(
        "INT. HALL - DAY\n\nThe walls are tall and cold\nOLD SHADOWS MOVE\nSomething stirs.\n",
      );
      assertEquals(
        scenes[0].action,
        "The walls are tall and cold\nOLD SHADOWS MOVE\nSomething stirs.",
      );
      assertEquals(scenes[0].dialogue.length, 0);
    });

    it("allows a character cue directly after a scene heading", () => {
      const { scenes } = parseScript("INT. CELL - NIGHT\nBOBBY\nIs anyone there?\n");
      assertEquals(scenes[0].dialogue, [{ name: "BOBBY", lines: ["Is anyone there?"] }]);
    });

    it("places content before any heading into a synthetic scene", () => {
      const { scenes, warnings } = parseScript("It begins at sea.\n\nINT. SHIP - DAY\n\nWaves.");
      assertEquals(scenes.length, 2);
      assertEquals(scenes[0].heading, "Scene 1");
      assertEquals(scenes[0].action, "It begins at sea.");
      assertEquals(scenes[1].heading, "INT. SHIP - DAY");
      assertEquals(
        warnings,
        [],
      );
    });

    it("warns when the whole script has no scene headings", () => {
      const { scenes, warnings } = parseScript("Just some words on a page.");
      assertEquals(scenes.length, 1);
      assertEquals(scenes[0].heading, "Scene 1");
      assertEquals(warnings, ["no scene headings found; created one scene for all content"]);
    });

    it("returns empty for blank input", () => {
      const { scenes, warnings } = parseScript("   \n  ");
      assertEquals(scenes, []);
      assertEquals(warnings, []);
    });

    it("warns 'no usable content found' for heading-only input", () => {
      const { scenes, warnings } = parseScript("INT. HALL - DAY\n\nEXT. DOCK - DAWN\n");
      assertEquals(scenes, []);
      assertEquals(warnings, ["no usable content found"]);
    });

    it("skips empty dialogue blocks and empty scenes on flush", () => {
      const { scenes } = parseScript("INT. A - DAY\n\nBOBBY\n\nEXT. B - DAY\n\nACTION LINE.\n");
      assertEquals(scenes.length, 1);
      assertEquals(scenes[0].heading, "EXT. B - DAY");
    });

    it("handles mixed line endings", () => {
      const { scenes } = parseScript("INT. A - DAY\r\n\r\nHELLO\r\nworld\r\n");
      assertEquals(scenes[0].dialogue, [{ name: "HELLO", lines: ["world"] }]);
    });

    it("joins wrapped dialogue lines into one spoken line per paragraph", () => {
      const { scenes } = parseScript(
        "INT. CAFE - DAY\n\nAVA\nhello there\nhow are you\n\nBOB\nfine\n",
      );
      assertEquals(scenes[0].dialogue, [
        { name: "AVA", lines: ["hello there", "how are you"] },
        { name: "BOB", lines: ["fine"] },
      ]);
    });
  });

  describe("formatDialogue", () => {
    it("renders a transcript grouped by speaker", () => {
      const text = formatDialogue([
        { name: "MARA", lines: ["We need to talk.", "It's done."] },
        { name: "JON", lines: ["I know."] },
      ]);
      assertEquals(text, "MARA\nWe need to talk.\nIt's done.\n\nJON\nI know.");
    });

    it("returns an empty string for empty input", () => {
      assertEquals(formatDialogue([]), "");
      assertEquals(formatDialogue(), "");
    });
  });

  describe("scriptToSceneInputs", () => {
    it("maps parsed scenes to import rows with draft prompts", () => {
      const { scenes } = parseScript(
        "INT. OFFICE - DAY\n\nShe reads the report.\n\nLEA\nWe found it.\n",
      );
      const inputs = scriptToSceneInputs(scenes);
      assertEquals(inputs.length, 1);
      assertEquals(inputs[0].name, "INT. OFFICE - DAY");
      assertEquals(inputs[0].description, "She reads the report.");
      assertEquals(inputs[0].notes, "LEA\nWe found it.");
      const prompt = inputs[0].prompt;
      assertEquals(prompt.startsWith("Film scene draft (imported from script)."), true);
      assertEquals(prompt.includes("Setting: INT. OFFICE - DAY"), true);
      assertEquals(prompt.includes("She reads the report."), true);
      assertEquals(prompt.includes("LEA\nWe found it."), true);
      assertEquals(inputs[0].notes !== undefined, true);
    });

    it("omits notes and falls back description when there is no dialogue", () => {
      const { scenes } = parseScript("EXT. FIELD - DUSK\n\nGrass sways.\n");
      const [input] = scriptToSceneInputs(scenes);
      assertEquals(input.notes, undefined);
      assertEquals(input.description, "Grass sways.");
    });

    it("caps long prompts at maxPromptLength", () => {
      const { scenes } = parseScript("INT. ROOM - DAY\n\n" + "word ".repeat(2000).trim());
      const [input] = scriptToSceneInputs(scenes, { maxPromptLength: 100 });
      assertEquals(input.prompt.length, 100);
    });
  });
});
