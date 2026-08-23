import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import {
  modelFormatForFile,
  normalizeVector,
  VIEW_SPECS,
  viewCameraPose,
} from "../src/model-views.js";

const BBOX = {
  center: { x: 1, y: 2, z: 3 },
  size: { x: 2, y: 4, z: 2 },
};
const FOV = Math.PI / 6;

describe("model-views", () => {
  describe("VIEW_SPECS", () => {
    it("pins the four standard export views in order", () => {
      assertEquals(VIEW_SPECS, ["front", "side", "top", "perspective"]);
    });
  });

  describe("normalizeVector", () => {
    it("normalizes a direction vector", () => {
      const n = normalizeVector({ x: 3, y: 0, z: 4 });
      assertEquals(n.x, 0.6);
      assertEquals(n.z, 0.8);
      assertEquals(Math.hypot(n.x, n.y, n.z), 1);
    });

    it("returns zero for a zero vector instead of NaN", () => {
      const n = normalizeVector({ x: 0, y: 0, z: 0 });
      assertEquals(n, { x: 0, y: 0, z: 0 });
    });
  });

  describe("viewCameraPose", () => {
    it("frames the front view along +Z from the default fov", () => {
      const pose = viewCameraPose(BBOX, "front", 1.3, FOV);
      const expectedDistance = (2 * 1.3) / Math.tan(FOV / 2);
      assertEquals(pose.distance, expectedDistance);
      assertEquals(pose.position, {
        x: 1,
        y: 2,
        z: 3 + expectedDistance,
      });
      assertEquals(pose.target, BBOX.center);
    });

    it("frames the side view along +X and the top view along +Y", () => {
      const side = viewCameraPose(BBOX, "side", 1.0, FOV);
      assertEquals(side.position.x > BBOX.center.x, true);
      assertEquals(side.position.y, BBOX.center.y);
      assertEquals(side.position.z, BBOX.center.z);

      const top = viewCameraPose(BBOX, "top", 1.0, FOV);
      assertEquals(top.position.y > BBOX.center.y, true);
      assertEquals(top.position.x, BBOX.center.x);
      assertEquals(top.position.z, BBOX.center.z);
    });

    it("frames the perspective view on the normalized diagonal", () => {
      const pose = viewCameraPose(BBOX, "perspective", 1.3, FOV);
      const expectedDistance = (2 * 1.3) / Math.tan(FOV / 2);
      const diag = normalizeVector({ x: 1, y: 0.65, z: 1 });
      assertEquals(
        pose.position,
        {
          x: BBOX.center.x + diag.x * expectedDistance,
          y: BBOX.center.y + diag.y * expectedDistance,
          z: BBOX.center.z + diag.z * expectedDistance,
        },
        { message: "perspective position must sit on the normalized diagonal" },
      );
    });

    it("falls back to the front view for unknown view names", () => {
      const pose = viewCameraPose(BBOX, "diagonal-2", 1.0, FOV);
      const front = viewCameraPose(BBOX, "front", 1.0, FOV);
      assertEquals(pose, front);
    });

    it("scales distance with margin and fov", () => {
      const tight = viewCameraPose(BBOX, "front", 1.0, FOV);
      const roomy = viewCameraPose(BBOX, "front", 2.0, FOV);
      assertEquals(roomy.distance, tight.distance * 2);
      const wide = viewCameraPose(BBOX, "front", 1.0, Math.PI / 3);
      assertEquals(wide.distance < tight.distance, true);
    });
  });

  describe("modelFormatForFile", () => {
    it("maps glb/gltf filenames and format strings to the gltf loader", () => {
      assertEquals(modelFormatForFile("statue.glb"), "gltf");
      assertEquals(modelFormatForFile("scene.gltf"), "gltf");
      assertEquals(modelFormatForFile("GLB"), "gltf");
      assertEquals(modelFormatForFile("GLTF"), "gltf");
    });

    it("maps obj to the obj loader", () => {
      assertEquals(modelFormatForFile("car.obj"), "obj");
      assertEquals(modelFormatForFile("obj"), "obj");
    });

    it("maps model MIME types to their loader formats", () => {
      assertEquals(modelFormatForFile("model/gltf-binary"), "gltf");
      assertEquals(modelFormatForFile("model/gltf+json"), "gltf");
      assertEquals(modelFormatForFile("model/obj"), "obj");
    });

    it("returns null for non-previewable formats", () => {
      assertEquals(modelFormatForFile("robot.fbx"), null);
      assertEquals(modelFormatForFile("asset.usd"), null);
      assertEquals(modelFormatForFile("asset.usdz"), null);
      assertEquals(modelFormatForFile("mesh.stl"), null);
      assertEquals(modelFormatForFile(""), null);
      assertEquals(modelFormatForFile(null), null);
    });
  });
});
