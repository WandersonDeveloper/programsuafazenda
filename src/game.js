import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// ─── Constantes ───────────────────────────────────────────────────────────────
const GRID   = 100;
const GROW   = 8;
const TILE_H = 0.50;   // altura do bloco 3D de terra

const CROPS = {
  milho:    { name:'Milho',    icon:'🌽', unlockAt:0,   grow:8,  color:0xf0c000 },
  soja:     { name:'Soja',     icon:'🌿', unlockAt:20,  grow:6,  color:0x88cc44 },
  feijao:   { name:'Feijão',   icon:'🫘', unlockAt:35,  grow:7,  color:0x8b3a2a },
  algodao:  { name:'Algodão',  icon:'🤍', unlockAt:50,  grow:10, color:0xf5f5f5 },
  trigo:    { name:'Trigo',    icon:'🌾', unlockAt:75,  grow:5,  color:0xe8c46a },
  batata:   { name:'Batata',   icon:'🥔', unlockAt:100, grow:9,  color:0xb5894a },
  tomate:   { name:'Tomate',   icon:'🍅', unlockAt:130, grow:6,  color:0xd9342b },
  cenoura:  { name:'Cenoura',  icon:'🥕', unlockAt:165, grow:7,  color:0xff8c2a },
  abobora:  { name:'Abóbora',  icon:'🎃', unlockAt:210, grow:12, color:0xe88a1a },
  cana:     { name:'Cana',     icon:'🎋', unlockAt:270, grow:9,  color:0x9be07a },
  uva:      { name:'Uva',      icon:'🍇', unlockAt:350, grow:14, color:0x6a3a8b },
};

const T = { EMPTY:'EMPTY', SOIL:'SOIL', SEED:'SEED', SPROUT:'SPROUT', GROWN:'GROWN', READY:'READY', SILO:'SILO' };
const DIR_VEC = [[1,0],[0,1],[-1,0],[0,-1]];


const EXPAND = [
  {h:0,s:1},   {h:3,s:2},   {h:8,s:3},   {h:18,s:4},   {h:35,s:5},
  {h:60,s:6},  {h:90,s:7},  {h:130,s:8},  {h:180,s:10},  {h:260,s:13},
  {h:380,s:16},{h:550,s:20},{h:800,s:25}, {h:1200,s:32}, {h:1800,s:40},
  {h:2700,s:50},{h:4000,s:65},{h:6000,s:80},{h:9000,s:100}
];

// ─── Estado ────────────────────────────────────────────────────────────────────
let grid = [], robot = {x:0,y:0,dir:0};
let tick=0, harvestCount=0, unlockedSize=1;
let running=false, stopRequested=false;
let currentCrop='milho';
const unlockedCrops=new Set(['milho']);
const unlockAnim = [];   // tiles que estão surgindo

// ─── Upgrades do drone ──────────────────────────────────────────────────────
let speedLevel = 1;                  // nível atual de velocidade (= slider max)
const MAX_SPEED_LEVEL  = 10;         // metade do máximo absoluto do slider (20)
const SPEED_UPGRADE_COST = 100;      // custo fixo por upgrade
function speedXPRequired(){ return speedLevel * 5; }   // colheitas necessárias para próximo nível

// ─── Sistema de Silo ─────────────────────────────────────────────────────────
let coins = 0;
let siloPlacementMode = false;
let siloGhost = null;
let movingSilo = null;       // silo em modo "mover" (objeto {x,y,mesh})
const placedSilos = [];
const SILO_COST = 15;
const SILO_REFUND = 10;       // moedas devolvidas ao vender
const SILO_PLACE_RANGE = 6;  // tiles fora da fazenda permitidos

// ─── Compartimento do Drone ─────────────────────────────────────────────────
// ─── Compartimento do Drone ─────────────────────────────────────────────────
const DRONE_CAPACITY_BASE = 8;
const DRONE_CAPACITY_HELPER_BONUS = 17; // 8 + 17 = 25 com auxiliar
function droneCapacity(){
  return DRONE_CAPACITY_BASE + (helperDroneUnlocked ? DRONE_CAPACITY_HELPER_BONUS : 0);
}
// Compat: getter dinâmico para código legado que usa DRONE_CAPACITY
Object.defineProperty(globalThis, 'DRONE_CAPACITY', { get: droneCapacity, configurable: true });
const SILO_CAPACITY  = 50;  // capacidade de UM silo
let droneInventory = { milho:0, soja:0, feijao:0, algodao:0, trigo:0, batata:0, tomate:0, cenoura:0, abobora:0, cana:0, uva:0, madeira:0 };
const siloStorage   = { milho:0, soja:0, feijao:0, algodao:0, trigo:0, batata:0, tomate:0, cenoura:0, abobora:0, cana:0, uva:0, madeira:0 };
const CROP_PRICES   = { milho:2, soja:3, feijao:4, algodao:5, trigo:6, batata:7, tomate:8, cenoura:9, abobora:11, cana:13, uva:16, madeira:3 };
let droneAutoUnloading = false;

// ─── Boosts temporários ──────────────────────────────────────────────────────
// Estado: timestamp (ms) em que o boost expira (0 = inativo)
const BOOSTS = {
  speed: { name:'Turbo', icon:'🚀', duration:30000, cost:50,  badge:'🚀 Turbo' },
  grow:  { name:'Crescimento Rápido', icon:'🌱', duration:60000, cost:80,  badge:'🌱 Cresc.×2' },
  sell:  { name:'Bônus de Venda', icon:'💰', duration:60000, cost:100, badge:'💰 +50% venda' },
};
const activeBoosts = { speed:0, grow:0, sell:0 };
function boostActive(k){ return activeBoosts[k] > Date.now(); }
function boostMultiplier(k){ return boostActive(k) ? 2 : 1; }
function priceOf(crop){ return CROP_PRICES[crop] * (boostActive('sell') ? 1.5 : 1); }

// ─── Bateria do drone ────────────────────────────────────────────────────────
let batteryLevel = 1;                       // nível comprado (1–10)
const MAX_BATTERY_LEVEL = 10;
const BATTERY_UPGRADE_COST = 80;            // moedas por upgrade
function batteryXPRequired(){ return batteryLevel * 4; }
function batteryMax(){ return 150 + (batteryLevel-1) * 60; }   // 150→690
const ENERGY_COST = { harvest:2, move:0.6, till:1, plant:1, turn:0.2, anim:0.5 };
let battery = 150;
let batteryCharging = false;
function batteryPct(){ return Math.max(0, Math.min(1, battery / batteryMax())); }
// Recarga: 10s base, reduz 0.05s por colheita (mín 2s)
function rechargeSeconds(){ return Math.max(2, 10 - harvestCount * 0.05); }
const RECHARGE_COST_MAIN = 3;   // 🪙 cobrado por recarga do drone principal
function consumeEnergy(kind){
  if(batteryCharging) return;
  battery = Math.max(0, battery - (ENERGY_COST[kind] || 1));
  updateBatteryBar(); updateStats();
}
async function ensureBattery(kind){
  if(batteryCharging){ log('🔋 Drone recarregando, aguarde...','warn'); throw new Error('STOPPED'); }
  if(battery < (ENERGY_COST[kind] || 1)){
    await rechargeBattery();
    if(stopRequested) throw new Error('STOPPED');
  }
  return true;
}
async function rechargeBattery(){
  if(batteryCharging) return;
  // Cobra custo da recarga
  if(coins < RECHARGE_COST_MAIN){
    log(`⚠ Sem moedas para recarregar! Precisa de ${RECHARGE_COST_MAIN} 🪙.`,'warn');
    showNotif(`⚠ Sem ${RECHARGE_COST_MAIN} 🪙 para recarregar!`);
    throw new Error('STOPPED');
  }
  coins -= RECHARGE_COST_MAIN;
  updateStats();
  const secs = rechargeSeconds();
  log(`🔋 Bateria descarregada! Recarregando (-${RECHARGE_COST_MAIN} 🪙)...`,'warn');
  showNotif(`🪂 Recarregando (-${RECHARGE_COST_MAIN} 🪙)...`);
  // 1) Inicia animação de retorno + pouso
  try { if(typeof pouse === 'function') await pouse(); } catch(_){}
  // 2) Espera a animação terminar (drone realmente tocar o solo)
  const tStart = Date.now();
  while(droneMesh && !droneMesh.userData.landed){
    await new Promise(r=>setTimeout(r,80));
    if(stopRequested) break;
    if(Date.now() - tStart > 8000) break; // failsafe
  }
  if(stopRequested){ batteryCharging = false; return; }
  // 3) Só agora começa a recarregar (barra vira azul)
  batteryCharging = true;
  updateBatteryBar();
  log(`⏳ Recarregando (${secs.toFixed(1)}s)...`,'info');
  showNotif('🔋 Recarregando...');
  const start = Date.now();
  const max = batteryMax();
  const initial = battery;
  while(Date.now() - start < secs*1000){
    const p = (Date.now() - start) / (secs*1000);
    battery = initial + (max - initial) * p;
    updateBatteryBar(); updateStats();
    await new Promise(r=>setTimeout(r,80));
    if(stopRequested) break;
  }
  battery = max;
  batteryCharging = false;
  updateBatteryBar(); updateStats();
  log('⚡ Bateria carregada! Pronto para voar.','ok');
  showNotif('⚡ Bateria cheia!');
}
function upgradeBattery(){
  if(batteryLevel >= MAX_BATTERY_LEVEL){ log('🔋 Bateria já no nível máximo!','warn'); return; }
  const xpNeed = batteryXPRequired();
  if(harvestCount < xpNeed){ log(`⚠ Precisa de ${xpNeed} colheitas (XP) para o próximo nível de bateria.`,'warn'); return; }
  if(coins < BATTERY_UPGRADE_COST){ log(`⚠ Precisa de ${BATTERY_UPGRADE_COST} 🪙 para upgrade de bateria.`,'warn'); return; }
  coins -= BATTERY_UPGRADE_COST;
  batteryLevel++;
  battery = batteryMax(); // recarrega ao subir
  showNotif(`🔋 Bateria upgrade! Nível ${batteryLevel}/${MAX_BATTERY_LEVEL}`);
  log(`✅ Bateria aumentada para nível ${batteryLevel} (cap. ${batteryMax()}, -${BATTERY_UPGRADE_COST} 🪙).`,'ok');
  updateStats(); updateBatteryBar(); saveGame();
}
function updateBatteryBar(){
  if(!droneMesh || !droneMesh.userData.batteryBar) return;
  const bar = droneMesh.userData.batteryBar;
  const pct = batteryPct();
  bar.fill.scale.x = Math.max(0.001, pct);
  bar.fill.position.x = -0.29 * (1 - pct);
  let color;
  if(batteryCharging) color = 0x44aaff;
  else if(pct > 0.5)  color = 0x44dd44;
  else if(pct > 0.2)  color = 0xeecc22;
  else                color = 0xee3333;
  bar.fillMat.color.setHex(color);
}

function droneTotal(){ let s=0; for(const k of Object.keys(droneInventory)) s += (droneInventory[k]||0); return s; }
function siloTotal(){ let s=0; for(const k of Object.keys(siloStorage)) s += (siloStorage[k]||0); return s; }
function siloMaxCapacity(){ return placedSilos.length * SILO_CAPACITY; }
function siloFreeSpace(){ return Math.max(0, siloMaxCapacity() - siloTotal()); }

// Smooth movement physics
let droneVelocity = new THREE.Vector3(0, 0, 0);
const DRONE_ACCELERATION = 0.25;
const DRONE_FRICTION = 0.15;

// ─── Renderer ─────────────────────────────────────────────────────────────────
const canvas   = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.toneMapping       = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 2.0;

// ─── Cena ─────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0xc8e8c0, 30, 75);

// ─── Câmera ───────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 200);
camera.position.set(4.5, 9, 15);
camera.lookAt(4.5, TILE_H, 4.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(4.5, TILE_H, 4.5);
controls.minDistance      = 3;
controls.maxDistance      = 38;
controls.maxPolarAngle    = Math.PI / 2.05;
controls.enableDamping    = true;
controls.dampingFactor    = 0.08;
controls.rotateSpeed      = 0.7;
controls.zoomSpeed        = 1.2;
controls.panSpeed         = 1.0;
controls.screenSpacePanning = true;
controls.mouseButtons     = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.update();

// ─── Iluminação ───────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xfff8e8, 1.8));
const sun = new THREE.DirectionalLight(0xfff5d0, 2.5);
sun.position.set(8, 20, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left:-20, right:20, top:20, bottom:-20, near:1, far:70 });
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x88aa44, 0.4));

// ─── Texturas procedurais ────────────────────────────────────────────────────
function mkTex(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  fn(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function noiseFill(ctx, s, base, spread, density=1) {
  for (let py=0; py<s; py+=2) for (let px=0; px<s; px+=2) {
    const v = (Math.random()-.5)*spread;
    if (Math.abs(v) < spread*.25) continue;
    ctx.fillStyle = v>0 ? `rgba(220,160,80,${Math.min(v/spread*.6,1)*density})` : `rgba(0,0,0,${Math.min(-v/spread*.7,1)*density})`;
    ctx.fillRect(px, py, 2, 2);
  }
}

const TEX = {};
function buildTextures() {
  // Lateral dos blocos — terra escura com grãos
  TEX.side = mkTex(64, (ctx, s) => {
    ctx.fillStyle = '#5a3215'; ctx.fillRect(0,0,s,s);
    noiseFill(ctx, s, '#5a3215', 60, 0.9);
    for (let i=0;i<6;i++) {
      ctx.fillStyle='rgba(0,0,0,.22)'; ctx.beginPath();
      ctx.arc(Math.random()*s, Math.random()*s, Math.random()*2.5+.5, 0, Math.PI*2); ctx.fill();
    }
  });

  // Topo EMPTY — terra seca
  TEX.empty = mkTex(64, (ctx, s) => {
    ctx.fillStyle = '#8a5028'; ctx.fillRect(0,0,s,s);
    noiseFill(ctx, s, '#8a5028', 55, 0.85);
  });

  // Topo SOIL — terra molhada/arada escura com reflexo úmido
  TEX.soil = mkTex(64, (ctx, s) => {
    // base bem escura — terra encharcada
    ctx.fillStyle = '#2a1408'; ctx.fillRect(0,0,s,s);
    noiseFill(ctx, s, '#2a1408', 30, 0.6);
    // sulcos de arado com gradiente profundo
    for (let row=3; row<s; row+=8) {
      const g = ctx.createLinearGradient(0,row-2,0,row+4);
      g.addColorStop(0,'rgba(0,0,0,.0)');
      g.addColorStop(.3,'rgba(0,0,0,.6)');
      g.addColorStop(.7,'rgba(0,0,0,.5)');
      g.addColorStop(1,'rgba(0,0,0,.0)');
      ctx.fillStyle=g; ctx.fillRect(0,row-2,s,6);
      // crista do sulco com tom de terra úmida
      ctx.fillStyle='rgba(80,40,15,.5)'; ctx.fillRect(0,row+3,s,2);
    }
    // véu azul-acinzentado de umidade
    ctx.fillStyle='rgba(40,70,120,.18)'; ctx.fillRect(0,0,s,s);
    // pequenas poças brilhantes
    for (let i=0;i<5;i++){
      const px=Math.random()*s, py=Math.random()*s;
      const rx=Math.random()*5+3, ry=Math.random()*1.5+.5;
      const gr=ctx.createRadialGradient(px,py,0,px,py,rx);
      gr.addColorStop(0,'rgba(140,180,220,.55)');
      gr.addColorStop(1,'rgba(140,180,220,.0)');
      ctx.fillStyle=gr; ctx.beginPath(); ctx.ellipse(px,py,rx,ry,0,0,Math.PI*2); ctx.fill();
    }
  });

  // Topo SEED — terra escura com sementes
  TEX.seed = mkTex(64, (ctx, s) => {
    ctx.fillStyle = '#55381a'; ctx.fillRect(0,0,s,s);
    noiseFill(ctx, s, '#55381a', 40, 0.7);
    for (let row=3;row<s;row+=8){ctx.fillStyle='rgba(0,0,0,.3)';ctx.fillRect(0,row,s,2);}
    for (let i=0;i<10;i++){
      const px=Math.random()*s, py=Math.random()*s;
      ctx.fillStyle='#c8a040'; ctx.beginPath(); ctx.ellipse(px,py,2,1,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
    }
  });

  // Topo SPROUT — terra com toque verde
  TEX.sprout = mkTex(64, (ctx, s) => {
    ctx.fillStyle = '#4a4818'; ctx.fillRect(0,0,s,s);
    noiseFill(ctx, s, '#4a4818', 40, 0.6);
    for (let row=3;row<s;row+=8){ctx.fillStyle='rgba(0,0,0,.25)';ctx.fillRect(0,row,s,2);}
    ctx.fillStyle='rgba(60,140,20,.35)'; ctx.fillRect(0,0,s,s);
  });

  // Topo GROWN — terra verde-escura
  TEX.grown = mkTex(64, (ctx, s) => {
    ctx.fillStyle = '#3a4015'; ctx.fillRect(0,0,s,s);
    noiseFill(ctx, s, '#3a4015', 35, 0.55);
    ctx.fillStyle='rgba(30,100,10,.4)'; ctx.fillRect(0,0,s,s);
  });

  // Topo READY — dourado com padrão de colheita
  TEX.ready = mkTex(64, (ctx, s) => {
    ctx.fillStyle = '#7a6010'; ctx.fillRect(0,0,s,s);
    noiseFill(ctx, s, '#7a6010', 50, 0.8);
    ctx.fillStyle='rgba(220,180,0,.3)'; ctx.fillRect(0,0,s,s);
    ctx.strokeStyle='rgba(200,150,0,.4)'; ctx.lineWidth=1.5;
    for(let row=4;row<s;row+=7){ctx.beginPath();ctx.moveTo(0,row);ctx.lineTo(s,row);ctx.stroke();}
  });

  // Grama do chão
  TEX.grass = mkTex(128, (ctx, s) => {
    ctx.fillStyle = '#3a9822'; ctx.fillRect(0,0,s,s);
    noiseFill(ctx, s, '#3a9822', 35, 0.6);
    for(let i=0;i<50;i++){
      const gx=Math.random()*s, gy=Math.random()*s, r=Math.random()*9+4;
      ctx.fillStyle=Math.random()>.5?'rgba(0,60,0,.12)':'rgba(120,220,60,.1)';
      ctx.beginPath(); ctx.ellipse(gx,gy,r,r*.55,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
    }
    ctx.strokeStyle='rgba(60,140,20,.45)'; ctx.lineWidth=1;
    for(let i=0;i<80;i++){
      const gx=Math.random()*s, gy=Math.random()*s;
      ctx.beginPath(); ctx.moveTo(gx,gy);
      ctx.quadraticCurveTo(gx+(Math.random()-.5)*5,gy-5, gx+(Math.random()-.5)*3,gy-9);
      ctx.stroke();
    }
  });
}

const TOP_TEX = {
  [T.EMPTY]:'empty',[T.SOIL]:'soil',[T.SEED]:'seed',
  [T.SPROUT]:'sprout',[T.GROWN]:'grown',[T.READY]:'ready',
};

function getTopTex(type) { return TEX[TOP_TEX[type]] ?? TEX.empty; }

// Gerar todas as texturas agora que TEX está declarado
buildTextures();

// ─── Chão de grama (Poliigon PBR) ────────────────────────────────────────────
const _loader = new THREE.TextureLoader();
const _GP = './assets/textures/grass/2K/Poliigon_GrassPatchyGround_4585_';
function _gTex(file, srgb) {
  const t = _loader.load(_GP + file, undefined, undefined,
    ()=>{ console.warn('Grass tex fallback:', file); });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(20, 20);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const grassMat = new THREE.MeshStandardMaterial({
  map:          _gTex('BaseColor.jpg', true),
  normalMap:    _gTex('Normal.png'),
  roughnessMap: _gTex('Roughness.jpg'),
  aoMap:        _gTex('AmbientOcclusion.jpg'),
  roughness: 1, metalness: 0,
});
const grass = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), grassMat);
grass.rotation.x = -Math.PI/2;
grass.position.set(4.5, -0.05, 4.5);
grass.receiveShadow = true;
scene.add(grass);

// ─── Metal texture (Poliigon PBR) ─────────────────────────────────────────────
const _MP = './assets/textures/metal/2K/Poliigon_MetalSteelBrushed_7174_';
function _mTex(file, srgb) {
  const t = _loader.load(_MP + file, undefined, undefined,
    ()=>{ console.warn('Metal tex fallback:', file); });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const metalMat = new THREE.MeshStandardMaterial({
  map:          _mTex('BaseColor.jpg', true),
  normalMap:    _mTex('Normal.png'),
  roughnessMap: _mTex('Roughness.jpg'),
  metalnessMap: _mTex('Metallic.jpg'),
  aoMap:        _mTex('AmbientOcclusion.jpg'),
  roughness: 0.4, metalness: 1.0,
});

// ─── Blocos 3D de terra ───────────────────────────────────────────────────────
// Shininess por tipo: SOIL fica brilhante (molhado), resto fosco
const TILE_SHINE = { [T.EMPTY]:0, [T.SOIL]:90, [T.SEED]:5, [T.SPROUT]:5, [T.GROWN]:5, [T.READY]:12 };
const TILE_SPEC  = { [T.SOIL]: new THREE.Color(0x5588bb) }; // especular azulado para solo molhado

function makeTileMats(type) {
  const top  = new THREE.MeshPhongMaterial({ map: getTopTex(type), shininess: TILE_SHINE[type]??0, specular: TILE_SPEC[type] ?? new THREE.Color(0x111111) });
  const side = new THREE.MeshLambertMaterial({ map: TEX.side });
  const bot  = new THREE.MeshLambertMaterial({ color: 0x1a0a04 });
  return [side, side, top, bot, side, side];
}

const TILE_GEO   = new THREE.BoxGeometry(0.93, TILE_H, 0.93);
const tileMeshes = Array.from({length:GRID}, ()=>new Array(GRID).fill(null));

function buildTileGrid() {
  for (let y=0; y<GRID; y++) {
    for (let x=0; x<GRID; x++) {
      const mats = makeTileMats(T.EMPTY);
      const mesh = new THREE.Mesh(TILE_GEO, mats);
      mesh.position.set(x, -4, y);
      mesh.receiveShadow = true;
      mesh.castShadow    = true;
      mesh.visible       = false;
      scene.add(mesh);
      tileMeshes[y][x] = mesh;
    }
  }
}

function setTileType(x, y, type) {
  const mats = tileMeshes[y][x].material;
  mats[2].map       = getTopTex(type);
  mats[2].shininess = TILE_SHINE[type] ?? 0;
  mats[2].specular  = TILE_SPEC[type]  ?? new THREE.Color(0x111111);
  mats[2].needsUpdate = true;
}

// ─── Animação de desbloqueio do bloco ────────────────────────────────────────
function revealBlock(x, y) {
  const mesh = tileMeshes[y][x];
  mesh.visible = true;
  mesh.scale.set(1, 0.01, 1);
  mesh.position.y = 0;
  unlockAnim.push({ mesh, t: 0 });
}

function tickUnlockAnim(dt) {
  for (let i=unlockAnim.length-1; i>=0; i--) {
    const a = unlockAnim[i];
    a.t = Math.min(a.t + dt * 3.5, 1);
    const s = 1 - Math.pow(1-a.t, 3); // ease-out cubic
    a.mesh.scale.y  = s;
    a.mesh.position.y = (TILE_H/2) * s;
    if (a.t >= 1) { a.mesh.scale.y=1; a.mesh.position.y=TILE_H/2; unlockAnim.splice(i,1); }
  }
}

// ─── Plantas sobre os blocos ──────────────────────────────────────────────────
const cropMeshes = Array.from({length:GRID}, ()=>new Array(GRID).fill(null));
const CB = TILE_H; // crop base — topo do bloco

function clearCrop(x, y) {
  const m = cropMeshes[y][x];
  if (!m) return;
  scene.remove(m);
  m.traverse(c=>{ if(c.geometry) c.geometry.dispose(); if(c.material) c.material.dispose(); });
  cropMeshes[y][x] = null;
}

// ─── Modelos 3D por cultura ───────────────────────────────────────────────────
function buildMilhoModel(stage) {
  const g=new THREE.Group();
  const mS=new THREE.MeshPhongMaterial({color:0x4a9a20});
  const mL=new THREE.MeshPhongMaterial({color:0x2d8010});
  const mC=new THREE.MeshPhongMaterial({color:0xf0c000,shininess:40});
  if(stage===T.SEED){
    const s=new THREE.Mesh(new THREE.SphereGeometry(.055,7,5),new THREE.MeshPhongMaterial({color:0xc8a020}));
    s.scale.set(1,.65,1.3); s.position.y=.065; g.add(s);
  } else if(stage===T.SPROUT){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.018,.022,.18,5),mS); st.position.y=.09; g.add(st);
    [-1,1].forEach(i=>{const l=new THREE.Mesh(new THREE.BoxGeometry(.035,.008,.14),mL);l.position.set(Math.sin(i*.7)*.09,.17,0);l.rotation.z=i*.7;g.add(l);});
  } else if(stage===T.GROWN){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.02,.027,.40,5),mS); st.position.y=.2; g.add(st);
    [[.09,1],[.22,-1],[.36,.8]].forEach(([h,s])=>{const l=new THREE.Mesh(new THREE.BoxGeometry(.038,.009,.17),mL);l.position.set(Math.sin(s*.9)*.1,h,0);l.rotation.z=s*.9;g.add(l);});
  } else if(stage===T.READY){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.02,.027,.52,5),mS); st.position.y=.26; g.add(st);
    [[.08,1],[.2,-1],[.34,.8],[.46,-.9]].forEach(([h,s])=>{const l=new THREE.Mesh(new THREE.BoxGeometry(.038,.009,.18),mL);l.position.set(Math.sin(s*.9)*.1,h,0);l.rotation.z=s*.9;g.add(l);});
    const cp=new THREE.Group(); cp.position.set(0,.3,0); cp.rotation.z=-.45;
    const cob=new THREE.Mesh(new THREE.CylinderGeometry(.062,.068,.21,8),mC); cob.position.y=.105; cp.add(cob);
    const silk=new THREE.Mesh(new THREE.ConeGeometry(.03,.09,6),new THREE.MeshPhongMaterial({color:0xc88800})); silk.position.y=.22; cp.add(silk);
    g.add(cp);
  }
  return g;
}

function buildSojaModel(stage) {
  const g=new THREE.Group();
  const mS=new THREE.MeshPhongMaterial({color:0x5a8820});
  const mL=new THREE.MeshPhongMaterial({color:0x3a8830});
  const mP=new THREE.MeshPhongMaterial({color:0x90b840});
  if(stage===T.SEED){
    const s=new THREE.Mesh(new THREE.SphereGeometry(.055,7,5),new THREE.MeshPhongMaterial({color:0xd4c060}));
    s.scale.set(1.2,.75,1); s.position.y=.06; g.add(s);
  } else if(stage===T.SPROUT){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.016,.02,.14,5),mS); st.position.y=.07; g.add(st);
    [-1,1].forEach(i=>{const l=new THREE.Mesh(new THREE.SphereGeometry(.065,6,4),mL);l.scale.set(1,.2,1.3);l.position.set(i*.09,.15,0);g.add(l);});
  } else if(stage===T.GROWN){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.018,.022,.24,5),mS); st.position.y=.12; g.add(st);
    for(let i=0;i<5;i++){const a=(i/5)*Math.PI*2;const l=new THREE.Mesh(new THREE.SphereGeometry(.068,5,4),mL);l.scale.set(1,.2,1.3);l.position.set(Math.cos(a)*.11,.18+(i%3)*.055,Math.sin(a)*.11);g.add(l);}
  } else if(stage===T.READY){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.018,.022,.28,5),mS); st.position.y=.14; g.add(st);
    for(let i=0;i<5;i++){const a=(i/5)*Math.PI*2;const l=new THREE.Mesh(new THREE.SphereGeometry(.065,5,4),mL);l.scale.set(1,.2,1.3);l.position.set(Math.cos(a)*.1,.2+(i%3)*.05,Math.sin(a)*.1);g.add(l);}
    for(let i=0;i<4;i++){const a=(i/4)*Math.PI*2+.4;const pod=new THREE.Mesh(new THREE.CylinderGeometry(.022,.022,.11,5),mP);pod.position.set(Math.cos(a)*.13,.2+(i%2)*.09,Math.sin(a)*.13);pod.rotation.z=.55;pod.rotation.y=a;g.add(pod);}
  }
  return g;
}

