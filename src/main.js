import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import "./style.css"

// scene
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b1020, 10, 80);

// camera
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.5, 100);
camera.position.set(0, 10, 40);
camera.rotation.set(
  THREE.MathUtils.degToRad(-10),
  0,
  0
)
// camera.lookAt(0, 0, -25)

// renderer
const canvas = document.getElementById('base');
const renderer = new THREE.WebGLRenderer({ canvas:canvas, antialias:true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0xacd2ed);

// lights
scene.add(new THREE.AmbientLight(0xffffff, 1));
const dLight = new THREE.DirectionalLight(0xffffff, 1.0);
dLight.position.set(0, 10, 50) 
scene.add(dLight);
scene.add(new THREE.HemisphereLight(0xacd2ed, 0xdfe9ff, 1.0));

// ground: base terrain + snow
const WORLD_SIZE = 128;
const GRID = 256;
const VERTS = (GRID + 1) * (GRID + 1);

const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GRID, GRID);
groundGeo.rotateX(-Math.PI / 2);

const ground = new THREE.Mesh(
  groundGeo,
  new THREE.MeshStandardMaterial({ color: 0xdfe9ff, roughness: 1})
);
// ground.rotation.x = -Math.PI / 2;
ground.rotation.y = 0;
scene.add(ground);

const baseMap = new Float32Array(VERTS);
const snowMap = new Float32Array(VERTS);
const posAttr = groundGeo.attributes.position;

// simplex fBm (multiple octaves)
const noise2d = createNoise2D(); // optionally seed it if you want repeatability

function fbmSimplex(x, z , {
  scale = 0.08,
  octaves = 5,
  lacunarity = 2.0,
  gain = 0.5
} = {}) {
  let amp = 1.0;
  let freq = 1.0;
  let sum = 0.0;
  let norm = 0.5;

  for (let o = 0; o < octaves; o++) {
    // simplex gives ~[-1, 1]
    const n = noise2d(x * scale * freq, z * scale * freq);
    sum += n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  return sum / norm; // ~[-1, 1]
}

function buildBaseTerrain() {
  const hillHeight = 2.5;
  const hillScale = 0.09;

  for (let i = 0; i < VERTS; i++){
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);

    const n = fbmSimplex(x, z, {scale: hillScale, octaves: 5});
    // optional shaping so it look more like rolling hills than jagged noise:
    const shaped = Math.sign(n) * Math.pow(Math.abs(n), 1.25);

    baseMap[i] = shaped * hillHeight;
  }
}

function applyGround() {
  for (let i = 0; i < VERTS; i++) {
    posAttr.setY(i, baseMap[i] + snowMap[i]);
  }

  posAttr.needsUpdate = true;
  groundGeo.computeVertexNormals();
}

function cellIndexFromXZ(x, z) {
  const half = WORLD_SIZE / 2;
  const u = (x + half) / WORLD_SIZE;
  const v = (z - half) /WORLD_SIZE;

  const ix = Math.max(0, Math.min(GRID, Math.round(u * GRID)));
  const iz = Math.max(0, Math.min(GRID, Math.round(v * GRID)));

  return iz * (GRID +1) + ix;
}

function groudHeightAtXZ(x, z) {
  const idx = cellIndexFromXZ(x, z);
  return baseMap[idx] + snowMap[idx];
}

buildBaseTerrain();
applyGround();

// snow: InstancedMesh + deposit into snowMap
const FLAKES  = 5000;
const SPAWN_Y = 18;
const MIN_Y   = -8;

const flakeGeo = new THREE.SphereGeometry(0.03, 6, 6);
const flakeMat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 1});

const snow = new THREE.InstancedMesh(flakeGeo, flakeMat, FLAKES);
snow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(snow);

const flake = {
  x: new Float32Array(FLAKES),
  y: new Float32Array(FLAKES),
  z: new Float32Array(FLAKES),
  vy: new Float32Array(FLAKES),
  drift: new Float32Array(FLAKES),
}

