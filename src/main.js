import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const button = document.getElementById('enter-ar');
const statusEl = document.getElementById('status');
const setStatus = (msg) => { statusEl.textContent = msg; };

// --- Renderer / scene ------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 20);
camera.position.set(0, 0, 0.6);

// Simple light. The bronze is metallic 1.0, which looks almost black under
// direct lights alone, so add a small PMREM room environment as well (README).
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(0.5, 1, 0.8);
scene.add(sun);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

// --- Gauntlet --------------------------------------------------------------
// `anchor` receives the raw wrist-joint matrix each frame. The glove is its
// child, rotated 180° about (0, 1, -1)/√2 so that (README "Axis convention"):
//   glove +Y (fingers) -> joint -Z,  glove -Z (back) -> joint +Y,  glove -X (thumb) -> joint +X
// The glove origin is the wrist attachment point, so no offset is needed.
const anchor = new THREE.Group();
anchor.matrixAutoUpdate = false;
scene.add(anchor);

const WRIST_CORRECTION = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 1, -1).normalize(), Math.PI);

let gauntlet = null;
new GLTFLoader().load(
  'assets/models/gauntlet.glb',
  (gltf) => {
    gauntlet = gltf.scene;
    gauntlet.quaternion.copy(WRIST_CORRECTION);
    anchor.add(gauntlet);
    checkSupport();
  },
  undefined,
  (err) => {
    console.error(err);
    setStatus('Could not load assets/models/gauntlet.glb.');
  }
);

// --- Hand tracking ---------------------------------------------------------
// three.js only draws hand meshes if you attach an XRHandModelFactory model to
// renderer.xr.getHand(i). We don't, and hide the hand groups just in case.
for (let i = 0; i < 2; i++) renderer.xr.getHand(i).visible = false;

function findLeftHand(session) {
  for (const source of session.inputSources) {
    if (source.hand && source.handedness === 'left') return source.hand;
  }
  return null;
}

// Desktop / pre-AR preview: glove upright in front of the camera.
const previewMatrix = new THREE.Matrix4();
const previewEuler = new THREE.Euler();
const previewQuat = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);
const PREVIEW_POS = new THREE.Vector3(0, -0.05, 0);

renderer.setAnimationLoop((time, frame) => {
  if (frame) {
    const refSpace = renderer.xr.getReferenceSpace();
    const hand = findLeftHand(frame.session);
    const wrist = hand && hand.get('wrist');
    const pose = wrist && frame.getJointPose(wrist, refSpace);
    if (pose) {
      anchor.matrix.fromArray(pose.transform.matrix);
      anchor.matrixWorldNeedsUpdate = true;
      anchor.visible = true;
    } else {
      anchor.visible = false; // left hand not tracked this frame
    }
  } else {
    // Undo the wrist correction so the preview shows fingers up, back to the viewer, then spin.
    previewEuler.set(0, time * 0.0005, 0);
    previewQuat.setFromEuler(previewEuler).multiply(WRIST_CORRECTION.clone().invert());
    anchor.matrix.copy(previewMatrix.compose(PREVIEW_POS, previewQuat, ONE));
    anchor.matrixWorldNeedsUpdate = true;
    anchor.visible = true;
  }
  renderer.render(scene, camera);
});

// --- Enter AR --------------------------------------------------------------
async function checkSupport() {
  if (!window.isSecureContext) {
    setStatus('WebXR needs HTTPS (or localhost). Open this page over https://.');
    return;
  }
  if (!('xr' in navigator)) {
    setStatus('WebXR is not supported in this browser. Try the Meta Quest Browser or Chrome on Android.');
    return;
  }
  let arSupported = false;
  try {
    arSupported = await navigator.xr.isSessionSupported('immersive-ar');
  } catch (e) {
    console.warn(e);
  }
  if (!arSupported) {
    setStatus('WebXR is available, but immersive-ar is not supported on this device/browser.');
    return;
  }
  button.disabled = false;
  setStatus('Ready. Enter AR, then show your left hand (hand tracking, no controllers).');
}

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      optionalFeatures: ['hand-tracking', 'local-floor'],
    });

    // 'local-floor' is optional; fall back to 'local' if it wasn't granted.
    try {
      await session.requestReferenceSpace('local-floor');
      renderer.xr.setReferenceSpaceType('local-floor');
    } catch {
      renderer.xr.setReferenceSpaceType('local');
    }

    session.addEventListener('end', () => {
      button.disabled = false;
      button.textContent = 'Enter AR';
      setStatus('AR session ended.');
    });

    await renderer.xr.setSession(session);
    button.textContent = 'In AR…';
    setStatus('In AR. Show your left hand.');
  } catch (err) {
    console.error(err);
    button.disabled = false;
    setStatus(`Could not start AR: ${err.message || err}`);
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