function buildFeijaoModel(stage) {
  const g=new THREE.Group();
  const mS=new THREE.MeshPhongMaterial({color:0x4a7530});
  const mL=new THREE.MeshPhongMaterial({color:0x2f6020});
  const mP=new THREE.MeshPhongMaterial({color:0x6b8a3a});
  const mB=new THREE.MeshPhongMaterial({color:0x8b3a2a,shininess:12});
  if(stage===T.SEED){
    const s=new THREE.Mesh(new THREE.SphereGeometry(.06,7,5),mB);
    s.scale.set(1.3,.7,1); s.position.y=.06; g.add(s);
  } else if(stage===T.SPROUT){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.018,.022,.16,5),mS); st.position.y=.08; g.add(st);
    [-1,1].forEach(i=>{
      const l=new THREE.Mesh(new THREE.SphereGeometry(.07,6,4),mL);
      l.scale.set(1,.22,1.2); l.position.set(i*.08,.16,0); g.add(l);
    });
  } else if(stage===T.GROWN){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.02,.025,.28,5),mS); st.position.y=.14; g.add(st);
    for(let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2; const h=.16+(i%3)*.05;
      const l=new THREE.Mesh(new THREE.SphereGeometry(.072,5,4),mL);
      l.scale.set(1,.2,1.4); l.position.set(Math.cos(a)*.11,h,Math.sin(a)*.11); g.add(l);
    }
  } else if(stage===T.READY){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.02,.025,.32,5),mS); st.position.y=.16; g.add(st);
    for(let i=0;i<5;i++){
      const a=(i/5)*Math.PI*2;
      const l=new THREE.Mesh(new THREE.SphereGeometry(.07,5,4),mL);
      l.scale.set(1,.2,1.3); l.position.set(Math.cos(a)*.1,.22+(i%3)*.05,Math.sin(a)*.1); g.add(l);
    }
    for(let i=0;i<5;i++){
      const a=(i/5)*Math.PI*2+.3; const h=.18+(i%2)*.1;
      const pod=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.16,6),mP);
      pod.position.set(Math.cos(a)*.13,h,Math.sin(a)*.13);
      pod.rotation.z=.65; pod.rotation.y=a; g.add(pod);
      for(let j=0;j<3;j++){
        const bean=new THREE.Mesh(new THREE.SphereGeometry(.022,5,4),mB);
        bean.scale.set(1,.7,1.4);
        bean.position.set(Math.cos(a)*.13 + Math.cos(a+1.5)*((j-1)*.045),
                          h + .015,
                          Math.sin(a)*.13 + Math.sin(a+1.5)*((j-1)*.045));
        g.add(bean);
      }
    }
  }
  return g;
}

function buildAlgodaoModel(stage) {
  const g=new THREE.Group();
  const mS=new THREE.MeshPhongMaterial({color:0x6a7030});
  const mL=new THREE.MeshPhongMaterial({color:0x4a7020});
  const mB=new THREE.MeshPhongMaterial({color:0xf2f2f2,shininess:8});
  if(stage===T.SEED){
    const s=new THREE.Mesh(new THREE.SphereGeometry(.05,7,5),new THREE.MeshPhongMaterial({color:0xd8c8a0}));
    s.position.y=.06; g.add(s);
  } else if(stage===T.SPROUT){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.016,.02,.15,5),mS); st.position.y=.075; g.add(st);
    const l=new THREE.Mesh(new THREE.SphereGeometry(.078,5,2),mL);l.scale.set(1,.2,1);l.position.y=.17;g.add(l);
  } else if(stage===T.GROWN){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.02,.025,.32,5),mS); st.position.y=.16; g.add(st);
    for(let i=0;i<3;i++){const a=(i/3)*Math.PI*2;const br=new THREE.Mesh(new THREE.CylinderGeometry(.01,.013,.14,4),mS);br.position.set(Math.cos(a)*.07,.25+(i*.04),Math.sin(a)*.07);br.rotation.z=Math.cos(a)*.6;br.rotation.x=Math.sin(a)*.6;g.add(br);const l=new THREE.Mesh(new THREE.SphereGeometry(.065,5,2),mL);l.scale.set(1,.2,1);l.position.set(Math.cos(a)*.15,.28+(i*.04),Math.sin(a)*.15);g.add(l);}
  } else if(stage===T.READY){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.02,.025,.36,5),mS); st.position.y=.18; g.add(st);
    for(let i=0;i<4;i++){
      const a=(i/4)*Math.PI*2; const bh=.22+(i%2)*.1;
      const br=new THREE.Mesh(new THREE.CylinderGeometry(.01,.013,.13,4),mS);br.position.set(Math.cos(a)*.06,bh,Math.sin(a)*.06);br.rotation.z=Math.cos(a)*.7;br.rotation.x=Math.sin(a)*.7;g.add(br);
      const boll=new THREE.Mesh(new THREE.SphereGeometry(.075,8,6),mB);boll.position.set(Math.cos(a)*.16,bh+.04,Math.sin(a)*.16);g.add(boll);
      for(let j=0;j<3;j++){const ja=(j/3)*Math.PI*2;const f=new THREE.Mesh(new THREE.SphereGeometry(.048,6,4),mB);f.position.set(Math.cos(a)*.16+Math.cos(ja)*.055,bh+.07,Math.sin(a)*.16+Math.sin(ja)*.055);g.add(f);}
    }
  }
  return g;
}

// ─── Trigo ───────────────────────────────────────────────────────────────────
function buildTrigoModel(stage){
  const g=new THREE.Group();
  const mS=new THREE.MeshPhongMaterial({color:0x8a9a30});
  const mY=new THREE.MeshPhongMaterial({color:0xe8c46a});
  const mG=new THREE.MeshPhongMaterial({color:0xc8a040});
  if(stage===T.SEED){
    const s=new THREE.Mesh(new THREE.SphereGeometry(.05,7,5),mY); s.scale.set(1.4,.6,1); s.position.y=.05; g.add(s);
  } else if(stage===T.SPROUT){
    for(let i=0;i<3;i++){
      const a=(i/3)*Math.PI*2;
      const st=new THREE.Mesh(new THREE.CylinderGeometry(.008,.011,.18,4),mS);
      st.position.set(Math.cos(a)*.04,.09,Math.sin(a)*.04); g.add(st);
    }
  } else if(stage===T.GROWN){
    for(let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2;
      const st=new THREE.Mesh(new THREE.CylinderGeometry(.009,.012,.36,4),mS);
      st.position.set(Math.cos(a)*.06,.18,Math.sin(a)*.06); g.add(st);
    }
  } else if(stage===T.READY){
    for(let i=0;i<8;i++){
      const a=(i/8)*Math.PI*2; const r=.07;
      const st=new THREE.Mesh(new THREE.CylinderGeometry(.009,.012,.46,4),mG);
      st.position.set(Math.cos(a)*r,.23,Math.sin(a)*r); g.add(st);
      const ear=new THREE.Mesh(new THREE.CylinderGeometry(.022,.014,.14,5),mY);
      ear.position.set(Math.cos(a)*r,.52,Math.sin(a)*r); g.add(ear);
      for(let j=0;j<3;j++){
        const aw=new THREE.Mesh(new THREE.CylinderGeometry(.002,.002,.10,3),mY);
        aw.position.set(Math.cos(a)*r,.60+j*.02,Math.sin(a)*r);
        aw.rotation.z=(j-1)*.4; g.add(aw);
      }
    }
  }
  return g;
}

// ─── Batata ──────────────────────────────────────────────────────────────────
function buildBatataModel(stage){
  const g=new THREE.Group();
  const mL=new THREE.MeshPhongMaterial({color:0x2d6818});
  const mF=new THREE.MeshPhongMaterial({color:0xc8c068});
  const mT=new THREE.MeshPhongMaterial({color:0xb5894a});
  if(stage===T.SEED){
    const s=new THREE.Mesh(new THREE.SphereGeometry(.06,6,5),mT); s.scale.set(1.3,.7,1); s.position.y=.05; g.add(s);
  } else if(stage===T.SPROUT){
    for(let i=0;i<3;i++){
      const a=(i/3)*Math.PI*2;
      const l=new THREE.Mesh(new THREE.SphereGeometry(.07,6,4),mL);
      l.scale.set(1,.25,1); l.position.set(Math.cos(a)*.05,.07+i*.02,Math.sin(a)*.05); g.add(l);
    }
  } else if(stage===T.GROWN){
    for(let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2; const r=.1;
      const l=new THREE.Mesh(new THREE.SphereGeometry(.09,6,4),mL);
      l.scale.set(1,.3,1); l.position.set(Math.cos(a)*r,.10+(i%2)*.05,Math.sin(a)*r); g.add(l);
    }
    for(let i=0;i<3;i++){
      const a=(i/3)*Math.PI*2;
      const f=new THREE.Mesh(new THREE.SphereGeometry(.022,5,4),mF);
      f.position.set(Math.cos(a)*.07,.22,Math.sin(a)*.07); g.add(f);
    }
  } else if(stage===T.READY){
    for(let i=0;i<8;i++){
      const a=(i/8)*Math.PI*2; const r=.12;
      const l=new THREE.Mesh(new THREE.SphereGeometry(.1,6,4),mL);
      l.scale.set(1,.32,1); l.position.set(Math.cos(a)*r,.12+(i%3)*.05,Math.sin(a)*r); g.add(l);
    }
    for(let i=0;i<5;i++){
      const a=(i/5)*Math.PI*2+.3; const r=.16;
      const t=new THREE.Mesh(new THREE.SphereGeometry(.06,7,5),mT);
      t.scale.set(1.4,.7,1); t.position.set(Math.cos(a)*r,.04,Math.sin(a)*r);
      t.rotation.y=a; g.add(t);
    }
  }
  return g;
}

// ─── Tomate ──────────────────────────────────────────────────────────────────
function buildTomateModel(stage){
  const g=new THREE.Group();
  const mS=new THREE.MeshPhongMaterial({color:0x4a8a30});
  const mL=new THREE.MeshPhongMaterial({color:0x2f7022});
  const mF=new THREE.MeshPhongMaterial({color:0xffe888});
  const mR=new THREE.MeshPhongMaterial({color:0xd9342b,shininess:50});
  if(stage===T.SEED){
    const s=new THREE.Mesh(new THREE.SphereGeometry(.05,7,5),new THREE.MeshPhongMaterial({color:0xd9c060}));
    s.scale.set(1,.7,1.2); s.position.y=.05; g.add(s);
  } else if(stage===T.SPROUT){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.014,.018,.16,5),mS); st.position.y=.08; g.add(st);
    [-1,1].forEach(i=>{const l=new THREE.Mesh(new THREE.SphereGeometry(.06,5,4),mL);l.scale.set(1.3,.2,1);l.position.set(i*.07,.16,0);g.add(l);});
  } else if(stage===T.GROWN){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.018,.022,.36,5),mS); st.position.y=.18; g.add(st);
    for(let i=0;i<5;i++){
      const a=(i/5)*Math.PI*2;
      const l=new THREE.Mesh(new THREE.SphereGeometry(.075,5,4),mL);
      l.scale.set(1.3,.2,1); l.position.set(Math.cos(a)*.1,.16+(i%3)*.06,Math.sin(a)*.1); g.add(l);
    }
    for(let i=0;i<3;i++){
      const a=(i/3)*Math.PI*2;
      const f=new THREE.Mesh(new THREE.SphereGeometry(.025,5,4),mF);
      f.position.set(Math.cos(a)*.09,.30,Math.sin(a)*.09); g.add(f);
    }
  } else if(stage===T.READY){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.02,.025,.42,5),mS); st.position.y=.21; g.add(st);
    for(let i=0;i<5;i++){
      const a=(i/5)*Math.PI*2;
      const l=new THREE.Mesh(new THREE.SphereGeometry(.07,5,4),mL);
      l.scale.set(1.3,.2,1); l.position.set(Math.cos(a)*.1,.18+(i%3)*.06,Math.sin(a)*.1); g.add(l);
    }
    for(let i=0;i<5;i++){
      const a=(i/5)*Math.PI*2+.4; const h=.18+(i%2)*.12;
      const t=new THREE.Mesh(new THREE.SphereGeometry(.062,8,6),mR);
      t.position.set(Math.cos(a)*.13,h,Math.sin(a)*.13); g.add(t);
      const cap=new THREE.Mesh(new THREE.ConeGeometry(.022,.025,5),mL);
      cap.position.set(Math.cos(a)*.13,h+.06,Math.sin(a)*.13); g.add(cap);
    }
  }
  return g;
}

// ─── Cenoura ─────────────────────────────────────────────────────────────────
function buildCenouraModel(stage){
  const g=new THREE.Group();
  const mL=new THREE.MeshPhongMaterial({color:0x3a8830});
  const mD=new THREE.MeshPhongMaterial({color:0x2a6f24});
  const mC=new THREE.MeshPhongMaterial({color:0xff8c2a,shininess:30});
  if(stage===T.SEED){
    const s=new THREE.Mesh(new THREE.SphereGeometry(.04,6,4),new THREE.MeshPhongMaterial({color:0xb09060}));
    s.position.y=.04; g.add(s);
  } else if(stage===T.SPROUT){
    for(let i=0;i<4;i++){
      const a=(i/4)*Math.PI*2;
      const l=new THREE.Mesh(new THREE.ConeGeometry(.022,.16,4),mL);
      l.position.set(Math.cos(a)*.03,.09,Math.sin(a)*.03);
      l.rotation.z=Math.cos(a)*.3; l.rotation.x=Math.sin(a)*.3; g.add(l);
    }
  } else if(stage===T.GROWN){
    for(let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2;
      const l=new THREE.Mesh(new THREE.ConeGeometry(.03,.30,5),mL);
      l.position.set(Math.cos(a)*.05,.17,Math.sin(a)*.05);
      l.rotation.z=Math.cos(a)*.4; l.rotation.x=Math.sin(a)*.4; g.add(l);
    }
  } else if(stage===T.READY){
    for(let i=0;i<8;i++){
      const a=(i/8)*Math.PI*2;
      const l=new THREE.Mesh(new THREE.ConeGeometry(.035,.36,5),i%2?mL:mD);
      l.position.set(Math.cos(a)*.06,.22,Math.sin(a)*.06);
      l.rotation.z=Math.cos(a)*.5; l.rotation.x=Math.sin(a)*.5; g.add(l);
    }
    const root=new THREE.Mesh(new THREE.ConeGeometry(.07,.18,7),mC);
    root.rotation.x=Math.PI;
    root.position.y=.04; g.add(root);
    const shoulder=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,.04,8),mC);
    shoulder.position.y=.06; g.add(shoulder);
  }
  return g;
}

// ─── Abóbora ─────────────────────────────────────────────────────────────────
function buildAboboraModel(stage){
  const g=new THREE.Group();
  const mV=new THREE.MeshPhongMaterial({color:0x3d6a2a});
  const mL=new THREE.MeshPhongMaterial({color:0x2f7022});
  const mF=new THREE.MeshPhongMaterial({color:0xffe066});
  const mP=new THREE.MeshPhongMaterial({color:0xe88a1a,shininess:25});
  const mPd=new THREE.MeshPhongMaterial({color:0x6b4a18});
  if(stage===T.SEED){
    const s=new THREE.Mesh(new THREE.SphereGeometry(.055,7,5),new THREE.MeshPhongMaterial({color:0xd8c890}));
    s.scale.set(1,.5,1.2); s.position.y=.04; g.add(s);
  } else if(stage===T.SPROUT){
    for(let i=0;i<3;i++){
      const a=(i/3)*Math.PI*2;
      const l=new THREE.Mesh(new THREE.SphereGeometry(.08,5,4),mL);
      l.scale.set(1,.18,1); l.position.set(Math.cos(a)*.06,.05,Math.sin(a)*.06); g.add(l);
    }
  } else if(stage===T.GROWN){
    for(let i=0;i<5;i++){
      const a=(i/5)*Math.PI*2; const r=.14;
      const v=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.18,4),mV);
      v.position.set(Math.cos(a)*r/2,.05,Math.sin(a)*r/2);
      v.rotation.z=Math.PI/2; v.rotation.y=a; g.add(v);
      const l=new THREE.Mesh(new THREE.SphereGeometry(.11,6,4),mL);
      l.scale.set(1,.18,1); l.position.set(Math.cos(a)*r,.06,Math.sin(a)*r); g.add(l);
    }
    const f=new THREE.Mesh(new THREE.ConeGeometry(.06,.08,6),mF);
    f.position.set(.08,.10,-.05); g.add(f);
  } else if(stage===T.READY){
    for(let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2; const r=.17;
      const l=new THREE.Mesh(new THREE.SphereGeometry(.12,6,4),mL);
      l.scale.set(1,.18,1); l.position.set(Math.cos(a)*r,.07,Math.sin(a)*r); g.add(l);
    }
    const pump=new THREE.Mesh(new THREE.SphereGeometry(.22,12,10),mP);
    pump.scale.set(1.2,.85,1.2); pump.position.y=.18; g.add(pump);
    for(let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2;
      const rib=new THREE.Mesh(new THREE.TorusGeometry(.04,.018,4,8),mP);
      rib.rotation.y=a; rib.rotation.x=Math.PI/2;
      rib.position.set(Math.cos(a)*.22,.18,Math.sin(a)*.22);
      rib.scale.set(1,1,4); g.add(rib);
    }
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(.025,.035,.08,5),mPd);
    stem.position.y=.36; g.add(stem);
  }
  return g;
}

// ─── Cana de açúcar ──────────────────────────────────────────────────────────
function buildCanaModel(stage){
  const g=new THREE.Group();
  const mS=new THREE.MeshPhongMaterial({color:0x9be07a});
  const mL=new THREE.MeshPhongMaterial({color:0x4aa030});
  const mT=new THREE.MeshPhongMaterial({color:0xeaffc8});
  if(stage===T.SEED){
    const s=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.08,5),mS);
    s.rotation.z=Math.PI/2; s.position.y=.03; g.add(s);
  } else if(stage===T.SPROUT){
    for(let i=0;i<3;i++){
      const a=(i/3)*Math.PI*2;
      const st=new THREE.Mesh(new THREE.CylinderGeometry(.018,.022,.22,5),mS);
      st.position.set(Math.cos(a)*.05,.11,Math.sin(a)*.05); g.add(st);
    }
  } else if(stage===T.GROWN){
    for(let i=0;i<5;i++){
      const a=(i/5)*Math.PI*2; const r=.07;
      const st=new THREE.Mesh(new THREE.CylinderGeometry(.022,.026,.55,6),mS);
      st.position.set(Math.cos(a)*r,.28,Math.sin(a)*r); g.add(st);
      for(let n=1;n<=2;n++){
        const ring=new THREE.Mesh(new THREE.TorusGeometry(.026,.005,4,8),mL);
        ring.position.set(Math.cos(a)*r,.13*n,Math.sin(a)*r);
        ring.rotation.x=Math.PI/2; g.add(ring);
      }
      const lf=new THREE.Mesh(new THREE.ConeGeometry(.025,.18,4),mL);
      lf.position.set(Math.cos(a)*r,.45,Math.sin(a)*r);
      lf.rotation.z=Math.cos(a)*.8; lf.rotation.x=Math.sin(a)*.8; g.add(lf);
    }
  } else if(stage===T.READY){
    for(let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2; const r=.08;
      const st=new THREE.Mesh(new THREE.CylinderGeometry(.024,.028,.78,6),mS);
      st.position.set(Math.cos(a)*r,.39,Math.sin(a)*r); g.add(st);
      for(let n=1;n<=4;n++){
        const ring=new THREE.Mesh(new THREE.TorusGeometry(.029,.006,4,8),mL);
        ring.position.set(Math.cos(a)*r,.16*n,Math.sin(a)*r);
        ring.rotation.x=Math.PI/2; g.add(ring);
      }
      const tassel=new THREE.Mesh(new THREE.ConeGeometry(.05,.18,5),mT);
      tassel.position.set(Math.cos(a)*r,.86,Math.sin(a)*r); g.add(tassel);
      for(let j=0;j<2;j++){
        const lf=new THREE.Mesh(new THREE.ConeGeometry(.032,.32,4),mL);
        lf.position.set(Math.cos(a)*r,.55+j*.1,Math.sin(a)*r);
        lf.rotation.z=Math.cos(a+j)*.9; lf.rotation.x=Math.sin(a+j)*.9; g.add(lf);
      }
    }
  }
  return g;
}

// ─── Uva (videira em treliça) ────────────────────────────────────────────────
function buildUvaModel(stage){
  const g=new THREE.Group();
  const mW=new THREE.MeshPhongMaterial({color:0x7a5a30});
  const mV=new THREE.MeshPhongMaterial({color:0x6b4a20});
  const mL=new THREE.MeshPhongMaterial({color:0x4a8a30});
  const mU=new THREE.MeshPhongMaterial({color:0x6a3a8b,shininess:40});
  const mF=new THREE.MeshPhongMaterial({color:0xfff0a0});
  if(stage===T.SEED){
    const s=new THREE.Mesh(new THREE.SphereGeometry(.045,6,5),mU); s.position.y=.045; g.add(s);
  } else if(stage===T.SPROUT){
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.018,.025,.20,5),mV); st.position.y=.10; g.add(st);
    for(let i=0;i<2;i++){
      const a=i*Math.PI;
      const l=new THREE.Mesh(new THREE.SphereGeometry(.06,5,4),mL);
      l.scale.set(1.2,.18,1.2); l.position.set(Math.cos(a)*.05,.18,Math.sin(a)*.05); g.add(l);
    }
  } else if(stage===T.GROWN){
    const post=new THREE.Mesh(new THREE.CylinderGeometry(.022,.022,.5,5),mW);
    post.position.y=.25; g.add(post);
    const arm=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.4,5),mW);
    arm.rotation.z=Math.PI/2; arm.position.y=.45; g.add(arm);
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.025,.035,.45,6),mV);
    trunk.position.set(.04,.22,0); trunk.rotation.z=.18; g.add(trunk);
    for(let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2;
      const l=new THREE.Mesh(new THREE.SphereGeometry(.085,5,4),mL);
      l.scale.set(1.3,.2,1.3); l.position.set(Math.cos(a)*.14,.42,Math.sin(a)*.14); g.add(l);
    }
    for(let i=0;i<3;i++){
      const a=(i/3)*Math.PI*2;
      const f=new THREE.Mesh(new THREE.SphereGeometry(.02,5,4),mF);
      f.position.set(Math.cos(a)*.1,.36,Math.sin(a)*.1); g.add(f);
    }
  } else if(stage===T.READY){
    const post1=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.6,5),mW);
    post1.position.set(-.14,.30,0); g.add(post1);
    const post2=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.6,5),mW);
    post2.position.set( .14,.30,0); g.add(post2);
    const top=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.36,5),mW);
    top.rotation.z=Math.PI/2; top.position.y=.58; g.add(top);
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.03,.04,.5,6),mV);
    trunk.position.y=.25; g.add(trunk);
    for(let i=0;i<10;i++){
      const a=(i/10)*Math.PI*2; const r=.18;
      const l=new THREE.Mesh(new THREE.SphereGeometry(.1,5,4),mL);
      l.scale.set(1.3,.22,1.3); l.position.set(Math.cos(a)*r,.55+(i%3)*.04,Math.sin(a)*r); g.add(l);
    }
    const clusters=[ [-.10,.35,.05], [.10,.32,-.05], [.0,.40,.12] ];
    for(const [cx,cy,cz] of clusters){
      const cg=new THREE.Group();
      cg.position.set(cx,cy,cz);
      const rows=[
        {y:0,    r:.07, n:6},
        {y:-.06, r:.055,n:5},
        {y:-.12, r:.04, n:4},
        {y:-.17, r:.025,n:3},
        {y:-.21, r:.012,n:1},
      ];
      for(const row of rows){
        for(let i=0;i<row.n;i++){
          const a=(i/row.n)*Math.PI*2;
          const b=new THREE.Mesh(new THREE.SphereGeometry(.028,7,6),mU);
          b.position.set(Math.cos(a)*row.r, row.y, Math.sin(a)*row.r);
          cg.add(b);
        }
      }
      const center=new THREE.Mesh(new THREE.SphereGeometry(.03,7,6),mU);
      center.position.y=-.06; cg.add(center);
      g.add(cg);
    }
  }
  return g;
}

function makeCrop(x, y, type) {
  clearCrop(x, y);
  if(type===T.EMPTY||type===T.SOIL) return;
  const ct=grid[y][x].crop||'milho';
  const builders = {
    milho:   buildMilhoModel,
    soja:    buildSojaModel,
    feijao:  buildFeijaoModel,
    algodao: buildAlgodaoModel,
    trigo:   buildTrigoModel,
    batata:  buildBatataModel,
    tomate:  buildTomateModel,
    cenoura: buildCenouraModel,
    abobora: buildAboboraModel,
    cana:    buildCanaModel,
    uva:     buildUvaModel,
  };
  const fn = builders[ct] || buildMilhoModel;
  const obj = fn(type);
  if(obj){
    obj.position.set(x,CB,y);
    obj.traverse(c=>{ if(c.isMesh) c.castShadow=true; });
    scene.add(obj);
    cropMeshes[y][x]=obj;
  }
}

function syncTile(x, y) {
  const locked = x>=unlockedSize || y>=unlockedSize;
  const mesh   = tileMeshes[y][x];
  if (locked) { mesh.visible=false; clearCrop(x,y); return; }
  mesh.visible = true;
  const type   = grid[y][x].type;
  setTileType(x, y, type);
  if (type===T.EMPTY||type===T.SOIL) clearCrop(x,y);
  else makeCrop(x,y,type);
}

// ─── Partículas de colheita ───────────────────────────────────────────────────
const particles = [];
function spawnFX(wx, wz) {
  const N=16, pos=new Float32Array(N*3), vel=[];
  for(let i=0;i<N;i++){ pos[i*3]=wx;pos[i*3+1]=CB+0.3;pos[i*3+2]=wz; vel.push(new THREE.Vector3((Math.random()-.5)*.13,Math.random()*.14+.05,(Math.random()-.5)*.13)); }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  const p=new THREE.Points(g,new THREE.PointsMaterial({color:0xffd700,size:.09,transparent:true}));
  scene.add(p); particles.push({mesh:p,vel,life:1});
}
function tickParticles(dt) {
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i]; p.life-=dt*2; p.mesh.material.opacity=Math.max(p.life,0);
    const pos=p.mesh.geometry.attributes.position.array;
    for(let j=0;j<p.vel.length;j++){pos[j*3]+=p.vel[j].x;pos[j*3+1]+=p.vel[j].y;pos[j*3+2]+=p.vel[j].z;p.vel[j].y-=.006;}
    p.mesh.geometry.attributes.position.needsUpdate=true;
    if(p.life<=0){scene.remove(p.mesh);particles.splice(i,1);}
  }
}

// ─── Carregador de Chapéu FBX ─────────────────────────────────────────────────
const fbxLoader = new FBXLoader();
let hatModel3D = null;

