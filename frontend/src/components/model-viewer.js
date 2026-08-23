import { css, html, LitElement } from "lit";
import { VIEW_SPECS, viewCameraPose } from "../model-views.js";

const EXPORT_SIZE = 1024;
const FIT_RADIUS = 1;
const MARGIN = 1.3;
const FOV_DEG = 30;

/**
 * model-viewer — interactive 3D preview for glb/gltf/obj assets.
 *
 * three.js is loaded through the import map (esm.sh CDN) and this module is
 * dynamically imported by asset-detail, so a CDN or WebGL failure only degrades
 * the model preview — it never breaks the rest of the app.
 *
 * Dispatches `model-views-exported` (bubbles, composed) with
 * `detail: { views: [{ view, blob }] }` — one 1024² PNG per standard view.
 */
export class ModelViewer extends LitElement {
  static properties = {
    src: { type: String },
    format: { type: String },
    height: { type: Number },
  };

  static styles = css`
    :host {
      display: block;
    }
    .viewer-wrap {
      position: relative;
      width: 100%;
      border: 1px solid var(--border, #ddd);
      border-radius: 6px;
      overflow: hidden;
      background: #f4f4f5;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    .viewer-status {
      position: absolute;
      left: 8px;
      bottom: 6px;
      font-size: 12px;
      color: #555;
      background: rgba(255, 255, 255, 0.85);
      padding: 2px 8px;
      border-radius: 4px;
      pointer-events: none;
    }
    .viewer-error {
      color: #b00020;
    }
  `;

  constructor() {
    super();
    this.src = null;
    this.format = "gltf";
    this.height = 380;
    this._renderer = null;
    this._scene = null;
    this._camera = null;
    this._controlsModule = null;
    this._root = null;
    this._bbox = null;
    this._loopFn = null;
    this._resizeObserver = null;
    this._loadFailed = false;
  }

  firstUpdated() {
    this._resizeObserver = new ResizeObserver(() => this._syncSize());
    if (this.shadowRoot) {
      this._resizeObserver.observe(this.shadowRoot.querySelector(".viewer-wrap"));
    }
  }

  updated(changed) {
    if (!changed.has("src") && !changed.has("format")) return;
    this._clearModel();
    if (this.src) {
      this._init().then(() => this._load()).catch((err) => this._fail(err));
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._clearModel();
    if (this._renderer) {
      if (this._loopFn) this._renderer.setAnimationLoop(null);
      this._renderer.dispose();
      this._renderer = null;
    }
    if (this._controlsModule) {
      this._controlsModule.dispose();
      this._controlsModule = null;
    }
    this._scene = null;
    this._camera = null;
  }

  _canvas() {
    return this.shadowRoot?.querySelector("canvas") ?? null;
  }

  async _init() {
    const canvas = this._canvas();
    if (!canvas) throw new Error("viewer canvas not ready");
    if (this._renderer) {
      this._syncSize();
      return;
    }
    const THREE = await import("three");
    const { OrbitControls } = await import(
      "three/addons/controls/OrbitControls.js"
    );
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(0xf4f4f5, 1);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      FOV_DEG,
      1,
      0.01,
      100,
    );
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(2.5, 4, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-3, 2, -2);
    scene.add(fill);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    this._renderer = renderer;
    this._scene = scene;
    this._camera = camera;
    this._controlsModule = controls;
    this._THREE = THREE;
    this._syncSize();
  }

  _syncSize() {
    const wrap = this.shadowRoot?.querySelector(".viewer-wrap");
    if (!wrap || !this._renderer || !this._camera) return;
    const width = wrap.clientWidth || 1;
    const height = wrap.clientHeight || 1;
    this._renderer.setSize(width, height, false);
    this._camera.aspect = width / height;
    this._camera.updateProjectionMatrix();
  }

  async _load() {
    const THREE = this._THREE;
    if (!THREE || !this.src || this._loadFailed) return;
    const root = this._scene;
    const modelGroup = new THREE.Group();
    root.add(modelGroup);
    this._root = modelGroup;

    let buffer;
    try {
      const response = await fetch(this.src);
      if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
      buffer = await response.arrayBuffer();
    } catch (err) {
      modelGroup.removeFromParent();
      this._root = null;
      this._fail(err);
      return;
    }

    try {
      if (this.format === "obj") {
        const { OBJLoader } = await import("three/addons/loaders/OBJLoader.js");
        const text = new TextDecoder().decode(buffer);
        const obj = new OBJLoader().parse(text, "");
        const material = new THREE.MeshStandardMaterial({
          color: 0xc9ced6,
          roughness: 0.8,
          metalness: 0.05,
        });
        obj.traverse((child) => {
          if (child.isMesh) child.material = material;
        });
        this._placeModel(obj);
      } else {
        const { GLTFLoader } = await import(
          "three/addons/loaders/GLTFLoader.js"
        );
        const gltf = await new Promise((resolve, reject) => {
          new GLTFLoader().parse(buffer, "", resolve, reject);
        });
        this._placeModel(gltf.scene);
      }
    } catch (err) {
      modelGroup.removeFromParent();
      this._root = null;
      this._bbox = null;
      this._fail(err);
    }
  }

