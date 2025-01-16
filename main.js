// core game imports - graphics, physics, networking
import './style.css'
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {Water} from 'three/examples/jsm/objects/Water.js';
import {Sky} from 'three/examples/jsm/objects/Sky.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader';
import { Points, BufferGeometry, Float32BufferAttribute, PointsMaterial } from 'three';

// core game systems - need these for literally everything
let camera, scene, renderer;
let controls, water, sun;
let startTime = Date.now();

// multiplayer stuff - websocket connection + player tracking
let ws;
let playerName;
const otherPlayers = new Map();

// loads all our 3D models (ships, etc)
const loader = new GLTFLoader();

// combat system tracking
let killFeed = [];
const MAX_HEALTH = 100;
let activeCannonBalls = [];

// rq helper for random numbers between min/max
function random(min, max) {
  return Math.random() * (max-min) + min;
}

// tracks which camera view we're using rn
// 1 = follow cam (default), 2 = top down view
let view = 1;

// creates those floating name tags above ships
// uses canvas bc its WAY faster than 3D text
function createPlayerLabel(name) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 64;
  
  // text settings for name tags
  context.font = '32px Arial';
  context.fillStyle = 'white';
  context.textAlign = 'center';
  context.fillText(name, canvas.width/2, canvas.height/2);
  
  // convert the text to a sprite that floats above ships
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(20, 5, 1);
  
  return sprite;
}

// MAIN PLAYER CLASS - handles everything a ship can do
class Player {
  constructor(isMainPlayer = false) {
    // tracks if this is the local player or someone else
    this.isMainPlayer = isMainPlayer;
    this.health = MAX_HEALTH;
    
    // prevents cannon spam + keeps combat fair
    this.cannonCooldown = 0;
    this.cannonCooldownTime = 2000;  // 2sec between shots
    
    // setup health display for local player
    if (isMainPlayer) {
      updateHealthBar(this.health);
    }
    
    // load the ship model and set it up
    loader.load('assets/ship/ship.glb', (ship) => {
      // find a safe spot to spawn (away from islands)
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

      // add ship to game world
      scene.add(ship.scene);
      ship.scene.position.set(safeX, -2, safeZ);
      
      // scale ship to reasonable size
      ship.scene.scale.set(2, 2, 2);
      
      // rotate to face forward + slight tilt for style
      ship.scene.rotation.y = Math.PI / 2;
      ship.scene.rotation.x = 0.05;
      ship.scene.rotation.z = 0;
      
      // setup all the ship's materials + remove junk geometry
      ship.scene.traverse((child) => {
        if (child.isMesh) {
          // check if this is that annoying placeholder plane
          const isPlane = child.geometry.attributes.position.count === 4;
          
          if (isPlane) {
            // yeet the plane
            child.visible = false;
            child.parent.remove(child);
          } else {
            // setup proper shadows + materials
            child.castShadow = true;
            child.receiveShadow = false;
            
            if (child.material) {
              child.material.emissive = new THREE.Color(0x222222);
              child.material.emissiveIntensity = 0.2;
              child.material.side = THREE.DoubleSide;
            }
          }
        }
      });

      this.player = ship.scene;
      
      // add floating name tag if this is a player
      if (isMainPlayer) {
        this.nameLabel = createPlayerLabel(playerName);
        this.player.add(this.nameLabel);
        this.nameLabel.position.set(0, 60, 0);
      }
      
      // movement + physics vars
      this.speed = {
        velocity: 0,
        rotation: 0,
        bobOffset: 0,
        pitchOffset: 0
      }
    });
  }

  // handles stopping ship movement when keys are released
  stop(key) {
    // stop forward/back movement
    if(key=="w" || key=="s" || key=="W" || key=="S") {
      this.speed.velocity = 0;
    }
    // stop turning
    if(key=="a" || key=="d" || key=="A" || key=="D") {
      this.speed.rotation = 0;
    }
  }

