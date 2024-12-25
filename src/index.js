import * as THREE from 'three';

import { OrbitControls } from '../node_modules/three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';

// Init scene, camera and renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

camera.position.set(30, 30, 30);
scene.fog = new THREE.Fog(0xffffff, 0.01);

// Axis helper
const axesHelper = new THREE.AxesHelper(100);
//scene.add(axesHelper);

// Asset Loader
const assetLoader = new GLTFLoader();
assetLoader.load("../models/lighthouse_on_a_sea_rock.glb", function(gltf){
  const model = gltf.scene;
  model.scale.set(0.1, 0.1, 0.1);
  model.position.y = 6;
  model.castShadow = true;
  model.receiveShadow = true;

  scene.add(model);
});


// Add OrbitControls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // Adds smooth movement
controls.dampingFactor = 0.05;
controls.target.set(0, 0, 0); // Set focus target
controls.update();

// Ambient Light
const Ambientlight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(Ambientlight);

// Directional Light
const light = new THREE.DirectionalLight(0xffffff, 1.5);
light.position.set(-100, 30, -100);
scene.add(light);
light.castShadow = true;

const dLightHelper = new THREE.DirectionalLightHelper(light);
//scene.add(dLightHelper);

// Skybox
const loader = new THREE.CubeTextureLoader();
const skyboxTexture = loader.load([
  '../skybox/side_3.png', // Positive X
  '../skybox/side_1.png', // Negative X
  '../skybox/top.png', // Positive Y
  '../skybox/floor.png', // Negative Y
  '../skybox/side_2.png', // Positive Z
  '../skybox/side_4.png', // Negative Z
]);
scene.background = skyboxTexture;

// Water
const waterGeometry = new THREE.PlaneGeometry(200, 200, 500, 500);
const waterMaterial = new THREE.ShaderMaterial({
  vertexShader: `
    uniform float time;
    varying vec2 vUv;
    varying vec3 vPosition;

    // Simple pseudo-random function
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
    vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
    vec3 fade(vec3 t) {return t*t*t*(t*(t*6.0-15.0)+10.0);}

    // Smooth noise function
    // Walahi ma chatgpt
    float noise(vec3 P){
        vec3 Pi0 = floor(P); // Integer part for indexing
        vec3 Pi1 = Pi0 + vec3(1.0); // Integer part + 1
        Pi0 = mod(Pi0, 289.0);
        Pi1 = mod(Pi1, 289.0);
        vec3 Pf0 = fract(P); // Fractional part for interpolation
        vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0
        vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
        vec4 iy = vec4(Pi0.yy, Pi1.yy);
        vec4 iz0 = Pi0.zzzz;
        vec4 iz1 = Pi1.zzzz;

        vec4 ixy = permute(permute(ix) + iy);
        vec4 ixy0 = permute(ixy + iz0);
        vec4 ixy1 = permute(ixy + iz1);

        vec4 gx0 = ixy0 / 7.0;
        vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
        gx0 = fract(gx0);
        vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
        vec4 sz0 = step(gz0, vec4(0.0));
        gx0 -= sz0 * (step(0.0, gx0) - 0.5);
        gy0 -= sz0 * (step(0.0, gy0) - 0.5);

        vec4 gx1 = ixy1 / 7.0;
        vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
        gx1 = fract(gx1);
        vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
        vec4 sz1 = step(gz1, vec4(0.0));
        gx1 -= sz1 * (step(0.0, gx1) - 0.5);
        gy1 -= sz1 * (step(0.0, gy1) - 0.5);

        vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
        vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
        vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
        vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
        vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
        vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
        vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
        vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

        vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
        g000 *= norm0.x;
        g010 *= norm0.y;
        g100 *= norm0.z;
        g110 *= norm0.w;
        vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
        g001 *= norm1.x;
        g011 *= norm1.y;
        g101 *= norm1.z;
        g111 *= norm1.w;

        float n000 = dot(g000, Pf0);
        float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
        float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
        float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
        float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
        float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
        float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
        float n111 = dot(g111, Pf1);

        vec3 fade_xyz = fade(Pf0);
        vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
        vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
        float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x); 
        return 2.2 * n_xyz;
    }

    void main() {
        vUv = uv;

        vec3 pos = position;

        // Add noise-based waves for natural randomness
        float wave1 = sin(pos.x * 1.5 + time) * 0.2;
        float wave2 = sin(pos.y * 2.0 + time * 1.2) * 0.05;
        float wave3 = noise(vec3(pos.xy * 3.0 + time * 0.5, 1.0)) * 0.3;

        pos.z += (wave1 + wave2 + wave3) * 0.45;

        vPosition = pos;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: `
    uniform float time;
    uniform samplerCube skybox;
    varying vec2 vUv;
    varying vec3 vPosition;

    void main() {
        // Simulated water color for depth
        vec3 shallowColor = vec3(0.0, 0.7, 0.9); // Bright turquoise
        vec3 deepColor = vec3(0.0, 0.2, 0.5);    // Deep ocean blue

        // Blend color based on "depth" (vUv.y gives a sense of vertical position)
        vec3 baseWaterColor = mix(shallowColor, deepColor, vUv.y);

        // Simulate reflections using the skybox
        vec3 reflected = reflect(vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0)); // Simplified normal
        vec3 reflection = textureCube(skybox, reflected).rgb;

        // Blend reflection with base water color
        vec3 waterColor = mix(baseWaterColor, reflection, 0.5); // Adjust reflection strength

        // Add highlights for wave peaks
        float highlight = pow(abs(vUv.y - 0.5), 8.0); // Tweak highlight sharpness
        waterColor += vec3(1.0, 1.0, 1.0) * highlight * 0.1; // Reduce highlight intensity

        waterColor = mix(0.3, 0.8, vPosition.z) * vec3(0.2,0.4,0.9) + reflection;

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
water.castShadow = true;
water.receiveShadow = true;
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
