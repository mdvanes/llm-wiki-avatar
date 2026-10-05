import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { type VRM, VRMLoaderPlugin, VRMLookAtBoneApplier, VRMUtils } from '@pixiv/three-vrm';
import type { AvatarFrame } from '@/hooks/useAvatarDriver';
import { MORPHS, type RigBone, boneRotations, gaze, morphWeights } from '@/lib/vrm/rig';

/** Head and shoulders: the part of the model to fit in view, in model metres above the floor. */
const FRAME_BOTTOM = 1.24;
const FRAME_TOP = 1.8;
const FOV = 22;

/** Draws a VRM model with WebGL and poses it per frame from the shared face pose and mouth shape. */
export class VrmRenderer {
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 20);
  readonly #environment: THREE.Texture;
  readonly #resize: ResizeObserver;
  #vrm: VRM | null = null;
  #morphs = new Map<string, [THREE.Mesh, number][]>();
  #gazeRange = { x: 90, y: 90 };
  /** VRM 0.x models face -Z in their own space, which mirrors the X and Z rotations of normalized bones. */
  #mirror = 1;
  #disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.#renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.#renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#renderer.toneMapping = THREE.NeutralToneMapping;

    // The model uses PBR materials, which look flat without an environment to reflect.
    const pmrem = new THREE.PMREMGenerator(this.#renderer);
    this.#environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.#scene.environment = this.#environment;
    this.#scene.environmentIntensity = 0.5;

    const key = new THREE.DirectionalLight(0xfff4e8, 1.8);
    key.position.set(-1, 2, 2.5);
    const fill = new THREE.DirectionalLight(0xe8f0ff, 0.6);
    fill.position.set(1.5, 1.2, 1.5);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9);
    rim.position.set(0, 2, -2);
    this.#scene.add(key, fill, rim, new THREE.HemisphereLight(0xffffff, 0x404040, 0.6));

    this.#resize = new ResizeObserver(() => this.#fit(canvas));
    this.#resize.observe(canvas);
    this.#fit(canvas);
  }

  async load(url: string): Promise<void> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (this.#disposed || !vrm) {
      VRMUtils.deepDispose(gltf.scene);
      if (!vrm) throw new Error(`${url} is not a VRM model`);
      return;
    }
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm);

    const names = new Set<string>(MORPHS);
    vrm.scene.traverse((obj) => {
      // Skinned meshes move away from their bind-pose bounds, which would cull them wrongly.
      obj.frustumCulled = false;
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.morphTargetDictionary) return;
      for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
        if (!names.has(name)) continue;
        const list = this.#morphs.get(name) ?? [];
        list.push([mesh, index]);
        this.#morphs.set(name, list);
      }
    });

    if (vrm.lookAt) {
      vrm.lookAt.autoUpdate = false;
      const applier = vrm.lookAt.applier;
      if (applier instanceof VRMLookAtBoneApplier) {
        this.#gazeRange = {
          x: applier.rangeMapHorizontalOuter.inputMaxValue,
          y: applier.rangeMapVerticalUp.inputMaxValue,
        };
      }
    }

    this.#scene.add(vrm.scene);
    this.#mirror = vrm.meta.metaVersion === '0' ? -1 : 1;
    this.#vrm = vrm;
  }

  draw({ pose, shape }: AvatarFrame, dtMs: number): void {
    const vrm = this.#vrm;
    if (!vrm) return;
    const m = this.#mirror;
    for (const [bone, [x, y, z]] of Object.entries(boneRotations(pose))) {
      vrm.humanoid.getNormalizedBoneNode(bone as RigBone)?.rotation.set(m * x, y, m * z);
    }
    if (vrm.lookAt) {
      const g = gaze(pose);
      vrm.lookAt.yaw = g.x * this.#gazeRange.x;
      vrm.lookAt.pitch = g.y * this.#gazeRange.y;
    }
    vrm.update(dtMs / 1000);
    // After vrm.update(): its expressions reset the morphs they are bound to.
    for (const [name, weight] of Object.entries(morphWeights(pose, shape))) {
      for (const [mesh, index] of this.#morphs.get(name) ?? []) mesh.morphTargetInfluences![index] = weight;
    }
    this.#renderer.render(this.#scene, this.#camera);
  }

  dispose(): void {
    this.#disposed = true;
    this.#resize.disconnect();
    if (this.#vrm) VRMUtils.deepDispose(this.#vrm.scene);
    this.#vrm = null;
    this.#environment.dispose();
    this.#renderer.dispose();
  }

  #fit(canvas: HTMLCanvasElement): void {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    this.#renderer.setSize(width, height, false);
    const camera = this.#camera;
    camera.aspect = width / height;
    // Fit the frame's height, or its width in a narrow panel, so the shoulders stay in view.
    const halfTan = Math.tan((FOV / 2) * (Math.PI / 180));
    const frameHeight = FRAME_TOP - FRAME_BOTTOM;
    const frameWidth = 0.5;
    const distance = Math.max(frameHeight / (2 * halfTan), frameWidth / (2 * halfTan * camera.aspect));
    const centre = (FRAME_TOP + FRAME_BOTTOM) / 2;
    camera.position.set(0, centre + 0.02, distance);
    camera.lookAt(0, centre, 0);
    camera.updateProjectionMatrix();
  }
}
