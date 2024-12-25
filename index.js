import * as THREE from 'three';

import { OrbitControls } from './node_modules/three/examples/jsm/controls/OrbitControls.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

camera.position.set(0, 10, 0);

// Add OrbitControls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // Adds smooth movement
controls.dampingFactor = 0.05;
controls.target.set(0, 0, 0); // Set focus target
controls.update();

// Directional Light
const light = new THREE.AmbientLight(0xffffff, 1.5);
light.position.set(10, 10, 10);
scene.add(light);

// Skybox
const loader = new THREE.CubeTextureLoader();
const skyboxTexture = loader.load([
  'skybox/side_3.png', // Positive X
  'skybox/side_1.png', // Negative X
  'skybox/top.png', // Positive Y
  'skybox/floor.png', // Negative Y
  'skybox/side_2.png', // Positive Z
  'skybox/side_4.png', // Negative Z
]);
scene.background = skyboxTexture;

// Water Shader
const waterGeometry = new THREE.PlaneGeometry(100, 100, 200, 200);

const waterMaterial = new THREE.ShaderMaterial({
  vertexShader: `
    uniform float time;
    varying vec2 vUv;

    // Simple pseudo-random function
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    // Smooth noise function
    float noise(vec2 st) {
        vec2 i = floor(st);
        vec2 f = fract(st);

        float a = random(i);
        float b = random(i + vec2(1.0, 0.0));
        float c = random(i + vec2(0.0, 1.0));
        float d = random(i + vec2(1.0, 1.0));

        vec2 u = f * f * (3.0 - 2.0 * f);

        return mix(a, b, u.x) +
               (c - a) * u.y * (1.0 - u.x) +
               (d - b) * u.x * u.y;
    }

    void main() {
        vUv = uv;

        vec3 pos = position;

        // Add noise-based waves for natural randomness
        float wave1 = sin(pos.x * 1.5 + time) * 0.2;
        float wave2 = sin(pos.y * 2.0 + time * 1.2) * 0.1;
        float wave3 = noise(pos.xy * 3.0 + time * 0.5) * 0.3;

        pos.z += wave1 + wave2 + wave3;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: `
    uniform float time;
    uniform samplerCube skybox;
    varying vec2 vUv;

    void main() {
        // Simulated water color for depth
        vec3 shallowColor = vec3(0.0, 0.7, 0.9); // Bright turquoise
        vec3 deepColor = vec3(0.0, 0.2, 0.5);    // Deep ocean blue

        // Blend color based on "depth" (vUv.y gives a sense of vertical position)
        vec3 baseWaterColor = mix(shallowColor, deepColor, vUv.y);

        // Simulate reflections using the skybox
        vec3 reflected = reflect(vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0)); // Simplified normal
        vec3 reflection = textureCube(skybox, reflected).rgb;

        // Blend reflection with base water color
        vec3 waterColor = mix(baseWaterColor, reflection, 0.5); // Adjust reflection strength

        // Add highlights for wave peaks
        float highlight = pow(1.0 - abs(vUv.y - 0.5), 8.0); // Tweak highlight sharpness
        waterColor += vec3(1.0, 1.0, 1.0) * highlight * 0.1; // Reduce highlight intensity

        gl_FragColor = vec4(waterColor, 1.0);
    }
  `,
  uniforms: {
    time: { value: 0 },
    skybox: { value: skyboxTexture },
  },
  transparent: true,
  side: THREE.DoubleSide,
});

const water = new THREE.Mesh(waterGeometry, waterMaterial);
water.rotation.x = -Math.PI / 2;
scene.add(water);

// Animate Water
function animateWater() {
  waterMaterial.uniforms.time.value += 0.02;
}

// Animation Loop
function animate() {
  requestAnimationFrame(animate);
  animateWater();
  renderer.render(scene, camera);
}

// Handle Resizing
window.addEventListener('resize', () => {
  const newWidth = window.innerWidth;
  const newHeight = window.innerHeight;

  camera.aspect = newWidth / newHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(newWidth, newHeight);
});

animate();
