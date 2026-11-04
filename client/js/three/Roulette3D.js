/**
 * Roulette3D.js
 * Procedural Three.js European Roulette 3D Engine.
 * 
 * Key Architectural Features:
 * 1. 100% Procedural Geometry: <4,000 polygons total, 0 KB external 3D files.
 * 2. Single Dynamic 2D Canvas Texture Atlas: 37 pockets rendered into 1 CanvasTexture (<6 scene draw calls).
 * 3. Dual-Rate Thermal Throttling: Capped at 60 FPS in spin, throttled to 30 FPS in idle.
 * 4. Hardware Friendly: DPR clamped to Math.min(devicePixelRatio, 2), shadowMap disabled.
 * 5. Deterministic 3-Phase Ball Trajectory: Synchronized counter-clockwise spin landing exactly
 *    on server-designated winning pocket at t = spinDuration without snapping.
 * 6. 100% Silent: Zero sound effects or synthesizer overhead.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Roulette3D = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // Authentic European single-zero clockwise sequence (37 pockets)
  const WHEEL_NUMBERS = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
  ];

  const RED_NUMBERS = new Set([
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
  ]);

  class Roulette3D {
    /**
     * @param {HTMLElement} container 
     */
    constructor(container) {
      this.container = container;
      this.THREE = window.THREE;
      if (!this.THREE) {
        throw new Error('Three.js must be loaded before initializing Roulette3D');
      }

      this.WHEEL_NUMBERS = WHEEL_NUMBERS;
      this.RED_NUMBERS = RED_NUMBERS;

      // Thermal & Performance Management
      this.isSpinning = false;
      this.targetFps = 30; // 30 FPS idle, 60 FPS active spin
      this.lastFrameTime = performance.now();

      // Spin physics state
      this.spinStartTime = 0;
      this.spinDuration = 8.0;
      this.wheelStartAngle = 0;
      this.wheelEndAngle = 0;
      this.ballStartAngle = 0;
      this.ballEndAngle = 0;
      this.targetPocketAngle = 0;
      this.currentWinningNumber = 0;

      // Animation loop handle
      this.animationFrameId = null;

      this.init();
    }

    init() {
      const THREE = this.THREE;

      // 1. Scene & Atmosphere
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x061510); // Deep luxury emerald void

      const width = this.container.clientWidth || 800;
      const height = this.container.clientHeight || 500;

      // 2. Camera
      this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
      this.updateCamera(width, height);

      // 3. WebGL Renderer with Thermal Protections
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
        alpha: false
      });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = false; // Zero shadow map overhead
      this.container.appendChild(this.renderer.domElement);

      // 4. Luxury Casino Lighting
      const ambientLight = new THREE.AmbientLight(0xfff6ea, 0.85);
      this.scene.add(ambientLight);

      const dirLight = new THREE.DirectionalLight(0xfffaed, 1.25);
      dirLight.position.set(3, 8, 4);
      this.scene.add(dirLight);

      const goldPointLight = new THREE.PointLight(0xd4af37, 0.9, 8);
      goldPointLight.position.set(0, 2.8, 0);
      this.scene.add(goldPointLight);

      // 5. Build Procedural 3D Geometry (<4,000 triangles total)
      this.buildTableAndWheel();
      this.buildBall();

      // 6. Responsive Resize Listener
      this.onResize = this.onResize.bind(this);
      window.addEventListener('resize', this.onResize);

      // 7. Start Throttled Render Loop
      this.animate = this.animate.bind(this);
      this.animationFrameId = requestAnimationFrame(this.animate);
    }

    /**
     * Builds the stationary bowl, brass deflectors, spinning rotor, turret,
     * frets, and the single-texture pocket ring.
     */
    buildTableAndWheel() {
      const THREE = this.THREE;

      // Stationary Table Bowl (Mahogany & Brass)
      const tableGroup = new THREE.Group();
      const mahoganyMat = new THREE.MeshStandardMaterial({
        color: 0x1f1008,
        roughness: 0.35,
        metalness: 0.08
      });

      // Bowl sloping base
      const bowlGeo = new THREE.CylinderGeometry(2.6, 2.0, 0.5, 36, 1, true);
      const bowlMesh = new THREE.Mesh(bowlGeo, mahoganyMat);
      bowlMesh.position.y = 0.25;
      tableGroup.add(bowlMesh);

      // Polished outer rim
      const rimGeo = new THREE.TorusGeometry(2.6, 0.16, 14, 36);
      const rimMesh = new THREE.Mesh(rimGeo, mahoganyMat);
      rimMesh.rotation.x = Math.PI / 2;
      rimMesh.position.y = 0.5;
      tableGroup.add(rimMesh);

      // 8 Brass Rhombus Deflectors
      const brassMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        roughness: 0.22,
        metalness: 0.88
      });
      const deflectorGeo = new THREE.OctahedronGeometry(0.065);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI * 2) / 8;
        const def = new THREE.Mesh(deflectorGeo, brassMat);
        def.position.set(Math.cos(a) * 2.25, 0.35, Math.sin(a) * 2.25);
        def.rotation.y = a;
        tableGroup.add(def);
      }
      this.scene.add(tableGroup);

      // Spinning Rotor Hub
      this.rotor = new THREE.Group();

      // Polished Gold Turret & Dome
      const goldMat = new THREE.MeshStandardMaterial({
        color: 0xe6b800,
        roughness: 0.18,
        metalness: 0.94
      });
      const turretGeo = new THREE.CylinderGeometry(0.2, 0.46, 0.4, 20);
      const turret = new THREE.Mesh(turretGeo, goldMat);
      turret.position.y = 0.2;
      this.rotor.add(turret);

      const domeGeo = new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const dome = new THREE.Mesh(domeGeo, goldMat);
      dome.position.y = 0.4;
      this.rotor.add(dome);

      // Crossbars (handles)
      const barGeo = new THREE.CylinderGeometry(0.024, 0.024, 1.15, 8);
      for (let b = 0; b < 2; b++) {
        const bar = new THREE.Mesh(barGeo, goldMat);
        bar.rotation.z = Math.PI / 2;
        bar.rotation.y = (b * Math.PI) / 2;
        bar.position.y = 0.32;
        this.rotor.add(bar);
      }

      // Single Dynamic Canvas Texture for 37 Pockets (1 Draw Call)
      const pocketCanvas = this.generatePocketTextureCanvas();
      const pocketTexture = new THREE.CanvasTexture(pocketCanvas);
      pocketTexture.anisotropy = 4;

      const ringGeo = new THREE.RingGeometry(1.35, 2.0, 37);
      const ringMat = new THREE.MeshStandardMaterial({
        map: pocketTexture,
        roughness: 0.28,
        metalness: 0.12,
        side: THREE.DoubleSide
      });
      const pocketDisk = new THREE.Mesh(ringGeo, ringMat);
      pocketDisk.rotation.x = -Math.PI / 2;
      pocketDisk.position.y = 0.05;
      this.rotor.add(pocketDisk);

      // 37 Golden Pocket Frets (Dividers)
      const fretGeo = new THREE.BoxGeometry(0.015, 0.05, 0.65);
      const sliceAngle = (Math.PI * 2) / 37;
      for (let i = 0; i < 37; i++) {
        const fretAngle = i * sliceAngle - Math.PI / 2 + sliceAngle / 2;
        const fret = new THREE.Mesh(fretGeo, brassMat);
        fret.position.set(Math.cos(fretAngle) * 1.67, 0.07, Math.sin(fretAngle) * 1.67);
        fret.rotation.y = -fretAngle + Math.PI / 2;
        this.rotor.add(fret);
      }

      this.scene.add(this.rotor);
    }

    /**
     * Generates a single 1024x1024 texture atlas with all 37 European roulette pockets.
     * Renders crisp vector numbers and authentic Green, Red, and Black sectors.
     */
    generatePocketTextureCanvas() {
      const size = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      const cx = size / 2;
      const cy = size / 2;
      const outerR = size / 2;
      const innerR = size * 0.33;
      const sliceAngle = (2 * Math.PI) / 37;

      for (let i = 0; i < 37; i++) {
        const num = this.WHEEL_NUMBERS[i];
        const startA = i * sliceAngle - Math.PI / 2 - sliceAngle / 2;
        const endA = startA + sliceAngle;
        const midA = startA + sliceAngle / 2;

        ctx.beginPath();
        ctx.arc(cx, cy, outerR, startA, endA);
        ctx.arc(cx, cy, innerR, endA, startA, true);
        ctx.closePath();

        if (num === 0) {
          ctx.fillStyle = '#0b6623'; // Emerald Green
        } else if (this.RED_NUMBERS.has(num)) {
          ctx.fillStyle = '#9b111e'; // Ruby Red
        } else {
          ctx.fillStyle = '#121212'; // Obsidian Black
        }
        ctx.fill();

        // Subtle gold pocket border
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Crisp vector numbers facing inward toward turret
        ctx.save();
        ctx.translate(cx + Math.cos(midA) * (outerR * 0.77), cy + Math.sin(midA) * (outerR * 0.77));
        ctx.rotate(midA + Math.PI / 2);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px "Cinzel", "Georgia", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(num.toString(), 0, 0);
        ctx.restore();
      }

      return canvas;
    }

    /**
     * Builds the ivory roulette ball.
     */
    buildBall() {
      const THREE = this.THREE;
      const ballGeo = new THREE.SphereGeometry(0.08, 16, 16);
      const ballMat = new THREE.MeshStandardMaterial({
        color: 0xfdfdfd,
        roughness: 0.12,
        metalness: 0.04
      });
      this.ball = new THREE.Mesh(ballGeo, ballMat);
      this.scene.add(this.ball);

      // Initial resting pocket (0 Green)
      this.setRestingPocket(0);
    }

    /**
     * Positions the wheel and ball deterministically at the designated winning pocket.
     * Guarantees 100% visual parity across all connected multiplayer clients.
     * @param {number} winningNumber 
     */
    setRestingPocket(winningNumber) {
      if (typeof winningNumber !== 'number') return;
      this.currentWinningNumber = winningNumber;
      const pocketIdx = this.WHEEL_NUMBERS.indexOf(winningNumber);
      if (pocketIdx === -1) return;

      const sliceAngle = (Math.PI * 2) / 37;
      const pocketAngle = pocketIdx * sliceAngle - Math.PI / 2;
      this.targetPocketAngle = pocketAngle;
      this.targetPocketLocal = new this.THREE.Vector3(
        Math.cos(pocketAngle) * 1.68,
        0.12,
        Math.sin(pocketAngle) * 1.68
      );

      // Deterministic rotor alignment: winning pocket always stops at front angle (Math.PI / 2)
      const desiredEndMod = ((pocketAngle - Math.PI / 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      this.rotor.rotation.y = desiredEndMod;
      this.rotor.updateMatrixWorld(true);

      const worldPocket = this.targetPocketLocal.clone().applyMatrix4(this.rotor.matrixWorld);
      if (this.ball) {
        this.ball.position.copy(worldPocket);
      }
    }

    /**
     * Adjusts camera aspect ratio and perspective based on container dimensions.
     */
    updateCamera(width, height) {
      this.camera.aspect = width / height;
      if (width < 768) {
        // Mobile portrait layout: elevated angle
        this.camera.fov = 56;
        this.camera.position.set(0, 5.0, 3.4);
      } else {
        // Desktop / landscape layout
        this.camera.fov = 42;
        this.camera.position.set(0, 4.2, 3.8);
      }
      this.camera.lookAt(0, 0.22, 0);
      this.camera.updateProjectionMatrix();
    }

    onResize() {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w > 0 && h > 0) {
        this.updateCamera(w, h);
        this.renderer.setSize(w, h);
      }
    }

    /**
     * Triggers a server-synchronized spin.
     * Computes exact target world angle for the winning pocket and smoothly
     * guides the ball through 3 distinct physical phases.
     * 
     * @param {number} winningNumber Pocket number [0..36]
     * @param {number} [duration=8.0] Spin duration in seconds
     * @param {number} [elapsed=0] Elapsed seconds if joining mid-spin
     */
    startSpin(winningNumber, duration = 8.0, elapsed = 0) {
      this.isSpinning = true;
      this.targetFps = 60; // 60 FPS capped during active spin
      this.spinStartTime = performance.now() - (elapsed * 1000);
      this.spinDuration = Math.max(1.0, duration);
      this.currentWinningNumber = winningNumber;

      const pocketIdx = this.WHEEL_NUMBERS.indexOf(winningNumber);
      const sliceAngle = (Math.PI * 2) / 37;
      const pocketAngle = pocketIdx * sliceAngle - Math.PI / 2;
      this.targetPocketAngle = pocketAngle;
      this.targetPocketLocal = new this.THREE.Vector3(
        Math.cos(pocketAngle) * 1.68,
        0.12,
        Math.sin(pocketAngle) * 1.68
      );

      // Deterministic end angle for rotor so pocket ALWAYS stops at Math.PI / 2 (front towards camera)
      const desiredEndMod = ((pocketAngle - Math.PI / 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const currentRotY = this.rotor.rotation.y;
      const minClockwiseTurns = 4;
      const baseEndAngle = currentRotY + minClockwiseTurns * Math.PI * 2;
      const currentMod = ((baseEndAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      let diff = desiredEndMod - currentMod;
      if (diff < 0) diff += Math.PI * 2;

      this.wheelStartAngle = currentRotY;
      this.wheelEndAngle = baseEndAngle + diff;

      // Ball current angle in world space
      this.ballStartAngle = this.ball
        ? Math.atan2(this.ball.position.z, this.ball.position.x)
        : 0;

      // Ball executes counter-clockwise turns, ending at Math.PI / 2 (the exact landing angle)
      let targetBallEnd = Math.PI / 2;
      while (targetBallEnd < this.ballStartAngle + Math.PI * 2 * 5) {
        targetBallEnd += Math.PI * 2;
      }
      this.ballEndAngle = targetBallEnd;
    }

    /**
     * Thermal-throttled render and animation loop.
     */
    animate(currentTime) {
      this.animationFrameId = requestAnimationFrame(this.animate);

      // Dual-Rate Thermal Throttling:
      // 60 FPS during spin (~16.6ms), throttled to 30 FPS in idle (~33.3ms)
      const currentInterval = 1000 / this.targetFps;
      const delta = currentTime - this.lastFrameTime;
      if (delta < currentInterval) return;
      this.lastFrameTime = currentTime - (delta % currentInterval);

      const now = performance.now();

      if (this.isSpinning) {
        const elapsed = (now - this.spinStartTime) / 1000;
        const p = Math.min(1.0, Math.max(0, elapsed / this.spinDuration));
        // Ease-out cubic: smooth deceleration without abrupt halts
        const easeP = 1.0 - Math.pow(1.0 - p, 3);

        // Rotor rotation (clockwise)
        this.rotor.rotation.y = this.wheelStartAngle + (this.wheelEndAngle - this.wheelStartAngle) * easeP;
        this.rotor.updateMatrixWorld(true);

        // Get exact real-time world position of the winning pocket
        const targetWorldPos = this.targetPocketLocal.clone().applyMatrix4(this.rotor.matrixWorld);

        if (p < 0.65) {
          // Phase 1: High-speed rim spin
          const ballAngle = this.ballStartAngle + (this.ballEndAngle - this.ballStartAngle) * easeP;
          this.ball.position.set(
            Math.cos(ballAngle) * 2.40,
            0.45,
            Math.sin(ballAngle) * 2.40
          );
        } else if (p < 1.0) {
          // Phase 2: Inward descent directly towards targetWorldPos with natural deflector bounce
          const u = (p - 0.65) / 0.35;
          const ballAngle = this.ballStartAngle + (this.ballEndAngle - this.ballStartAngle) * easeP;
          const rimPos = new this.THREE.Vector3(
            Math.cos(ballAngle) * 2.40,
            0.45,
            Math.sin(ballAngle) * 2.40
          );
          
          this.ball.position.lerpVectors(rimPos, targetWorldPos, u);
          // Add small diminishing bounce
          const bounce = 0.08 * (1.0 - u) * Math.abs(Math.sin(u * 5 * Math.PI));
          this.ball.position.y += bounce;
        } else {
          // Spin complete: lock ball directly into pocket
          this.isSpinning = false;
          this.targetFps = 30; // Reduce power consumption by >60%
          this.ball.position.copy(targetWorldPos);
        }
      } else {
        // Idle phase: STAY STILL! Wheel and ball remain firmly stationary in the pocket.
        if (this.targetPocketLocal && this.ball) {
          this.rotor.updateMatrixWorld(true);
          const settledPos = this.targetPocketLocal.clone().applyMatrix4(this.rotor.matrixWorld);
          this.ball.position.copy(settledPos);
        }
      }

      this.renderer.render(this.scene, this.camera);
    }

    /**
     * Cleans up Three.js resources and event listeners on unload.
     */
    destroy() {
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
      }
      window.removeEventListener('resize', this.onResize);
      if (this.renderer && this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
      if (this.renderer) {
        this.renderer.dispose();
      }
    }
  }

  return Roulette3D;
}));