  _placeModel(obj) {
    const THREE = this._THREE;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) {
      this._root?.removeFromParent();
      this._root = null;
      this._fail(new Error("model has no geometry"));
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = (FIT_RADIUS * 2) / maxDim;
    obj.scale.multiplyScalar(scale);
    const root = this._root;
    root.attach(obj);

    const grid = new THREE.GridHelper(
      4,
      20,
      new THREE.Color(0x9aa0a6),
      new THREE.Color(0xd4d4d8),
    );
    const fitted = new THREE.Box3().setFromObject(obj);
    grid.position.y = fitted.min.y;
    root.add(grid);

    this._bbox = {
      center: { x: 0, y: 0, z: 0 },
      size: {
        x: fitted.max.x - fitted.min.x,
        y: fitted.max.y - fitted.min.y,
        z: fitted.max.z - fitted.min.z,
      },
    };

    const pose = viewCameraPose(this._bbox, "perspective", MARGIN, (FOV_DEG * Math.PI) / 180);
    this._camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this._controlsModule.target.set(0, 0, 0);
    this._controlsModule.update();

    this._loopFn = () => {
      this._controlsModule.update();
      this._renderer.render(this._scene, this._camera);
    };
    this._renderer.setAnimationLoop(this._loopFn);
    this.requestUpdate();
  }

  _fail(err) {
    this._loadFailed = true;
    console.error("model-viewer failed:", err);
    this.requestUpdate();
  }

  _clearModel() {
    if (!this._root) return;
    this._root.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      const materials = Array.isArray(obj.material)
        ? obj.material
        : obj.material
        ? [obj.material]
        : [];
      for (const material of materials) material.dispose();
    });
    this._root.removeFromParent();
    this._root = null;
  }

  /**
   * Render every standard view to a 1024² PNG blob. Pauses the interactive
   * loop while exporting and restores the canvas size afterwards.
   * Resolves null when a model is not loaded yet.
   */
  async exportViews(size = EXPORT_SIZE) {
    if (!this._renderer || !this._bbox || !this._root) return null;
    const { renderer, camera, _controlsModule: controls, scene } = this;
    const canvas = renderer.domElement;
    const prevWidth = canvas.width;
    const prevHeight = canvas.height;
    const prevLoop = this._loopFn;
    renderer.setAnimationLoop(null);
    renderer.setSize(size, size, true);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    const views = [];
    try {
      for (const view of VIEW_SPECS) {
        const pose = viewCameraPose(
          this._bbox,
          view,
          MARGIN,
          (FOV_DEG * Math.PI) / 180,
        );
        camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        controls.target.set(pose.target.x, pose.target.y, pose.target.z);
        controls.update();
        renderer.render(scene, camera);
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("canvas export failed"))),
            "image/png",
          );
        });
        views.push({ view, blob });
      }
    } finally {
      renderer.setSize(prevWidth, prevHeight, true);
      camera.aspect = prevWidth / prevHeight || 1;
      camera.updateProjectionMatrix();
      if (prevLoop) renderer.setAnimationLoop(prevLoop);
    }
    this.dispatchEvent(
      new CustomEvent("model-views-exported", {
        detail: { views },
        bubbles: true,
        composed: true,
      }),
    );
    return views;
  }

  render() {
    const failed = this._loadFailed;
    const loading = this.src && !this._root && !failed;
    return html`
      <div class="viewer-wrap" style="height:${this.height}px;">
        <canvas width="800" height="400"></canvas>
        ${failed
          ? html`<div class="viewer-status viewer-error">
                3D preview failed to load in this browser
              </div>`
          : loading
          ? html`<div class="viewer-status">Loading model…</div>`
          : html`<div class="viewer-status">drag to rotate · scroll to
              zoom</div>`}
      </div>
    `;
  }
}

customElements.define("model-viewer", ModelViewer);
