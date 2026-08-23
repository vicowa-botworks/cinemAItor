// Continuity analyzer (MS-8) — pure, deterministic rules over a project's
// creative objects (storyboard panels, scenes, shots). No DB, no DOM: the
// route layers a loader (loadProjectContinuityInput) on top, so every rule is
// unit-testable against plain rows.

export type ContinuitySeverity = "error" | "warning" | "info";

export interface ContinuityPanelRow {
  id: string;
  storyboard_name: string;
  panel_order: number;
  time_of_day: string | null;
  lighting: string | null;
  linked_scene_id: string | null;
  linked_shot_id: string | null;
  prompt_created_at: string | null;
  clip_created_at: string | null;
}

export interface ContinuitySceneRow {
  id: string;
  name: string;
  target_duration: number | null;
}

export interface ContinuityShotRow {
  id: string;
  scene_id: string;
  shot_order: number;
  name: string | null;
  duration: number | null;
  prompt_created_at: string | null;
  clip_created_at: string | null;
}

export interface ContinuityInput {
  panels: ContinuityPanelRow[];
  scenes: ContinuitySceneRow[];
  shots: ContinuityShotRow[];
}

export interface ContinuityIssue {
  rule: string;
  severity: ContinuitySeverity;
  object_type: "panel" | "scene" | "shot";
  object_id: string;
  object_label: string;
  message: string;
}

export const CONTINUITY_RULES = [
  {
    id: "panel-link-mismatch",
    severity: "error",
    description: "Panel links reference a missing or foreign shot/scene",
  },
  {
    id: "time-of-day-jump",
    severity: "warning",
    description: "Panels in one scene declare different times of day",
  },
  {
    id: "lighting-conflict",
    severity: "warning",
    description: "Panels in one scene declare conflicting lighting",
  },
  {
    id: "stale-clip",
    severity: "warning",
    description: "Generated clip predates the current prompt version",
  },
  {
    id: "duration-mismatch",
    severity: "warning",
    description: "Scene target duration and shot durations disagree",
  },
  {
    id: "unlinked-panel",
    severity: "info",
    description: "Panel is linked to a scene but not to one of its shots",
  },
] as const;

const SEVERITY_RANK: Record<ContinuitySeverity, number> = { error: 0, warning: 1, info: 2 };

function panelLabel(panel: ContinuityPanelRow): string {
  return `${panel.storyboard_name} · panel ${panel.panel_order}`;
}

function shotLabel(shot: ContinuityShotRow, scenes: ContinuitySceneRow[]): string {
  const scene = scenes.find((s) => s.id === shot.scene_id);
  const prefix = scene ? scene.name : shot.scene_id;
  return shot.name ? `${prefix} · ${shot.name}` : `${prefix} · shot ${shot.shot_order}`;
}

function valuesCount(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, count]) => `${value} (${count})`)
    .join(", ");
}

/** Stale when the current prompt version was created after the clip. */
function isStale(promptCreatedAt: string | null, clipCreatedAt: string | null): boolean {
  if (!promptCreatedAt || !clipCreatedAt) return false;
  // Both are ISO-8601 UTC strings; lexicographic order is chronological.
  return promptCreatedAt > clipCreatedAt;
}

