import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { getDb, resetDb } from "../src/db/database.ts";
import * as schema from "../src/db/schema.ts";
import {
  createProject,
  deleteProject,
  getProjectAccessible,
  getProjectById,
  hasProjectPermission,
  listProjects,
  updateProject,
} from "../src/db/projects.ts";

function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`;
}

function grantPermission(
  projectId: string,
  userId: number,
  permission: string,
): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO project_permissions (id, project_id, user_id, permission, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  (stmt.run as (...params: unknown[]) => unknown)(
    crypto.randomUUID(),
    projectId,
    userId,
    permission,
    new Date().toISOString(),
  );
}

describe("projects", () => {
  let ownerId: number;
  let otherId: number;

  beforeEach(() => {
    getDb(":memory:");
    ownerId = schema.createUser(uniqueEmail("owner"), "hash123", "Owner");
    otherId = schema.createUser(uniqueEmail("other"), "hash456", "Other");
  });

  afterEach(() => {
    resetDb();
  });

  it("creates a project with defaults and owner permission", () => {
    const project = createProject({ name: "Test Film" }, ownerId);

    assertEquals(project.name, "Test Film");
    assertEquals(project.status, "active");
    assertEquals(project.created_by_user_id, ownerId);
    assertEquals(project.aspect_ratio, "16:9");
    assertEquals(project.frame_rate, 24);
    assertEquals(project.resolution_width, 1920);
    assertEquals(project.resolution_height, 1080);
    assertEquals(project.audio_sample_rate, 48000);
    assertEquals(project.media_directory, `projects/${project.id}/media`);
    assertEquals(project.output_directory, `projects/${project.id}/output`);
    assertEquals(hasProjectPermission(ownerId, project.id, "admin"), true);
  });

  it("lists only non-deleted projects accessible to the user", () => {
    createProject({ name: "Mine" }, ownerId);
    createProject({ name: "Yours" }, otherId);

    const projects = listProjects(ownerId);
    assertEquals(projects.length, 1);
    assertEquals(projects[0].name, "Mine");
  });

  it("lets a user with read permission access but not update", () => {
    const project = createProject({ name: "Readable" }, ownerId);
    grantPermission(project.id, otherId, "read");

    assertEquals(getProjectAccessible(project.id, otherId)?.name, "Readable");
    assertEquals(updateProject(project.id, otherId, { name: "Hacked" }), undefined);
  });

  it("lets a user with write permission update but not delete", () => {
    const project = createProject({ name: "Writable" }, ownerId);
    grantPermission(project.id, otherId, "write");

    const updated = updateProject(project.id, otherId, {
      name: "Updated",
      frame_rate: 30,
    });
    assertEquals(updated?.name, "Updated");
    assertEquals(updated?.frame_rate, 30);
    assertEquals(deleteProject(project.id, otherId), false);
  });

  it("lets a user with admin permission delete", () => {
    const project = createProject({ name: "Deletable" }, ownerId);
    grantPermission(project.id, otherId, "admin");

    assertEquals(deleteProject(project.id, otherId), true);
    assertEquals(getProjectAccessible(project.id, otherId), undefined);
    assertEquals(getProjectById(project.id)?.status, "deleted");
  });

  it("soft-deletes projects for the owner", () => {
    const project = createProject({ name: "Owner Delete" }, ownerId);

    assertEquals(deleteProject(project.id, ownerId), true);
    assertEquals(listProjects(ownerId).length, 0);
    assertEquals(getProjectById(project.id)?.status, "deleted");
  });

  it("keeps older settings when updating only some fields", () => {
    const project = createProject({
      name: "Original",
      frame_rate: 25,
      resolution_width: 3840,
      resolution_height: 2160,
    }, ownerId);

    const updated = updateProject(project.id, ownerId, {
      name: "Renamed",
    });
    assertEquals(updated?.name, "Renamed");
    assertEquals(updated?.frame_rate, 25);
    assertEquals(updated?.resolution_width, 3840);
    assertEquals(updated?.resolution_height, 2160);
  });
});