  // main update loop for ship physics + movement
  update() {
    if(this.player) {
      // save current pos in case we need to undo movement
      const oldX = this.player.position.x;
      const oldZ = this.player.position.z;

      // handle ship rotation
      this.player.rotation.y += this.speed.rotation;

      // update wave bobbing effect
      this.speed.bobOffset += 0.02;
      this.speed.pitchOffset += 0.015;
      
      // calc how much the ship bobs up/down rn
      const bobHeight = Math.sin(this.speed.bobOffset) * 0.3;
      // calc how much the ship tilts forward/back
      const pitchAngle = Math.sin(this.speed.pitchOffset) * 0.02;
      
      // apply the wave motion to the ship
      this.player.position.y = -2 + bobHeight;
      this.player.rotation.x = 0.05 + pitchAngle;

      // figure out which way the ship is pointing rn
      const direction = new THREE.Vector3(1, 0, 0);
      direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.rotation.y);
      
      // move ship in that direction based on speed
      this.player.position.x += direction.x * this.speed.velocity;
      this.player.position.z += direction.z * this.speed.velocity;

      // check if we hit any islands
      let collision = false;
      for(const island of islands) {
        if(island.checkCollision(this.player.position.x, this.player.position.z)) {
          collision = true;
          break;
        }
      }

      // check if we hit other ships
      if (!collision && this.isMainPlayer) {
        const playerRadius = 8; // thicc hitbox for better collisions
        otherPlayers.forEach((otherPlayer) => {
          if (otherPlayer.player) {
            const dx = this.player.position.x - otherPlayer.player.position.x;
            const dz = this.player.position.z - otherPlayer.player.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            if (distance < playerRadius * 2) { // if ships are too close
              collision = true;
            }
          }
        });
      }

      // if we hit something, undo the movement
      if(collision) {
        this.player.position.x = oldX;
        this.player.position.z = oldZ;
      }
    }
  }

  // smoothly updates ship position from network data
  updateFromNetwork(position, rotation) {
    if (this.player) {
      // smoothly move to new position (no teleporting)
      this.player.position.lerp(new THREE.Vector3(
        position.x,
        position.y,
        position.z
      ), 0.3);

      // smoothly rotate to new angle
      const targetRotation = new THREE.Euler(
        rotation._x,
        rotation._y,
        rotation._z
      );
      this.player.rotation.x = THREE.MathUtils.lerp(
        this.player.rotation.x,
        targetRotation.x,
        0.3
      );
      this.player.rotation.y = THREE.MathUtils.lerp(
        this.player.rotation.y,
        targetRotation.y,
        0.3
      );
      this.player.rotation.z = THREE.MathUtils.lerp(
        this.player.rotation.z,
        targetRotation.z,
        0.3
      );
    }
  }

  // handles taking damage + updates UI
  damage(amount) {
    this.health = Math.max(0, this.health - amount);
    if (this.isMainPlayer) {
      updateHealthBar(this.health);
    }
    
    return this.health <= 0; // true if ship is sunk
  }

  // handles firing cannons from either side
  fireCannon(side) {
    if (!this.player) return;
    if (this.cannonCooldown > Date.now()) return;
    
    this.cannonCooldown = Date.now() + this.cannonCooldownTime;
    
    // add screen shake when firing
    if (this.isMainPlayer) {
      const intensity = 0.5;
      camera.position.y += Math.random() * intensity - intensity/2;
      camera.position.x += Math.random() * intensity - intensity/2;
      setTimeout(() => {
        camera.position.y -= Math.random() * intensity - intensity/2;
        camera.position.x -= Math.random() * intensity - intensity/2;
      }, 50);
    }

    // calc which direction ship is facing
    const forward = new THREE.Vector3(1, 0, 0);
    forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.rotation.y);
    
    // calc which way cannons should fire
    const sideOffset = side === 'left' ? Math.PI/2 : -Math.PI/2;
    const shootDir = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), sideOffset);
    
    // shoot multiple cannonballs in a spread pattern
    for (let i = -1; i <= 1; i++) {
      // add some randomness to shot direction
      const spread = new THREE.Vector3(
        shootDir.x + Math.random() * 0.1 - 0.05,
        0,
        shootDir.z + Math.random() * 0.1 - 0.05
      ).normalize();
      
      // spawn point slightly offset from ship's side
      const spawnPos = this.player.position.clone()
        .add(shootDir.clone().multiplyScalar(3))
        .add(forward.clone().multiplyScalar(i * 2));
      
      // create + track the cannonball
      const ball = new CannonBall(
        spawnPos,
        spread,
        this.isMainPlayer ? playerName : null
      );
      activeCannonBalls.push(ball);
    }

    // tell other players we fired
    if (this.isMainPlayer && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'cannonFire',
        side: side,
        position: this.player.position,
        rotation: this.player.rotation
      }));
    }
  }
}