async function loadHatModel() {
  return new Promise((resolve, reject) => {
    fbxLoader.load(
      './assets/models/hat/source/CHAPEU TESTE.fbx',
      (fbx) => {
        fbx.scale.set(0.01, 0.01, 0.01); // Ajustar escala
        fbx.position.set(0, 0.15, 0); // Posição original
        fbx.rotation.order = 'YXZ';
        fbx.rotation.x = -Math.PI / 2; // Virar para deitar (invertido)
        fbx.rotation.y = Math.PI / 2; // Girar 90 graus no eixo Y
        
        // Processar o modelo para aceitar mudanças de cor
        fbx.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            
            // Material sólido sem textura
            const solidMaterial = new THREE.MeshPhongMaterial({
              color: 0x6b3410, // Marrom padrão
              emissive: 0x3d1a08,
              emissiveIntensity: 0.2,
              shininess: 60,
              flatShading: false
            });
            
            child.material = solidMaterial;
          }
        });
        
        hatModel3D = fbx;
        resolve(fbx);
        log('✨ Chapéu FBX carregado com sucesso! 🤠', 'ok');
      },
      undefined,
      (error) => {
        log('❌ Erro ao carregar chapéu FBX: ' + error.message, 'error');
        reject(error);
      }
    );
  });
}

// ─── Helipad ──────────────────────────────────────────────────────────────────
function buildHelipad() {
  const helipad = new THREE.Group();
  // Posição fixa: canto inferior-esquerdo, logo fora da fazenda inicial (x=-2, z=-2)
  helipad.position.set(-2, 0.01, -2);
  
  // Círculo de pouso (base)
  const circleMat = new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x222222, shininess: 30 });
  const circleGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.05, 32);
  const circleMesh = new THREE.Mesh(circleGeo, circleMat);
  circleMesh.position.y = 0.025;
  circleMesh.receiveShadow = true;
  circleMesh.castShadow = true;
  helipad.add(circleMesh);
  
  // H de helipad (marcações planas no eixo X)
  const lineMat = new THREE.MeshPhongMaterial({ color: 0xff0000, emissive: 0x440000 });
  
  // Linha vertical esquerda do H (deitada no chão, ao longo de Z)
  const lineGeo = new THREE.BoxGeometry(0.15, 0.05, 0.8);
  const line1 = new THREE.Mesh(lineGeo, lineMat);
  line1.position.set(-0.3, 0.08, 0);
  line1.castShadow = true;
  helipad.add(line1);
  
  // Linha vertical direita do H
  const line2 = new THREE.Mesh(lineGeo, lineMat);
  line2.position.set(0.3, 0.08, 0);
  line2.castShadow = true;
  helipad.add(line2);
  
  // Linha horizontal do H (ao longo de X)
  const hbarGeo = new THREE.BoxGeometry(0.6, 0.05, 0.15);
  const line3 = new THREE.Mesh(hbarGeo, lineMat);
  line3.position.set(0, 0.08, 0);
  line3.castShadow = true;
  helipad.add(line3);
  
  // Círculo vermelho externo
  const borderMat = new THREE.MeshPhongMaterial({ color: 0xff3333, emissive: 0x550000 });
  const borderGeo = new THREE.CylinderGeometry(1.15, 1.15, 0.02, 32);
  const borderMesh = new THREE.Mesh(borderGeo, borderMat);
  borderMesh.position.y = 0.06;
  borderMesh.castShadow = true;
  helipad.add(borderMesh);
  
  scene.add(helipad);
  window.helipadMesh = helipad; // Guardar referência
}

// ─── Árvores decorativas (Tree.fbx) ──────────────────────────────────────────
let treeModel3D = null;
const treeMeshes = [];
const treeOccupied = new Map(); // "x,y" -> contagem (permite múltiplas por tile)

// ─── Sistema de madeira ─────────────────────────────────────────────────────
let woodTotal = 0;
const TREE_WOOD = 2;            // madeira por árvore
const TREE_REGROW_MS = 60000;   // 60s para crescer
const TREE_SPROUT_FRACTION = 0.4; // 40% do tempo como broto, 60% adulta crescendo

function _buildSprout(){
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b3a18, roughness: 0.9, flatShading: true });
  const leafMat  = new THREE.MeshStandardMaterial({ color: 0x44aa44, roughness: 0.85, flatShading: true });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.18, 5), trunkMat);
  trunk.position.y = 0.09; trunk.castShadow = true;
  g.add(trunk);
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.35, 6), leafMat);
  leaf.position.y = 0.32; leaf.castShadow = true;
  g.add(leaf);
  return g;
}

function harvestTree(treeRoot){
  const ud = treeRoot.userData;
  if (!ud || !ud.isTree || ud.harvested) return false;
  ud.harvested = true;
  // Guarda posição/escala/rotação para regenerar igual
  ud._origPos = treeRoot.position.clone();
  ud._origRot = treeRoot.rotation.clone();
  ud._origScale = treeRoot.scale.clone();
  scene.remove(treeRoot);

  woodTotal += TREE_WOOD;
  droneInventory.madeira = (droneInventory.madeira||0) + TREE_WOOD;
  harvestCount += TREE_WOOD;          // XP de expansão
  log(`🪵 +${TREE_WOOD} madeira no drone (${droneTotal()}/${droneCapacity()}) +${TREE_WOOD} XP`, 'ok');
  if (typeof updateStats === 'function') updateStats();

  // Spawn broto imediatamente
  const sprout = _buildSprout();
  sprout.position.copy(ud._origPos);
  sprout.userData.isSprout = true;
  sprout.userData.startMs = performance.now();
  sprout.userData.parentTree = treeRoot;
  scene.add(sprout);
  ud._sproutMesh = sprout;
  return true;
}

function tickTreeGrowth(){
  // Verifica brotos: faz crescer e converte em adulta após TREE_REGROW_MS
  for (let i = treeMeshes.length - 1; i >= 0; i--) {
    const tree = treeMeshes[i];
    const ud = tree.userData;
    if (!ud.harvested || !ud._sproutMesh) continue;
    const sprout = ud._sproutMesh;
    // Se um silo foi colocado por cima depois da colheita, não regenera a árvore
    const ox = ud._origPos ? ud._origPos.x : sprout.position.x;
    const oz = ud._origPos ? ud._origPos.z : sprout.position.z;
    if (isPointNearAnySilo(ox, oz)) {
      scene.remove(sprout);
      ud._sproutMesh = null;
      treeMeshes.splice(i, 1);
      continue;
    }
    const elapsed = (performance.now() - sprout.userData.startMs) / TREE_REGROW_MS;
    if (elapsed < TREE_SPROUT_FRACTION) {
      // fase broto: cresce de 0.6 → 1.2
      const f = elapsed / TREE_SPROUT_FRACTION;
      const s = 0.6 + f * 0.6;
      sprout.scale.set(s, s, s);
    } else if (elapsed < 1.0) {
      // fase adulta crescendo: troca para árvore real e escala 0.3 → 1.0
      if (!ud._adultGrowing) {
        scene.remove(sprout);
        scene.add(tree);
        tree.position.copy(ud._origPos);
        tree.rotation.copy(ud._origRot);
        ud._adultGrowing = true;
      }
      const f = (elapsed - TREE_SPROUT_FRACTION) / (1 - TREE_SPROUT_FRACTION);
      const s = 0.3 + f * 0.7;
      tree.scale.set(
        ud._origScale.x * s,
        ud._origScale.y * s,
        ud._origScale.z * s,
      );
    } else {
      // pronta!
      tree.scale.copy(ud._origScale);
      ud.harvested = false;
      ud._sproutMesh = null;
      ud._adultGrowing = false;
    }
  }
}

// Árvore procedural de fallback (low-poly)
function buildProceduralTree() {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b3a18, roughness: 0.9, flatShading: true });
  const leafMat  = new THREE.MeshStandardMaterial({ color: 0x2e8b3a, roughness: 0.85, flatShading: true });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.4, 6), trunkMat);
  trunk.position.y = 0.7;
  trunk.castShadow = true; trunk.receiveShadow = true;
  g.add(trunk);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 0), leafMat);
  crown.position.y = 1.85;
  crown.castShadow = true; crown.receiveShadow = true;
  g.add(crown);
  const crown2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), leafMat);
  crown2.position.set(0.35, 2.4, 0.1);
  crown2.castShadow = true;
  g.add(crown2);
  return g;
}

async function loadTreeModel() {
  return new Promise((resolve, reject) => {
    fbxLoader.load(
      './assets/models/tree/Lowpoly_tree_sample.fbx',
      (fbx) => {
        // Calcular Y central de cada mesh para distinguir tronco (baixo) x folhas (alto)
        const meshInfo = [];
        fbx.traverse((c) => {
          if (c.isMesh) {
            const bb = new THREE.Box3().setFromObject(c);
            const cy = (bb.min.y + bb.max.y) / 2;
            meshInfo.push({ mesh: c, cy });
          }
        });
        const sorted = meshInfo.map(m => m.cy).sort((a,b)=>a-b);
        const median = sorted.length ? sorted[Math.floor(sorted.length/2)] : 0;
        meshInfo.forEach(({ mesh, cy }) => {
          const isLeaf = cy >= median;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.material = new THREE.MeshStandardMaterial({
            color: isLeaf ? 0x2e8b3a : 0x6b3a18,
            roughness: 0.85,
            metalness: 0.0,
            flatShading: true,
          });
        });
        treeModel3D = fbx;
        const bb = new THREE.Box3().setFromObject(fbx);
        const sz = new THREE.Vector3(); bb.getSize(sz);
        log(`🌳 FBX tree carregada (size ${sz.x.toFixed(1)}×${sz.y.toFixed(1)}×${sz.z.toFixed(1)}, ${meshInfo.length} meshes)`, 'ok');
        resolve(fbx);
      },
      undefined,
      (err) => {
        log('⚠ FBX tree falhou, usando árvore procedural', 'warn');
        treeModel3D = buildProceduralTree();
        resolve(treeModel3D);
      }
    );
  });
}

function scatterTrees(count = 40) {
  if (!treeModel3D) {
    log('⚠ scatterTrees: nenhum modelo de árvore', 'warn');
    return;
  }
  const bbox = new THREE.Box3().setFromObject(treeModel3D);
  const size = new THREE.Vector3(); bbox.getSize(size);
  const targetH = 2.6;
  const baseScale = (size.y > 0.001) ? targetH / size.y : 1.0;

  // Floresta em GRADE cobrindo a borda do mapa, DENTRO do gramado
  // Gramado: 100×100 centrado em (4.5, 4.5) → vai de ~-45 até ~54
  const spacing = 2.2;
  const GRASS_MIN = -44;
  const GRASS_MAX = 53;
  const margin = 3;                   // afastamento da fazenda
  const minX = GRASS_MIN;
  const maxX = GRASS_MAX;
  const minZ = GRASS_MIN;
  const maxZ = GRASS_MAX;

  let placed = 0;
  for (let x = minX; x <= maxX; x += spacing) {
    for (let z = minZ; z <= maxZ; z += spacing) {
      // Só plantar fora da área da fazenda (anel)
      if (x > -margin && x < GRID + margin && z > -margin && z < GRID + margin) continue;
      // Evitar helipad em (-2,-2)
      if (Math.hypot(x - (-2), z - (-2)) < 3.5) continue;
      // Evitar a colmeia
      const hX = (typeof BEEHIVE_POS !== 'undefined') ? BEEHIVE_POS.x : 8.5;
      const hZ = (typeof BEEHIVE_POS !== 'undefined') ? BEEHIVE_POS.z : -8.5;
      if (Math.hypot(x - hX, z - hZ) < 3.5) continue;

      const tree = treeModel3D.clone(true);
      const s = baseScale * (0.8 + Math.random() * 0.45);
      tree.scale.set(s, s, s);
      tree.rotation.y = Math.random() * Math.PI * 2;
      const jx = (Math.random() - 0.5) * 0.6;
      const jz = (Math.random() - 0.5) * 0.6;
      tree.position.set(x + jx, 0, z + jz);
      tree.userData.isTree = true;
      tree.userData.harvested = false;
      scene.add(tree);
      treeMeshes.push(tree);
      placed++;
    }
  }
  log(`🌲 ${placed} árvores formando anel no gramado`, 'ok');
}

// Raio de proteção ao redor de um silo (não nasce/fica árvore)
const SILO_TREE_CLEAR_RADIUS = 2.6;

// Remove árvores (e brotos) próximas a uma posição (silo)
function removeTreesNearPoint(x, z, radius = SILO_TREE_CLEAR_RADIUS){
  const r2 = radius * radius;
  for (let i = treeMeshes.length - 1; i >= 0; i--) {
    const tree = treeMeshes[i];
    const ud = tree.userData || {};
    // Posição "verdadeira" da árvore (origPos se foi colhida)
    const px = ud._origPos ? ud._origPos.x : tree.position.x;
    const pz = ud._origPos ? ud._origPos.z : tree.position.z;
    const dx = px - x, dz = pz - z;
    if (dx*dx + dz*dz <= r2) {
      // remove broto se houver
      if (ud._sproutMesh) { scene.remove(ud._sproutMesh); ud._sproutMesh = null; }
      scene.remove(tree);
      treeMeshes.splice(i, 1);
    }
  }
}

function isPointNearAnySilo(x, z, radius = SILO_TREE_CLEAR_RADIUS){
  const r2 = radius * radius;
  for (const s of placedSilos) {
    const dx = s.x - x, dz = s.y - z;
    if (dx*dx + dz*dz <= r2) return true;
  }
  return false;
}

// ─── Silo 3D ( grande, base no chão ) ────────────────────────────────────────
function buildSilo3D() {
  const g = new THREE.Group();
  const mBody = new THREE.MeshStandardMaterial({ color:0xb4bcc4, metalness:0.78, roughness:0.28 });
  const mRoof = new THREE.MeshPhongMaterial({ color:0x8b1a1a, shininess:40 });
  const mBase = new THREE.MeshPhongMaterial({ color:0x2a2a2a });
  const mRib  = new THREE.MeshPhongMaterial({ color:0x909098 });
  const mDoor = new THREE.MeshPhongMaterial({ color:0x5a3311 });

  // Base de concreto larga (encostada no chão)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.90, 2.00, 0.36, 28), mBase);
  base.position.y = 0.18; base.receiveShadow=true; base.castShadow=true; g.add(base);
  // Corpo principal (alto e largo)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.70, 1.70, 5.6, 28), mBody);
  body.position.y = 0.36 + 2.8; body.castShadow=true; body.receiveShadow=true;
  g.add(body);
  // Costelas metálicas (aros)
  for(let i=0;i<9;i++){
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(1.76,1.76,0.14,28), mRib);
    rib.position.y = 0.6 + i*0.62; g.add(rib);
  }
  // Teto cônico vermelho
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.96, 1.70, 28), mRoof);
  roof.position.y = 0.36 + 5.6 + 0.85; roof.castShadow=true; g.add(roof);
  // Topo com pequena chaminé
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.20,0.20,0.36,12), mRib);
  cap.position.y = 0.36 + 5.6 + 1.88; cap.castShadow=true; g.add(cap);
  // Porta
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.60, 1.10, 0.08), mDoor);
  door.position.set(1.66, 0.92, 0); g.add(door);
  // Escada lateral
  const ladderRail = new THREE.MeshPhongMaterial({color:0x666677});
  for(let i=0;i<14;i++){
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.12), ladderRail);
    rung.position.set(-1.72, 0.60 + i*0.40, 0.10); g.add(rung);
  }
  // Trilhos verticais da escada
  for(const dz of [-0.12, 0.32]){
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 5.4, 0.08), ladderRail);
    rail.position.set(-1.72, 2.95, dz); g.add(rail);
  }
  return g;
}

// ─── Upgrade de velocidade ───────────────────────────────────────────────────
function applySpeedCap(){
  const slider = document.getElementById('speed');
  const lbl    = document.getElementById('speed-label');
  if(!slider) return;
  slider.max = String(speedLevel);
  if(parseInt(slider.value,10) > speedLevel) slider.value = String(speedLevel);
  if(lbl) lbl.textContent = slider.value;
}
function upgradeSpeed(){
  if(speedLevel >= MAX_SPEED_LEVEL){ log('⚡ Velocidade já no máximo!','warn'); return; }
  const xpNeed = speedXPRequired();
  if(harvestCount < xpNeed){
    log(`⚠ Precisa de ${xpNeed} colheitas (XP) para o próximo nível de velocidade.`,'warn');
    return;
  }
  if(coins < SPEED_UPGRADE_COST){
    log(`⚠ Precisa de ${SPEED_UPGRADE_COST} 🪙 para upgrade de velocidade.`,'warn');
    return;
  }
  coins -= SPEED_UPGRADE_COST;
  speedLevel++;
  applySpeedCap();
  const slider = document.getElementById('speed');
  if(slider){
    slider.value = String(speedLevel);
    document.getElementById('speed-label').textContent = String(speedLevel);
  }
  showNotif(`⚡ Velocidade upgrade! Nível ${speedLevel}/${MAX_SPEED_LEVEL}`);
  log(`✅ Velocidade aumentada para ${speedLevel}× (-${SPEED_UPGRADE_COST} 🪙).`,'ok');
  updateStats(); saveGame();
}

// ─── Boosts: comprar e atualizar UI ──────────────────────────────────────────
function buyBoost(kind){
  const cfg = BOOSTS[kind]; if(!cfg) return;
  if(coins < cfg.cost){
    log(`⚠ Precisa de ${cfg.cost} 🪙 para o boost ${cfg.name}.`,'warn');
    showNotif(`❌ Moedas insuficientes! (${coins}/${cfg.cost})`);
    return;
  }
  // Se já está ativo, soma o tempo (acumula)
  const now = Date.now();
  const base = activeBoosts[kind] > now ? activeBoosts[kind] : now;
  activeBoosts[kind] = base + cfg.duration;
  coins -= cfg.cost;
  log(`${cfg.icon} Boost "${cfg.name}" ativado por ${cfg.duration/1000}s (-${cfg.cost} 🪙).`,'ok');
  showNotif(`${cfg.icon} ${cfg.name} ATIVO!`);
  updateStats(); updateBoostUI();
}
function updateBoostUI(){
  const indicator = document.getElementById('boost-indicator');
  if(indicator) indicator.innerHTML = '';
  for(const [k, cfg] of Object.entries(BOOSTS)){
    const card    = document.querySelector(`.boost-item[data-boost="${k}"]`);
    const buyBtn  = document.getElementById(`buy-boost-${k}`);
    const fill    = document.getElementById(`boost-${k}-fill`);
    const lbl     = document.getElementById(`boost-${k}-lbl`);
    if(buyBtn) buyBtn.disabled = coins < cfg.cost;
    const remain = activeBoosts[k] - Date.now();
    if(remain > 0){
      if(card) card.classList.add('active');
      const totalEffective = Math.max(remain, cfg.duration);
      if(fill) fill.style.width = `${Math.min(100, (remain/totalEffective)*100)}%`;
      if(lbl)  lbl.textContent = `Ativo: ${(remain/1000).toFixed(1)}s restantes`;
      if(indicator){
        const badge = document.createElement('div');
        badge.className = 'boost-badge';
        badge.textContent = `${cfg.badge} ${(remain/1000).toFixed(0)}s`;
        indicator.appendChild(badge);
      }
    } else {
      if(card) card.classList.remove('active');
      if(fill) fill.style.width = '0%';
      if(lbl)  lbl.textContent = 'Inativo';
      if(activeBoosts[k] !== 0){
        // acabou de expirar
        activeBoosts[k] = 0;
        log(`${cfg.icon} Boost "${cfg.name}" expirou.`,'info');
      }
    }
  }
}
// Loop de atualização dos boosts (1× por segundo + render fluido)
setInterval(updateBoostUI, 250);

// ─── Lógica do Silo ───────────────────────────────────────────────────────────
function updateShopUI(){
  // ─── Botão Comprar Silo ───
  const btn=document.getElementById('buy-silo-btn');
  if(btn){
    btn.disabled = coins < SILO_COST;
    const costEl=btn.querySelector('.shop-cost');
    if(costEl) costEl.textContent=`🪙 ${SILO_COST}`;
  }

  // ─── Botão Expandir Fazenda ───
  const expBtn   = document.getElementById('buy-expand-btn');
  const expCost  = document.getElementById('expand-cost');
  const expDesc  = document.getElementById('expand-desc');
  const expFill  = document.getElementById('expand-xp-fill');
  const expLbl   = document.getElementById('expand-xp-lbl');
  const expName  = document.getElementById('expand-name');
  const next = getNextExpandSize();
  if(!next){
    if(expBtn){ expBtn.disabled=true; const lbl=expBtn.querySelector('.shop-buy-lbl'); if(lbl) lbl.textContent='MÁX'; }
    if(expCost) expCost.textContent='—';
    if(expName) expName.textContent='Fazenda MÁXIMA';
    if(expDesc) expDesc.textContent=`${unlockedSize}×${unlockedSize} (limite)`;
    if(expFill){ expFill.style.width='100%'; expFill.style.background='linear-gradient(90deg,#ffd56b,#ff9000)'; }
    if(expLbl) expLbl.textContent='🏆 Tudo desbloqueado';
  } else {
    const cost = getExpandCost();
    const xpHave = harvestCount;
    const xpNeed = next.h;
    const hasXP = xpHave >= xpNeed;
    const hasCoins = coins >= cost;
    if(expBtn) expBtn.disabled = !(hasXP && hasCoins);
    if(expCost) expCost.textContent = `🪙 ${cost}`;
    if(expName) expName.textContent = `Expandir para ${next.s}×${next.s}`;
    if(expDesc) expDesc.textContent = hasXP
      ? (hasCoins ? '✅ Pronto para expandir!' : `Faltam ${cost-coins} 🪙`)
      : `Precisa de ${xpNeed} colheitas`;
    if(expFill){
      const pct = Math.min(100, (xpHave/xpNeed)*100);
      expFill.style.width = pct + '%';
      expFill.style.background = hasXP
        ? 'linear-gradient(90deg,#88ff88,#44cc44)'
        : 'linear-gradient(90deg,#5a8fd0,#3a6fb0)';
    }
    if(expLbl) expLbl.textContent = `XP: ${xpHave}/${xpNeed}`;
  }

  // ─── Botão Upgrade de Velocidade ───
  const spdBtn  = document.getElementById('buy-speed-btn');
  const spdCost = document.getElementById('speed-cost');
  const spdName = document.getElementById('speed-name');
  const spdDesc = document.getElementById('speed-desc');
  const spdFill = document.getElementById('speed-xp-fill');
  const spdLbl  = document.getElementById('speed-xp-lbl');
  if(speedLevel >= MAX_SPEED_LEVEL){
    if(spdBtn){ spdBtn.disabled=true; const lbl=spdBtn.querySelector('.shop-buy-lbl'); if(lbl) lbl.textContent='MÁX'; }
    if(spdCost) spdCost.textContent='—';
    if(spdName) spdName.textContent=`⚡ Velocidade MÁX (${MAX_SPEED_LEVEL}×)`;
    if(spdDesc) spdDesc.textContent='Limite atingido';
    if(spdFill){ spdFill.style.width='100%'; spdFill.style.background='linear-gradient(90deg,#ffd56b,#ff9000)'; }
    if(spdLbl) spdLbl.textContent='🏆 Velocidade máxima';
  } else {
    const xpNeedSpd  = speedXPRequired();
    const hasXPspd   = harvestCount >= xpNeedSpd;
    const hasCoinSpd = coins >= SPEED_UPGRADE_COST;
    if(spdBtn) spdBtn.disabled = !(hasXPspd && hasCoinSpd);
    if(spdCost) spdCost.textContent = `🪙 ${SPEED_UPGRADE_COST}`;
    if(spdName) spdName.textContent = `⚡ Velocidade do Drone`;
    if(spdDesc) spdDesc.textContent = hasXPspd
      ? (hasCoinSpd ? `Pronto: nível ${speedLevel} → ${speedLevel+1}×` : `Faltam ${SPEED_UPGRADE_COST-coins} 🪙`)
      : `Precisa de ${xpNeedSpd} colheitas`;
    if(spdFill){
      const pct = Math.min(100, (harvestCount/xpNeedSpd)*100);
      spdFill.style.width = pct + '%';
      spdFill.style.background = hasXPspd
        ? 'linear-gradient(90deg,#88ff88,#44cc44)'
        : 'linear-gradient(90deg,#5a8fd0,#3a6fb0)';
    }
    if(spdLbl) spdLbl.textContent = `Nível ${speedLevel}/${MAX_SPEED_LEVEL} │ XP: ${harvestCount}/${xpNeedSpd}`;
  }

  // ─── Card Bateria ───
  const batBtn  = document.getElementById('buy-battery-btn');
  const batCost = document.getElementById('battery-cost');
  const batDesc = document.getElementById('battery-desc');
  const batFill = document.getElementById('battery-xp-fill');
  const batLbl  = document.getElementById('battery-xp-lbl');
  if(batteryLevel >= MAX_BATTERY_LEVEL){
    if(batBtn) batBtn.disabled = true;
    if(batDesc) batDesc.textContent = `Capacidade máxima (${batteryMax()})`;
    if(batFill){ batFill.style.width='100%'; batFill.style.background='linear-gradient(90deg,#ffd56b,#ff9000)'; }
    if(batLbl) batLbl.textContent='🏆 Bateria máxima';
  } else {
    const xpNeedBat  = batteryXPRequired();
    const hasXPbat   = harvestCount >= xpNeedBat;
    const hasCoinBat = coins >= BATTERY_UPGRADE_COST;
    if(batBtn) batBtn.disabled = !(hasXPbat && hasCoinBat);
    if(batCost) batCost.textContent = `🪙 ${BATTERY_UPGRADE_COST}`;
    if(batDesc) batDesc.textContent = hasXPbat
      ? (hasCoinBat ? `Pronto: cap. ${batteryMax()} → ${batteryMax()+60}` : `Faltam ${BATTERY_UPGRADE_COST-coins} 🪙`)
      : `Precisa de ${xpNeedBat} colheitas`;
    if(batFill){
      const pct = Math.min(100, (harvestCount/xpNeedBat)*100);
      batFill.style.width = pct + '%';
      batFill.style.background = hasXPbat
        ? 'linear-gradient(90deg,#88ff88,#44cc44)'
        : 'linear-gradient(90deg,#5a8fd0,#3a6fb0)';
    }
    if(batLbl) batLbl.textContent = `Nível ${batteryLevel}/${MAX_BATTERY_LEVEL} │ Cap. ${batteryMax()} │ XP: ${harvestCount}/${xpNeedBat}`;
  }

  // ─── Card Colmeia (Abelhas) ───
  const hiveBtn  = document.getElementById('buy-hive-btn');
  const hiveDesc = document.getElementById('hive-desc');
  const hiveCost = document.getElementById('hive-cost');
  const hiveLbl  = document.getElementById('hive-lbl');
  if(hivesOwned >= MAX_HIVES){
    if(hiveBtn){
      hiveBtn.disabled = true;
      const lbl = hiveBtn.querySelector('.shop-buy-lbl');
      if(lbl) lbl.textContent = '🏆 Máximo';
    }
    if(hiveDesc) hiveDesc.textContent = `🐝 ${bees.length} abelhas • +${Math.round((beeGrowMultiplier()-1)*100)}% crescimento`;
  } else {
    if(hiveBtn) hiveBtn.disabled = coins < BEE_HIVE_COST;
    if(hiveCost) hiveCost.textContent = `🪙 ${BEE_HIVE_COST}`;
    if(hiveDesc) hiveDesc.textContent = `🐝 ${bees.length} abelhas • +${Math.round((beeGrowMultiplier()-1)*100)}% • +${BEES_PER_HIVE} por colmeia`;
  }
  if(hiveLbl) hiveLbl.textContent = `Colmeias ${hivesOwned}/${MAX_HIVES}`;

  // ─── Card Drone Auxiliar ───
  const helpBtn  = document.getElementById('buy-helper-btn');
  const helpDesc = document.getElementById('helper-desc');
  const helpCost = document.getElementById('helper-cost');
  if(helperDroneUnlocked){
    if(helpBtn){
      helpBtn.disabled = true;
      const lbl = helpBtn.querySelector('.shop-buy-lbl');
      if(lbl) lbl.textContent = '✅ Adquirido';
    }
    if(helpDesc) helpDesc.textContent = `🛸 Voando ao seu lado! Capacidade: ${droneCapacity()}`;
  } else {
    if(helpBtn) helpBtn.disabled = coins < HELPER_DRONE_COST;
    if(helpCost) helpCost.textContent = `🪙 ${HELPER_DRONE_COST}`;
    if(helpDesc) helpDesc.textContent = `Aumenta capacidade do drone (${DRONE_CAPACITY_BASE} → ${DRONE_CAPACITY_BASE+DRONE_CAPACITY_HELPER_BONUS}) e voa junto`;
  }

  // ─── Card Drone Autônomo B ───
  const dbBtn  = document.getElementById('buy-droneb-btn');
  const dbDesc = document.getElementById('droneb-desc');
  const dbCost = document.getElementById('droneb-cost');
  if(droneBUnlocked){
    if(dbBtn){
      dbBtn.disabled = true;
      const lbl = dbBtn.querySelector('.shop-buy-lbl');
      if(lbl) lbl.textContent = '✅ Adquirido';
    }
    if(dbDesc) dbDesc.textContent = '🤖 Use mover_b(), colher_b(), girar_esq_b()...';
  } else {
    if(dbBtn) dbBtn.disabled = coins < DRONE_B_COST;
    if(dbCost) dbCost.textContent = `🪙 ${DRONE_B_COST}`;
  }
}

