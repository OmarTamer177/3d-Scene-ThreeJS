import './style.css'
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {Water} from 'three/examples/jsm/objects/Water.js';
import {Sky} from 'three/examples/jsm/objects/Sky.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader';

let camera, scene, renderer;
let controls, water, sun;
let startTime = Date.now();

const loader = new GLTFLoader();

function random(min, max) {
  return Math.random() * (max-min) + min;
}

let view = 1;

class Player {
  constructor() {
    loader.load('assets/ship/ship.glb', (ship) => {
      // Find safe spawn position
      let safeX = 0, safeZ = 0;
      let isSafe = false;
      
      while (!isSafe) {
        safeX = random(-200, 200);
        safeZ = random(-200, 200);
        isSafe = true;
        for (const island of islands) {
          if (island.checkCollision(safeX, safeZ)) {
            isSafe = false;
            break;
          }
        }
      }

      scene.add(ship.scene);
      ship.scene.position.set(safeX, -2, safeZ);
      
      // Reduced scale from 5 to 2
      ship.scene.scale.set(2, 2, 2);

    
      
      // Rotate 90 degrees to align with forward direction
      ship.scene.rotation.y = Math.PI / 2;
      ship.scene.rotation.x = 0.05;
      ship.scene.rotation.z = 0;
      
      // Process all meshes in the ship model
      ship.scene.traverse((child) => {
        if (child.isMesh) {
          // Check if this is the unwanted plane (usually has a very simple geometry)
          const isPlane = child.geometry.attributes.position.count === 4; // Planes typically have 4 vertices
          
          if (isPlane) {
            // Either hide the plane
            child.visible = false;
            // Or remove it entirely
            child.parent.remove(child);
          } else {
            // Normal mesh processing
            child.castShadow = true;
            child.receiveShadow = false;
            
            if (child.material) {
              child.material.emissive = new THREE.Color(0x222222);
              child.material.emissiveIntensity = 0.2;
              // Make sure materials are properly rendered from both sides
              child.material.side = THREE.DoubleSide;
            }
          }
        }
      });

      this.player = ship.scene;
      this.speed = {
        velocity: 0,
        rotation: 0,
        bobOffset: 0,
        pitchOffset: 0
      }
    });
  }

  stop(key) {
    if(key=="w" || key=="s" || key=="W" || key=="S") {
      this.speed.velocity = 0;
    }
    if(key=="a" || key=="d" || key=="A" || key=="D") {
      this.speed.rotation = 0;
    }
  }

  update() {
    if(this.player) {
      // Store current position
      const oldX = this.player.position.x;
      const oldZ = this.player.position.z;

      // Update rotation
      this.player.rotation.y += this.speed.rotation;

      // Add wave motion effects
      this.speed.bobOffset += 0.02;
      this.speed.pitchOffset += 0.015;
      
      // Vertical bob
      const bobHeight = Math.sin(this.speed.bobOffset) * 0.3;
      // Pitch (forward/back tilt)
      const pitchAngle = Math.sin(this.speed.pitchOffset) * 0.02;
      
      // Apply wave motion
      this.player.position.y = -2 + bobHeight;
      this.player.rotation.x = 0.05 + pitchAngle;

      // Calculate forward direction based on ship's rotation
      const direction = new THREE.Vector3(1, 0, 0);
      direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.rotation.y);
      
      // Move in the calculated direction
      this.player.position.x += direction.x * this.speed.velocity;
      this.player.position.z += direction.z * this.speed.velocity;

      // Check collisions
      let collision = false;
      for(const island of islands) {
        if(island.checkCollision(this.player.position.x, this.player.position.z)) {
          collision = true;
          break;
        }
      }

      // If collision, revert position
      if(collision) {
        this.player.position.x = oldX;
        this.player.position.z = oldZ;
      }
    }
  }
}