function resetFlake(i) {
  flake.x[i] = (Math.random() - 0.5) * WORLD_SIZE;
  flake.z[i] = (Math.random() - 0.5) * WORLD_SIZE;
  flake.y[i] = SPAWN_Y + Math.random() * 10;
  flake.vy[i] = -Math.random() * 0.3;
  flake.drift[i] = (Math.random() * 2 - 1) * 0.35;
}

for (let i = 0; i < FLAKES; i++) {
  flake.x[i] = (Math.random() - 0.5) * WORLD_SIZE;
  flake.z[i] = (Math.random() - 0.5) * WORLD_SIZE;
  flake.y[i] = SPAWN_Y + Math.random() * 50;
  flake.vy[i] = -Math.random() * 0.3;
  flake.drift[i] = (Math.random() * 2 - 1) * 0.35;
}

const dummy = new THREE.Object3D();
const clock = new THREE.Clock();

const g = 9.8 * 0.35;
const deposit = 0.0035;
const maxSnow = 1.2;
const spread = 0.30;

let frame = 0;

function depositSnow(idx) {
  if(snowMap[idx] >= maxSnow) return;

  const d = deposit;
  snowMap[idx] += d;

  // smooth piles by spreading some into neighbors
  const row = GRID + 1;
  const left = idx - 1, right = idx + 1, up = idx - row, down = idx + row;

  const s = d * spread;
  if (left >= 0) snowMap[left] += s;
  if (right < VERTS) snowMap[right] += s;
  if (up >= 0) snowMap[up] += s;
  if (down < VERTS) snowMap[down] += s;
}

// load and add glb to scene
const loader = new GLTFLoader();
const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/wintercabin.glb`);
gltf.scene.rotation.set(0, THREE.MathUtils.degToRad(90), 0);
gltf.scene.position.set(0, 0.1, 0);
gltf.scene.scale.set(1, 1, 1);

// animate glb
const mixer = new THREE.AnimationMixer();
let action = mixer.clipAction(gltf.animations[0], gltf.scene);
action.play();

scene.add(gltf.scene);

function animate(now) {
  requestAnimationFrame(animate)

  const dt = Math.min(clock.getDelta(), 0.33);

  for (let i = 0; i < FLAKES; i++) {
    flake.vy[i] -= g * dt;


    //wind drift + small wobble
    flake.x[i] += flake.drift[i] * dt * Math.sin((frame + i) * 0.01) * 0.002;
    flake.y[i] += flake.vy[i] *dt

    if(flake.y[i] < MIN_Y) {
      resetFlake(i);
      continue;
    }

    const gh = groudHeightAtXZ(flake.x[i], flake.z[i]);
    if(flake.y[i] <= gh + 0.02) {
      const idx = cellIndexFromXZ(flake.x[i], flake.z[i]);
      depositSnow(idx);
      resetFlake(i);
      continue;
    }

    dummy.position.set(flake.x[i], flake.y[i], flake.z[i]);
    dummy.updateMatrix();
    snow.setMatrixAt(i, dummy.matrix);
  }

  snow.instanceMatrix.needsUpdate = true;

  // update ground less often for performance
  if((frame++ % 5) === 0) applyGround();

  mixer.update(dt);
  renderer.render(scene, camera);
}

animate();

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerWidth;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const hidButton = document.getElementById("hid-container");
const card = document.getElementById("card");
const showButton = document.getElementById("show-container");

hidButton.addEventListener("click", () => {
  card.classList.toggle("hidden");
  showButton.classList.toggle("hidden");
  showButton.classList.add("notice");
  card.classList.remove("notice2")
});

showButton.addEventListener("click", () => {
  card.classList.toggle("hidden")
  showButton.classList.toggle("hidden");
  showButton.classList.remove("notice");
  card.classList.add("notice2")
});