// ─── Auto-descarga no silo ───────────────────────────────────────────────────
function findNearestSilo(){
  if(!placedSilos.length) return null;
  let best=null, bestD=Infinity;
  for(const s of placedSilos){
    const d=Math.hypot(s.x-robot.x, s.y-robot.y);
    if(d<bestD){ bestD=d; best=s; }
  }
  return best;
}

async function flyDroneTo(targetX, targetZ, finalY){
  return new Promise(resolve=>{
    const startX=droneMesh.position.x, startY=droneMesh.position.y, startZ=droneMesh.position.z;
    const flyH=Math.max(startY, TILE_H+1.6);
    droneMesh.userData.landed=false;
    droneMesh.userData.floatAnim=null;
    droneMesh.userData.pousoAnim={
      phase:'rise', t:0, isLanding:false,
      rise:   { duration:0.5, startX, startY, startZ, endY:flyH },
      travel: { duration:1.2, endX:targetX, endZ:targetZ },
      land:   { duration:0.6, endY:finalY }
    };
    const check=setInterval(()=>{
      if(!droneMesh.userData.pousoAnim){ clearInterval(check); resolve(); }
    }, 50);
  });
}

async function autoUnloadToSilo(){
  const silo=findNearestSilo();
  if(!silo){
    log('⚠ Nenhum silo instalado! Compre um na Loja.','warn');
    openSiloModal();
    return;
  }
  if(droneAutoUnloading) return;
  droneAutoUnloading=true;
  log('🚁 Voando até o silo...','info');
  // Voa até o silo (1 tile à frente da porta)
  await flyDroneTo(silo.x, silo.y+1.2, TILE_H+1.0);
  log('📤 Descarregando no silo...','info');
  // Transfere respeitando a capacidade total dos silos
  let free = siloFreeSpace();
  let transferred = 0;
  for(const k of Object.keys(droneInventory)){
    if(free<=0) break;
    const moved = Math.min(droneInventory[k], free);
    siloStorage[k] = (siloStorage[k]||0) + moved;
    droneInventory[k] -= moved;
    free -= moved;
    transferred += moved;
  }
  spawnFX(silo.x, silo.y);
  updateStats();
  saveGame();
  if(droneTotal()>0){
    log(`⚠ Silos cheios! ${droneTotal()} unidades sobraram no drone. Compre mais silos ou venda o estoque.`,'warn');
  } else {
    log(`✅ Silo: ${siloTotal()}/${siloMaxCapacity()} unidades.`,'ok');
  }
  // Volta para a posição do robot
  await flyDroneTo(robot.x, robot.y, TILE_H+0.6);
  droneAutoUnloading=false;
  // Abre o modal para o usuário decidir o que fazer (vender, etc)
  openSiloModal();
}

// ─── Modal do Silo ────────────────────────────────────────────────────────────
function siloValue(){
  let v = 0;
  for(const k of Object.keys(siloStorage)) v += (siloStorage[k]||0) * priceOf(k);
  return Math.floor(v);
}
function droneValue(){
  let v = 0;
  for(const k of Object.keys(droneInventory)) v += (droneInventory[k]||0) * priceOf(k);
  return Math.floor(v);
}
function refreshSellButtons(){
  // Botões de venda por cultura: somam silo + drone
  document.querySelectorAll('.silo-sell-btn').forEach(btn=>{
    const c = btn.dataset.crop;
    const qty = (siloStorage[c]||0) + (droneInventory[c]||0);
    btn.disabled = qty<=0;
    const gain = Math.floor(qty * priceOf(c));
    btn.textContent = qty>0 ? `Vender (+${gain} 🪙)` : 'Vender';
  });
  const sellAll = document.getElementById('silo-sell-all-btn');
  if(sellAll){
    const v = siloValue() + droneValue();
    sellAll.disabled = v<=0;
    sellAll.innerHTML = v>0 ? `💰 Vender Tudo (+${v} 🪙)` : '💰 Vender Tudo';
  }
}
function sellCrop(crop){
  const qSilo  = siloStorage[crop]||0;
  const qDrone = droneInventory[crop]||0;
  const qty = qSilo + qDrone;
  if(qty<=0){ log(`Sem ${crop} para vender.`,'warn'); return; }
  const gain = Math.floor(qty * priceOf(crop));
  siloStorage[crop] = 0;
  droneInventory[crop] = 0;
  coins += gain;
  const origem = qSilo>0 && qDrone>0 ? `(${qSilo} silo + ${qDrone} drone)`
               : qDrone>0 ? '(drone)' : '(silo)';
  const bonus = boostActive('sell') ? ' 💰+50%' : '';
  log(`💰 Vendeu ${qty} ${crop} ${origem} por ${gain} 🪙${bonus}.`,'ok');
  updateStats(); openSiloModal(); saveGame();
}
function sellAllCrops(){
  const vSilo = siloValue();
  const vDrn  = droneValue();
  const v = vSilo + vDrn;
  if(v<=0){ log('Nada para vender.','warn'); return; }
  const parts=[];
  for(const c of Object.keys(siloStorage)){
    const total = (siloStorage[c]||0) + (droneInventory[c]||0);
    if(total>0){
      parts.push(`${total} ${c}`);
      siloStorage[c]=0;
      droneInventory[c]=0;
    }
  }
  coins += v;
  log(`💰 Vendeu ${parts.join(', ')} por ${v} 🪙.`,'ok');
  updateStats(); openSiloModal(); saveGame();
}
function openSiloModal(){
  const modal=document.getElementById('silo-modal'); if(!modal) return;
  // Atualiza o título da seção mostrando quantos silos e capacidade
  const secTitle = document.querySelector('#silo-modal .silo-section:last-of-type .silo-section-title');
  if(secTitle){
    const n = placedSilos.length;
    secTitle.innerHTML = n>0
      ? `🏚 Estoque do Silo &mdash; Vender <span style="color:#88a0c8;font-size:.7rem;">(${n} silo${n!==1?'s':''} × ${SILO_CAPACITY} = ${siloMaxCapacity()} cap)</span>`
      : `💰 Vender carga &mdash; <span style="color:#ffb347;font-size:.7rem;">sem silo, vendendo direto do drone</span>`;
  }
  // Botão de descarregar: só faz sentido se existir silo
  const unloadBtn = document.getElementById('silo-unload-btn');
  if(unloadBtn){
    if(placedSilos.length === 0){
      unloadBtn.disabled = true;
      unloadBtn.title = 'Compre um silo na loja para descarregar';
      unloadBtn.style.opacity = '.4';
    } else {
      unloadBtn.disabled = false;
      unloadBtn.title = '';
      unloadBtn.style.opacity = '1';
    }
  }
  document.getElementById('silo-storage-total').textContent   = `${siloTotal()} / ${siloMaxCapacity()}`;
  const valEl = document.getElementById('silo-storage-value');
  if(valEl) valEl.textContent = siloValue() + ' 🪙';

  // ── Lista dinâmica do compartimento do drone ───────────────────────────
  const droneList = document.getElementById('drone-inv-list');
  if(droneList){
    const items = [];
    for(const k of Object.keys(droneInventory)){
      const meta = CROPS[k] || (k==='madeira' ? {name:'Madeira', icon:'🪵'} : {name:k, icon:'•'});
      items.push(`<div class="silo-row"><span>${meta.icon} ${meta.name}:</span> <strong>${droneInventory[k]||0}</strong></div>`);
    }
    droneList.innerHTML = items.join('');
  }

  // ── Lista dinâmica de venda do silo ────────────────────────────────────
  const sellList = document.getElementById('silo-sell-list');
  if(sellList){
    const rows = [];
    for(const k of Object.keys(siloStorage)){
      const meta = CROPS[k] || (k==='madeira' ? {name:'Madeira', icon:'🪵'} : {name:k, icon:'•'});
      const price = CROP_PRICES[k] || 0;
      rows.push(`
        <div class="silo-sell-row" data-crop="${k}">
          <div class="ssr-icon">${meta.icon}</div>
          <div class="ssr-info">
            <div class="ssr-name">${meta.name} <span class="ssr-price">${price} 🪙/un</span></div>
            <div class="ssr-qty"><strong>${siloStorage[k]||0}</strong> un armazenadas</div>
          </div>
          <button class="silo-sell-btn" data-crop="${k}">Vender</button>
        </div>`);
    }
    sellList.innerHTML = rows.join('');
    // Religa eventos de venda nos botões recém-criados
    sellList.querySelectorAll('.silo-sell-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> sellCrop(btn.dataset.crop));
    });
  }

  document.getElementById('drone-inv-total').textContent      = droneTotal();
  const capEl = document.getElementById('drone-inv-cap');
  if(capEl) capEl.textContent = droneCapacity();
  refreshSellButtons();
  modal.classList.remove('hidden');
}
function closeSiloModal(){
  document.getElementById('silo-modal')?.classList.add('hidden');
}
async function manualUnload(){
  if(droneTotal()===0){ log('Compartimento já está vazio.','warn'); return; }
  closeSiloModal();
  await autoUnloadToSilo();
  openSiloModal();
}