class Island {
  constructor(x, z) {
    this.position = { x, z };
    this.radius = 100;
    this.treasureSpots = [];
    
    // Create beach base with random size variation and slight elevation
    const beachRadius = 110 + random(-10, 10);
    const beachGeometry = new THREE.CircleGeometry(beachRadius, 32);
    const beachMaterial = new THREE.MeshStandardMaterial({
      color: 0xf2d16b,
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.DoubleSide // Make beach visible from both sides
    });
    
    const beach = new THREE.Mesh(beachGeometry, beachMaterial);
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(x, 0.1, z); // Slight elevation to prevent z-fighting
    beach.receiveShadow = true;
    scene.add(beach);

    // Randomly choose island type
    const islandType = Math.floor(random(0, 4)); // 0: normal, 1: tall, 2: wide, 3: volcanic
    const baseHeight = islandType === 1 ? 60 : islandType === 3 ? 70 : 40;
    const baseRadius = islandType === 2 ? 120 : 100;
    const segments = islandType === 3 ? 16 : 32;

    // Create main island using ConeGeometry as base
    const mainGeometry = new THREE.ConeGeometry(baseRadius, baseHeight, segments, 4);
    
    // Modify vertices to create irregular terrain
    const vertices = mainGeometry.attributes.position.array;
    for(let i = 0; i < vertices.length; i += 3) {
      const vx = vertices[i];
      const vy = vertices[i + 1];
      const vz = vertices[i + 2];
      
      // Add height variation based on island type
      const distance = Math.sqrt(vx * vx + vz * vz) / baseRadius;
      let heightVariation = Math.sin(vx * 0.2) * Math.cos(vz * 0.2) * 15;
      
      if(islandType === 3) { // Volcanic
        heightVariation *= (1 - Math.pow(distance, 0.5)) * 2;
        if(distance < 0.2) { // Create crater
          heightVariation -= 20;
        }
      } else if(islandType === 2) { // Wide
        heightVariation *= (1 - Math.pow(distance, 2));
      } else {
        heightVariation *= (1 - distance);
      }
      
      vertices[i + 1] = vy + heightVariation;
      
      // Store potential treasure spots - increased probability
      if (vy > baseHeight * 0.2 && vy < baseHeight * 0.7 && Math.random() > 0.8) {
        this.treasureSpots.push({
          x: vx + x,
          y: vy + 2,
          z: vz + z
        });
      }
    }

    mainGeometry.computeVertexNormals();

    // Create material based on island type
    const mainMaterial = new THREE.MeshStandardMaterial({
      color: islandType === 3 ? 0x4a4a4a : 0x2d5a27,
      roughness: 0.8,
      metalness: 0.2,
      flatShading: true
    });

    const mainMesh = new THREE.Mesh(mainGeometry, mainMaterial);
    mainMesh.position.set(x, 20, z);
    mainMesh.castShadow = true;
    mainMesh.receiveShadow = true;
    scene.add(mainMesh);
    this.island = mainMesh;

    // Add random peaks except for volcanic type
    if(islandType !== 3) {
      const numPeaks = Math.floor(random(2, 5));
      for(let i = 0; i < numPeaks; i++) {
        const peakHeight = random(15, 25);
        const peakRadius = random(8, 12);
        const peakGeometry = new THREE.ConeGeometry(peakRadius, peakHeight, 4);
        const peakMaterial = new THREE.MeshStandardMaterial({
          color: 0x4a4a4a,
          roughness: 0.9,
          metalness: 0.2,
          flatShading: true
        });
        
        const peak = new THREE.Mesh(peakGeometry, peakMaterial);
        const angle = Math.random() * Math.PI * 2;
        const radius = random(20, 60);
        peak.position.set(
          x + Math.cos(angle) * radius,
          30 + random(-5, 5),
          z + Math.sin(angle) * radius
        );
        peak.castShadow = true;
        peak.receiveShadow = true;
        scene.add(peak);
      }
    }

    // Add vegetation (small cones for trees)
    const numTrees = Math.floor(random(5, 10));
    for(let i = 0; i < numTrees; i++) {
      const treeGeometry = new THREE.ConeGeometry(5, 15, 4);
      const treeMaterial = new THREE.MeshStandardMaterial({
        color: 0x1a472a,
        roughness: 0.9,
        metalness: 0.1,
        flatShading: true
      });
      
      const tree = new THREE.Mesh(treeGeometry, treeMaterial);
      const angle = Math.random() * Math.PI * 2;
      const radius = random(30, 70);
      tree.position.set(
        x + Math.cos(angle) * radius,
        25,
        z + Math.sin(angle) * radius
      );
      tree.castShadow = true;
      scene.add(tree);
    }
  }