class Island {
  constructor(x, z) {
    // basic island properties
    this.position = { x, z };
    this.radius = 100;
    this.treasureSpots = [];
    
    // make the beach ring around island
    const beachRadius = 110 + random(-10, 10);
    const beachGeometry = new THREE.CircleGeometry(beachRadius, 32);
    const beachMaterial = new THREE.MeshStandardMaterial({
      color: 0xf2d16b,
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.DoubleSide // need both sides bc water can clip
    });
    
    // setup beach mesh
    const beach = new THREE.Mesh(beachGeometry, beachMaterial);
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(x, 0.1, z); // tiny bit up to avoid z-fighting
    beach.receiveShadow = true;
    scene.add(beach);

    // pick random island style
    const islandType = Math.floor(random(0, 4)); // normal/tall/wide/volcano
    const baseHeight = islandType === 1 ? 60 : islandType === 3 ? 70 : 40;
    const baseRadius = islandType === 2 ? 120 : 100;
    const segments = islandType === 3 ? 16 : 32;

    // create base island shape
    const mainGeometry = new THREE.ConeGeometry(baseRadius, baseHeight, segments, 4);
    
    // mess up the perfect cone shape to look more natural
    const vertices = mainGeometry.attributes.position.array;
    for(let i = 0; i < vertices.length; i += 3) {
      const vx = vertices[i];
      const vy = vertices[i + 1];
      const vz = vertices[i + 2];
      
      // add random height variation based on type
      const distance = Math.sqrt(vx * vx + vz * vz) / baseRadius;
      let heightVariation = Math.sin(vx * 0.2) * Math.cos(vz * 0.2) * 15;
      
      if(islandType === 3) { // volcano gets a crater
        heightVariation *= (1 - Math.pow(distance, 0.5)) * 2;
        if(distance < 0.2) {
          heightVariation -= 20;
        }
      } else if(islandType === 2) { // wide island
        heightVariation *= (1 - Math.pow(distance, 2));
      } else { // normal island
        heightVariation *= (1 - distance);
      }
      
      vertices[i + 1] = vy + heightVariation;
      
      // maybe put treasure here if its a good spot
      if (vy > baseHeight * 0.2 && vy < baseHeight * 0.7 && Math.random() > 0.8) {
        this.treasureSpots.push({
          x: vx + x,
          y: vy + 2,
          z: vz + z
        });
      }
    }

    // fix lighting after messing w/ vertices
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

class CannonBall {
  constructor(startPos, direction, shooterName) {
    this.position = startPos.clone();
    this.direction = direction.normalize();
    this.speed = 2;
    this.damage = 25; // Increased damage
    this.lifetime = 2000;
    this.startTime = Date.now();
    this.shooterName = shooterName;
    this.hasHit = false;
    this.hitRadius = 12; // Increased from 8 to 12 for easier hits

    // Create larger, more visible particles
    const geometry = new BufferGeometry();
    const positions = new Float32Array(50 * 3); // More particles
    
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = startPos.x;
      positions[i + 1] = startPos.y + 2;
      positions[i + 2] = startPos.z;
    }
    
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    
    const material = new PointsMaterial({
      color: 0xff4400,
      size: 3.0, // Larger particles
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 1.0
    });

    this.particles = new Points(geometry, material);
    scene.add(this.particles);
    
    // Add smoke trail
    this.smokeParticles = [];
    for (let i = 0; i < 10; i++) {
      const smokeGeo = new BufferGeometry();
      const smokePositions = new Float32Array(20 * 3);
      smokeGeo.setAttribute('position', new Float32BufferAttribute(smokePositions, 3));
      
      const smokeMaterial = new PointsMaterial({
        color: 0x888888,
        size: 2.0,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.5
      });
      
      const smoke = new Points(smokeGeo, smokeMaterial);
      scene.add(smoke);
      this.smokeParticles.push({
        mesh: smoke,
        positions: smokePositions,
        age: 0
      });
    }
  }

  update() {
    if (this.hasHit || Date.now() - this.startTime > this.lifetime) {
      scene.remove(this.particles);
      this.smokeParticles.forEach(smoke => scene.remove(smoke.mesh));
      return true;
    }

    // Move the cannonball
    const moveAmount = this.direction.clone().multiplyScalar(this.speed);
    this.position.add(moveAmount);
    
    // Update particle positions with spread
    const positions = this.particles.geometry.attributes.position.array;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = this.position.x + (Math.random() - 0.5) * 3;
      positions[i + 1] = this.position.y + 2 + (Math.random() - 0.5) * 3;
      positions[i + 2] = this.position.z + (Math.random() - 0.5) * 3;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;


    //TODO: LOOK AT THIS
    // Update smoke trail
    this.smokeParticles.forEach(smoke => {
      smoke.age += 0.016;
      for (let i = 0; i < smoke.positions.length; i += 3) {
        const t = i / smoke.positions.length;
        smoke.positions[i] = this.position.x - this.direction.x * (t * 10) + (Math.random() - 0.5) * 2;
        smoke.positions[i + 1] = this.position.y + 2 - t * 2 + (Math.random() - 0.5) * 2;
        smoke.positions[i + 2] = this.position.z - this.direction.z * (t * 10) + (Math.random() - 0.5) * 2;
      }
      smoke.mesh.geometry.attributes.position.needsUpdate = true;
      smoke.mesh.material.opacity = Math.max(0, 0.5 - smoke.age);
    });

    // Check collisions with other ships
    otherPlayers.forEach((otherPlayer, playerName) => {
      if (!this.hasHit && otherPlayer.player) {
        const dx = this.position.x - otherPlayer.player.position.x;
        const dz = this.position.z - otherPlayer.player.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance < this.hitRadius) {
          console.log('Hit detected on player:', playerName); // Debug log
          if (this.shooterName && ws && ws.readyState === WebSocket.OPEN) {
            const hitMessage = {
              type: 'hit',
              target: playerName,
              damage: this.damage,
              shooterName: this.shooterName
            };
            console.log('Sending hit message:', hitMessage);
            ws.send(JSON.stringify(hitMessage));
            
            // Add hit effect
            this.createHitEffect(this.position.clone());
          }
          this.hasHit = true;
          return true;
        }
      }
    });

    return false;
  }