// ─── Persistência (SQLite via sql.js) ────────────────────────────────────────
let SQL=null, db=null;
async function initSQLite(){
  try {
    if(typeof initSqlJs!=='function'){ console.warn('sql.js não carregado'); return; }
    SQL = await initSqlJs({ locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}` });
    const saved = localStorage.getItem('farmer_db');
    if(saved){
      const bin = Uint8Array.from(atob(saved), c=>c.charCodeAt(0));
      db = new SQL.Database(bin);
    } else {
      db = new SQL.Database();
      db.run(`CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v TEXT);`);
      db.run(`CREATE TABLE IF NOT EXISTS silos (x INTEGER, y INTEGER, PRIMARY KEY(x,y));`);
      db.run(`CREATE TABLE IF NOT EXISTS silo_storage (crop TEXT PRIMARY KEY, qty INTEGER);`);
      db.run(`CREATE TABLE IF NOT EXISTS drone_inv    (crop TEXT PRIMARY KEY, qty INTEGER);`);
    }
    log('💾 SQLite inicializado.','ok');
    loadGameFromDB();
  } catch(e){ console.warn('SQLite init falhou:', e); log('⚠ SQLite indisponível, persistência desativada.','warn'); }
}

function persistDB(){
  if(!db) return;
  try {
    const bin = db.export();
    let s=''; for(let i=0;i<bin.length;i++) s+=String.fromCharCode(bin[i]);
    localStorage.setItem('farmer_db', btoa(s));
  } catch(e){ console.warn('persistDB falhou:',e); }
}

function saveGame(){
  if(!db) return;
  try {
    db.run('BEGIN');
    const stm = db.prepare('INSERT OR REPLACE INTO state(k,v) VALUES (?,?)');
    stm.run(['coins',         String(coins)]);
    stm.run(['harvestCount',  String(harvestCount)]);
    stm.run(['unlockedSize',  String(unlockedSize)]);
    stm.run(['speedLevel',    String(speedLevel)]);
    stm.run(['batteryLevel',  String(batteryLevel)]);
    stm.run(['battery',       String(Math.round(battery))]);
    stm.run(['helperDroneUnlocked', helperDroneUnlocked ? '1' : '0']);
    stm.run(['hivesOwned', String(hivesOwned)]);
    stm.run(['droneBUnlocked', droneBUnlocked ? '1' : '0']);
    stm.run(['droneBPos', `${droneB.x},${droneB.y},${droneB.dir}`]);
    stm.run(['currentCrop',   currentCrop]);
    stm.run(['unlockedCrops', JSON.stringify([...unlockedCrops])]);
    stm.free();
    db.run('DELETE FROM silos');
    const sst = db.prepare('INSERT INTO silos(x,y) VALUES (?,?)');
    for(const s of placedSilos) sst.run([s.x, s.y]);
    sst.free();
    const stStore = db.prepare('INSERT OR REPLACE INTO silo_storage(crop,qty) VALUES (?,?)');
    for(const k of Object.keys(siloStorage)) stStore.run([k, siloStorage[k]]);
    stStore.free();
    const stInv = db.prepare('INSERT OR REPLACE INTO drone_inv(crop,qty) VALUES (?,?)');
    for(const k of Object.keys(droneInventory)) stInv.run([k, droneInventory[k]]);
    stInv.free();
    db.run('COMMIT');
    persistDB();
  } catch(e){ console.warn('saveGame:',e); try{db.run('ROLLBACK');}catch{} }
}

function loadGameFromDB(){
  if(!db) return;
  try {
    const stRes = db.exec('SELECT k,v FROM state');
    if(stRes[0]){
      const map = Object.fromEntries(stRes[0].values);
      if(map.coins        != null) coins        = parseInt(map.coins,10) || 0;
      if(map.harvestCount != null) harvestCount = parseInt(map.harvestCount,10) || 0;
      if(map.unlockedSize != null) unlockedSize = Math.max(1, parseInt(map.unlockedSize,10) || 1);
      if(map.speedLevel   != null) speedLevel   = Math.min(MAX_SPEED_LEVEL, Math.max(1, parseInt(map.speedLevel,10) || 1));
      if(map.batteryLevel != null) batteryLevel = Math.min(MAX_BATTERY_LEVEL, Math.max(1, parseInt(map.batteryLevel,10) || 1));
      if(map.battery      != null) battery      = Math.max(0, Math.min(batteryMax(), parseFloat(map.battery) || batteryMax()));
      else battery = batteryMax();
      if(map.helperDroneUnlocked === '1'){
        helperDroneUnlocked = true;
        spawnHelperDrone();
      }
      if(map.hivesOwned != null){
        hivesOwned = Math.min(MAX_HIVES, Math.max(1, parseInt(map.hivesOwned,10) || 1));
        spawnBees(); // re-spawn para o número correto
      }
      if(map.droneBUnlocked === '1'){
        droneBUnlocked = true;
        // PRIMEIRO restaura posição, DEPOIS spawna o mesh nessa posição
        if(map.droneBPos){
          const [bx,by,bd] = map.droneBPos.split(',').map(s=>parseInt(s,10));
          if(!isNaN(bx)) droneB.x = bx;
          if(!isNaN(by)) droneB.y = by;
          if(!isNaN(bd)) droneB.dir = bd;
        }
        spawnDroneB();
        // Liga o modo autônomo automaticamente ao carregar o save
        startDroneBAuto();
      }
      if(map.currentCrop)          currentCrop  = map.currentCrop;
      if(map.unlockedCrops){ try { const arr=JSON.parse(map.unlockedCrops); unlockedCrops.clear(); arr.forEach(c=>unlockedCrops.add(c)); } catch{} }
    }
    const ssRes = db.exec('SELECT crop,qty FROM silo_storage');
    if(ssRes[0]) for(const [c,q] of ssRes[0].values) siloStorage[c] = q || 0;
    const diRes = db.exec('SELECT crop,qty FROM drone_inv');
    if(diRes[0]) for(const [c,q] of diRes[0].values) droneInventory[c] = q || 0;

    // Recriar silos
    for(const s of placedSilos) scene.remove(s.mesh);
    placedSilos.length=0;
    const sRes = db.exec('SELECT x,y FROM silos');
    if(sRes[0]) for(const [x,y] of sRes[0].values){
      const m=buildSilo3D(); m.position.set(x,0,y); scene.add(m);
      placedSilos.push({x,y,mesh:m});
      removeTreesNearPoint(x, y);
    }
    // Re-revelar tiles desbloqueados
    for(let yy=0; yy<unlockedSize; yy++) for(let xx=0; xx<unlockedSize; xx++){
      tileMeshes[yy][xx].visible = true;
      tileMeshes[yy][xx].scale.set(1,1,1);
      tileMeshes[yy][xx].position.y = TILE_H/2;
    }
    updateStats(); renderCropSelector();
    log('💾 Jogo carregado do SQLite.','ok');
  } catch(e){ console.warn('loadGameFromDB:',e); }
}

function placeSilo(x, y){
  if(siloGhost){ scene.remove(siloGhost); siloGhost=null; }
  siloPlacementMode=false;
  controls.enabled=true;
  canvas.style.cursor='';
  const ph=document.getElementById('placement-hint'); if(ph) ph.style.display='none';

  if(placedSilos.some(s=>s.x===x&&s.y===y)){
    log('❌ Já existe um silo nessa posição!','error'); return;
  }

  // Se está movendo um silo existente, reusar mesh
  if(movingSilo){
    movingSilo.x = x; movingSilo.y = y;
    movingSilo.mesh.position.set(x, 0, y);
    movingSilo.mesh.visible = true;
    removeTreesNearPoint(x, y);
    log(`🏚 Silo movido para (${x},${y})!`,'ok');
    showNotif('🏚 Silo reposicionado!');
    movingSilo = null;
    saveGame();
    return;
  }

  const silo=buildSilo3D();
  silo.position.set(x,0,y);
  scene.add(silo);
  placedSilos.push({x,y,mesh:silo});
  removeTreesNearPoint(x, y);
  log(`🏚 Silo instalado em (${x},${y})!`,'ok');
  showNotif('🏚 Silo instalado com sucesso!');
  updateShopUI();
  saveGame();
}

function buySilo(){
  if(coins<SILO_COST){
    log(`❌ Precisa de ${SILO_COST} 🪙 moedas (você tem ${coins})`,'error');
    showNotif(`❌ Moedas insuficientes! (${coins}/${SILO_COST})`);
    return;
  }
  coins-=SILO_COST;
  updateStats();

  // Ghost semitransparente para preview
  const ghostMat=new THREE.MeshBasicMaterial({color:0x88ccff,transparent:true,opacity:0.35,side:THREE.DoubleSide});
  siloGhost=buildSilo3D();
  siloGhost.traverse(c=>{ if(c.isMesh){ c.material=ghostMat; c.castShadow=false; c.receiveShadow=false; } });
  siloGhost.visible=false;
  scene.add(siloGhost);

  siloPlacementMode=true;
  controls.enabled=false;
  canvas.style.cursor='crosshair';
  const ph=document.getElementById('placement-hint'); if(ph) ph.style.display='flex';
  log('🏚 Clique em um tile da fazenda para posicionar o silo! [ESC] cancela.','info');
}

function cancelPlacement(){
  if(!siloPlacementMode) return;
  siloPlacementMode=false;
  if(siloGhost){ scene.remove(siloGhost); siloGhost=null; }
  controls.enabled=true;
  canvas.style.cursor='';
  const ph=document.getElementById('placement-hint'); if(ph) ph.style.display='none';
  if(movingSilo){
    // Só cancela o movimento, não devolve dinheiro nem destrói o silo
    movingSilo.mesh.visible = true;
    movingSilo = null;
    log('↩ Movimento cancelado.','warn');
  } else {
    coins+=SILO_COST; // devolve o dinheiro da compra
    updateStats();
    log('↩ Compra cancelada. Moedas devolvidas.','warn');
  }
}

// ─── Mover / Vender silo existente ────────────────────────────────────────
function startMoveSilo(silo){
  if(siloPlacementMode) return;
  movingSilo = silo;
  silo.mesh.visible = false; // esconde o silo original durante o movimento
  // Cria ghost para preview
  const ghostMat=new THREE.MeshBasicMaterial({color:0x88ccff,transparent:true,opacity:0.40,side:THREE.DoubleSide});
  siloGhost=buildSilo3D();
  siloGhost.traverse(c=>{ if(c.isMesh){ c.material=ghostMat; c.castShadow=false; c.receiveShadow=false; } });
  siloGhost.visible=false;
  scene.add(siloGhost);
  siloPlacementMode=true;
  controls.enabled=false;
  canvas.style.cursor='crosshair';
  const ph=document.getElementById('placement-hint');
  if(ph){ ph.querySelector('div').textContent='🏚 Clique em outro local para mover o silo'; ph.style.display='flex'; }
  log('🔄 Mova o silo para uma nova posição (FORA da fazenda). [ESC] cancela.','info');
}

function sellSilo(silo){
  // Devolve estoque ao drone? Não — o estoque do silo fica perdido. Devolvemos só dinheiro.
  scene.remove(silo.mesh);
  const idx = placedSilos.indexOf(silo);
  if(idx>=0) placedSilos.splice(idx,1);
  coins += SILO_REFUND;
  updateStats();
  log(`💰 Silo vendido por ${SILO_REFUND} 🪙 moedas.`,'ok');
  showNotif(`💰 +${SILO_REFUND} moedas`);
  closeSiloMenu();
  saveGame();
}

// ─── Menu contextual do silo ─────────────────────────────────────────────
let activeSiloMenu = null;
function openSiloMenu(silo, screenX, screenY){
  closeSiloMenu();
  const menu = document.getElementById('silo-context-menu');
  if(!menu) return;
  menu.style.left = screenX + 'px';
  menu.style.top  = screenY + 'px';
  menu.style.display = 'block';
  activeSiloMenu = silo;
  const refundLbl = menu.querySelector('#silo-sell-btn .menu-cost');
  if(refundLbl) refundLbl.textContent = `+${SILO_REFUND} 🪙`;
}
function closeSiloMenu(){
  const menu = document.getElementById('silo-context-menu');
  if(menu) menu.style.display='none';
  activeSiloMenu = null;
}

// ─── Drone ────────────────────────────────────────────────────────────────────

// ─── Abelhas mascote (enxame, evitam o drone) ────────────────────────────────
function buildBee(){
  const bee = new THREE.Group();

  // Materiais reutilizáveis
  const matYellow = new THREE.MeshPhongMaterial({ color: 0xffcc1a, shininess: 90, specular: 0x886611 });
  const matBlack  = new THREE.MeshPhongMaterial({ color: 0x1a1208, shininess: 60 });
  const matEye    = new THREE.MeshPhongMaterial({ color: 0x0a0a0a, shininess: 120, specular: 0xffffff });
  const matWing   = new THREE.MeshPhongMaterial({
    color: 0xddeeff, transparent: true, opacity: 0.45,
    side: THREE.DoubleSide, shininess: 100, specular: 0xffffff
  });
  const matAntenna = new THREE.MeshPhongMaterial({ color: 0x1a1208 });

  // ── Corpo segmentado (cabeça + tórax + abdômen) ──
  // Cabeça
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), matBlack);
  head.position.set(0, 0.005, 0.075);
  head.scale.set(1, 0.95, 0.9);
  bee.add(head);

  // Tórax (amarelo)
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), matYellow);
  thorax.scale.set(1, 0.95, 1.1);
  thorax.position.set(0, 0, 0.005);
  bee.add(thorax);

  // Abdômen (cone arredondado, com listras)
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 12), matYellow);
  abdomen.scale.set(0.95, 0.85, 1.5);
  abdomen.position.set(0, -0.005, -0.085);
  bee.add(abdomen);

  // Listras pretas no abdômen (anéis sutis)
  for(let i = 0; i < 3; i++){
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.012, 6, 16), matBlack);
    ring.position.set(0, -0.005, -0.04 - i * 0.04);
    ring.rotation.y = Math.PI / 2;
    ring.scale.set(0.95 - i*0.06, 0.82, 1);
    bee.add(ring);
  }

  // Ferrão pequeno
  const sting = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.04, 6), matBlack);
  sting.position.set(0, -0.005, -0.18);
  sting.rotation.x = -Math.PI / 2;
  bee.add(sting);

  // ── Olhos compostos (ovais grandes laterais) ──
  const eyeGeom = new THREE.SphereGeometry(0.022, 8, 6);
  const eyeL = new THREE.Mesh(eyeGeom, matEye);
  eyeL.position.set(-0.038, 0.012, 0.095);
  eyeL.scale.set(0.7, 1.1, 0.9);
  bee.add(eyeL);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.038; bee.add(eyeR);

  // ── Antenas (curva com bolinha na ponta) ──
  function makeAntenna(side){
    const g = new THREE.Group();
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0035, 0.0035, 0.06, 4),
      matAntenna
    );
    stem.position.set(0, 0.03, 0);
    stem.rotation.z = side * 0.35;
    stem.rotation.x = -0.3;
    g.add(stem);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 5), matAntenna);
    tip.position.set(side * 0.022, 0.062, 0.012);
    g.add(tip);
    return g;
  }
  const antL = makeAntenna(-1); antL.position.set(-0.012, 0.04, 0.105); bee.add(antL);
  const antR = makeAntenna( 1); antR.position.set( 0.012, 0.04, 0.105); bee.add(antR);

  // ── Asas (4 asas, formato de pétala) ──
  function makeWing(){
    // Forma de pétala via shape
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.04, 0.02,  0.10, 0.025, 0.12, 0);
    shape.bezierCurveTo(0.10, -0.025, 0.04, -0.02, 0, 0);
    const wing = new THREE.Mesh(new THREE.ShapeGeometry(shape, 12), matWing);
    return wing;
  }
  const wingFL = makeWing(); wingFL.position.set(-0.04, 0.05,  0.01); wingFL.rotation.set(0, 0.2,  Math.PI/2); bee.add(wingFL);
  const wingFR = makeWing(); wingFR.position.set( 0.04, 0.05,  0.01); wingFR.rotation.set(0, -0.2, Math.PI/2); wingFR.scale.x = -1; bee.add(wingFR);
  const wingBL = makeWing(); wingBL.position.set(-0.035, 0.045,-0.04); wingBL.rotation.set(0, 0.4,  Math.PI/2); wingBL.scale.set(0.75, 0.75, 0.75); bee.add(wingBL);
  const wingBR = makeWing(); wingBR.position.set( 0.035, 0.045,-0.04); wingBR.rotation.set(0,-0.4,  Math.PI/2); wingBR.scale.set(-0.75, 0.75, 0.75); bee.add(wingBR);

  // ── Pernas (3 pares, cilindros bem finos pendurados) ──
  function makeLeg(x, z){
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003, 0.0025, 0.05, 4),
      matBlack
    );
    leg.position.set(x, -0.04, z);
    leg.rotation.z = x > 0 ? -0.4 : 0.4;
    return leg;
  }
  bee.add(makeLeg(-0.04, 0.025));
  bee.add(makeLeg( 0.04, 0.025));
  bee.add(makeLeg(-0.045, -0.005));
  bee.add(makeLeg( 0.045, -0.005));
  bee.add(makeLeg(-0.04, -0.04));
  bee.add(makeLeg( 0.04, -0.04));

  // Escala global menor
  bee.scale.setScalar(0.28);

  bee.userData.wings = { FL: wingFL, FR: wingFR, BL: wingBL, BR: wingBR };
  bee.userData.bee = {
    pos: new THREE.Vector3(
      (Math.random() - 0.5) * 8,
      TILE_H + 0.6 + Math.random() * 1.2,
      (Math.random() - 0.5) * 8
    ),
    vel: new THREE.Vector3(0, 0, 0),
    target: new THREE.Vector3(0, TILE_H + 1, 0),
    targetTimer: 0,
    flapPhase: Math.random() * Math.PI * 2
  };
  return bee;
}

let bees = [];
let beehiveMesh = null;
const BEE_AVOID_DIST = 1.8;     // distância mínima do drone
const BEE_AVOID_FORCE = 6.0;
const BEE_MAX_SPEED = 2.5;
const BEE_BOUND = 7;            // raio do território
// ─── Sistema de colmeias compráveis ───
const BEES_INITIAL  = 6;        // começa com 6 abelhas (colmeia inicial grátis)
const BEES_PER_HIVE = 8;        // cada upgrade adiciona +8 abelhas
const MAX_HIVES     = 6;        // máximo de upgrades de colmeia
const BEE_HIVE_COST = 150;      // custo por upgrade
let hivesOwned = 1;             // 1 = colmeia inicial; 2..MAX_HIVES = upgrades
function currentBeeCount(){ return BEES_INITIAL + (hivesOwned - 1) * BEES_PER_HIVE; }
// Cada abelha além da colmeia inicial acelera levemente o crescimento das plantas
function beeGrowMultiplier(){
  const extra = Math.max(0, bees.length - BEES_INITIAL);
  return 1 + extra * 0.025;     // +2.5% por abelha extra
}
// Posição da colmeia (canto fora do campo); y=0 é o chão (base do tronco)
const BEEHIVE_POS = new THREE.Vector3(8.5, 0, -8.5);
// Altura onde a colmeia fica pendurada (alvo das abelhas)
const BEEHIVE_HOVER_Y = 1.25;

function buildBeehive(){
  const root = new THREE.Group();

  // Tronco (sobe do chão)
  const TRUNK_H = 1.8;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.24, TRUNK_H, 8),
    new THREE.MeshPhongMaterial({ color: 0x5a3a1f, shininess: 10 })
  );
  trunk.position.y = TRUNK_H / 2;
  root.add(trunk);

  // Galho horizontal
  const branch = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.5, 6),
    new THREE.MeshPhongMaterial({ color: 0x4a2a15 })
  );
  branch.position.set(0.18, TRUNK_H - 0.05, 0);
  branch.rotation.z = Math.PI / 2;
  root.add(branch);

  // Corda
  const ropeLen = TRUNK_H - 0.10 - BEEHIVE_HOVER_Y;  // entre galho e topo da colmeia
  if(ropeLen > 0){
    const rope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, ropeLen, 5),
      new THREE.MeshPhongMaterial({ color: 0x2a1a08 })
    );
    rope.position.set(0.30, BEEHIVE_HOVER_Y + ropeLen/2 + 0.20, 0);
    root.add(rope);
  }

  // ── Colmeia (estilo "favo de mel" empilhado) ──
  const hive = new THREE.Group();
  const hiveMatYellow = new THREE.MeshPhongMaterial({ color: 0xe6a430, shininess: 50, specular: 0x664400 });
  const hiveMatDark   = new THREE.MeshPhongMaterial({ color: 0xb37820, shininess: 30 });

  const ringSizes = [
    { r: 0.32, h: 0.16, y:  0.10 },
    { r: 0.36, h: 0.18, y: -0.06 },
    { r: 0.32, h: 0.16, y: -0.22 },
    { r: 0.24, h: 0.14, y: -0.36 },
  ];
  for(let i = 0; i < ringSizes.length; i++){
    const r = ringSizes[i];
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(r.r, r.r * 0.95, r.h, 16),
      i % 2 === 0 ? hiveMatYellow : hiveMatDark
    );
    ring.position.y = r.y;
    hive.add(ring);
  }

  // Topo arredondado
  const top = new THREE.Mesh(
    new THREE.SphereGeometry(0.30, 16, 8, 0, Math.PI*2, 0, Math.PI/2),
    hiveMatYellow
  );
  top.position.y = 0.18;
  hive.add(top);

  // Base pontiaguda (vira para baixo)
  const bottom = new THREE.Mesh(
    new THREE.ConeGeometry(0.20, 0.18, 12),
    hiveMatDark
  );
  bottom.position.y = -0.50;
  bottom.rotation.x = Math.PI;
  hive.add(bottom);

  // Buraco de entrada
  const entrance = new THREE.Mesh(
    new THREE.CircleGeometry(0.06, 12),
    new THREE.MeshBasicMaterial({ color: 0x1a0a00 })
  );
  entrance.position.set(0, -0.18, 0.36);
  hive.add(entrance);

  // Plataforma de pouso
  const ledge = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.02, 0.06),
    new THREE.MeshPhongMaterial({ color: 0x4a2a15 })
  );
  ledge.position.set(0, -0.22, 0.38);
  hive.add(ledge);

  hive.position.set(0.30, BEEHIVE_HOVER_Y, 0);
  root.add(hive);

  root.position.copy(BEEHIVE_POS);
  root.castShadow = true;
  return root;
}

function spawnBees(){
  // Cria a colmeia primeiro
  if(!beehiveMesh){
    beehiveMesh = buildBeehive();
    scene.add(beehiveMesh);
  }
  const target = currentBeeCount();
  // Se já tem o suficiente, não faz nada
  if(bees.length >= target) return;
  for(let i = bees.length; i < target; i++){
    const b = buildBee();
    b.castShadow = true;
    // Estado inicial: cada abelha começa próxima à colmeia
    b.userData.bee.pos.set(
      BEEHIVE_POS.x + 0.30 + (Math.random() - 0.5) * 0.5,
      BEEHIVE_HOVER_Y + (Math.random() - 0.5) * 0.3,
      BEEHIVE_POS.z + (Math.random() - 0.5) * 0.5
    );
    b.userData.bee.mode = 'field';        // 'field' ou 'hive'
    b.userData.bee.modeTimer = Math.random() * 8;
    scene.add(b);
    bees.push(b);
  }
}
function updateBees(dt, t){
  if(!bees.length) return;
  for(const bee of bees){
    const s = bee.userData.bee;

    // Alterna entre ir para o campo e voltar para a colmeia
    s.modeTimer -= dt;
    if(s.modeTimer <= 0){
      if(s.mode === 'field'){
        s.mode = 'hive';
        s.modeTimer = 4 + Math.random() * 5;   // fica 4-9s na colmeia
      } else {
        s.mode = 'field';
        s.modeTimer = 8 + Math.random() * 8;   // 8-16s no campo
      }
      s.targetTimer = 0; // força recálculo do alvo
    }

    // Renova alvo aleatório
    s.targetTimer -= dt;
    if(s.targetTimer <= 0){
      if(s.mode === 'hive'){
        // Alvo perto da colmeia (pequena nuvem ao redor da entrada)
        s.target.set(
          BEEHIVE_POS.x + 0.30 + (Math.random() - 0.5) * 0.8,
          BEEHIVE_HOVER_Y + (Math.random() - 0.5) * 0.5,
          BEEHIVE_POS.z + (Math.random() - 0.5) * 0.8
        );
        s.targetTimer = 0.8 + Math.random() * 1.2;
      } else {
        // Alvo no campo
        s.target.set(
          (Math.random() - 0.5) * BEE_BOUND * 2,
          TILE_H + 0.5 + Math.random() * 1.5,
          (Math.random() - 0.5) * BEE_BOUND * 2
        );
        s.targetTimer = 1.5 + Math.random() * 2.5;
      }
    }

    const toTarget = s.target.clone().sub(s.pos);
    if(toTarget.length() > 0.01) toTarget.normalize().multiplyScalar(1.2);

    // Fuga do drone (válida em qualquer modo)
    let avoid = new THREE.Vector3(0, 0, 0);
    if(droneMesh){
      const dToDrone = s.pos.clone().sub(droneMesh.position);
      const distXZ = Math.hypot(dToDrone.x, dToDrone.z);
      if(distXZ < BEE_AVOID_DIST){
        const strength = (BEE_AVOID_DIST - distXZ) / BEE_AVOID_DIST;
        avoid.set(dToDrone.x, 0, dToDrone.z).normalize().multiplyScalar(BEE_AVOID_FORCE * strength);
        s.targetTimer = Math.min(s.targetTimer, 0.4);
      }
    }

    const jitter = new THREE.Vector3(
      (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 0.3,
      (Math.random() - 0.5) * 0.6
    );
    s.vel.add(toTarget.multiplyScalar(dt * 4));
    s.vel.add(avoid.multiplyScalar(dt * 4));
    s.vel.add(jitter.multiplyScalar(dt * 2));
    s.vel.multiplyScalar(0.92);
    if(s.vel.length() > BEE_MAX_SPEED) s.vel.setLength(BEE_MAX_SPEED);
    s.pos.add(s.vel.clone().multiplyScalar(dt));
    if(s.pos.y < TILE_H + 0.3) s.pos.y = TILE_H + 0.3;
    if(s.pos.y > TILE_H + 2.5) s.pos.y = TILE_H + 2.5;
    bee.position.copy(s.pos);
    if(Math.hypot(s.vel.x, s.vel.z) > 0.05){
      bee.rotation.y = Math.atan2(s.vel.x, s.vel.z);
    }
    s.flapPhase += dt * 70;
    const flap = Math.sin(s.flapPhase) * 0.9;
    if(bee.userData.wings){
      bee.userData.wings.FL.rotation.y =  0.2 + flap;
      bee.userData.wings.FR.rotation.y = -0.2 - flap;
      bee.userData.wings.BL.rotation.y =  0.4 + flap * 0.8;
      bee.userData.wings.BR.rotation.y = -0.4 - flap * 0.8;
    }
  }
}

// ─── Drone Auxiliar (cosmético - shop) ─────────────────────────────────────
function buildHelperDrone(){
  const drone = new THREE.Group();
  const mBody = new THREE.MeshPhongMaterial({ color: 0xff6b35, shininess: 100 });
  const mArm  = new THREE.MeshPhongMaterial({ color: 0x2a2a2a });
  const mRot  = new THREE.MeshPhongMaterial({ color: 0xa0b0c0, transparent: true, opacity: 0.55 });
  const mBlade= new THREE.MeshPhongMaterial({ color: 0x1a1a1a });
  // Corpo central menor
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.10, 0.32), mBody);
  drone.add(body);
  // Braços + rotores em X
  const rotors = [];
  const armLen = 0.32;
  for(let i=0; i<4; i++){
    const ang = (Math.PI/2)*i + Math.PI/4;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,armLen,6), mArm);
    arm.position.set(Math.cos(ang)*armLen/2, 0, Math.sin(ang)*armLen/2);
    arm.rotation.z = Math.PI/2;
    arm.rotation.y = -ang;
    drone.add(arm);
    const rotor = new THREE.Group();
    rotor.position.set(Math.cos(ang)*armLen, 0.06, Math.sin(ang)*armLen);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.012, 12), mRot);
    rotor.add(disc);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.008, 0.025), mBlade);
    rotor.add(blade);
    drone.add(rotor);
    rotors.push(rotor);
  }
  drone.userData.rotors = rotors;
  drone.scale.setScalar(0.75);
  return drone;
}

// Estado dos companheiros
let helperDroneMesh = null;
let helperDroneUnlocked = false;
const HELPER_DRONE_COST = 250;

function spawnHelperDrone(){
  if(helperDroneMesh) return;
  helperDroneMesh = buildHelperDrone();
  helperDroneMesh.castShadow = true;
  scene.add(helperDroneMesh);
}
function buyHelperDrone(){
  if(helperDroneUnlocked){ log('🛸 Drone Auxiliar já comprado.','warn'); return; }
  if(coins < HELPER_DRONE_COST){ log(`⚠ Precisa de ${HELPER_DRONE_COST} 🪙 para o Drone Auxiliar.`,'warn'); return; }
  coins -= HELPER_DRONE_COST;
  helperDroneUnlocked = true;
  spawnHelperDrone();
  showNotif(`🛸 Drone Auxiliar! Capacidade ${DRONE_CAPACITY_BASE}→${droneCapacity()}`);
  log(`✅ Drone Auxiliar voando junto. Capacidade aumentada para ${droneCapacity()}!`,'ok');
  updateStats(); saveGame();
}

// ─── Compra de Colmeia (mais abelhas = colheita mais rápida) ───
function buyBeeHive(){
  if(hivesOwned >= MAX_HIVES){
    showNotif('🏖️ Máximo de colmeias atingido!');
    return;
  }
  if(coins < BEE_HIVE_COST){
    log(`⚠ Precisa de ${BEE_HIVE_COST} 🪙 para uma nova colmeia.`,'warn');
    return;
  }
  coins -= BEE_HIVE_COST;
  hivesOwned++;
  spawnBees();   // adiciona +BEES_PER_HIVE abelhas
  const pct = Math.round((beeGrowMultiplier() - 1) * 100);
  showNotif(`🐝 +${BEES_PER_HIVE} abelhas! Crescimento +${pct}%`);
  log(`✅ Colmeia ${hivesOwned}/${MAX_HIVES} adquirida. Total: ${bees.length} abelhas.`,'ok');
  updateStats(); saveGame();
}

// ─── Drone Autônomo "B" (com script próprio - shop) ─────────────────────────
let droneBMesh = null;
let droneB = { x: 0, y: 0, dir: 0 };
let droneBInventory = { milho:0, soja:0, feijao:0, algodao:0, trigo:0, batata:0, tomate:0, cenoura:0, abobora:0, cana:0, uva:0, madeira:0 };
let droneBUnlocked = false;
let droneBResting = true;   // quando true, fica pairando sobre o heliponto
const DRONE_B_COST = 1000;
// Drone B: bateria, armazenamento e custo de recarga
const DRONE_B_BATTERY_MAX = 60;        // bateria total
const DRONE_B_STORAGE_MAX = 20;        // capacidade total (somando todas as crops)
const DRONE_B_RECHARGE_COST = 5;       // 🪙 cobrado por recarga
const DRONE_B_HARVEST_COST = 1.5;      // bateria por colheita
const DRONE_B_MOVE_COST = 0.4;         // bateria por step
let droneBBattery = DRONE_B_BATTERY_MAX;
let droneBCharging = false;
let droneBGoingToCharge = false;   // está voando para o heliponto
function droneBStorageTotal(){
  let s = 0;
  for(const k of Object.keys(droneBInventory)) s += (droneBInventory[k]||0);
  return s;
}
// Posição mundial do heliponto (espelha buildHelipad: -2,-2)
const HELIPAD_WX = -2;
const HELIPAD_WZ = -2;
const HELIPAD_HOVER_Y = 1.4;

function buildDroneB(){
  // Versão azul/verde do drone principal
  const drone = new THREE.Group();
  const mBody = new THREE.MeshPhongMaterial({ color: 0x4488ff, shininess: 100 });
  const mDark = new THREE.MeshPhongMaterial({ color: 0x1a2540 });
  const mRot  = new THREE.MeshPhongMaterial({ color: 0xa0c0e0, transparent:true, opacity:0.55 });
  const mBlade= new THREE.MeshPhongMaterial({ color: 0x1a1a2a });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42,0.14,0.42), mBody);
  drone.add(body);
  const rotors = [];
  for(let i=0;i<4;i++){
    const ang = Math.PI/2 * i + Math.PI/4;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,0.42,6), mDark);
    arm.position.set(Math.cos(ang)*0.21, 0, Math.sin(ang)*0.21);
    arm.rotation.z = Math.PI/2;
    arm.rotation.y = -ang;
    drone.add(arm);
    const r = new THREE.Group();
    r.position.set(Math.cos(ang)*0.42, 0.08, Math.sin(ang)*0.42);
    r.add(new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.13,0.014,12), mRot));
    r.add(new THREE.Mesh(new THREE.BoxGeometry(0.26,0.01,0.03), mBlade));
    drone.add(r);
    rotors.push(r);
  }
  drone.userData.rotors = rotors;
  // ─── Barra de bateria 3D acima do drone B ─────────────────────────────────
  const batGroup = new THREE.Group();
  batGroup.position.set(0, .55, 0);
  const batBg = new THREE.Mesh(new THREE.PlaneGeometry(.6, .08), new THREE.MeshBasicMaterial({ color:0x111111, side:THREE.DoubleSide }));
  batGroup.add(batBg);
  const batBorder = new THREE.Mesh(new THREE.PlaneGeometry(.62, .10), new THREE.MeshBasicMaterial({ color:0x88ccff, side:THREE.DoubleSide }));
  batBorder.position.z = -0.001;
  batGroup.add(batBorder);
  const batFillMat = new THREE.MeshBasicMaterial({ color:0x44dd44, side:THREE.DoubleSide });
  const batFill = new THREE.Mesh(new THREE.PlaneGeometry(.58, .06), batFillMat);
  batFill.position.z = 0.002;
  batGroup.add(batFill);
  drone.add(batGroup);
  drone.userData.batteryBar = { group: batGroup, fill: batFill, fillMat: batFillMat, bg: batBg };
  drone.scale.setScalar(0.9);
  return drone;
}
function updateDroneBBatteryBar(){
  if(!droneBMesh || !droneBMesh.userData.batteryBar) return;
  const bar = droneBMesh.userData.batteryBar;
  const pct = Math.max(0, Math.min(1, droneBBattery / DRONE_B_BATTERY_MAX));
  bar.fill.scale.x = Math.max(0.001, pct);
  bar.fill.position.x = -0.29 * (1 - pct);
  let color;
  if(droneBCharging) color = 0x44aaff;
  else if(pct > 0.5) color = 0x44dd44;
  else if(pct > 0.2) color = 0xeecc22;
  else               color = 0xee3333;
  bar.fillMat.color.setHex(color);
}
function spawnDroneB(){
  if(droneBMesh) return;
  droneBMesh = buildDroneB();
  droneBMesh.castShadow = true;
  droneBMesh.visible = true;
  // Sempre clampa dentro da \u00e1rea desbloqueada
  droneB.x = Math.max(0, Math.min(unlockedSize - 1, droneB.x|0));
  droneB.y = Math.max(0, Math.min(unlockedSize - 1, droneB.y|0));
  droneB.dir = ((droneB.dir|0) + 4) % 4;
  // Posiciona visualmente bem perto do drone principal
  if(droneMesh){
    droneBMesh.position.set(
      droneMesh.position.x + 0.8,
      droneMesh.position.y + 0.4,
      droneMesh.position.z + 0.8
    );
  } else {
    droneBMesh.position.set(HELIPAD_WX, HELIPAD_HOVER_Y, HELIPAD_WZ);
  }
  droneBMesh.rotation.y = -droneB.dir * Math.PI / 2;
  scene.add(droneBMesh);
  console.log('🤖 Drone B spawnado:', {droneB, scenePos: droneBMesh.position, unlockedSize});
  log(`🤖 Drone B em (${droneB.x},${droneB.y})`,'ok');
}
function buyDroneB(){
  if(droneBUnlocked){ log('🤖 Drone Autônomo já comprado.','warn'); return; }
  if(coins < DRONE_B_COST){ log(`⚠ Precisa de ${DRONE_B_COST} 🪙 para o Drone Autônomo.`,'warn'); return; }
  coins -= DRONE_B_COST;
  droneBUnlocked = true;
  showNotif('🤖 Drone Autônomo adquirido!');
  log('✅ Drone B desbloqueado! Use chamar_b() para invocá-lo e dispensar_b() para recolher.','ok');
  updateStats(); saveGame();
}

// Invocar/recolher o Drone B sob demanda
function chamar_b(){
  if(!droneBUnlocked){ log('⚠ Drone B não foi comprado.','warn'); return; }
  if(droneBMesh){ log('🤖 Drone B já está ativo.','info'); return; }
  spawnDroneB();
  startDroneBAuto();
  showNotif('🤖 Drone B invocado!');
}
function dispensar_b(){
  if(!droneBMesh){ log('⚠ Drone B não está ativo.','warn'); return; }
  stopDroneBAuto();
  droneBCharging = false;
  droneBGoingToCharge = false;
  scene.remove(droneBMesh);
  droneBMesh = null;
  log('📥 Drone B recolhido.','info');
  showNotif('📥 Drone B recolhido');
}

// Funções de controle do Drone B (acessíveis ao script do jogador)
async function mover_b(){
  if(!droneBUnlocked || !droneBMesh) { log('⚠ Drone B não comprado.','warn'); return; }
  const [dx,dz] = DIR_VEC[droneB.dir];
  const nx = droneB.x + dx, nz = droneB.y + dz;
  if(nx>=0 && nx<unlockedSize && nz>=0 && nz<unlockedSize){
    droneB.x = nx; droneB.y = nz;
  }
  await doTick();
}
async function girar_esq_b(){
  if(!droneBUnlocked) return;
  droneB.dir = (droneB.dir + 3) % 4;
  await doTick();
}
async function girar_dir_b(){
  if(!droneBUnlocked) return;
  droneB.dir = (droneB.dir + 1) % 4;
  await doTick();
}
async function arar_b(){
  if(!droneBUnlocked) return;
  const t = grid[droneB.y][droneB.x];
  if(t.type === T.EMPTY){ t.type = T.SOIL; syncTile(droneB.x, droneB.y); }
  await doTick();
}
async function plantar_b(){
  if(!droneBUnlocked) return;
  const t = grid[droneB.y][droneB.x];
  if(t.type === T.SOIL){ t.type = T.SEED; t.plantedTick = tick; t.crop = currentCrop; syncTile(droneB.x, droneB.y); }
  await doTick();
}
async function colher_b(){
  if(!droneBUnlocked) return;
  const t = grid[droneB.y][droneB.x];
  if(t.type === T.READY){
    const cropKey = t.crop;
    spawnFX(droneB.x, droneB.y);
    t.type = T.SOIL; t.crop = null;
    syncTile(droneB.x, droneB.y);
    harvestCount++; coins++;
    droneBInventory[cropKey] = (droneBInventory[cropKey]||0) + 1;
    // Drone B descarrega direto (sem capacidade limite)
    siloStorage[cropKey] = (siloStorage[cropKey]||0) + 1;
    droneBInventory[cropKey] = 0;
    log(`🤖 Drone B colheu ${CROPS[cropKey]?.name||cropKey}!`,'ok');
    updateStats(); saveGame();
  }
  await doTick();
}

// ─── Modo "seguir e colher" ──────────────────────────────────────────────────
// Drone B rastreia o drone principal usando A* simples (BFS) e colhe tudo
// que estiver READY no caminho. Para com `parar_b()` ou ao atingir maxSteps.
let droneBFollowing = false;
async function seguir_a(maxSteps = 200){
  if(!droneBUnlocked || !droneBMesh){ log('⚠ Drone B não comprado.','warn'); return; }
  if(droneBFollowing){ log('🤖 Drone B já está seguindo.','warn'); return; }
  droneBFollowing = true;
  log('🤖 Drone B começou a seguir o drone principal.','ok');
  let steps = 0;
  while(droneBFollowing && steps < maxSteps){
    steps++;
    // 1) Sempre tenta colher na posição atual
    const cur = grid[droneB.y]?.[droneB.x];
    if(cur && cur.type === T.READY){
      await colher_b();
      continue;
    }
    // 2) Se já está no drone principal (ou adjacente), aguarda
    const dx = robot.x - droneB.x;
    const dy = robot.y - droneB.y;
    if(Math.abs(dx) + Math.abs(dy) <= 1){
      await doTick();
      continue;
    }
    // 3) Calcula próximo passo em direção ao drone (greedy, prioriza eixo maior)
    let stepX = 0, stepY = 0;
    if(Math.abs(dx) >= Math.abs(dy)){
      stepX = Math.sign(dx);
    } else {
      stepY = Math.sign(dy);
    }
    // Direção desejada
    let wantDir = droneB.dir;
    if(stepX === 1)  wantDir = 0;     // +x
    if(stepY === 1)  wantDir = 1;     // +y
    if(stepX === -1) wantDir = 2;     // -x
    if(stepY === -1) wantDir = 3;     // -y
    // Gira até alinhar
    let safety = 4;
    while(droneB.dir !== wantDir && safety-- > 0){
      const diff = (wantDir - droneB.dir + 4) % 4;
      if(diff === 1)      await girar_dir_b();
      else if(diff === 3) await girar_esq_b();
      else { await girar_dir_b(); await girar_dir_b(); }
    }
    // Move
    await mover_b();
  }
  droneBFollowing = false;
  log(`🤖 Drone B parou de seguir (${steps} passos).`,'info');
}
function parar_b(){
  if(droneBFollowing){
    droneBFollowing = false;
    log('🛑 Drone B vai parar de seguir.','info');
  }
}

// ─── Modo Autônomo: Drone B trabalha sozinho ──────────────────────────────
// Roda em intervalo próprio (independente do script do jogador).
// Procura o tile READY mais próximo, anda até ele e colhe. Repete sem parar.
let droneBAutoOn = false;
let droneBAutoTimer = null;
function droneBAutoStep(){
  if(!droneBAutoOn || !droneBUnlocked || !droneBMesh) return;
  if(droneBCharging) return; // recarregando, parado
  if(droneBGoingToCharge){
    // Esperando o mesh chegar visualmente ao heliponto
    const dx = droneBMesh.position.x - HELIPAD_WX;
    const dz = droneBMesh.position.z - HELIPAD_WZ;
    if(dx*dx + dz*dz < 0.25){ // chegou perto
      droneBRechargeStart();
    }
    return;
  }
  const usz = Math.max(1, unlockedSize|0);
  // Sanitiza posição
  if(!Number.isFinite(droneB.x) || droneB.x < 0 || droneB.x >= usz) droneB.x = 0;
  if(!Number.isFinite(droneB.y) || droneB.y < 0 || droneB.y >= usz) droneB.y = 0;
  if(!Number.isFinite(droneB.dir)) droneB.dir = 0;
  droneBResting = false;

  // ─── Verifica bateria → vai para o heliponto recarregar ───
  if(droneBBattery <= DRONE_B_HARVEST_COST){
    droneBGoingToCharge = true;
    log('🔋 Drone B com bateria baixa, indo para o heliponto...','warn');
    return;
  }
  // ─── Verifica armazenamento cheio → vai pro silo descarregar ───
  if(droneBStorageTotal() >= DRONE_B_STORAGE_MAX){
    droneBDumpToSilo();
    return;
  }

  // 1) Se o tile atual está READY → colhe
  const cur = grid[droneB.y]?.[droneB.x];
  if(cur && cur.type === T.READY){
    const cropKey = cur.crop;
    spawnFX(droneB.x, droneB.y);
    cur.type = T.SOIL; cur.crop = null;
    syncTile(droneB.x, droneB.y);
    harvestCount++; coins++;
    droneBInventory[cropKey] = (droneBInventory[cropKey]||0) + 1;
    droneBBattery = Math.max(0, droneBBattery - DRONE_B_HARVEST_COST);
    updateDroneBBatteryBar();
    updateStats();
    return;
  }

  // 2) Caminhar em zigue-zague pelo mapa
  droneBBattery = Math.max(0, droneBBattery - DRONE_B_MOVE_COST);
  updateDroneBBatteryBar();
  const goingRight = (droneB.y % 2 === 0);
  if(goingRight){
    if(droneB.x < usz - 1){
      droneB.x++; droneB.dir = 0;
    } else if(droneB.y < usz - 1){
      droneB.y++; droneB.dir = 1;
    } else {
      droneB.x = 0; droneB.y = 0; droneB.dir = 0;
    }
  } else {
    if(droneB.x > 0){
      droneB.x--; droneB.dir = 2;
    } else if(droneB.y < usz - 1){
      droneB.y++; droneB.dir = 1;
    } else {
      droneB.x = 0; droneB.y = 0; droneB.dir = 0;
    }
  }
}

// Descarga automática no silo: transfere todo o inventário e segue
function droneBDumpToSilo(){
  let total = 0;
  for(const k of Object.keys(droneBInventory)){
    const q = droneBInventory[k]||0;
    if(q > 0){
      siloStorage[k] = (siloStorage[k]||0) + q;
      droneBInventory[k] = 0;
      total += q;
    }
  }
  if(total > 0){
    log(`📦 Drone B descarregou ${total} no silo!`,'ok');
    showNotif(`📦 Drone B → silo (+${total})`);
  }
  updateStats(); saveGame();
}

// Recarga do Drone B: cobra moedas, anima
async function droneBRechargeStart(){
  if(droneBCharging) return;
  if(coins < DRONE_B_RECHARGE_COST){
    log(`⚠ Drone B sem moedas para recarregar (${DRONE_B_RECHARGE_COST} 🪙)! Modo automático parado.`,'warn');
    showNotif(`⚠ Drone B sem ${DRONE_B_RECHARGE_COST} 🪙!`);
    stopDroneBAuto();
    return;
  }
  coins -= DRONE_B_RECHARGE_COST;
  droneBCharging = true;
  updateStats();
  log(`🔋 Drone B recarregando (-${DRONE_B_RECHARGE_COST} 🪙)...`,'info');
  showNotif(`🔋 Drone B recarregando (-${DRONE_B_RECHARGE_COST} 🪙)`);
  const secs = 4;
  const start = Date.now();
  const initial = droneBBattery;
  const max = DRONE_B_BATTERY_MAX;
  await new Promise(resolve => {
    const iv = setInterval(()=>{
      const p = Math.min(1, (Date.now() - start) / (secs*1000));
      droneBBattery = initial + (max - initial) * p;
      updateDroneBBatteryBar();
      updateStats();
      if(p >= 1){ clearInterval(iv); resolve(); }
    }, 100);
  });
  droneBBattery = max;
  droneBCharging = false;
  droneBGoingToCharge = false;
  updateDroneBBatteryBar();
  updateStats();
  log('⚡ Drone B recarregado!','ok');
}
function startDroneBAuto(){
  if(!droneBUnlocked){ log('⚠ Drone B não foi comprado.','warn'); return; }
  if(!droneBMesh) spawnDroneB();
  if(droneBAutoTimer) return;
  droneBAutoOn = true;
  droneBAutoTimer = setInterval(droneBAutoStep, 350);
  log('🤖 Drone B em modo automático: vai colher sozinho!','ok');
}
function stopDroneBAuto(){
  droneBAutoOn = false;
  if(droneBAutoTimer){ clearInterval(droneBAutoTimer); droneBAutoTimer = null; }
  log('🛑 Drone B parou o modo automático.','info');
}
// Aliases para o jogador chamar via script
function auto_b(){ startDroneBAuto(); }
function parar_auto_b(){ stopDroneBAuto(); }

// ─── Modo Lenhador (Drone B corta árvores) ──────────────────────────────────
let droneBWoodMode = false;
let droneBWoodTimer = null;
let droneBWoodTarget = null; // { tree, x, z }

function findNearestTree(fromX, fromZ){
  let best = null, bestD = Infinity;
  for(const tree of treeMeshes){
    const ud = tree.userData || {};
    if(ud.harvested) continue;
    const px = ud._origPos ? ud._origPos.x : tree.position.x;
    const pz = ud._origPos ? ud._origPos.z : tree.position.z;
    const dx = px - fromX, dz = pz - fromZ;
    const d2 = dx*dx + dz*dz;
    if(d2 < bestD){ bestD = d2; best = { tree, x:px, z:pz }; }
  }
  return best;
}

// Variante de harvestTree que adiciona ao inventário do Drone B
function harvestTreeForB(treeRoot){
  const ud = treeRoot.userData;
  if(!ud || !ud.isTree || ud.harvested) return false;
  ud.harvested = true;
  ud._origPos = treeRoot.position.clone();
  ud._origRot = treeRoot.rotation.clone();
  ud._origScale = treeRoot.scale.clone();
  scene.remove(treeRoot);
  woodTotal += TREE_WOOD;
  droneBInventory.madeira = (droneBInventory.madeira||0) + TREE_WOOD;
  harvestCount += TREE_WOOD;
  log(`🪵 Drone B +${TREE_WOOD} madeira (${droneBStorageTotal()}/${DRONE_B_STORAGE_MAX})`, 'ok');
  if(typeof updateStats === 'function') updateStats();
  // broto cresce de novo (sistema existente)
  const sprout = _buildSprout();
  sprout.position.copy(ud._origPos);
  sprout.userData.isSprout = true;
  sprout.userData.startMs = performance.now();
  sprout.userData.parentTree = treeRoot;
  scene.add(sprout);
  ud._sproutMesh = sprout;
  return true;
}

function droneBWoodStep(){
  if(!droneBWoodMode || !droneBUnlocked || !droneBMesh) return;
  if(droneBCharging || droneBGoingToCharge) return;
  if(droneBBattery <= DRONE_B_HARVEST_COST){
    droneBGoingToCharge = true;
    droneBWoodTarget = null;
    log('🔋 Drone B (lenhador) com bateria baixa, indo recarregar...','warn');
    return;
  }
  if(droneBStorageTotal() >= DRONE_B_STORAGE_MAX){
    droneBDumpToSilo();
    return;
  }
  if(!droneBWoodTarget){
    const t = findNearestTree(droneBMesh.position.x, droneBMesh.position.z);
    if(!t){
      log('🌲 Nenhuma árvore disponível para cortar.','warn');
      stopDroneBWoodAuto();
      return;
    }
    droneBWoodTarget = t;
    return;
  }
  const dx = droneBMesh.position.x - droneBWoodTarget.x;
  const dz = droneBMesh.position.z - droneBWoodTarget.z;
  const dist = Math.hypot(dx, dz);
  if(dist < 1.0){
    if(harvestTreeForB(droneBWoodTarget.tree)){
      droneBBattery = Math.max(0, droneBBattery - DRONE_B_HARVEST_COST);
      updateDroneBBatteryBar(); updateStats();
    }
    droneBWoodTarget = null;
  } else {
    droneBBattery = Math.max(0, droneBBattery - DRONE_B_MOVE_COST);
    updateDroneBBatteryBar();
  }
}

function startDroneBWoodAuto(){
  if(!droneBUnlocked){ log('⚠ Drone B não foi comprado.','warn'); return; }
  if(!droneBMesh) spawnDroneB();
  if(droneBAutoOn) stopDroneBAuto();          // não roda os dois ao mesmo tempo
  if(droneBWoodTimer) return;
  droneBWoodMode = true;
  droneBWoodTimer = setInterval(droneBWoodStep, 350);
  log('🪓 Drone B em modo lenhador: cortando árvores!','ok');
  showNotif('🪓 Drone B → modo lenhador');
}
function stopDroneBWoodAuto(){
  droneBWoodMode = false;
  droneBWoodTarget = null;
  if(droneBWoodTimer){ clearInterval(droneBWoodTimer); droneBWoodTimer = null; }
  log('🛑 Drone B parou o modo lenhador.','info');
}
function auto_b_madeira(){ startDroneBWoodAuto(); }
function parar_auto_b_madeira(){ stopDroneBWoodAuto(); }

function buildDrone() {
  const drone=new THREE.Group();
  const mBody =metalMat;
  const mDark =new THREE.MeshPhongMaterial({color:0x1a252f});
  const mPlate=new THREE.MeshPhongMaterial({color:0x3d5166,shininess:120});
  const mRotor=new THREE.MeshPhongMaterial({color:0xa0b0c0,transparent:true,opacity:.55});
  const mBlade=new THREE.MeshPhongMaterial({color:0x1a252f});
  const mRed  =new THREE.MeshPhongMaterial({color:0xff2222,emissive:0x880000});
  const mGreen=new THREE.MeshPhongMaterial({color:0x22ff44,emissive:0x004411});

  const body=new THREE.Mesh(new THREE.BoxGeometry(.40,.13,.40),mBody); body.castShadow=true; drone.add(body);
  const plate=new THREE.Mesh(new THREE.BoxGeometry(.32,.034,.32),mPlate); plate.position.y=.082; drone.add(plate);

  const cam=new THREE.Mesh(new THREE.SphereGeometry(.08,10,7,0,Math.PI*2,0,Math.PI*.6),mDark);
  cam.rotation.x=Math.PI; cam.position.y=-.074; drone.add(cam);

  const lens=new THREE.Mesh(new THREE.CircleGeometry(.038,10),new THREE.MeshPhongMaterial({color:0x112244,shininess:300}));
  lens.rotation.x=Math.PI/2; lens.position.set(0,-.117,0); drone.add(lens);

  [[-.1,0,.18],[.1,0,.18],[-.1,0,-.18],[.1,0,-.18]].forEach(([lx,ly,lz],i)=>{
    const led=new THREE.Mesh(new THREE.SphereGeometry(.022,6,4),i<2?mRed:mGreen);
    led.position.set(lx,ly+.07,lz); drone.add(led);
  });

  const glow=new THREE.PointLight(0x5577ff,1.0,3.5); glow.position.set(0,-.15,0); drone.add(glow); drone.userData.glow=glow;

  // ─── Blinking Red and Blue Lights ──────────────────────────────────────────
  const redLight=new THREE.PointLight(0xff0000, 1.5, 5);
  redLight.position.set(-.15, .05, .25);
  drone.add(redLight);
  
  const blueLight=new THREE.PointLight(0x0066ff, 1.5, 5);
  blueLight.position.set(.15, .05, .25);
  drone.add(blueLight);
  
  drone.userData.lights = { red: redLight, blue: blueLight };
  drone.userData.lightPhase = 0;

  const rotors=[];
  [Math.PI/4,-Math.PI/4,3*Math.PI/4,-3*Math.PI/4].forEach((ang,idx)=>{
    const ax=Math.cos(ang)*.44, az=Math.sin(ang)*.44;
    const arm=new THREE.Mesh(new THREE.BoxGeometry(.44*1.05,.038,.038),new THREE.MeshPhongMaterial({color:0x4a5a70}));
    arm.position.set(ax*.5,0,az*.5); arm.rotation.y=ang; arm.castShadow=true; drone.add(arm);
    const motor=new THREE.Mesh(new THREE.CylinderGeometry(.052,.052,.065,8),mDark); motor.position.set(ax,.032,az); drone.add(motor);
    const disc=new THREE.Mesh(new THREE.CylinderGeometry(.21,.21,.012,14),mRotor); disc.position.set(ax,.065,az); drone.add(disc);
    for(let b=0;b<2;b++){const blade=new THREE.Mesh(new THREE.BoxGeometry(.40,.008,.055),mBlade);blade.rotation.y=b*Math.PI/2;disc.add(blade);}
    rotors.push({disc,dir:idx%2===0?1:-1});
  });

  // ─── Cowboy Hat (Using FBX Model) ─────────────────────────────────────────
  if (hatModel3D) {
    // Usar o modelo FBX carregado
    const hatClone = hatModel3D.clone();
    drone.add(hatClone);
    drone.userData.hatModel = hatClone;
    log('🤠 Chapéu FBX adicionado ao drone!', 'ok');
  } else {
    // Fallback: usar chapéu geométrico se FBX não estiver carregado
    const mHat=new THREE.MeshPhongMaterial({color:0x6b3410,shininess:25,emissive:0x3d1a08});
    const mHatLight=new THREE.MeshPhongMaterial({color:0x8b4513,shininess:20,emissive:0x4a2410});
    const mBand=new THREE.MeshPhongMaterial({color:0x2c1810,emissive:0x0a0604});
    const mBandGold=new THREE.MeshPhongMaterial({color:0xdaa520,shininess:60,emissive:0x6d5410});
    
    const crownPoints = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(.11, 0),
      new THREE.Vector2(.12, .05),
      new THREE.Vector2(.145, .095),
      new THREE.Vector2(.16, .16),
      new THREE.Vector2(.155, .22),
      new THREE.Vector2(.11, .265),
      new THREE.Vector2(.055, .285),
      new THREE.Vector2(0, .285)
    ];
    const crownGeom = new THREE.LatheGeometry(crownPoints, 32);
    const crown = new THREE.Mesh(crownGeom, mHat);
    crown.position.y = .19;
    crown.castShadow = true;
    drone.add(crown);

    const brimPoints = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(.12, 0),
      new THREE.Vector2(.27, .015),
      new THREE.Vector2(.33, .008),
      new THREE.Vector2(.34, 0),
      new THREE.Vector2(.33, -.008),
      new THREE.Vector2(.27, -.015),
      new THREE.Vector2(.12, 0),
      new THREE.Vector2(0, 0)
    ];
    const brimGeom = new THREE.LatheGeometry(brimPoints, 32);
    const brim = new THREE.Mesh(brimGeom, mHatLight);
    brim.position.y = .145;
    brim.castShadow = true;
    drone.add(brim);

    const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(.122, .115, .024, 32), mBand);
    hatBand.position.y = .145;
    drone.add(hatBand);

    const bandTrim = new THREE.Mesh(new THREE.CylinderGeometry(.125, .125, .008, 32), mBandGold);
    bandTrim.position.y = .165;
    drone.add(bandTrim);
    
    const bandTrimBack = new THREE.Mesh(new THREE.CylinderGeometry(.125, .125, .008, 32), mBandGold);
    bandTrimBack.position.y = .124;
    drone.add(bandTrimBack);

    const pinchLeft = new THREE.Mesh(new THREE.BoxGeometry(.05, .135, .085, 4, 8, 4), mHat);
    pinchLeft.position.set(-.068, .205, .083);
    pinchLeft.rotation.z = .35;
    pinchLeft.scale.y = .65;
    drone.add(pinchLeft);

    const pinchRight = new THREE.Mesh(new THREE.BoxGeometry(.05, .135, .085, 4, 8, 4), mHat);
    pinchRight.position.set(.068, .205, .083);
    pinchRight.rotation.z = -.35;
    pinchRight.scale.y = .65;
    drone.add(pinchRight);
    
    const starGeom = new THREE.ConeGeometry(.035, .04, 5);
    const mStar = new THREE.MeshPhongMaterial({color:0xffd700,shininess:80,emissive:0xffaa00});
    const star = new THREE.Mesh(starGeom, mStar);
    star.position.set(0, .315, 0);
    star.rotation.z = Math.random() * Math.PI * 2;
    star.castShadow = true;
    drone.add(star);

    // Armazenar referências do chapéu para mudança de cor
    drone.userData.hatMaterials = {
      hatMain: mHat,
      hatLight: mHatLight,
      band: mBand,
      bandGold: mBandGold,
      crownMesh: crown,
      brimMesh: brim,
      hatBandMesh: hatBand,
      bandTrimMesh: bandTrim,
      bandTrimBackMesh: bandTrimBack,
      pinchLeftMesh: pinchLeft,
      pinchRightMesh: pinchRight,
      starMesh: star,
      mStar: mStar
    };
  }

  drone.userData.rotors=rotors;

  // ─── Barra de bateria 3D acima do drone ────────────────────────────────────────
  const batGroup = new THREE.Group();
  batGroup.position.set(0, .55, 0);
  // Fundo da barra (preto)
  const batBgGeom = new THREE.PlaneGeometry(.6, .08);
  const batBg = new THREE.Mesh(batBgGeom, new THREE.MeshBasicMaterial({ color:0x111111, side:THREE.DoubleSide }));
  batGroup.add(batBg);
  // Borda
  const batBorderGeom = new THREE.PlaneGeometry(.62, .10);
  const batBorder = new THREE.Mesh(batBorderGeom, new THREE.MeshBasicMaterial({ color:0xffffff, side:THREE.DoubleSide }));
  batBorder.position.z = -0.001;
  batGroup.add(batBorder);
  // Preenchimento (verde, escala depende do nível)
  const batFillGeom = new THREE.PlaneGeometry(.58, .06);
  const batFillMat  = new THREE.MeshBasicMaterial({ color:0x44dd44, side:THREE.DoubleSide });
  const batFill = new THREE.Mesh(batFillGeom, batFillMat);
  batFill.position.z = 0.002;
  batGroup.add(batFill);
  // Faz a barra sempre olhar para a câmera (billboard via flag em animate)
  drone.add(batGroup);
  drone.userData.batteryBar = { group: batGroup, fill: batFill, fillMat: batFillMat, bg: batBg };

  return drone;
}

// ─── Lógica do jogo ───────────────────────────────────────────────────────────
function initGrid() {
  grid=Array.from({length:GRID},()=>Array.from({length:GRID},()=>({type:T.EMPTY,plantedTick:0,crop:null})));
}

function growCrops() {
  for(let y=0;y<GRID;y++) for(let x=0;x<GRID;x++){
    if(x>=unlockedSize||y>=unlockedSize) continue;
    const t=grid[y][x];
    const age=tick-t.plantedTick;
    const grow=Math.max(1, Math.round((CROPS[t.crop]?.grow??GROW) / (boostMultiplier('grow') * beeGrowMultiplier())));
    let next=null;
    if(t.type===T.SEED  &&age>=grow) next=T.SPROUT;
    if(t.type===T.SPROUT&&age>=grow) next=T.GROWN;
    if(t.type===T.GROWN &&age>=grow) next=T.READY;
    if(next){t.type=next;t.plantedTick=tick;syncTile(x,y);}
  }
}

function getUnlockedSize(h){ let s=1; for(const e of EXPAND){ if(h>=e.h) s=e.s; } return s; }
function getNextThreshold(){ for(const e of EXPAND){ if(harvestCount<e.h) return e.h; } return null; }

function checkCropUnlocks(){
  let changed=false;
  for(const[key,crop]of Object.entries(CROPS)){
    if(!unlockedCrops.has(key)&&harvestCount>=crop.unlockAt){
      unlockedCrops.add(key); changed=true;
      showNotif(`Nova cultura: ${crop.icon} ${crop.name} desbloqueada!`);
      log(`${crop.name} desbloqueada com ${harvestCount} colheitas!`,'ok');
    }
  }
  if(changed) renderCropSelector();
}

function checkExpansion() {
  // Sem auto-expansão; apenas atualiza UI da loja para refletir XP atual
  updateShopUI();
}

// Custo em moedas para expandir para o próximo nível
function getExpandCost(){
  const next = unlockedSize + 1;
  // custo cresce com tamanho: pequeno barato, grande caro
  return Math.floor(5 + Math.pow(next, 1.8));
}
function getNextExpandSize(){
  // próximo tamanho disponível pelos thresholds
  for(const e of EXPAND){ if(e.s > unlockedSize) return e; }
  return null;
}
function expandFarm(){
  const next = getNextExpandSize();
  if(!next){ log('🌾 Fazenda já no tamanho máximo!','warn'); return; }
  if(harvestCount < next.h){
    log(`⚠ Precisa de ${next.h} colheitas (XP) para expandir para ${next.s}×${next.s}.`,'warn');
    return;
  }
  const cost = getExpandCost();
  if(coins < cost){
    log(`⚠ Precisa de ${cost} 🪙 para expandir.`,'warn');
    return;
  }
  coins -= cost;
  const old = unlockedSize;
  unlockedSize = next.s;
  for(let y=0;y<GRID;y++) for(let x=0;x<GRID;x++){
    if((x<unlockedSize&&y<unlockedSize)&&(x>=old||y>=old)) revealBlock(x,y);
  }
  showNotif(`🌾 Fazenda expandida: ${unlockedSize}×${unlockedSize}!`);
  log(`✅ Fazenda expandida para ${unlockedSize}×${unlockedSize} (-${cost} 🪙).`,'ok');
  updateStats(); saveGame();
}

// ─── Comandos do robô ─────────────────────────────────────────────────────────
let droneMesh;
function getDelay(){
  const base = Math.round(1000/parseInt(document.getElementById('speed').value,10));
  return Math.round(base / boostMultiplier('speed'));
}

async function doTick(){
  tick++; growCrops(); updateStats();
  droneMesh.userData.tx=robot.x; droneMesh.userData.tz=robot.y; droneMesh.userData.tdir=robot.dir;
  await new Promise(r=>setTimeout(r,getDelay()));
  if(stopRequested) throw new Error('STOPPED');
}

function decolar(){
  if(droneMesh && droneMesh.userData.landed){
    droneMesh.userData.landed = false;
    const startY = droneMesh.position.y;
    droneMesh.userData.floatAnim = { t:0, duration:0.7, startY, endY: TILE_H + 0.6 };
    log('🚁 Decolando!','ok');
  }
}
async function move(){ decolar(); if(!await ensureBattery('move')) return; const[dx,dz]=DIR_VEC[robot.dir],nx=robot.x+dx,nz=robot.y+dz; if(nx>=0&&nx<unlockedSize&&nz>=0&&nz<unlockedSize){robot.x=nx;robot.y=nz;} consumeEnergy('move'); await doTick(); }
async function turn_left() { decolar(); if(!await ensureBattery('turn')) return; robot.dir=(robot.dir+3)%4; consumeEnergy('turn'); await doTick(); }
async function turn_right(){ decolar(); if(!await ensureBattery('turn')) return; robot.dir=(robot.dir+1)%4; consumeEnergy('turn'); await doTick(); }

async function till(){
  decolar();
  if(!await ensureBattery('till')) return;
  const t=grid[robot.y][robot.x];
  if(t.type===T.EMPTY){t.type=T.SOIL;syncTile(robot.x,robot.y);}
  consumeEnergy('till');
  await doTick();
}
async function plant(){
  decolar();
  if(!await ensureBattery('plant')) return;
  const t=grid[robot.y][robot.x];
  if(t.type===T.SOIL){t.type=T.SEED;t.plantedTick=tick;t.crop=currentCrop;syncTile(robot.x,robot.y);}
  consumeEnergy('plant');
  await doTick();
}
async function harvest(){
  decolar();
  if(!await ensureBattery('harvest')) return;
  const t=grid[robot.y][robot.x];
  if(t.type===T.READY){
    const cropName=CROPS[t.crop]?.name||'planta';
    const cropKey=t.crop;
    spawnFX(robot.x,robot.y); t.type=T.SOIL; t.crop=null; syncTile(robot.x,robot.y);
    harvestCount++; coins++;
    droneInventory[cropKey] = (droneInventory[cropKey]||0) + 1;
    consumeEnergy('harvest');
    checkExpansion(); checkCropUnlocks();
    log(`Colheu ${cropName}! Total: ${harvestCount} | 📦 ${droneTotal()}/${DRONE_CAPACITY} | 🔋 ${Math.round(batteryPct()*100)}%`,'ok');
    updateStats();
    saveGame();
    if(droneTotal() >= DRONE_CAPACITY){
      log('⚠ Compartimento cheio! Indo descarregar no silo...','warn');
      await doTick();
      await autoUnloadToSilo();
      return;
    }
  }
  await doTick();
}

// ─── Drone derruba árvore mais próxima ──────────────────────────────────────
function _findNearestTree(){
  let best = null, bestD = Infinity;
  // posição atual do drone (x,z em coordenadas de tile)
  const dx = robot.x, dz = robot.y;
  for (const t of treeMeshes){
    if (t.userData.harvested) continue;
    const d = Math.hypot(t.position.x - dx, t.position.z - dz);
    if (d < bestD){ bestD = d; best = t; }
  }
  return best;
}

async function cortar(){
  decolar();
  if (!await ensureBattery('harvest')) return;
  if (droneTotal() >= droneCapacity()){
    log(`📦 Compartimento cheio (${droneTotal()}/${droneCapacity()}). Descarregue antes de cortar.`,'warn');
    await doTick();
    return;
  }
  const tree = _findNearestTree();
  if (!tree){
    log('🌲 Nenhuma árvore disponível para cortar.','warn');
    await doTick();
    return;
  }
  // Energia baixa: voo curto, custo plano leve
  const FLY_COST = 3;     // custo fixo de voo
  const CHOP_COST = 2;    // custo de corte
  if (battery < FLY_COST + CHOP_COST){
    await rechargeBattery();
  }
  // Voa até a árvore
  const flyH = TILE_H + 0.6;
  log(`🪓 Indo cortar árvore em (${tree.position.x.toFixed(1)}, ${tree.position.z.toFixed(1)})`, 'info');
  await flyDroneTo(tree.position.x, tree.position.z, flyH);
  battery = Math.max(0, battery - FLY_COST);
  updateBatteryBar(); updateStats();
  // Corta
  harvestTree(tree);
  battery = Math.max(0, battery - CHOP_COST);
  updateBatteryBar(); updateStats();
  if(droneTotal() >= droneCapacity()){
    log('⚠ Compartimento cheio! Indo descarregar no silo...','warn');
    await doTick();
    await autoUnloadToSilo();
    return;
  }
  await doTick();
}

async function flip(){
  decolar();
  if(droneMesh){
    const startY = droneMesh.position.y;
    droneMesh.userData.flipAnim = { 
      t: 0, 
      duration: 0.8, 
      startRotX: droneMesh.rotation.x, 
      startRotY: droneMesh.rotation.y, 
      startRotZ: droneMesh.rotation.z,
      startY: startY
    };
    log('Fazendo flip 360!','ok');
  }
  await doTick();
}

async function fly(){
  if(droneMesh){
    // Reiniciar hélices e limpar estado pousado
    droneMesh.userData.landed = false;
    droneMesh.userData.pousoAnim = null;
    droneMesh.userData.floatAnim = null;

    // Voltar para o primeiro bloco (posição 0,0)
    robot.x = 0; robot.y = 0;
    const flyH = TILE_H + 0.6;
    droneMesh.userData.pousoAnim = {
      phase: 'rise',
      t: 0,
      isLanding: false, // fly() não para as hélices ao terminar
      rise:   { duration: 0.6, startX: droneMesh.position.x, startY: droneMesh.position.y, startZ: droneMesh.position.z, endY: flyH + 0.8 },
      travel: { duration: 1.2, endX: 0, endZ: 0 },
      land:   { duration: 0.5, endY: flyH }
    };
    log('🚁 Decolando para o bloco inicial!','ok');
  }
  await doTick();
}

async function dive(){
  decolar();
  if(droneMesh){
    const startY = droneMesh.position.y;
    droneMesh.userData.floatAnim = { 
      t: 0, 
      duration: 0.6, 
      startY: startY, 
      endY: Math.max(0, startY - 0.5) 
    };
    log('Mergulhando!','ok');
  }
  await doTick();
}

async function spin(){
  decolar();
  if(droneMesh){
    droneMesh.userData.spinAnim = { 
      t: 0, 
      duration: 0.6, 
      startRotY: droneMesh.rotation.y 
    };
    log('Girando 360°!','ok');
  }
  await doTick();
}

async function wait(){
  await doTick();
}

async function pouse(){
  if(droneMesh && window.helipadMesh){
    const hPos = window.helipadMesh.position; // posição world do heliponto
    const startX = droneMesh.position.x;
    const startY = droneMesh.position.y;
    const startZ = droneMesh.position.z;
    const flyH   = Math.max(startY, TILE_H + 1.2); // altura de cruzeiro para voar até lá
    // Garantir que hélices girem durante toda a animação de voo
    droneMesh.userData.landed = false;
    droneMesh.userData.floatAnim = null;
    droneMesh.userData.pousoAnim = {
      phase: 'rise',  // rise → travel → land
      t: 0,
      isLanding: true, // sinaliza que deve parar hélices ao terminar
      // fase 1: subir para altura de cruzeiro
      rise:   { duration: 0.6, startX, startY, startZ, endY: flyH },
      // fase 2: voar em linha reta até o heliponto
      travel: { duration: 1.4, endX: hPos.x, endZ: hPos.z },
      // fase 3: descer suavemente até a plataforma
      land:   { duration: 0.9, endY: 0.25 }
    };
    log('🚁 Indo para o heliponto...','ok');
  }
  await doTick();
}

function can_harvest()    { return grid[robot.y][robot.x].type===T.READY; }
function get_wood()       { return woodTotal; }
function get_type()       { return grid[robot.y][robot.x].type; }
function get_x()          { return robot.x; }
function get_y()          { return robot.y; }
function get_world_size() { return unlockedSize; }
function num_items()      { return harvestCount; }
function sense(){
  const[dx,dz]=DIR_VEC[robot.dir],nx=robot.x+dx,nz=robot.y+dz;
  if(nx<0||nx>=unlockedSize||nz<0||nz>=unlockedSize) return 'WALL';
  return grid[nz][nx].type;
}
function get_crop(){ return currentCrop; }
function set_crop(name){ if(CROPS[name]&&unlockedCrops.has(name)){currentCrop=name;renderCropSelector();} }

// Cores disponíveis para o chapéu
const HAT_COLORS = {
  'marrom': { main: 0x6b3410, light: 0x8b4513, emMain: 0x3d1a08, emLight: 0x4a2410 },
  'preto': { main: 0x1a1a1a, light: 0x2d2d2d, emMain: 0x0a0a0a, emLight: 0x151515 },
  'vermelho': { main: 0x8b0000, light: 0xc41e3a, emMain: 0x440000, emLight: 0x7a0a1f },
  'azul': { main: 0x00008b, light: 0x1e90ff, emMain: 0x000044, emLight: 0x0f4877 },
  'verde': { main: 0x228b22, light: 0x32cd32, emMain: 0x114511, emLight: 0x196619 },
  'amarelo': { main: 0xdaa520, light: 0xffd700, emMain: 0x6d5410, emLight: 0x806c00 },
  'branco': { main: 0xf5f5f5, light: 0xffffff, emMain: 0x7a7a7a, emLight: 0x8c8c8c },
  'rosa': { main: 0xc71585, light: 0xff69b4, emMain: 0x630a42, emLight: 0x803459 }
};

function set_hat_color(colorName){
  const color = HAT_COLORS[colorName.toLowerCase()];
  if(!color || !droneMesh) return;
  
  // Se está usando o modelo FBX
  if(droneMesh.userData.hatModel){
    const hatModel = droneMesh.userData.hatModel;
    hatModel.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.color.setHex(color.main);
        child.material.emissive.setHex(color.emMain);
        child.material.emissiveIntensity = 0.4;
        child.material.shininess = 100;
        child.material.needsUpdate = true;
      }
    });
    log(`🤠 Chapéu FBX mudado para ${colorName}! ✨`,'ok');
  } 
  // Fallback: usar o chapéu geométrico
  else if(droneMesh.userData.hatMaterials){
    const hat = droneMesh.userData.hatMaterials;
    hat.hatMain.color.setHex(color.main);
    hat.hatMain.emissive.setHex(color.emMain);
    hat.hatLight.color.setHex(color.light);
    hat.hatLight.emissive.setHex(color.emLight);
    hat.crownMesh.material.needsUpdate = true;
    hat.brimMesh.material.needsUpdate = true;
    hat.pinchLeftMesh.material.needsUpdate = true;
    hat.pinchRightMesh.material.needsUpdate = true;
    if(hat.mStar) hat.mStar.emissive.setHex(0xffaa00);
    log(`Chapeu melhorado em ${colorName}! ✨`,'ok');
  }
}

// ─── Executor ─────────────────────────────────────────────────────────────────
const ASYNC_CMDS=['move','turn_left','turn_right','till','plant','harvest','cortar','flip','fly','dive','spin','wait','pouse','pouso','set_hat_color'];

function pythonToJS(pythonCode) {
  // 1. Remover comentários Python (#)
  const rawLines = pythonCode.split('\n').map(line => {
    const idx = line.indexOf('#');
    return idx !== -1 ? line.slice(0, idx) : line;
  });

  // 2. Converter cada linha individualmente (com âncoras ^...$)
  const converted = rawLines.map(rawLine => {
    const indentMatch = rawLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';
    const line = rawLine.trim();
    if (!line) return '';

    // Converter operadores booleanos Python → JS (antes dos blocos de controle)
    const pyLine = line
      .replace(/\bnot\s+/g, '!')
      .replace(/\band\b/g, '&&')
      .replace(/\bor\b/g, '||')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null');

    // for var in range(expr):
    const forM = pyLine.match(/^for\s+(\w+)\s+in\s+range\s*\(([\s\S]*)\)\s*:$/);
    if (forM) return `${indent}for (let ${forM[1]} = 0; ${forM[1]} < ${forM[2]}; ${forM[1]}++):`;

    // elif condition:  (ANTES do if para não ser afetado)
    const elifM = pyLine.match(/^elif\s+([\s\S]+?)\s*:$/);
    if (elifM) return `${indent}else if (${elifM[1]}):`;

    // else:
    if (pyLine === 'else:') return `${indent}else:`;

    // while True / while condition:
    const whileM = pyLine.match(/^while\s+([\s\S]+?)\s*:$/);
    if (whileM) return `${indent}while (${whileM[1]}):`;

    // if condition:  (âncoras garantem que não afeta elif)
    const ifM = pyLine.match(/^if\s+([\s\S]+?)\s*:$/);
    if (ifM) return `${indent}if (${ifM[1]}):`;

    // Aplicar substituições na linha comum (sem bloco de controle)
    const rawTrim = rawLine.trimEnd();
    const newContent = rawTrim
      .replace(/\bnot\s+/g, '!')
      .replace(/\band\b/g, '&&')
      .replace(/\bor\b/g, '||')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null');
    return newContent;
  });

  // 3. Converter indentação Python → chaves JS
  const result = [];
  const indentStack = [0];

  for (const line of converted) {
    if (!line.trim()) continue;
    const spaces = line.search(/\S/);
    const level = Math.floor(spaces / 4);
    const content = line.trim();

    // Fechar chaves para indentação reduzida
    while (indentStack.length > 1 && indentStack[indentStack.length - 1] > level) {
      indentStack.pop();
      result.push('}');
    }

    result.push('  '.repeat(indentStack.length - 1) + content);

    if (content.endsWith(':')) {
      result[result.length - 1] = result[result.length - 1].slice(0, -1) + ' {';
      indentStack.push(level + 1);
    }
  }

  // Fechar todas as chaves abertas
  while (indentStack.length > 1) {
    indentStack.pop();
    result.push('}');
  }

  return result.join('\n');
}

function transformCode(code){return ASYNC_CMDS.reduce((o,c)=>o.replace(new RegExp(`\\b${c}\\s*\\(`,'g'),`await ${c}(`),code);}

async function runPlayerCode(code){
  try {
    // Validação básica de sintaxe Python
    if (code.includes('  :') || code.includes('\t:')) {
      throw new Error('Erro de indentação: dois pontos (:) não podem ter espaços antes');
    }
    
    const jsCode = pythonToJS(code);
    const transformedCode = transformCode(jsCode);
    console.log('=== JS GERADO ===\n' + transformedCode);
    const fn=new Function('move','turn_left','turn_right','till','plant','harvest','cortar','flip','fly','dive','spin','wait','pouse','pouso','can_harvest','get_type','sense','get_x','get_y','get_world_size','num_items','get_crop','set_crop','set_hat_color','mover_b','girar_esq_b','girar_dir_b','arar_b','plantar_b','colher_b','seguir_a','parar_b','auto_b','parar_auto_b','auto_b_madeira','parar_auto_b_madeira','chamar_b','dispensar_b','get_wood','log','print',`return (async()=>{ ${transformedCode} })()`);
    const _userLog = (...args)=>log(args.map(a=>typeof a==='object'?JSON.stringify(a):String(a)).join(' '),'info');
    await fn(move,turn_left,turn_right,till,plant,harvest,cortar,flip,fly,dive,spin,wait,pouse,pouse,can_harvest,get_type,sense,get_x,get_y,get_world_size,num_items,get_crop,set_crop,set_hat_color,mover_b,girar_esq_b,girar_dir_b,arar_b,plantar_b,colher_b,seguir_a,parar_b,auto_b,parar_auto_b,auto_b_madeira,parar_auto_b_madeira,chamar_b,dispensar_b,get_wood,_userLog,_userLog);
  } catch(e) {
    // Extrair informações úteis do erro
    let errorMsg = e.message || e.toString();
    
    // Tentar identificar erros comuns
    if (errorMsg.includes('Unexpected token')) {
      errorMsg = 'Erro de sintaxe: verifique parenteses, colchetes e pontuação';
    } else if (errorMsg.includes('is not defined')) {
      const match = errorMsg.match(/(\w+) is not defined/);
      if (match) {
        errorMsg = `Funcao/variavel "${match[1]}" nao definida. Verificar indentacao ou typo`;
      }
    } else if (errorMsg.includes('Erro de indentacao')) {
      errorMsg = errorMsg;
    }
    
    log(`❌ ${errorMsg}`,'error');
    throw e;
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function log(msg,type='info'){
  const el=document.getElementById('console-log');
  const d=document.createElement('div');
  d.className=`log-${type}`;
  
  // Melhorar exibição de erros com mais detalhe
  let displayMsg = msg;
  if(type === 'error') {
    displayMsg = `❌ ${msg}`;
  } else if(type === 'ok') {
    displayMsg = `✓ ${msg}`;
  } else if(type === 'warn') {
    displayMsg = `⚠ ${msg}`;
  }
  
  d.textContent=`[${tick}] ${displayMsg}`;
  el.appendChild(d);
  el.scrollTop=el.scrollHeight;
}

function updateStats(){
  document.getElementById('harvest-count').textContent=harvestCount;
  document.getElementById('tick-count').textContent=tick;
  document.getElementById('farm-size').textContent=`${unlockedSize}×${unlockedSize}`;
  const next=getNextThreshold();
  document.getElementById('next-expand').textContent=next!=null?next-harvestCount:'MAX';
  document.getElementById('robot-pos').textContent=`X:${robot.x} Y:${robot.y}`;
  const coinsEl=document.getElementById('coin-count'); if(coinsEl) coinsEl.textContent=coins;
  const woodEl=document.getElementById('wood-count'); if(woodEl) woodEl.textContent=(siloStorage.madeira||0) + (droneInventory.madeira||0);
  // Barra de capacidade do drone
  const fill = document.getElementById('drone-bar-fill');
  const lbl  = document.getElementById('drone-bar-label');
  const total = droneTotal();
  const pct = Math.min(100, (total/DRONE_CAPACITY)*100);
  if(fill){
    fill.style.width = pct + '%';
    fill.style.background = pct>=100
      ? 'linear-gradient(90deg,#ff5050,#ff8800)'
      : pct>=70
        ? 'linear-gradient(90deg,#f0c000,#ff9000)'
        : 'linear-gradient(90deg,#44cc44,#88dd44)';
  }
  if(lbl) lbl.textContent = `📦 ${total}/${DRONE_CAPACITY}`;
  updateShopUI();
}

function setRunning(val){
  running=val;
  document.getElementById('run-btn').disabled=val;
  document.getElementById('stop-btn').disabled=!val;
  document.getElementById('reset-btn').disabled=val;
}

function showNotif(msg){
  let stack = document.getElementById('toast-stack');
  if(!stack){
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    document.body.appendChild(stack);
  }
  // Evita toasts duplicados em sequência (deduplica último)
  const last = stack.lastElementChild;
  if(last && last.dataset.msg === msg && !last.classList.contains('toast-out')){
    // Re-trigger animação aumentando contador
    const n = (parseInt(last.dataset.count||'1',10) || 1) + 1;
    last.dataset.count = String(n);
    const cnt = last.querySelector('.toast-count');
    if(cnt) cnt.textContent = `×${n}`;
    else {
      const s = document.createElement('span');
      s.className = 'toast-count';
      s.textContent = `×${n}`;
      last.appendChild(s);
    }
    clearTimeout(last._timer);
    last._timer = setTimeout(()=>{ last.classList.add('toast-out'); setTimeout(()=>last.remove(),350); }, 2800);
    return;
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.msg = msg;
  el.textContent = msg;
  stack.appendChild(el);
  // Limita a 5 toasts visíveis
  while(stack.children.length > 5){ stack.firstElementChild.remove(); }
  el._timer = setTimeout(()=>{ el.classList.add('toast-out'); setTimeout(()=>el.remove(),350); }, 2800);
}

function renderCropSelector(){
  const container=document.getElementById('crop-btns'); if(!container) return;
  container.innerHTML='';
  for(const[key,crop]of Object.entries(CROPS)){
    const unlocked=unlockedCrops.has(key);
    const btn=document.createElement('button');
    btn.className='crop-btn'+(unlocked?'':' locked')+(currentCrop===key&&unlocked?' active':'');
    btn.disabled=!unlocked;
    btn.title=unlocked?`Plantar ${crop.name}`:`Desbloqueia com ${crop.unlockAt} colheitas`;
    btn.innerHTML=`<span class="crop-icon">${crop.icon}</span><span class="crop-name">${crop.name}</span>`+(unlocked?'':`<span class="crop-lock">&#128274; ${crop.unlockAt}</span>`);
    if(unlocked) btn.addEventListener('click',()=>{ currentCrop=key; renderCropSelector(); });
    container.appendChild(btn);
  }
}

function initGame(){
  for(const s of placedSilos){ scene.remove(s.mesh); } placedSilos.length=0;
  coins=0; if(siloGhost){scene.remove(siloGhost);siloGhost=null;} siloPlacementMode=false; canvas.style.cursor='';
  const _ph=document.getElementById('placement-hint'); if(_ph) _ph.style.display='none';
  for(const k of Object.keys(droneInventory)) droneInventory[k]=0;
  for(const k of Object.keys(siloStorage))    siloStorage[k]=0;
  initGrid(); robot={x:0,y:0,dir:0}; tick=0; harvestCount=0; unlockedSize=1;
  currentCrop='milho'; unlockedCrops.clear(); unlockedCrops.add('milho');
  droneVelocity.set(0, 0, 0); // Reset drone velocity
  for(let y=0;y<GRID;y++) for(let x=0;x<GRID;x++){clearCrop(x,y); tileMeshes[y][x].visible=false; tileMeshes[y][x].scale.set(1,1,1); tileMeshes[y][x].position.y=TILE_H/2; setTileType(x,y,T.EMPTY);}
  grid[0][0].type=T.EMPTY;
  // Mostra apenas o bloco inicial (0,0)
  tileMeshes[0][0].visible=true;
  if(droneMesh){droneMesh.position.set(0,TILE_H+0.6,0);droneMesh.userData.tx=0;droneMesh.userData.tz=0;droneMesh.userData.tdir=0;droneMesh.rotation.set(0,0,0);}
  updateStats();
  renderCropSelector();
}

function insertCmd(raw){
  const code=raw.replace(/\\n/g,'\n');
  const el=document.getElementById('code-editor'); 
  el.focus();
  const s=el.selectionStart;
  
  // Detectar indentação atual
  const beforeCursor = el.value.substring(0, s);
  const lastLineStart = beforeCursor.lastIndexOf('\n') + 1;
  const currentLineIndent = beforeCursor.substring(lastLineStart).match(/^\s*/)[0];
  
  // Se o comando termina com ":", adicionar indentação extra
  let codeToInsert = code;
  if (code.trim().endsWith(':')) {
    const nextLineIndent = currentLineIndent + '    '; // Adicionar 4 espaços
    codeToInsert = code + '\n' + nextLineIndent;
  }
  
  el.value=el.value.substring(0,s)+codeToInsert+'\n'+el.value.substring(el.selectionEnd);
  el.selectionStart=el.selectionEnd=s+codeToInsert.length+1;
}

// ─── Drag ─────────────────────────────────────────────────────────────────────
function makeDraggable(panel, handle){
  let drag=false,ox=0,oy=0;
  handle.addEventListener('mousedown',e=>{drag=true;ox=e.clientX-panel.offsetLeft;oy=e.clientY-panel.offsetTop;e.preventDefault();});
  window.addEventListener('mousemove',e=>{if(!drag)return;panel.style.left=Math.max(0,Math.min(innerWidth-panel.offsetWidth,e.clientX-ox))+'px';panel.style.top=Math.max(0,Math.min(innerHeight-panel.offsetHeight,e.clientY-oy))+'px';});
  window.addEventListener('mouseup',()=>{drag=false;});
}

// ─── Minimap ──────────────────────────────────────────────────────────────────
const mmCanvas = document.getElementById('minimap-canvas');
const mmCtx    = mmCanvas.getContext('2d');
const MM_CELL  = 13;
const MM_COL   = { [T.EMPTY]:'#654321',[T.SOIL]:'#8b5a3c',[T.SEED]:'#556b2f',[T.SPROUT]:'#228b22',[T.GROWN]:'#1b4d1b',[T.READY]:'#ffd700' };
const DIR_ANG_MM = [Math.PI/2, Math.PI, -Math.PI/2, 0]; // E,S,W,N

function renderMinimap(){
  // Background com gradient
  const gradient = mmCtx.createLinearGradient(0, 0, 130, 130);
  gradient.addColorStop(0, '#0a0f1a');
  gradient.addColorStop(1, '#0d1220');
  mmCtx.fillStyle = gradient;
  mmCtx.fillRect(0, 0, 130, 130);
  
  // Grid e células
  for(let y=0;y<GRID;y++) for(let x=0;x<GRID;x++){
    const locked=x>=unlockedSize||y>=unlockedSize;
    if(locked){ mmCtx.fillStyle='#0f1418'; }
    else {
      const type=grid[y][x].type;
      if(type===T.READY){ const p=.5+Math.sin(Date.now()*.003+x+y)*.5; mmCtx.fillStyle=`rgb(${Math.round(220*p+35)},${Math.round(190*p+16)},0)`; }
      else mmCtx.fillStyle=MM_COL[type]||'#1a1f2e';
    }
    mmCtx.fillRect(x*MM_CELL+1,y*MM_CELL+1,MM_CELL-2,MM_CELL-2);
    
    // Grid lines sutis
    mmCtx.strokeStyle='rgba(100,120,160,.08)'; mmCtx.lineWidth=0.5;
    mmCtx.strokeRect(x*MM_CELL+1,y*MM_CELL+1,MM_CELL-2,MM_CELL-2);
  }
  
  // Borda da área desbloqueada com glow
  mmCtx.shadowColor='rgba(100,200,100,.4)';
  mmCtx.shadowBlur=3;
  mmCtx.strokeStyle='rgba(100,220,100,.6)'; mmCtx.lineWidth=2;
  mmCtx.strokeRect(.75,.75,unlockedSize*MM_CELL-.75,unlockedSize*MM_CELL-.75);
  mmCtx.shadowBlur=0;
  
  // Drone com efeito de glow
  const rx=robot.x*MM_CELL+MM_CELL/2, ry=robot.y*MM_CELL+MM_CELL/2;
  mmCtx.save();
  
  // Sombra/glow ao redor do drone
  mmCtx.shadowColor='rgba(100,200,255,.8)';
  mmCtx.shadowBlur=6;
  
  mmCtx.translate(rx,ry); mmCtx.rotate(DIR_ANG_MM[robot.dir]);
  
  // Anim de pulsação
  const pulse = 0.6 + 0.4 * Math.sin(Date.now() * 0.004);
  
  // Corpo do drone - hexágono (mais realista)
  mmCtx.beginPath();
  for(let i=0;i<6;i++){
    const a = (i*Math.PI/3) - Math.PI/6;
    const x = Math.cos(a) * 4.5 * pulse;
    const y = Math.sin(a) * 4.5 * pulse;
    if(i===0) mmCtx.moveTo(x,y);
    else mmCtx.lineTo(x,y);
  }
  mmCtx.closePath();
  mmCtx.fillStyle='#4488ff'; mmCtx.fill();
  mmCtx.strokeStyle='#88ccff'; mmCtx.lineWidth=1.3; mmCtx.stroke();
  
  // Seta de direção (frente do drone)
  mmCtx.beginPath(); mmCtx.moveTo(0,-6); mmCtx.lineTo(3,-2); mmCtx.lineTo(-3,-2); mmCtx.closePath();
  mmCtx.fillStyle='#ffff88'; mmCtx.fill();
  
  // Centro (chapéu do cowboy estilizado)
  mmCtx.beginPath(); mmCtx.arc(0,0,1.8,0,Math.PI*2);
  mmCtx.fillStyle='#daa520'; mmCtx.fill();
  mmCtx.strokeStyle='#f0e68c'; mmCtx.lineWidth=0.8; mmCtx.stroke();
  
  mmCtx.restore();
}

// ─── Câmera presets ───────────────────────────────────────────────────────────
let camAnim = null;
let followDrone = true;

function setCamPreset(name){
  const cx=(unlockedSize-1)/2, cz=(unlockedSize-1)/2;
  if(name==='iso') camAnim={pos:new THREE.Vector3(cx,9,cz+12), tgt:new THREE.Vector3(cx,TILE_H,cz)};
  if(name==='top') camAnim={pos:new THREE.Vector3(cx,16,cz+.01), tgt:new THREE.Vector3(cx,0,cz)};
  document.querySelectorAll('.cam-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById(`preset-${name}`)?.classList.add('active');
}

// ─── Eventos ──────────────────────────────────────────────────────────────────
document.getElementById('run-btn').addEventListener('click', async()=>{
  const raw=document.getElementById('code-editor').value.trim();
  if(!raw){log('Nenhum codigo.','warn');return;}
  let code;
  try { code = resolveImports(raw); }
  catch(err){ log(`Erro de import: ${err.message}`,'error'); return; }
  stopRequested=false; setRunning(true); log('Executando...','info');
  try{ 
    await runPlayerCode(code); 
    log('Concluido com sucesso!','ok'); 
  }
  catch(err){ 
    if(err.message==='STOPPED') {
      log('Parado pelo usuario.','warn'); 
    } else {
      const errorMsg = err.message || err.toString();
      log(`Erro de sintaxe/execucao: ${errorMsg}`,'error');
      console.error('Detalhes do erro:', err);
    } 
  }
  finally{ 
    setRunning(false); 
    stopRequested=false; 
  }
});

document.getElementById('stop-btn').addEventListener('click',()=>{ stopRequested=true; });
document.getElementById('reset-btn').addEventListener('click',()=>{ if(running)return; initGame(); document.getElementById('console-log').innerHTML=''; log('Reiniciado.','info'); saveGame(); });
document.getElementById('speed').addEventListener('input',e=>{
  // Garante que não ultrapasse o nível comprado
  let v = parseInt(e.target.value,10);
  if(v > speedLevel){ v = speedLevel; e.target.value = String(speedLevel); }
  document.getElementById('speed-label').textContent = String(v);
});
document.getElementById('min-btn').addEventListener('click',()=>{ const p=document.getElementById('editor-panel'); p.classList.toggle('minimized'); document.getElementById('min-btn').textContent=p.classList.contains('minimized')?'+':'−'; });

// ─── Modal de prompt bonito ──────────────────────────────────────────────────
function showPrompt({ title='Nome', icon='📝', message='Digite um valor:', value='', placeholder='', validate=null } = {}){
  return new Promise(resolve=>{
    const modal   = document.getElementById('prompt-modal');
    const tEl     = document.getElementById('prompt-modal-title');
    const iEl     = document.getElementById('prompt-modal-icon');
    const mEl     = document.getElementById('prompt-modal-message');
    const inp     = document.getElementById('prompt-modal-input');
    const errEl   = document.getElementById('prompt-modal-error');
    const okBtn   = document.getElementById('prompt-modal-ok');
    const cBtn    = document.getElementById('prompt-modal-cancel');
    tEl.textContent = title;
    iEl.textContent = icon;
    mEl.textContent = message;
    inp.value = value || '';
    inp.placeholder = placeholder || '';
    errEl.textContent = '';
    modal.classList.remove('hidden');
    setTimeout(()=>{ inp.focus(); inp.select(); }, 30);

    function cleanup(result){
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cBtn.removeEventListener('click', onCancel);
      inp.removeEventListener('keydown', onKey);
      modal.removeEventListener('click', onBgClick);
      resolve(result);
    }
    function onOk(){
      const v = inp.value.trim();
      if(validate){
        const err = validate(v);
        if(err){ errEl.textContent = err; inp.focus(); return; }
      } else if(!v){
        errEl.textContent = 'Digite um nome.'; inp.focus(); return;
      }
      cleanup(v);
    }
    function onCancel(){ cleanup(null); }
    function onKey(e){
      if(e.key==='Enter'){ e.preventDefault(); onOk(); }
      else if(e.key==='Escape'){ e.preventDefault(); onCancel(); }
    }
    function onBgClick(e){ if(e.target === modal) onCancel(); }
    okBtn.addEventListener('click', onOk);
    cBtn.addEventListener('click', onCancel);
    inp.addEventListener('keydown', onKey);
    modal.addEventListener('click', onBgClick);
  });
}
function showConfirm(message, title='Confirmar'){
  return new Promise(resolve=>{
    // Reusa o modal mas esconde o input
    const modal = document.getElementById('prompt-modal');
    const tEl   = document.getElementById('prompt-modal-title');
    const iEl   = document.getElementById('prompt-modal-icon');
    const mEl   = document.getElementById('prompt-modal-message');
    const inp   = document.getElementById('prompt-modal-input');
    const errEl = document.getElementById('prompt-modal-error');
    const okBtn = document.getElementById('prompt-modal-ok');
    const cBtn  = document.getElementById('prompt-modal-cancel');
    tEl.textContent = title; iEl.textContent = '⚠️'; mEl.textContent = message;
    inp.style.display = 'none'; errEl.textContent = '';
    modal.classList.remove('hidden');
    setTimeout(()=>okBtn.focus(), 30);
    function cleanup(r){
      inp.style.display = '';
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cBtn.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      resolve(r);
    }
    function onOk(){ cleanup(true); }
    function onCancel(){ cleanup(false); }
    function onKey(e){
      if(e.key==='Enter'){ e.preventDefault(); onOk(); }
      else if(e.key==='Escape'){ e.preventDefault(); onCancel(); }
    }
    okBtn.addEventListener('click', onOk);
    cBtn.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

// ─── Resolver imports entre scripts ──────────────────────────────────────────
// Sintaxe: linhas no topo do tipo:
//   import "nome_do_script"
//   import nome_do_script
// Insere o conteúdo do(s) script(s) antes do código atual.
function resolveImports(code, _seen){
  const seen = _seen || new Set();
  const lines = code.split('\n');
  const out = [];
  const prepend = [];
  const importRe = /^\s*import\s+["']?([A-Za-z0-9_\- ]+)["']?\s*$/;
  const scripts = loadScripts();
  for(const line of lines){
    const m = line.match(importRe);
    if(m){
      const name = m[1].trim();
      if(seen.has(name)) continue;          // evita ciclo
      seen.add(name);
      const src = scripts[name];
      if(src == null) throw new Error(`script "${name}" não existe`);
      prepend.push(`# === import: ${name} ===`);
      prepend.push(resolveImports(src, seen));
      prepend.push(`# === fim import: ${name} ===`);
    } else {
      out.push(line);
    }
  }
  return [...prepend, ...out].join('\n');
}


// ─── Biblioteca de scripts (localStorage) ────────────────────────────────────
const SCRIPTS_KEY = 'farmer_scripts_v1';
const SCRIPTS_CURR_KEY = 'farmer_scripts_current';
function loadScripts(){
  try { return JSON.parse(localStorage.getItem(SCRIPTS_KEY) || '{}'); } catch(_){ return {}; }
}
function saveScripts(s){ localStorage.setItem(SCRIPTS_KEY, JSON.stringify(s)); }
function currentScriptName(){ return localStorage.getItem(SCRIPTS_CURR_KEY) || ''; }
function setCurrentScriptName(n){ localStorage.setItem(SCRIPTS_CURR_KEY, n||''); }
function refreshScriptSelect(){
  const sel = document.getElementById('script-select'); if(!sel) return;
  const scripts = loadScripts();
  const names = Object.keys(scripts).sort((a,b)=>a.localeCompare(b));
  let cur = currentScriptName();
  // Se cur não está na lista (ou está vazio) mas existem scripts, adota o primeiro
  if(names.length > 0 && (!cur || !names.includes(cur))){
    cur = names[0];
    setCurrentScriptName(cur);
  } else if(names.length === 0 && cur){
    setCurrentScriptName('');
    cur = '';
  }
  sel.innerHTML = '';
  if(names.length === 0){
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = '— sem scripts salvos —';
    sel.appendChild(opt);
  } else {
    for(const n of names){
      const opt = document.createElement('option');
      opt.value = n; opt.textContent = n;
      if(n === cur) opt.selected = true;
      sel.appendChild(opt);
    }
  }
  document.getElementById('script-delete-btn').disabled = names.length === 0;
  document.getElementById('script-rename-btn').disabled = names.length === 0;
}
document.getElementById('script-select').addEventListener('change', async e=>{
  const name = e.target.value; if(!name) return;
  if(_scriptDirty){
    const ok = await showConfirm('Você tem alterações não salvas. Descartar e trocar de script?', 'Trocar Script');
    if(!ok){
      // restaura seleção anterior
      e.target.value = currentScriptName();
      return;
    }
  }
  const scripts = loadScripts();
  if(scripts[name] != null){
    document.getElementById('code-editor').value = scripts[name];
    setCurrentScriptName(name);
    markDirty(false);
    log(`📂 Script "${name}" carregado.`,'info');
  }
});
document.getElementById('script-new-btn').addEventListener('click', async ()=>{
  if(_scriptDirty){
    const ok = await showConfirm('Você tem alterações não salvas. Descartar e criar novo script?', 'Novo Script');
    if(!ok) return;
  }
  const scripts = loadScripts();
  const name = await showPrompt({
    title: 'Novo Script', icon: '✨',
    message: 'Nome do novo script:', placeholder: 'ex: colheita_otimizada',
    validate: v => !v ? 'Digite um nome.' : (scripts[v] != null ? 'Já existe um script com esse nome.' : null)
  });
  if(!name) return;
  scripts[name] = '# ' + name + '\n';
  saveScripts(scripts);
  setCurrentScriptName(name);
  document.getElementById('code-editor').value = scripts[name];
  markDirty(false);
  refreshScriptSelect();
  log(`✨ Script "${name}" criado.`,'ok');
});
document.getElementById('script-save-btn').addEventListener('click', async ()=>{
  const code = document.getElementById('code-editor').value;
  let name = currentScriptName();
  const scripts = loadScripts();
  if(!name){
    // Sem nome → novo script: abre modal pedindo nome
    name = await showPrompt({
      title: 'Salvar Script', icon: '💾',
      message: 'Nome do novo script:', placeholder: 'meu_script',
      validate: v => !v ? 'Digite um nome.' : null
    });
    if(!name) return;
    // Se o nome já existe, confirma a sobrescrita
    if(scripts[name] != null){
      const ok = await showConfirm(`Já existe um script "${name}". Sobrescrever?`, 'Sobrescrever Script');
      if(!ok) return;
    }
  }
  // Salva sobrescrevendo
  scripts[name] = code;
  saveScripts(scripts);
  setCurrentScriptName(name);
  refreshScriptSelect();
  markDirty(false);
  log(`💾 Script "${name}" salvo.`,'ok');
  showNotif(`💾 "${name}" salvo`);
});
document.getElementById('script-rename-btn').addEventListener('click', async ()=>{
  const cur = currentScriptName(); if(!cur){ log('Nenhum script ativo.','warn'); return; }
  const scripts = loadScripts();
  const novo = await showPrompt({
    title: 'Renomear Script', icon: '✏️',
    message: `Novo nome para "${cur}":`, value: cur,
    validate: v => !v ? 'Digite um nome.' : (v!==cur && scripts[v] != null ? 'Já existe — escolha outro nome.' : null)
  });
  if(!novo || novo===cur) return;
  scripts[novo] = scripts[cur];
  delete scripts[cur];
  saveScripts(scripts);
  setCurrentScriptName(novo);
  refreshScriptSelect();
  markDirty(_scriptDirty); // re-aplica estilo após refresh do botão
  log(`✏️ Script renomeado para "${novo}".`,'ok');
});
document.getElementById('script-delete-btn').addEventListener('click', async ()=>{
  const cur = currentScriptName(); if(!cur){ log('Nenhum script selecionado.','warn'); return; }
  const ok = await showConfirm(`Excluir o script "${cur}"? Esta ação não pode ser desfeita.`, 'Excluir Script');
  if(!ok) return;
  const scripts = loadScripts();
  delete scripts[cur];
  saveScripts(scripts);
  setCurrentScriptName('');
  refreshScriptSelect();
  // Limpa o editor já que o script foi excluído
  document.getElementById('code-editor').value = '';
  markDirty(false);
  log(`🗑️ Script "${cur}" excluído.`,'ok');
});
// Marca alterações não salvas (indicador visual no botão Salvar)
let _scriptDirty = false;
function markDirty(d){
  _scriptDirty = d;
  const btn = document.getElementById('script-save-btn');
  if(!btn) return;
  if(d){
    btn.style.background = 'rgba(220, 160, 40, .7)';
    btn.style.color = '#fff';
    btn.title = 'Salvar (alterações não salvas)';
  } else {
    btn.style.background = '';
    btn.style.color = '';
    btn.title = 'Salvar script atual';
  }
}
document.getElementById('code-editor').addEventListener('input', ()=>{
  if(currentScriptName()) markDirty(true);
});
// Aviso ao sair da página com alterações não salvas
window.addEventListener('beforeunload', e=>{
  if(_scriptDirty){ e.preventDefault(); e.returnValue = ''; }
});
// Atalho Ctrl+S para salvar
document.addEventListener('keydown', e=>{
  if((e.ctrlKey||e.metaKey) && e.key==='s'){
    const ed = document.getElementById('code-editor');
    if(ed && (document.activeElement === ed || _scriptDirty)){
      e.preventDefault();
      document.getElementById('script-save-btn').click();
    }
  }
});
// Inicializa lista e, se houver script atual, carrega no editor
(function initScripts(){
  const cur = currentScriptName();
  const scripts = loadScripts();
  if(cur && scripts[cur] != null){
    document.getElementById('code-editor').value = scripts[cur];
  }
  refreshScriptSelect();
})();


document.getElementById('preset-iso').addEventListener('click',()=>setCamPreset('iso'));
document.getElementById('preset-top').addEventListener('click',()=>setCamPreset('top'));
document.getElementById('btn-follow').addEventListener('click',()=>{
  followDrone=!followDrone;
  const btn=document.getElementById('btn-follow');
  btn.textContent=followDrone?'\u{1F4F9} Seguir: ON':'\u{1F4F9} Seguir: OFF';
  btn.classList.toggle('follow-on',followDrone);
});

document.getElementById('fab-help').addEventListener('click',()=>{ document.getElementById('help-panel').classList.toggle('hidden'); });
document.getElementById('buy-silo-btn')?.addEventListener('click', buySilo);
document.getElementById('buy-expand-btn')?.addEventListener('click', expandFarm);
document.getElementById('buy-speed-btn')?.addEventListener('click', upgradeSpeed);
document.getElementById('buy-battery-btn')?.addEventListener('click', upgradeBattery);
document.getElementById('buy-helper-btn')?.addEventListener('click', buyHelperDrone);
document.getElementById('buy-hive-btn')   ?.addEventListener('click', buyBeeHive);
document.getElementById('buy-droneb-btn')?.addEventListener('click', buyDroneB);
document.getElementById('buy-boost-speed')?.addEventListener('click', ()=>buyBoost('speed'));
document.getElementById('buy-boost-grow') ?.addEventListener('click', ()=>buyBoost('grow'));
document.getElementById('buy-boost-sell') ?.addEventListener('click', ()=>buyBoost('sell'));
document.getElementById('drone-bar')?.addEventListener('click', openSiloModal);
document.getElementById('silo-modal-close')?.addEventListener('click', closeSiloModal);
document.getElementById('silo-unload-btn')?.addEventListener('click', manualUnload);
document.getElementById('silo-sell-all-btn')?.addEventListener('click', sellAllCrops);
document.querySelectorAll('.silo-sell-btn').forEach(btn=>{
  btn.addEventListener('click', ()=> sellCrop(btn.dataset.crop));
});
document.getElementById('silo-modal')?.addEventListener('click', e=>{ if(e.target.id==='silo-modal') closeSiloModal(); });
document.getElementById('silo-move-btn')?.addEventListener('click', ()=>{ if(activeSiloMenu){ const s=activeSiloMenu; closeSiloMenu(); startMoveSilo(s); } });
document.getElementById('silo-sell-btn')?.addEventListener('click', ()=>{ if(activeSiloMenu) sellSilo(activeSiloMenu); });
window.addEventListener('mousedown', e=>{
  const menu=document.getElementById('silo-context-menu');
  if(menu && menu.style.display==='block' && !menu.contains(e.target) && e.target.tagName==='CANVAS'===false){
    closeSiloMenu();
  }
});

document.querySelectorAll('.pal').forEach(btn=>btn.addEventListener('click',()=>insertCmd(btn.dataset.code)));

document.getElementById('code-editor').addEventListener('keydown',e=>{
  const el = e.target;
  const s = el.selectionStart;
  
  if(e.key==='Tab'){
    e.preventDefault();
    el.value=el.value.substring(0,s)+'    '+el.value.substring(el.selectionEnd);
    el.selectionStart=el.selectionEnd=s+4;
  }
  
  if(e.key==='Enter'){
    e.preventDefault();
    // Detectar indentação da linha anterior
    const beforeCursor = el.value.substring(0, s);
    const lastNewline = beforeCursor.lastIndexOf('\n');
    const currentLine = beforeCursor.substring(lastNewline + 1);
    const indent = currentLine.match(/^\s*/)[0];
    
    // Se a linha termina com ":", adicionar indentação extra
    const trimmedLine = currentLine.trim();
    const extraIndent = (trimmedLine.endsWith(':') || trimmedLine.endsWith('{')) ? '    ' : '';
    
    el.value = el.value.substring(0,s) + '\n' + indent + extraIndent + el.value.substring(s);
    el.selectionStart = el.selectionEnd = s + 1 + indent.length + extraIndent.length;
  }
});

// Atalhos globais
window.addEventListener('keydown',e=>{
  if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();if(!running)document.getElementById('run-btn').click();}
  if(e.key==='Escape'){if(siloPlacementMode){cancelPlacement();return;} if(running)stopRequested=true;}
  if(e.key==='r'||e.key==='R'){if(!document.getElementById('code-editor').matches(':focus'))setCamPreset('iso');}
});

// Impede OrbitControls dentro dos painéis
['editor-panel','right-panel','help-panel','fab-help','silo-modal'].forEach(id=>{
  const el=document.getElementById(id); if(!el)return;
  el.addEventListener('mousedown',e=>e.stopPropagation());
  el.addEventListener('wheel',e=>e.stopPropagation());
});

window.addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });

// ─── Raycaster para posicionamento do Silo ────────────────────────────────────
const _placePlane=new THREE.Mesh(
  new THREE.PlaneGeometry(200,200),
  new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide}));
_placePlane.rotation.x=-Math.PI/2;
_placePlane.position.y=TILE_H;
scene.add(_placePlane);

const _raycaster=new THREE.Raycaster();
const _mouse2D=new THREE.Vector2();

canvas.addEventListener('mousemove',e=>{
  if(!siloPlacementMode||!siloGhost) return;
  _mouse2D.x= (e.clientX/innerWidth)*2-1;
  _mouse2D.y=-(e.clientY/innerHeight)*2+1;
  _raycaster.setFromCamera(_mouse2D,camera);
  const hits=_raycaster.intersectObject(_placePlane);
  if(!hits.length){ siloGhost.visible=false; return; }
  const p=hits[0].point;
  const gx=Math.round(p.x), gz=Math.round(p.z);
  const insideFarm = gx>=0&&gx<unlockedSize&&gz>=0&&gz<unlockedSize;
  const inPlaceZone = gx>=-SILO_PLACE_RANGE && gx<=unlockedSize-1+SILO_PLACE_RANGE &&
                      gz>=-SILO_PLACE_RANGE && gz<=unlockedSize-1+SILO_PLACE_RANGE;
  const onHelipad = (gx===-2 && gz===-2);
  const free=!placedSilos.some(s=>s.x===gx&&s.y===gz && s!==movingSilo);
  const valid=!insideFarm && inPlaceZone && free && !onHelipad;
  siloGhost.position.set(gx,0,gz);
  siloGhost.visible=true;
  siloGhost.traverse(c=>{ if(c.isMesh) c.material.color?.setHex(valid?0x88ccff:0xff6666); });
  canvas.style.cursor=valid?'crosshair':'not-allowed';
});

canvas.addEventListener('click',e=>{
  // Modo de posicionamento (compra OU mover): tenta colocar
  if(siloPlacementMode){
    _mouse2D.x= (e.clientX/innerWidth)*2-1;
    _mouse2D.y=-(e.clientY/innerHeight)*2+1;
    _raycaster.setFromCamera(_mouse2D,camera);
    const hits=_raycaster.intersectObject(_placePlane);
    if(!hits.length) return;
    const p=hits[0].point;
    const gx=Math.round(p.x), gz=Math.round(p.z);
    const insideFarm = gx>=0&&gx<unlockedSize&&gz>=0&&gz<unlockedSize;
    const inPlaceZone = gx>=-SILO_PLACE_RANGE && gx<=unlockedSize-1+SILO_PLACE_RANGE &&
                        gz>=-SILO_PLACE_RANGE && gz<=unlockedSize-1+SILO_PLACE_RANGE;
    const onHelipad = (gx===-2 && gz===-2);
    const free=!placedSilos.some(s=>s.x===gx&&s.y===gz && s!==movingSilo);
    if(!insideFarm && inPlaceZone && free && !onHelipad){
      placeSilo(gx,gz);
    } else if(insideFarm){
      log('❌ O silo deve ser colocado FORA da fazenda!','error');
    } else if(onHelipad){
      log('❌ Não pode colocar silo em cima do heliponto!','error');
    } else {
      log('❌ Posição inválida (muito longe da fazenda) ou ocupada!','error');
    }
    return;
  }
  // Clique normal: detectar silo para abrir menu
  _mouse2D.x= (e.clientX/innerWidth)*2-1;
  _mouse2D.y=-(e.clientY/innerHeight)*2+1;
  _raycaster.setFromCamera(_mouse2D,camera);

  // Detecta silo
  const siloMeshes = placedSilos.map(s=>s.mesh);
  const hits = _raycaster.intersectObjects(siloMeshes, true);
  if(hits.length){
    // Achar o silo cujo mesh contém o objeto atingido
    let hit = hits[0].object;
    while(hit && !placedSilos.find(s=>s.mesh===hit)) hit = hit.parent;
    const silo = placedSilos.find(s=>s.mesh===hit);
    if(silo) openSiloMenu(silo, e.clientX, e.clientY);
  } else {
    closeSiloMenu();
  }
});

// ─── Loop ─────────────────────────────────────────────────────────────────────
const DIR_ANGLE_3D = [-Math.PI/2, 0, Math.PI/2, Math.PI]; // E,S,O,N
let prevT = performance.now();

function animate(){
  requestAnimationFrame(animate);
  const now=performance.now(), dt=Math.min((now-prevT)/1000,.1); prevT=now;
  const t=now*.001;

  // Preset de câmera suave
  if(camAnim){ camera.position.lerp(camAnim.pos,.1); controls.target.lerp(camAnim.tgt,.1); if(camera.position.distanceTo(camAnim.pos)<.12)camAnim=null; }

  // Follow drone
  if(followDrone&&droneMesh){
    const droneFloor=new THREE.Vector3(droneMesh.position.x, TILE_H, droneMesh.position.z);
    const offset=camera.position.clone().sub(controls.target); // mantém ângulo e distância
    controls.target.lerp(droneFloor,.10);
    camera.position.copy(controls.target).add(offset);
  }

  // Drone animação
  if(droneMesh){
    // Barra de bateria sempre encarando a câmera (billboard)
    if(droneMesh.userData.batteryBar){
      const bar = droneMesh.userData.batteryBar.group;
      const camWorld = new THREE.Vector3();
      camera.getWorldPosition(camWorld);
      bar.lookAt(camWorld);
    }

    // ── Enxame de abelhas: vida própria, evitam o drone ──
    updateBees(dt, t);

    // ── Drone Auxiliar: segue o principal com offset ──
    if(helperDroneMesh){
      const offX = -1.2, offZ = -1.2, offY = 0.3;
      const tgtX = droneMesh.position.x + offX;
      const tgtY = droneMesh.position.y + offY + Math.sin(t*2.2)*0.10;
      const tgtZ = droneMesh.position.z + offZ;
      helperDroneMesh.position.x += (tgtX - helperDroneMesh.position.x) * 0.08;
      helperDroneMesh.position.y += (tgtY - helperDroneMesh.position.y) * 0.08;
      helperDroneMesh.position.z += (tgtZ - helperDroneMesh.position.z) * 0.08;
      const dx = droneMesh.position.x - helperDroneMesh.position.x;
      const dz = droneMesh.position.z - helperDroneMesh.position.z;
      helperDroneMesh.rotation.y += ((Math.atan2(dx,dz)) - helperDroneMesh.rotation.y) * 0.1;
      if(helperDroneMesh.userData.rotors){
        for(const r of helperDroneMesh.userData.rotors) r.rotation.y += dt * 30;
      }
    }

    // ── Drone Autônomo B: voa pela sua própria posição lógica (independente) ──
    if(droneBMesh){
      droneBMesh.visible = true;
      // Billboard da barra de bateria
      if(droneBMesh.userData.batteryBar){
        const bar = droneBMesh.userData.batteryBar.group;
        const camWorld = new THREE.Vector3();
        camera.getWorldPosition(camWorld);
        bar.lookAt(camWorld);
      }
      const usz = Math.max(1, unlockedSize|0);
      const cx = Math.max(0, Math.min(usz - 1, droneB.x|0));
      const cy = Math.max(0, Math.min(usz - 1, droneB.y|0));
      // Se está indo recarregar ou recarregando, alvo = heliponto
      let tgtX, tgtZ, tgtY;
      if(droneBGoingToCharge || droneBCharging){
        tgtX = HELIPAD_WX;
        tgtZ = HELIPAD_WZ;
        if(droneBCharging){
          tgtY = 0.25; // pousado no heliponto
        } else {
          // Descer ao chegar perto do heliponto
          const ddx = droneBMesh.position.x - HELIPAD_WX;
          const ddz = droneBMesh.position.z - HELIPAD_WZ;
          const horizDist = Math.hypot(ddx, ddz);
          tgtY = horizDist < 0.6 ? 0.25 : HELIPAD_HOVER_Y + Math.sin(t*2)*0.06;
        }
      } else {
        tgtX = cx;
        tgtZ = cy;
        tgtY = TILE_H + 1.0 + Math.sin(t*3)*0.06;
      }
      // Modo lenhador: vai até a árvore alvo (fora da grid)
      if(droneBWoodMode && droneBWoodTarget && !droneBGoingToCharge && !droneBCharging){
        tgtX = droneBWoodTarget.x;
        tgtZ = droneBWoodTarget.z;
        tgtY = TILE_H + 2.0 + Math.sin(t*3)*0.08;
      }
      if(!Number.isFinite(droneBMesh.position.x) || !Number.isFinite(droneBMesh.position.y) || !Number.isFinite(droneBMesh.position.z)){
        droneBMesh.position.set(tgtX, tgtY, tgtZ);
      } else {
        droneBMesh.position.x += (tgtX - droneBMesh.position.x) * 0.18;
        droneBMesh.position.y += (tgtY - droneBMesh.position.y) * 0.18;
        droneBMesh.position.z += (tgtZ - droneBMesh.position.z) * 0.18;
      }
      const tgtRot = -((droneB.dir|0)) * Math.PI / 2;
      let dRot = tgtRot - droneBMesh.rotation.y;
      while(dRot >  Math.PI) dRot -= Math.PI*2;
      while(dRot < -Math.PI) dRot += Math.PI*2;
      droneBMesh.rotation.y += dRot * 0.18;
      if(droneBMesh.userData.rotors){
        const spinning = !droneBCharging;
        if(spinning) for(const r of droneBMesh.userData.rotors) r.rotation.y += dt * 35;
      }
    }

    // Flip animation
    if(droneMesh.userData.flipAnim){
      const flip = droneMesh.userData.flipAnim;
      flip.t += dt;
      const progress = Math.min(flip.t / flip.duration, 1);
      const easeProgress = progress < 0.5 ? 2*progress*progress : -1 + (4-2*progress)*progress; // ease-in-out
      
      // Flip forward (pitch rotation) 360 degrees — smooth rotation only
      droneMesh.rotation.x = flip.startRotX + Math.PI * 2 * easeProgress;
      droneMesh.rotation.y = flip.startRotY;
      droneMesh.rotation.z = flip.startRotZ;
      
      // Smooth height with bobbing — NOT additive
      const bobbing = Math.sin(easeProgress * Math.PI) * 0.12;
      droneMesh.position.y = flip.startY + bobbing;
      
      if(progress >= 1) {
        droneMesh.userData.flipAnim = null;
        droneMesh.rotation.x = flip.startRotX;
        droneMesh.position.y = flip.startY;
      }
    }
    // Pouso/decolagem no heliponto — PRIORIDADE sobre floatAnim (3 fases: subir → viajar → descer)
    else if(droneMesh.userData.pousoAnim){
      const pa = droneMesh.userData.pousoAnim;
      pa.t += dt;
      const ease = p => p < 0.5 ? 2*p*p : -1+(4-2*p)*p;
      if(pa.phase === 'rise'){
        const dur = pa.rise.duration;
        const prog = Math.min(pa.t / dur, 1);
        droneMesh.position.y = pa.rise.startY + (pa.rise.endY - pa.rise.startY) * ease(prog);
        if(prog >= 1){ pa.phase = 'travel'; pa.t = 0; }
      } else if(pa.phase === 'travel'){
        const dur = pa.travel.duration;
        const prog = Math.min(pa.t / dur, 1);
        droneMesh.position.x = pa.rise.startX + (pa.travel.endX - pa.rise.startX) * ease(prog);
        droneMesh.position.z = pa.rise.startZ + (pa.travel.endZ - pa.rise.startZ) * ease(prog);
        droneMesh.position.y = pa.rise.endY;
        // banking suave na direção de voo
        const dx = pa.travel.endX - pa.rise.startX;
        const dz = pa.travel.endZ - pa.rise.startZ;
        if(Math.abs(dx)+Math.abs(dz) > 0.01){
          droneMesh.rotation.y = Math.atan2(dx, dz);
        }
        if(prog >= 1){ pa.phase = 'land'; pa.t = 0; log('🛬 Pousando!','ok'); }
      } else if(pa.phase === 'land'){
        const dur = pa.land.duration;
        const prog = Math.min(pa.t / dur, 1);
        droneMesh.position.y = pa.rise.endY + (pa.land.endY - pa.rise.endY) * ease(prog);
        droneMesh.rotation.z += (0 - droneMesh.rotation.z) * 0.1;
        droneMesh.rotation.x += (0 - droneMesh.rotation.x) * 0.1;
        if(prog >= 1){
          droneMesh.userData.pousoAnim = null;
          droneMesh.position.y = pa.land.endY;
          if(pa.isLanding){
            droneMesh.userData.landed = true;
            log('✅ Pousou no heliponto! Aguardando próximo comando...','ok');
          } else {
            log('✅ Chegou ao bloco inicial!','ok');
          }
        }
      }
    }
    // Spin animation
    else if(droneMesh.userData.spinAnim){
      const spin = droneMesh.userData.spinAnim;
      spin.t += dt;
      const progress = Math.min(spin.t / spin.duration, 1);
      const easeProgress = progress < 0.5 ? 2*progress*progress : -1 + (4-2*progress)*progress;
      
      droneMesh.rotation.y = spin.startRotY + Math.PI * 2 * easeProgress;
      
      if(progress >= 1) {
        droneMesh.userData.spinAnim = null;
        droneMesh.rotation.y = spin.startRotY;
      }
    }
    // Float animation simples (dive)
    else if(droneMesh.userData.floatAnim){
      const anim = droneMesh.userData.floatAnim;
      anim.t += dt;
      const progress = Math.min(anim.t / anim.duration, 1);
      const easeProgress = progress < 0.5 ? 2*progress*progress : -1 + (4-2*progress)*progress;
      droneMesh.position.y = anim.startY + (anim.endY - anim.startY) * easeProgress;
      if(progress >= 1) {
        droneMesh.userData.floatAnim = null;
        droneMesh.position.y = anim.endY;
      }
    } else if(droneMesh.userData.landed){
      // Pousado no heliponto — hélices paradas
    } else {
      // Smooth movement with physics
      const tx=droneMesh.userData.tx??0, tz=droneMesh.userData.tz??0, td=droneMesh.userData.tdir??0;
      const targetX = tx;
      const targetZ = tz;
      
      // Calculate desired velocity
      const desiredVelX = (targetX - droneMesh.position.x) * DRONE_ACCELERATION;
      const desiredVelZ = (targetZ - droneMesh.position.z) * DRONE_ACCELERATION;
      
      // Smooth velocity with exponential decay (friction)
      droneVelocity.x += (desiredVelX - droneVelocity.x) * DRONE_FRICTION;
      droneVelocity.z += (desiredVelZ - droneVelocity.z) * DRONE_FRICTION;
      
      // Apply velocity to position
      droneMesh.position.x += droneVelocity.x * dt * 10;
      droneMesh.position.z += droneVelocity.z * dt * 10;
      
      // Smooth height oscillation
      droneMesh.position.y = TILE_H + 0.6 + Math.sin(t * 2.7) * 0.04;
      
      // Smooth rotation towards target direction
      let targetRotY = DIR_ANGLE_3D[td];
      let da = targetRotY - droneMesh.rotation.y;
      while(da > Math.PI) da -= Math.PI * 2;
      while(da < -Math.PI) da += Math.PI * 2;
      droneMesh.rotation.y += da * 0.12; // smooth rotation lerp
      
      // Smooth tilt based on velocity (banking effect)
      const tiltStrength = 0.15;
      const targetTiltZ = -droneVelocity.x * tiltStrength;
      const targetTiltX = -droneVelocity.z * tiltStrength;
      
      droneMesh.rotation.z += (targetTiltZ - droneMesh.rotation.z) * 0.15;
      droneMesh.rotation.x += (targetTiltX - droneMesh.rotation.x) * 0.15;
    }
    
    if(!droneMesh.userData.landed){
      droneMesh.userData.rotors?.forEach(r=>{r.disc.rotation.y+=.30*r.dir;});
    }
    
    // Chapéu FBX fixo (sem rotação)
    
    // Star decoration rotates smoothly
    if(droneMesh.userData.hatMaterials?.starMesh) {
      droneMesh.userData.hatMaterials.starMesh.rotation.z += 0.02; // suave rotação
      droneMesh.userData.hatMaterials.starMesh.rotation.x += 0.015; // wobble 3D
    }
    
    if(droneMesh.userData.glow) droneMesh.userData.glow.intensity=.9+Math.sin(t*5)*.25;
    
    // Blinking red and blue lights — gentle blink
    if(droneMesh.userData.lights){
      const blinkSpeed = 1.5; // pisca mais lentamente
      const phase = (t * blinkSpeed) % 2;
      const redIntensity = phase < 1 ? 0.6 : 0.1;
      const blueIntensity = phase < 1 ? 0.1 : 0.6;
      droneMesh.userData.lights.red.intensity = redIntensity;
      droneMesh.userData.lights.blue.intensity = blueIntensity;
    }
  }

  // Pulso visual tiles READY — balança a planta
  for(let y=0;y<GRID;y++) for(let x=0;x<GRID;x++){
    if(grid[y]?.[x]?.type===T.READY&&x<unlockedSize&&y<unlockedSize){
      const cm=cropMeshes[y][x]; if(cm) cm.position.y=CB+Math.sin(t*2.5+x+y)*.018;
    }
  }

  tickUnlockAnim(dt);
  tickParticles(dt);
  tickTreeGrowth();
  renderMinimap();
  controls.update();
  renderer.render(scene,camera);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
buildTileGrid();
buildHelipad();

// Carregar o chapéu FBX antes de criar o drone
(async () => {
  try {
    await loadHatModel();
  } catch (err) {
    log('⚠ Usando chapéu geométrico (FBX não disponível)', 'warn');
  }

  // Carregar e espalhar árvores decorativas (não bloqueia se falhar)
  try {
    await loadTreeModel();
  } catch (err) {
    log('⚠ Árvores: usando fallback procedural', 'warn');
    treeModel3D = buildProceduralTree();
  }
    scatterTrees(120);

  droneMesh=buildDrone();
  droneMesh.position.set(0,TILE_H+.6,0);
  droneMesh.userData.tx=0; droneMesh.userData.tz=0; droneMesh.userData.tdir=0;
  droneMesh.castShadow=true;
  scene.add(droneMesh);

  // Mascote: enxame de abelhas com vida própria
  spawnBees();
  
  makeDraggable(document.getElementById('editor-panel'),  document.getElementById('editor-titlebar'));
  makeDraggable(document.getElementById('right-panel'),   document.getElementById('right-handle'));
  makeDraggable(document.getElementById('help-panel'),    document.getElementById('help-handle'));

  initGame();

  // Tentar restaurar do SQLite (sem bloquear)
  await initSQLite();

  log('Bem-vindo! 1 bloco de terra disponível.','info');
  log('Colha 3 vezes para desbloquear mais blocos!','info');

  animate();
})();