export function analyzeContinuity(input: ContinuityInput): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  const { panels, scenes, shots } = input;
  const sceneById = new Map(scenes.map((s) => [s.id, s]));
  const shotById = new Map(shots.map((s) => [s.id, s]));
  const shotsByScene = new Map<string, ContinuityShotRow[]>();
  for (const shot of shots) {
    const list = shotsByScene.get(shot.scene_id);
    if (list) list.push(shot);
    else shotsByScene.set(shot.scene_id, [shot]);
  }

  // Rule 1: panel links must resolve inside this project.
  for (const panel of panels) {
    const problems: string[] = [];
    if (panel.linked_scene_id && !sceneById.has(panel.linked_scene_id)) {
      problems.push(`references a scene that does not exist in this project`);
    }
    if (panel.linked_shot_id) {
      const shot = shotById.get(panel.linked_shot_id);
      if (!shot) {
        problems.push(`references a shot that does not exist in this project`);
      } else if (panel.linked_scene_id && shot.scene_id !== panel.linked_scene_id) {
        const foreign = sceneById.get(shot.scene_id);
        problems.push(
          `is linked to scene "${panel.linked_scene_id}" but its shot belongs to scene "${
            foreign?.name ?? shot.scene_id
          }"`,
        );
      }
    }
    if (problems.length > 0) {
      issues.push({
        rule: "panel-link-mismatch",
        severity: "error",
        object_type: "panel",
        object_id: panel.id,
        object_label: panelLabel(panel),
        message: `Panel ${problems.join("; ")}.`,
      });
    }
  }

  // Rules 2+3: time_of_day / lighting consistency within a linked scene.
  const panelsByScene = new Map<string, ContinuityPanelRow[]>();
  for (const panel of panels) {
    if (!panel.linked_scene_id || !sceneById.has(panel.linked_scene_id)) continue;
    const list = panelsByScene.get(panel.linked_scene_id);
    if (list) list.push(panel);
    else panelsByScene.set(panel.linked_scene_id, [panel]);
  }
  for (const [sceneId, linkedPanels] of panelsByScene) {
    const scene = sceneById.get(sceneId);
    if (!scene || linkedPanels.length < 2) continue;
    for (
      const rule of [
        {
          id: "time-of-day-jump",
          values: linkedPanels.map((p) => p.time_of_day),
          field: "times of day",
        },
        { id: "lighting-conflict", values: linkedPanels.map((p) => p.lighting), field: "lighting" },
      ]
    ) {
      const distinct = [...new Set(rule.values.filter((v): v is string => v !== null))];
      if (distinct.length > 1) {
        issues.push({
          rule: rule.id,
          severity: "warning",
          object_type: "scene",
          object_id: scene.id,
          object_label: scene.name,
          message: `Linked panels declare different ${rule.field}: ${
            valuesCount(
              rule.values.filter((v): v is string => v !== null),
            )
          }.`,
        });
      }
    }
  }

  // Rule 4: clips generated from an older prompt version.
  const staleObjects: Array<{
    object_type: "panel" | "shot";
    row: ContinuityPanelRow | ContinuityShotRow;
    label: string;
  }> = [
    ...panels.map((p) => ({
      object_type: "panel" as const,
      row: p,
      label: panelLabel(p),
    })),
    ...shots.map((s) => ({ object_type: "shot" as const, row: s, label: shotLabel(s, scenes) })),
  ];
  for (const { object_type, row, label } of staleObjects) {
    if (isStale(row.prompt_created_at, row.clip_created_at)) {
      issues.push({
        rule: "stale-clip",
        severity: "warning",
        object_type,
        object_id: row.id,
        object_label: label,
        message: `The generated clip predates the current prompt version (edited ${
          new Date(row.prompt_created_at as string).toISOString()
        } after the clip was created). Regenerate to pick up the new prompt.`,
      });
    }
  }

  // Rule 5: scene target duration vs sum of shot durations.
  for (const scene of scenes) {
    if (scene.target_duration === null) continue;
    const sceneShots = shotsByScene.get(scene.id) ?? [];
    const total = sceneShots.reduce(
      (sum, shot) => sum + (shot.duration ?? 0),
      0,
    );
    if (sceneShots.length === 0 || total <= 0) continue;
    const tolerance = Math.max(0.5, scene.target_duration * 0.1);
    if (Math.abs(scene.target_duration - total) > tolerance) {
      const rounded = (n: number) => Math.round(n * 10) / 10;
      issues.push({
        rule: "duration-mismatch",
        severity: "warning",
        object_type: "scene",
        object_id: scene.id,
        object_label: scene.name,
        message: `Scene targets ${rounded(scene.target_duration)}s but its shots total ${
          rounded(total)
        }s.`,
      });
    }
  }

  // Rule 6: panel linked to a scene but left without a shot.
  for (const panel of panels) {
    if (!panel.linked_scene_id || panel.linked_shot_id) continue;
    const scene = sceneById.get(panel.linked_scene_id);
    if (!scene) continue;
    const sceneShots = shotsByScene.get(scene.id) ?? [];
    if (sceneShots.length > 0) {
      issues.push({
        rule: "unlinked-panel",
        severity: "info",
        object_type: "panel",
        object_id: panel.id,
        object_label: panelLabel(panel),
        message: `Panel is linked to scene "${scene.name}" but not to one of its shots.`,
      });
    }
  }

  return issues.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.object_type.localeCompare(b.object_type) ||
      a.object_label.localeCompare(b.object_label) ||
      a.object_id.localeCompare(b.object_id),
  );
}