  createHitEffect(position) {
    // Create explosion particles
    const explosionGeo = new BufferGeometry();
    const explosionPositions = new Float32Array(100 * 3);
    
    for (let i = 0; i < explosionPositions.length; i += 3) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 5;
      explosionPositions[i] = position.x + Math.cos(angle) * radius;
      explosionPositions[i + 1] = position.y + 2 + Math.random() * 5;
      explosionPositions[i + 2] = position.z + Math.sin(angle) * radius;
    }
    
    explosionGeo.setAttribute('position', new Float32BufferAttribute(explosionPositions, 3));
    
    const explosionMaterial = new PointsMaterial({
      color: 0xff8800,
      size: 2.0,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 1.0
    });
    
    const explosion = new Points(explosionGeo, explosionMaterial);
    scene.add(explosion);
    
    // Animate explosion
    const startTime = Date.now();
    function animateExplosion() {
      const age = (Date.now() - startTime) / 1000;
      if (age > 1) {
        scene.remove(explosion);
        return;
      }
      
      explosion.material.opacity = 1 - age;
      requestAnimationFrame(animateExplosion);
    }
    animateExplosion();
  }
}

function updateHealthBar(health) {
  console.log('Updating health bar with health:', health); // Debug log
  const fill = document.querySelector('.health-fill');
  const text = document.querySelector('.health-text');
  if (!fill || !text) {
    console.error('Health bar elements not found!');
    return;
  }
  const percentage = (health / MAX_HEALTH) * 100;
  
  fill.style.width = `${percentage}%`;
  text.textContent = `${Math.max(0, Math.floor(health))}/${MAX_HEALTH}`;
}

function addKillFeed(killer, victim) {
  killFeed.unshift(`${killer} sunk ${victim}`);
  if (killFeed.length > 5) killFeed.pop();
  
  const feed = document.getElementById('killFeed');
  feed.innerHTML = killFeed.map(msg => `<div class="kill-message">${msg}</div>`).join('');
}

let player = new Player(true);
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