  checkCollision(playerX, playerZ) {
    const dx = this.position.x - playerX;
    const dz = this.position.z - playerZ;
    const distance = Math.sqrt(dx * dx + dz * dz);
    return distance < this.radius * 0.8;
  }

  getRandomTreasureSpot() {
    if(this.treasureSpots.length === 0) return null;
    const spot = this.treasureSpots[Math.floor(Math.random() * this.treasureSpots.length)];
    console.log('Selected treasure spot:', spot); // Debug log
    return spot;
  }
}

class Treasure {
  constructor() {
    if(islands.length === 0) {
      console.log('No islands available for treasure placement');
      return;
    }
    
    // Pick random island and treasure spot
    const island = islands[Math.floor(Math.random() * islands.length)];
    const spot = island.getRandomTreasureSpot();
    
    if(spot) {
      console.log('Creating treasure at:', spot); // Debug log
      loader.load('assets/treasure/scene.gltf', (box) => {
        scene.add(box.scene);
        box.scene.position.set(spot.x, spot.y, spot.z);
        box.scene.scale.set(0.1, 0.1, 0.1);
        // Rotate treasure chest to face upright
        box.scene.rotation.x = 0;
        box.scene.rotation.y = Math.random() * Math.PI * 2; // Random rotation
        this.treasure = box.scene;
        console.log('Treasure placed successfully'); // Debug log
      });
    } else {
      console.log('No valid treasure spot found on selected island');
    }
  }
}

const player = new Player();
let treasures = [];
let islands = [];

function generateIslands() {
  islands = [];
  const spacing = 400;
  const gridSize = 2;
  
  for(let i = -gridSize; i <= gridSize; i++) {
    for(let j = -gridSize; j <= gridSize; j++) {
      if(Math.random() > 0.3) {
        const x = i * spacing + random(-50, 50);
        const z = j * spacing + random(-50, 50);
        const island = new Island(x, z);
        islands.push(island);
      }
    }
  }
}

function spawnTreasures() {
  if(treasures.length < 20) {
    const newTreasure = new Treasure();
    treasures.push(newTreasure);
  }
}

init();
animate();