function createUI() {
  // Health bar
  const healthBar = document.createElement('div');
  healthBar.id = 'healthBar';
  healthBar.innerHTML = `
    <div class="health-container">
      <div class="health-fill"></div>
      <span class="health-text">100/100</span>
    </div>
  `;
  document.body.appendChild(healthBar);

  // Kill feed
  const killFeedElement = document.createElement('div');
  killFeedElement.id = 'killFeed';
  document.body.appendChild(killFeedElement);

  // Update the controls list in the existing HUD
  const controlsList = document.querySelector('.controls-list');
  if (controlsList) {
    // Add cannon controls
    const cannonControls = `
      <div class="control-item">
        <span class="key">Q</span>
        <span class="action">Fire Left Cannons</span>
      </div>
      <div class="control-item">
        <span class="key">E</span>
        <span class="action">Fire Right Cannons</span>
      </div>
    `;
    controlsList.innerHTML += cannonControls;
  }
}

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

  controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 40.0;
  controls.maxDistance = 200.0;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.rotateSpeed = 0.5;
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
    if(e.key=="q" || e.key=="Q") {
      console.log('Q key pressed - firing left cannons'); // Debug log
      player.fireCannon('left');
    }
    if(e.key=="e" || e.key=="E") {
      console.log('E key pressed - firing right cannons'); // Debug log
      player.fireCannon('right');
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

  // Get player name with validation
  let validName = false;
  while (!validName) {
    playerName = prompt('Enter your name:', 'Player' + Math.floor(Math.random() * 1000));
    
    if (!playerName || playerName.trim() === '') {
      alert('Please enter a valid name!');
    } else {
      validName = true;
    }
  }
  
  // Setup WebSocket
  ws = new WebSocket('ws://localhost:8081');
  
  ws.onopen = () => {
    console.log('Connected to server');
    // Join game
    ws.send(JSON.stringify({
      type: 'join',
      name: playerName,
      position: { x: 0, y: 0, z: 0 },
      rotation: { _x: 0, _y: 0, _z: 0 }
    }));
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    alert('Failed to connect to server. Please try again.');
  };
  
  ws.onclose = () => {
    console.log('Disconnected from server');
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Received message:', data); // Debug log
    
    switch(data.type) {
      case 'error':
        alert(data.message);
        location.reload(); // Reload the page if kicked
        break;
        
      case 'players':
        // Update other players
        data.players.forEach(([id, playerData]) => {
          if (id !== playerName) {
            if (!otherPlayers.has(id)) {
              const newPlayer = new Player(false);
              otherPlayers.set(id, newPlayer);
            }
            otherPlayers.get(id).updateFromNetwork(
              playerData.position,
              playerData.rotation
            );
          }
        });
        break;
        
      case 'playerLeft':
        if (otherPlayers.has(data.playerId)) {
          const playerToRemove = otherPlayers.get(data.playerId);
          if (playerToRemove.player) {
            scene.remove(playerToRemove.player);
          }
          otherPlayers.delete(data.playerId);
        }
        break;

      case 'cannonFire':
        if (otherPlayers.has(data.playerId)) {
          const shooter = otherPlayers.get(data.playerId);
          shooter.fireCannon(data.side);
        }
        break;

      case 'hit':
        if (data.target === playerName) {
          // Update our health
          player.health = data.remainingHealth;
          updateHealthBar(player.health);
          
          if (data.remainingHealth <= 0) {
            alert('Your ship has been sunk!');
            location.reload();
          }
        }
        break;

      case 'kill':
        addKillFeed(data.killer, data.victim);
        break;
    }
  };

  // Create UI elements
  createUI();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function cameraSetter() {
  if(player.player) {
    if(view == 1) {
      // Update controls target to follow ship
      controls.target.set(
        player.player.position.x,
        player.player.position.y,
        player.player.position.z
      );
      controls.enabled = true;
      
      // Only set initial camera position when switching to view 1
      if (controls.lastView !== 1) {
        camera.position.set(
          player.player.position.x + 32,
          40,
          player.player.position.z + 130
        );
        controls.lastView = 1;
      }
    }
    else if(view == 2) {
      controls.enabled = false;
      camera.position.set(player.player.position.x, 600, player.player.position.z);
      camera.lookAt(player.player.position);
      controls.lastView = 2;
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  
  // Update and clean up cannon balls first
  activeCannonBalls = activeCannonBalls.filter(ball => !ball.update());
  
  render();
  player.update();
  cameraSetter();
  
  if(view == 1) {
    controls.update();
  }
  
  // Send position update every frame if player exists
  if (ws && ws.readyState === WebSocket.OPEN && player.player) {
    ws.send(JSON.stringify({
      type: 'update',
      position: {
        x: player.player.position.x,
        y: player.player.position.y,
        z: player.player.position.z
      },
      rotation: {
        _x: player.player.rotation.x,
        _y: player.player.rotation.y,
        _z: player.player.rotation.z
      }
    }));
  }
  
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

init();
animate();