function init() {
  renderer = new THREE.WebGLRenderer({ 
    antialias: true,
    logarithmicDepthBuffer: true // Help with z-fighting
  });
  renderer.setPixelRatio( window.devicePixelRatio );
  renderer.setSize( window.innerWidth, window.innerHeight );
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild( renderer.domElement );

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera( 55, window.innerWidth / window.innerHeight, 1, 20000 );
  camera.position.set( 30, 48, 100 );
  //camera.lookAt(player.position.x, 0, player.position.z);
  //camera.lookAt(player.player.position);

  sun = new THREE.Vector3();

  // Water

  const waterGeometry = new THREE.PlaneGeometry(10000, 10000);

  water = new Water(
    waterGeometry,
    {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: new THREE.TextureLoader().load('assets/waternormals.jpg', function(texture) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(10, 10); // Increase wave pattern repetition
      }),
      sunDirection: new THREE.Vector3(),
      sunColor: 0xffffff,
      waterColor: 0x0088ff, // Brighter, more cartoon-like blue
      distortionScale: 8.0,  // Increased wave distortion
      fog: scene.fog !== undefined,
      alpha: 0.9, // Slight transparency
      side: THREE.DoubleSide
    }
  );

  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;

  // Add custom uniforms to make waves more pronounced
  water.material.uniforms.size = { value: 8.0 };
  water.material.uniforms.distortionScale.value = 8.0;
  water.material.transparent = true;

  scene.add( water );

  // Skybox

  const sky = new Sky();
  sky.scale.setScalar( 10000 );
  scene.add( sky );

  const skyUniforms = sky.material.uniforms;

  skyUniforms[ 'turbidity' ].value = 2;
  skyUniforms[ 'rayleigh' ].value = 1;
  skyUniforms[ 'mieCoefficient' ].value = 0.005;
  skyUniforms[ 'mieDirectionalG' ].value = 0.7;

  const parameters = {
    elevation: 5,
    azimuth: 160
  };

  const pmremGenerator = new THREE.PMREMGenerator( renderer );

  function updateSun() {
    const phi = THREE.MathUtils.degToRad( 90 - parameters.elevation );
    const theta = THREE.MathUtils.degToRad( parameters.azimuth );

    sun.setFromSphericalCoords( 1, phi, theta );

    sky.material.uniforms[ 'sunPosition' ].value.copy( sun );
    water.material.uniforms[ 'sunDirection' ].value.copy( sun ).normalize();

    scene.environment = pmremGenerator.fromScene( sky ).texture;
  }

  updateSun();

  controls = new OrbitControls( camera, renderer.domElement );
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set( 0, 10, 0 );
  controls.minDistance = 40.0;
  controls.maxDistance = 200.0;
  controls.update();

  // GUI

  const waterUniforms = water.material.uniforms;

  addLighting();
  generateIslands();
  
  setTimeout(() => {
    for(let i = 0; i < 10; i++) {
      treasures.push(new Treasure());
    }
  }, 1000);

  window.addEventListener('keydown', function(e) {
    if(e.key=="w" || e.key=="W") player.speed.velocity = 1;
    if(e.key=="s" || e.key=="S") player.speed.velocity = -1;
    if(e.key=="a" || e.key=="A") player.speed.rotation = 0.01;
    if(e.key=="d" || e.key=="D") player.speed.rotation = -0.01;
    if(e.key=="2") {
      view = 1;
      document.getElementById('viewMode').textContent = 'Follow Camera';
    }
    if(e.key=="3") {
      view = 2;
      document.getElementById('viewMode').textContent = 'Top View';
    }
  });

  window.addEventListener('keyup', function(e) {
    player.stop(e.key);
  });

  window.addEventListener('resize', onWindowResize);

  // Enable shadows in renderer
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.soft = true;
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function cameraSetter() {
  if(player.player) {
    if(view==1) {
      camera.position.set(player.player.position.x+32, 40, player.player.position.z+130)
      camera.lookAt(player.player.position)
    }
    else if(view==2) {
      camera.position.set(player.player.position.x, 600, player.player.position.z)
      camera.lookAt(player.player.position)
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  render();
  player.update();
  cameraSetter();
  
  if(Date.now() - startTime > 5000) {
    spawnTreasures();
    startTime = Date.now();
  }
}

function render() {
  water.material.uniforms['time'].value += 1.0 / 30.0;
  renderer.render(scene, camera);
}

function addLighting() {
  // Brighter ambient light with warmer tone
  const ambientLight = new THREE.AmbientLight(0xfff2e6, 0.5); // Warmer color, increased intensity

  // Main directional light (sunlight) with warmer tone
  const dirLight = new THREE.DirectionalLight(0xffd7b5, 1.0); // Warmer color, increased intensity
  dirLight.position.set(100, 100, 50);
  
  // Reduce shadow darkness
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 500;
  dirLight.shadow.camera.left = -200;
  dirLight.shadow.camera.right = 200;
  dirLight.shadow.camera.top = 200;
  dirLight.shadow.camera.bottom = -200;
  dirLight.shadow.bias = -0.001; // Reduce shadow artifacts
  
  scene.add(dirLight);

  // Warmer hemisphere light
  const hemiLight = new THREE.HemisphereLight(0xffeeb1, 0x080820, 0.6);
  scene.add(hemiLight);
}