import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { GripHorizontal, Maximize2, Minimize2, Move, PanelTop } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type {
  GeoBounds,
  GridEdge,
  GridNode,
  GridTopology,
  NodeSizeMode,
  PathViewMode,
} from '../types/grid';
import { StatusIndicator } from './StatusIndicator';

interface ThreeGridVisualizerProps {
  topology: GridTopology;
  pathMode: PathViewMode;
  isPlaying: boolean;
  isDark?: boolean;
  nodeSizeMode?: NodeSizeMode;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  heightClass?: string;
}

type CameraPreset = 'iso' | 'top' | 'low';

// Pre-allocated math helpers outside animation loop (zero per-frame GC)
const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _vecMid = new THREE.Vector3();
const _vecDir = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _targetPos = new THREE.Vector3();
const _targetLook = new THREE.Vector3();
const _pointerNdc = new THREE.Vector2();

const STATUS_HEX_LIGHT = {
  healthy: 0x16a34a,
  warning: 0xd97706,
  alarming: 0xdc2626,
} as const;

const STATUS_HEX_DARK = {
  healthy: 0x42be65,
  warning: 0xf1c21b,
  alarming: 0xfa4d56,
} as const;

const ROLE_ABBR: Record<GridNode['role'], string> = {
  generator: 'GEN',
  substation: 'SUB',
  transformer: 'TRF',
  load: 'BUS',
  renewable: 'REN',
};

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createGridFloorTexture(isDark: boolean, maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = isDark ? '#141414' : '#EEF2F6';
  ctx.fillRect(0, 0, size, size);

  // Minor grid
  ctx.strokeStyle = isDark ? '#282828' : '#DCE3EC';
  ctx.lineWidth = 1;
  const minor = size / 8;
  for (let i = 0; i <= size; i += minor) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

  // Major substation bay grid
  ctx.strokeStyle = isDark ? '#3F3F3F' : '#C4D0DF';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 12);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
}

function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

function createGeoMapPadTexture(
  geoBounds: GeoBounds,
  isDark: boolean,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const w = 1024;
  const h = 640;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Base topographic map plate
  ctx.fillStyle = isDark ? '#1A1E24' : '#E7EEF6';
  ctx.fillRect(0, 0, w, h);

  // Subtle topographic terrain elevation contours
  ctx.strokeStyle = isDark ? 'rgba(120, 169, 255, 0.08)' : 'rgba(15, 98, 254, 0.09)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.ellipse(w * 0.28, h * 0.34, 110 + i * 58, 70 + i * 38, -0.22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(w * 0.76, h * 0.68, 90 + i * 52, 62 + i * 36, 0.18, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Lat/Lon coordinate graticule lines
  const cols = 5;
  const rows = 4;
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(15, 23, 42, 0.12)';
  ctx.lineWidth = 1;
  ctx.font = '500 16px "IBM Plex Mono", monospace';
  ctx.fillStyle = isDark ? '#8D99AE' : '#475569';

  for (let c = 0; c <= cols; c++) {
    const x = 60 + (c / cols) * (w - 120);
    ctx.beginPath();
    ctx.moveTo(x, 42);
    ctx.lineTo(x, h - 48);
    ctx.stroke();
    const lon = geoBounds.minLon + (c / cols) * (geoBounds.maxLon - geoBounds.minLon);
    ctx.textAlign = 'center';
    ctx.fillText(formatLon(lon), x, h - 20);
  }

  for (let r = 0; r <= rows; r++) {
    const y = 42 + (r / rows) * (h - 90);
    ctx.beginPath();
    ctx.moveTo(60, y);
    ctx.lineTo(w - 60, y);
    ctx.stroke();
    const lat = geoBounds.maxLat - (r / rows) * (geoBounds.maxLat - geoBounds.minLat);
    ctx.textAlign = 'left';
    ctx.fillText(formatLat(lat), 12, y + 5);
  }

  // Crisp map perimeter frame
  ctx.strokeStyle = isDark ? '#4589FF' : '#0F62FE';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(58, 40, w - 116, h - 86);

  // Top-left region watermark
  ctx.fillStyle = isDark ? 'rgba(244, 244, 244, 0.78)' : 'rgba(15, 23, 42, 0.78)';
  ctx.font = '600 18px "IBM Plex Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${geoBounds.regionLabel.toUpperCase()} · ${geoBounds.country.toUpperCase()}`, 72, 26);

  // Top-right North compass indicator
  ctx.fillStyle = isDark ? '#78A9FF' : '#0F62FE';
  ctx.textAlign = 'right';
  ctx.fillText('N ↑ · OPEN-METEO 3D GEO MAP', w - 64, 26);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createClusterBadgeTexture(
  clusterName: string,
  nodeCount: number,
  accentHex: string,
  isDark: boolean
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 68;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = isDark ? 'rgba(22, 22, 22, 0.92)' : 'rgba(255, 255, 255, 0.94)';
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(6, 6, canvas.width - 12, canvas.height - 12, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accentHex;
  ctx.fillRect(16, 18, 6, 32);

  ctx.fillStyle = isDark ? '#F4F4F4' : '#0F172A';
  ctx.font = '600 20px "IBM Plex Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(clusterName, 32, 28);

  ctx.fillStyle = isDark ? '#A8A8A8' : '#475569';
  ctx.font = '500 15px "IBM Plex Mono", monospace';
  ctx.fillText(`CLUSTER · ${nodeCount} NODES`, 32, 50);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBusLabelTexture(node: GridNode, isDark: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 88;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Carbon/Light crisp badge plate
  ctx.fillStyle = isDark ? 'rgba(22, 22, 22, 0.92)' : 'rgba(255, 255, 255, 0.94)';
  ctx.strokeStyle =
    node.status === 'alarming'
      ? isDark
        ? '#FA4D56'
        : '#DC2626'
      : node.status === 'warning'
      ? isDark
        ? '#F1C21B'
        : '#D97706'
      : isDark
      ? '#42BE65'
      : '#16A34A';
  ctx.lineWidth = 4;

  const r = 10;
  ctx.beginPath();
  ctx.moveTo(r + 4, 6);
  ctx.lineTo(canvas.width - r - 4, 6);
  ctx.quadraticCurveTo(canvas.width - 4, 6, canvas.width - 4, r + 6);
  ctx.lineTo(canvas.width - 4, canvas.height - r - 6);
  ctx.quadraticCurveTo(canvas.width - 4, canvas.height - 6, canvas.width - r - 4, canvas.height - 6);
  ctx.lineTo(r + 4, canvas.height - 6);
  ctx.quadraticCurveTo(4, canvas.height - 6, 4, canvas.height - r - 6);
  ctx.lineTo(4, r + 6);
  ctx.quadraticCurveTo(4, 6, r + 4, 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = isDark ? '#F4F4F4' : '#0F172A';
  ctx.font = '600 28px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${node.id} · ${ROLE_ABBR[node.role]}`, canvas.width / 2, 33);

  ctx.fillStyle = isDark ? '#A8A8A8' : '#475569';
  ctx.font = '500 20px "IBM Plex Mono", monospace';
  ctx.fillText(`${node.loadMW} MW`, canvas.width / 2, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function mapNodeToWorld(node: GridNode): { x: number; z: number } {
  // Normalize 0..1000 x 0..560 into centered 3D engineering platform coordinates
  const x = ((node.x - 500) / 1000) * 34;
  const z = ((node.y - 280) / 560) * 20;
  return { x, z };
}

/**
 * Builds a composite 4–6 part 3D architectural power-grid block seated flush at y = 0.
 * Distinct silhouettes per role (Generator, Substation, Transformer, Renewable, Load Bus).
 */
function buildPowerBlockGroup(
  node: GridNode,
  isDark: boolean,
  nodeSizeMode: NodeSizeMode,
  isSelected: boolean,
  denseGrid: boolean,
  disposables: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; textures: THREE.Texture[] }
): { group: THREE.Group; hitProxy: THREE.Mesh; topY: number } {
  const group = new THREE.Group();
  const { x, z } = mapNodeToWorld(node);
  group.position.set(x, 0, z);

  const statusHex = (isDark ? STATUS_HEX_DARK : STATUS_HEX_LIGHT)[node.status];
  const util = Math.max(0.25, Math.min(1.15, node.loadMW / Math.max(1, node.capacityMW)));

  const footprintScale =
    nodeSizeMode === 'compact' || denseGrid
      ? 0.78
      : nodeSizeMode === 'proportional'
      ? 0.8 + util * 0.45
      : 1.0;

  const baseW = (node.role === 'generator' || node.role === 'substation' ? 1.85 : 1.55) * footprintScale;
  const baseD = (node.role === 'generator' || node.role === 'substation' ? 1.65 : 1.45) * footprintScale;
  const towerH = (1.1 + util * 2.15) * (nodeSizeMode === 'compact' ? 0.82 : 1.0);

  // Materials with >= 0.25 roughness contrast between adjacent parts
  const plinthMat = new THREE.MeshStandardMaterial({
    color: isDark ? 0x2a2a2a : 0x334155,
    roughness: 0.78,
    metalness: 0.22,
  });
  const bodyMat = new THREE.MeshStandardMaterial({
    color: isDark ? 0x262626 : 0xffffff,
    roughness: 0.52,
    metalness: 0.16,
  });
  const metalAccentMat = new THREE.MeshStandardMaterial({
    color: isDark ? 0x8d8d8d : 0x64748b,
    roughness: 0.2,
    metalness: 0.86,
  });
  const statusMat = new THREE.MeshStandardMaterial({
    color: statusHex,
    emissive: statusHex,
    emissiveIntensity: isDark ? 0.48 : 0.24,
    roughness: 0.3,
    metalness: 0.35,
  });
  disposables.materials.push(plinthMat, bodyMat, metalAccentMat, statusMat);

  // Part 1: Concrete/Steel Foundation Plinth (flush on y = 0)
  const plinthH = 0.22;
  const plinthGeo = new THREE.BoxGeometry(baseW + 0.32, plinthH, baseD + 0.32);
  const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
  plinthMesh.position.y = plinthH / 2;
  plinthMesh.castShadow = true;
  plinthMesh.receiveShadow = true;
  group.add(plinthMesh);
  disposables.geometries.push(plinthGeo);

  // Part 2: Primary Architectural Power Block Tower
  const bodyGeo = new THREE.BoxGeometry(baseW, towerH, baseD);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.position.y = plinthH + towerH / 2;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);
  disposables.geometries.push(bodyGeo);

  // Part 3: Status Health Collar Band wrapping top of block (Green / Yellow / Red)
  const collarH = 0.22;
  const collarGeo = new THREE.BoxGeometry(baseW + 0.1, collarH, baseD + 0.1);
  const collarMesh = new THREE.Mesh(collarGeo, statusMat);
  collarMesh.position.y = plinthH + towerH - collarH * 0.55;
  collarMesh.castShadow = true;
  group.add(collarMesh);
  disposables.geometries.push(collarGeo);

  // Part 4: Vertical Architectural Load Indicator Rib on front face
  const ribH = Math.max(0.3, towerH * Math.min(1, util) * 0.72);
  const ribGeo = new THREE.BoxGeometry(baseW * 0.24, ribH, 0.08);
  const ribMesh = new THREE.Mesh(ribGeo, statusMat);
  ribMesh.position.set(0, plinthH + ribH / 2 + 0.08, baseD / 2 + 0.03);
  group.add(ribMesh);
  disposables.geometries.push(ribGeo);

  // Part 5: Role-specific rooftop equipment (secondary metallic silhouette)
  const roofY = plinthH + towerH;
  let crownHeight = 0.45;
  if (node.role === 'generator') {
    const stackGeo = new THREE.BoxGeometry(baseW * 0.28, 0.65, baseD * 0.28);
    const s1 = new THREE.Mesh(stackGeo, metalAccentMat);
    s1.position.set(-baseW * 0.22, roofY + 0.325, -baseD * 0.12);
    const s2 = new THREE.Mesh(stackGeo, metalAccentMat);
    s2.position.set(baseW * 0.22, roofY + 0.24, baseD * 0.12);
    s2.scale.y = 0.74;
    group.add(s1, s2);
    disposables.geometries.push(stackGeo);
    crownHeight = 0.72;
  } else if (node.role === 'substation') {
    const railGeo = new THREE.BoxGeometry(baseW * 0.88, 0.1, 0.1);
    const postGeo = new THREE.BoxGeometry(0.1, 0.42, 0.1);
    const rail = new THREE.Mesh(railGeo, metalAccentMat);
    rail.position.set(0, roofY + 0.42, 0);
    const p1 = new THREE.Mesh(postGeo, metalAccentMat);
    p1.position.set(-baseW * 0.34, roofY + 0.21, 0);
    const p2 = new THREE.Mesh(postGeo, metalAccentMat);
    p2.position.set(baseW * 0.34, roofY + 0.21, 0);
    group.add(rail, p1, p2);
    disposables.geometries.push(railGeo, postGeo);
    crownHeight = 0.56;
  } else if (node.role === 'transformer') {
    const finGeo = new THREE.BoxGeometry(baseW * 0.22, 0.42, baseD * 0.64);
    const f1 = new THREE.Mesh(finGeo, metalAccentMat);
    f1.position.set(-baseW * 0.24, roofY + 0.21, 0);
    const f2 = new THREE.Mesh(finGeo, metalAccentMat);
    f2.position.set(baseW * 0.24, roofY + 0.21, 0);
    group.add(f1, f2);
    disposables.geometries.push(finGeo);
    crownHeight = 0.5;
  } else if (node.role === 'renewable') {
    const panelGeo = new THREE.BoxGeometry(baseW * 0.86, 0.08, baseD * 0.72);
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x0f62fe,
      roughness: 0.18,
      metalness: 0.75,
    });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(0, roofY + 0.28, 0);
    panel.rotation.x = -0.34;
    group.add(panel);
    disposables.geometries.push(panelGeo);
    disposables.materials.push(panelMat);
    crownHeight = 0.54;
  } else {
    // Load bus stepped modular block deck
    const deckGeo = new THREE.BoxGeometry(baseW * 0.68, 0.28, baseD * 0.68);
    const deck = new THREE.Mesh(deckGeo, metalAccentMat);
    deck.position.set(0, roofY + 0.14, 0);
    group.add(deck);
    disposables.geometries.push(deckGeo);
    crownHeight = 0.36;
  }

  // Selection highlight frame around plinth
  if (isSelected) {
    const selGeo = new THREE.BoxGeometry(baseW + 0.62, 0.08, baseD + 0.62);
    const selMat = new THREE.MeshStandardMaterial({
      color: isDark ? 0x78a9ff : 0x0f62fe,
      emissive: 0x0f62fe,
      emissiveIntensity: 0.6,
      roughness: 0.25,
      metalness: 0.4,
    });
    const selMesh = new THREE.Mesh(selGeo, selMat);
    selMesh.position.y = 0.04;
    group.add(selMesh);
    disposables.geometries.push(selGeo);
    disposables.materials.push(selMat);
  }

  // Floating crisp Bus ID label sprite (hidden on very dense grids unless selected)
  const topY = roofY + crownHeight;
  if (!denseGrid || isSelected) {
    const labelTex = createBusLabelTexture(node, isDark);
    const spriteMat = new THREE.SpriteMaterial({
      map: labelTex,
      transparent: true,
      depthTest: true,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(0, topY + 0.62, 0);
    sprite.scale.set(2.35 * footprintScale, 0.82 * footprintScale, 1);
    group.add(sprite);
    disposables.textures.push(labelTex);
    disposables.materials.push(spriteMat);
  }

  // Simplified invisible collision proxy box on Layer 1 for high-performance raycasting
  const proxyGeo = new THREE.BoxGeometry(baseW + 0.55, topY + 0.6, baseD + 0.55);
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitProxy = new THREE.Mesh(proxyGeo, proxyMat);
  hitProxy.position.set(x, (topY + 0.6) / 2, z);
  hitProxy.layers.set(1);
  hitProxy.userData = { nodeId: node.id, node };
  disposables.geometries.push(proxyGeo);
  disposables.materials.push(proxyMat);

  return { group, hitProxy, topY };
}

export function ThreeGridVisualizer({
  topology,
  pathMode,
  isPlaying,
  isDark = false,
  nodeSizeMode = 'standard',
  selectedNodeId = null,
  onSelectNode,
  heightClass = 'h-[440px]',
}: ThreeGridVisualizerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  // One renderer/canvas for the component's lifetime so a theme change never produces a blank frame.
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const floatingPadRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const onSelectNodeRef = useRef(onSelectNode);
  onSelectNodeRef.current = onSelectNode;

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const cameraPresetRef = useRef<((preset: CameraPreset) => void) | null>(null);
  const savedCameraRef = useRef<{
    topologyId: string;
    pos: [number, number, number];
    target: [number, number, number];
  } | null>(null);

  const [hoveredNode, setHoveredNode] = useState<GridNode | null>(null);
  const [activePreset, setActivePreset] = useState<CameraPreset>('iso');
  const [padMode, setPadMode] = useState<'docked' | 'floating'>('docked');
  const [padMinimized, setPadMinimized] = useState(false);
  const [padPos, setPadPos] = useState<{ x: number; y: number }>({ x: 12, y: 12 });
  const [isDraggingPad, setIsDraggingPad] = useState(false);

  const activeNodeForCard =
    hoveredNode ?? topology.nodes.find((n) => n.id === selectedNodeId) ?? topology.nodes[0] ?? null;

  const handlePadDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: padPos.x,
      originY: padPos.y,
    };
    setIsDraggingPad(true);
  };

  const handlePadDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const vpRect = viewportRef.current?.getBoundingClientRect();
    const padRect = floatingPadRef.current?.getBoundingClientRect();
    const maxX = vpRect && padRect ? Math.max(8, vpRect.width - padRect.width - 8) : 400;
    const maxY = vpRect && padRect ? Math.max(8, vpRect.height - padRect.height - 8) : 260;
    const nextX = Math.max(8, Math.min(maxX, drag.originX + (e.clientX - drag.startClientX)));
    const nextY = Math.max(8, Math.min(maxY, drag.originY + (e.clientY - drag.startClientY)));
    setPadPos({ x: Math.round(nextX), y: Math.round(nextY) });
  };

  const handlePadDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current || dragStateRef.current.pointerId !== e.pointerId) return;
    e.stopPropagation();
    dragStateRef.current = null;
    setIsDraggingPad(false);
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = Math.max(320, container.clientWidth);
    const height = Math.max(280, container.clientHeight);

    const bgHex = isDark ? 0x121212 : 0xf1f5f9;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.Fog(bgHex, 42, 105);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.2, 200);
    if (savedCameraRef.current && savedCameraRef.current.topologyId === topology.id) {
      camera.position.set(...savedCameraRef.current.pos);
    } else {
      camera.position.set(0, 21.5, 25.5);
    }

    const renderer =
      rendererRef.current ??
      new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    rendererRef.current = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = isDark ? 1.12 : 1.05;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (renderer.domElement.parentElement !== container) {
      container.innerHTML = '';
      container.appendChild(renderer.domElement);
    }

    // Studio Environment Reflection (mandatory RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    // Balanced 3-point warm/cool studio rig (<= 3 lights)
    const hemiLight = new THREE.HemisphereLight(
      isDark ? 0xd0e2ff : 0xf0f7ff,
      isDark ? 0x262626 : 0x94a3b8,
      isDark ? 0.95 : 0.95
    );
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff5e6, isDark ? 1.65 : 1.5);
    keyLight.position.set(16, 28, 18);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.left = -24;
      keyLight.shadow.camera.right = 24;
      keyLight.shadow.camera.top = 18;
      keyLight.shadow.camera.bottom = -18;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x78a9ff, isDark ? 0.65 : 0.4);
    rimLight.position.set(-18, 12, -16);
    scene.add(rimLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI / 2 - 0.08;
    controls.minDistance = 10;
    controls.maxDistance = 58;
    if (savedCameraRef.current && savedCameraRef.current.topologyId === topology.id) {
      controls.target.set(...savedCameraRef.current.target);
    } else {
      controls.target.set(0, 0.8, 0);
    }
    controls.update();

    const disposables: {
      geometries: THREE.BufferGeometry[];
      materials: THREE.Material[];
      textures: THREE.Texture[];
    } = { geometries: [], materials: [], textures: [] };

    // Grounded architectural substation grid floor
    const floorTex = createGridFloorTexture(isDark, renderer.capabilities.getMaxAnisotropy());
    const floorGeo = new THREE.PlaneGeometry(140, 110);
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.88,
      metalness: 0.08,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);
    disposables.geometries.push(floorGeo);
    disposables.materials.push(floorMat);
    disposables.textures.push(floorTex);

    // Platform frame defining active grid bay (upgraded to 3D Geo Map Plate when geoBounds exist)
    const padGeo = new THREE.BoxGeometry(38, 0.06, 24);
    let padMat: THREE.MeshStandardMaterial;
    if (topology.geoBounds) {
      const geoTex = createGeoMapPadTexture(
        topology.geoBounds,
        isDark,
        renderer.capabilities.getMaxAnisotropy()
      );
      padMat = new THREE.MeshStandardMaterial({
        map: geoTex,
        roughness: 0.82,
        metalness: 0.08,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      disposables.textures.push(geoTex);
    } else {
      padMat = new THREE.MeshStandardMaterial({
        color: isDark ? 0x1e1e1e : 0xe2e8f0,
        roughness: 0.85,
        metalness: 0.1,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
    }
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.position.set(0, 0.03, 0);
    padMesh.receiveShadow = true;
    scene.add(padMesh);
    disposables.geometries.push(padGeo);
    disposables.materials.push(padMat);

    // Build 3D Power Blocks
    const denseGrid = topology.nodes.length >= 20;
    const hitProxies: THREE.Mesh[] = [];
    const nodePosMap = new Map<string, { x: number; z: number; topY: number }>();

    for (const node of topology.nodes) {
      const built = buildPowerBlockGroup(
        node,
        isDark,
        nodeSizeMode,
        node.id === selectedNodeId,
        denseGrid,
        disposables
      );
      scene.add(built.group);
      scene.add(built.hitProxy);
      hitProxies.push(built.hitProxy);
      nodePosMap.set(node.id, {
        x: built.group.position.x,
        z: built.group.position.z,
        topY: built.topY,
      });
    }

    // Build 3D Microgrid Cluster Zones (grounded translucent pad + perimeter ring + cluster badge)
    const clusterGroups = new Map<
      string,
      { name: string; color: string; points: { x: number; z: number }[] }
    >();
    for (const node of topology.nodes) {
      if (!node.clusterId || !node.clusterName) continue;
      const pos = nodePosMap.get(node.id);
      if (!pos) continue;
      const existing = clusterGroups.get(node.clusterId);
      if (existing) {
        existing.points.push({ x: pos.x, z: pos.z });
      } else {
        clusterGroups.set(node.clusterId, {
          name: node.clusterName,
          color: node.clusterColor ?? '#0F62FE',
          points: [{ x: pos.x, z: pos.z }],
        });
      }
    }

    clusterGroups.forEach((cluster) => {
      if (cluster.points.length === 0) return;
      const cx = cluster.points.reduce((s, p) => s + p.x, 0) / cluster.points.length;
      const cz = cluster.points.reduce((s, p) => s + p.z, 0) / cluster.points.length;
      const maxDist = cluster.points.reduce(
        (m, p) => Math.max(m, Math.hypot(p.x - cx, p.z - cz)),
        0
      );
      const radius = Math.max(3.2, Math.min(7.8, maxDist + 2.35));
      const colorNum = new THREE.Color(cluster.color);

      // Grounded translucent cluster zone disc
      const zoneGeo = new THREE.CylinderGeometry(radius, radius + 0.14, 0.04, 48);
      const zoneMat = new THREE.MeshStandardMaterial({
        color: colorNum,
        emissive: colorNum,
        emissiveIntensity: isDark ? 0.25 : 0.08,
        roughness: 0.75,
        metalness: 0.12,
        transparent: true,
        opacity: isDark ? 0.18 : 0.13,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const zoneMesh = new THREE.Mesh(zoneGeo, zoneMat);
      zoneMesh.position.set(cx, 0.08, cz);
      scene.add(zoneMesh);
      disposables.geometries.push(zoneGeo);
      disposables.materials.push(zoneMat);

      // Architectural perimeter ring
      const ringGeo = new THREE.RingGeometry(radius - 0.11, radius + 0.05, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: colorNum,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: isDark ? 0.85 : 0.72,
        depthWrite: false,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.set(cx, 0.11, cz);
      scene.add(ringMesh);
      disposables.geometries.push(ringGeo);
      disposables.materials.push(ringMat);

      // Cluster badge sprite anchored at south perimeter of cluster zone
      const badgeTex = createClusterBadgeTexture(
        cluster.name,
        cluster.points.length,
        cluster.color,
        isDark
      );
      const badgeMat = new THREE.SpriteMaterial({
        map: badgeTex,
        transparent: true,
        depthTest: true,
      });
      const badgeSprite = new THREE.Sprite(badgeMat);
      badgeSprite.position.set(cx, 0.55, cz + radius + 0.45);
      badgeSprite.scale.set(4.1, 0.78, 1);
      scene.add(badgeSprite);
      disposables.textures.push(badgeTex);
      disposables.materials.push(badgeMat);
    });

    // Build 3D Transmission Bus-Duct Corridors + Animated Energy Flow Packets
    interface FlowPacket {
      mesh: THREE.Mesh;
      startX: number;
      startZ: number;
      endX: number;
      endZ: number;
      y: number;
      phase: number;
      speed: number;
    }
    const flowPackets: FlowPacket[] = [];
    const packetGeo = new THREE.BoxGeometry(0.32, 0.18, 0.32);
    disposables.geometries.push(packetGeo);

    const statusHexMap = isDark ? STATUS_HEX_DARK : STATUS_HEX_LIGHT;
    const quantumHex = isDark ? 0x4589ff : 0x0f62fe;
    const classicalHex = isDark ? 0x6f6f6f : 0x64748b;

    topology.edges.forEach((edge: GridEdge, idx: number) => {
      const src = nodePosMap.get(edge.source);
      const tgt = nodePosMap.get(edge.target);
      if (!src || !tgt) return;

      const isHighlightedQuantum = pathMode === 'quantum' && edge.isQuantumPath;
      const isHighlightedClassical = pathMode === 'classical' && edge.isClassicalPath;
      const isDiffQuantumOnly = pathMode === 'diff' && edge.isQuantumPath && !edge.isClassicalPath;
      const isDiffClassicalOnly = pathMode === 'diff' && edge.isClassicalPath && !edge.isQuantumPath;

      let lineColor: number = statusHexMap[edge.status];
      let thickness = edge.status === 'alarming' ? 0.18 : 0.13;
      let opacity = 0.88;

      if (pathMode === 'quantum') {
        opacity = edge.isQuantumPath ? 0.96 : 0.22;
        if (edge.isQuantumPath && edge.status === 'healthy') {
          lineColor = quantumHex;
          thickness = 0.17;
        }
      } else if (pathMode === 'classical') {
        opacity = edge.isClassicalPath ? 0.95 : 0.22;
        if (edge.isClassicalPath && edge.status === 'healthy') {
          lineColor = classicalHex;
          thickness = 0.15;
        }
      } else {
        if (isDiffQuantumOnly) {
          lineColor = quantumHex;
          thickness = 0.19;
          opacity = 0.98;
        } else if (isDiffClassicalOnly) {
          lineColor = classicalHex;
          thickness = 0.13;
          opacity = 0.72;
        } else {
          opacity = 0.5;
        }
      }

      const conduitY = 0.34 + (idx % 3) * 0.05;
      _vecA.set(src.x, conduitY, src.z);
      _vecB.set(tgt.x, conduitY, tgt.z);
      const dist = _vecA.distanceTo(_vecB);
      if (dist < 0.05) return;

      _vecMid.copy(_vecA).add(_vecB).multiplyScalar(0.5);
      _vecDir.copy(_vecB).sub(_vecA).normalize();
      _quat.setFromUnitVectors(_upAxis, _vecDir);

      // Rectangular busbar duct geometry (architectural block aesthetic)
      const ductGeo = new THREE.BoxGeometry(thickness, dist, thickness * 0.75);
      const ductMat = new THREE.MeshStandardMaterial({
        color: lineColor,
        emissive: lineColor,
        emissiveIntensity: opacity > 0.8 ? (isDark ? 0.45 : 0.2) : 0.05,
        roughness: 0.32,
        metalness: 0.48,
        transparent: opacity < 0.95,
        opacity,
      });
      const ductMesh = new THREE.Mesh(ductGeo, ductMat);
      ductMesh.position.copy(_vecMid);
      ductMesh.quaternion.copy(_quat);
      scene.add(ductMesh);
      disposables.geometries.push(ductGeo);
      disposables.materials.push(ductMat);

      const shouldAnimate =
        isHighlightedQuantum || isHighlightedClassical || isDiffQuantumOnly || edge.status === 'alarming';
      if (shouldAnimate) {
        const pktMat = new THREE.MeshStandardMaterial({
          color: edge.status === 'alarming' ? 0xff8389 : 0xffffff,
          emissive: edge.status === 'alarming' ? 0xfa4d56 : quantumHex,
          emissiveIntensity: 0.9,
          roughness: 0.2,
          metalness: 0.2,
        });
        const pktMesh = new THREE.Mesh(packetGeo, pktMat);
        pktMesh.position.set(src.x, conduitY + 0.14, src.z);
        scene.add(pktMesh);
        disposables.materials.push(pktMat);
        flowPackets.push({
          mesh: pktMesh,
          startX: src.x,
          startZ: src.z,
          endX: tgt.x,
          endZ: tgt.z,
          y: conduitY + 0.14,
          phase: (idx * 0.27) % 1,
          speed: edge.status === 'alarming' ? 0.55 : 0.36,
        });
      }
    });

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Smooth camera preset transitions
    let transitioning = false;
    cameraPresetRef.current = (preset: CameraPreset) => {
      if (preset === 'iso') {
        _targetPos.set(0, 21.5, 25.5);
        _targetLook.set(0, 0.8, 0);
      } else if (preset === 'top') {
        _targetPos.set(0, 34, 4.5);
        _targetLook.set(0, 0, 0);
      } else {
        _targetPos.set(-14, 11.5, 23);
        _targetLook.set(0, 1.2, 0);
      }
      transitioning = true;
      setActivePreset(preset);
    };

    const handleControlStart = () => {
      transitioning = false;
    };
    controls.addEventListener('start', handleControlStart);

    // Throttled Raycasting on Layer 1 with smooth hover dwell + sticky leave hysteresis
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const HOVER_ENTER_DELAY_MS = 110;
    const HOVER_LEAVE_DELAY_MS = 480;
    let lastRaycastMs = 0;
    let activeHoverId: string | null = null;
    let pendingEnterId: string | null = null;
    let enterTimer: number | null = null;
    let leaveTimer: number | null = null;

    const clearHoverTimers = () => {
      if (enterTimer !== null) {
        window.clearTimeout(enterTimer);
        enterTimer = null;
      }
      if (leaveTimer !== null) {
        window.clearTimeout(leaveTimer);
        leaveTimer = null;
      }
      pendingEnterId = null;
    };

    const getHitNode = (ev: PointerEvent): GridNode | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      _pointerNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(_pointerNdc, camera);
      const hits = raycaster.intersectObjects(hitProxies, false);
      if (hits.length > 0) {
        return (hits[0].object.userData.node as GridNode) ?? null;
      }
      return null;
    };

    const handlePointerMove = (ev: PointerEvent) => {
      // Never flicker bus telemetry while user is actively dragging/orbiting the 3D camera
      if (ev.buttons !== 0) return;

      const now = performance.now();
      if (now - lastRaycastMs < 48) return;
      lastRaycastMs = now;

      const hit = getHitNode(ev);
      renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';

      if (hit) {
        // Cancel any pending reset to default node when hovering a valid block
        if (leaveTimer !== null) {
          window.clearTimeout(leaveTimer);
          leaveTimer = null;
        }
        // Already displaying this node — nothing to change
        if (activeHoverId === hit.id) {
          if (enterTimer !== null) {
            window.clearTimeout(enterTimer);
            enterTimer = null;
            pendingEnterId = null;
          }
          return;
        }
        // Already waiting to enter this exact node
        if (pendingEnterId === hit.id) return;

        if (enterTimer !== null) {
          window.clearTimeout(enterTimer);
        }
        pendingEnterId = hit.id;
        enterTimer = window.setTimeout(() => {
          enterTimer = null;
          pendingEnterId = null;
          activeHoverId = hit.id;
          setHoveredNode((prev) => (prev?.id === hit.id ? prev : hit));
        }, HOVER_ENTER_DELAY_MS);
      } else {
        // Cancel pending switch to a node we brushed past
        if (enterTimer !== null) {
          window.clearTimeout(enterTimer);
          enterTimer = null;
          pendingEnterId = null;
        }
        // Hold current node steady across the gap between blocks for smooth node-to-node travel
        if (activeHoverId !== null && leaveTimer === null) {
          leaveTimer = window.setTimeout(() => {
            leaveTimer = null;
            activeHoverId = null;
            setHoveredNode(null);
          }, HOVER_LEAVE_DELAY_MS);
        }
      }
    };

    const handlePointerLeave = () => {
      renderer.domElement.style.cursor = 'grab';
      if (enterTimer !== null) {
        window.clearTimeout(enterTimer);
        enterTimer = null;
        pendingEnterId = null;
      }
      if (activeHoverId !== null && leaveTimer === null) {
        leaveTimer = window.setTimeout(() => {
          leaveTimer = null;
          activeHoverId = null;
          setHoveredNode(null);
        }, HOVER_LEAVE_DELAY_MS);
      }
    };

    let downX = 0;
    let downY = 0;
    const handlePointerDown = (ev: PointerEvent) => {
      downX = ev.clientX;
      downY = ev.clientY;
    };
    const handlePointerUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 6) return;
      const hit = getHitNode(ev);
      if (hit) onSelectNodeRef.current?.(hit.id);
    };

    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave);
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    // ResizeObserver for responsive container
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextW = Math.max(320, Math.floor(entry.contentRect.width));
      const nextH = Math.max(260, Math.floor(entry.contentRect.height));
      camera.aspect = nextW / nextH;
      camera.updateProjectionMatrix();
      renderer.setSize(nextW, nextH);
    });
    resizeObserver.observe(container);

    // Frame-rate independent loop with software WebGL afterDraw pacing
    let disposed = false;
    let frameId = 0;
    let lastTimeMs = performance.now();

    function afterDraw(cb: () => void) {
      if (disposed) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const nowMs = performance.now();
      const delta = Math.min(0.08, Math.max(0.001, (nowMs - lastTimeMs) / 1000));
      lastTimeMs = nowMs;

      if (transitioning) {
        const alpha = 1 - Math.exp(-6 * delta);
        camera.position.lerp(_targetPos, alpha);
        controls.target.lerp(_targetLook, alpha);
        if (camera.position.distanceTo(_targetPos) < 0.08) {
          camera.position.copy(_targetPos);
          controls.target.copy(_targetLook);
          transitioning = false;
        }
      }

      if (isPlayingRef.current) {
        for (let i = 0; i < flowPackets.length; i++) {
          const pkt = flowPackets[i];
          pkt.phase = (pkt.phase + delta * pkt.speed) % 1;
          const x = pkt.startX + (pkt.endX - pkt.startX) * pkt.phase;
          const z = pkt.startZ + (pkt.endZ - pkt.startZ) * pkt.phase;
          pkt.mesh.position.set(x, pkt.y, z);
        }
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      savedCameraRef.current = {
        topologyId: topology.id,
        pos: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      };
      disposed = true;
      clearHoverTimers();
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', handleControlStart);
      controls.dispose();
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      envTarget.dispose();
      disposables.geometries.forEach((g) => g.dispose());
      disposables.materials.forEach((m) => m.dispose());
      disposables.textures.forEach((t) => t.dispose());
    };
  }, [topology, pathMode, isDark, nodeSizeMode, selectedNodeId]);

  // Dispose the shared renderer only when the component unmounts.
  useEffect(
    () => () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    },
    []
  );

  const utilPct = activeNodeForCard
    ? Math.round((activeNodeForCard.loadMW / Math.max(1, activeNodeForCard.capacityMW)) * 100)
    : 0;

  return (
    <div
      className="w-full overflow-hidden rounded-md border border-slate-200 dark:border-[#393939] bg-[#F1F5F9] dark:bg-[#121212]"
      data-testid="three-grid-canvas"
    >
      {/* Docked Bus Telemetry Strip (Fixed-Height 2-Row Layout — Zero Layout Shift & Zero Grid Obstruction) */}
      {padMode === 'docked' && activeNodeForCard && (
        <div
          data-testid="three-node-telemetry-card"
          className="border-b border-slate-200 dark:border-[#393939] bg-white dark:bg-[#1E1E1E] px-3.5 py-2"
        >
          {/* Row 1: Fixed-height header row (bus identity + status + pad controls) */}
          <div className="flex items-center justify-between gap-3 min-h-[26px]">
            <div className="flex items-center gap-2.5 min-w-0">
              <StatusIndicator status={activeNodeForCard.status} compact badgeStyle />
              <span className="text-xs font-semibold text-slate-900 dark:text-[#F4F4F4] truncate">
                {activeNodeForCard.name}
              </span>
              <span className="text-[11px] font-mono text-slate-500 dark:text-[#A8A8A8] whitespace-nowrap shrink-0">
                {activeNodeForCard.id} · q[{activeNodeForCard.qubitIndex}] · {hoveredNode ? 'Hover' : 'Active'}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setPadMode('floating');
                  setPadPos({ x: 12, y: 12 });
                }}
                aria-label="Float and drag metrics pad"
                title="Undock into draggable floating pad"
                className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#262626] px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:text-[#C6C6C6] hover:bg-slate-100 dark:hover:bg-[#353535] whitespace-nowrap"
              >
                <Move className="h-3 w-3" aria-hidden="true" />
                Float
              </button>
              <button
                type="button"
                onClick={() => setPadMinimized((v) => !v)}
                aria-label={padMinimized ? 'Expand metrics pad' : 'Minimize metrics pad'}
                title={padMinimized ? 'Expand metrics pad' : 'Minimize metrics pad'}
                className="inline-flex items-center justify-center rounded border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#262626] p-1 text-slate-700 dark:text-[#C6C6C6] hover:bg-slate-100 dark:hover:bg-[#353535]"
              >
                {padMinimized ? (
                  <Maximize2 className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <Minimize2 className="h-3 w-3" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {/* Row 2: Complete bus metrics strip with clean wrap so GPS & Solar/Wind never clip */}
          {!padMinimized && (
            <div className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-[#303030] flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-mono tabular-nums">
              <div className="shrink-0">
                <span className="font-sans text-[10px] text-slate-500 dark:text-[#A8A8A8] mr-1.5">Load/Cap</span>
                <span className="font-semibold text-slate-900 dark:text-[#F4F4F4]">
                  {activeNodeForCard.loadMW}/{activeNodeForCard.capacityMW} MW ({utilPct}%)
                </span>
              </div>
              <div className="shrink-0">
                <span className="font-sans text-[10px] text-slate-500 dark:text-[#A8A8A8] mr-1.5">Voltage</span>
                <span className="font-semibold text-slate-900 dark:text-[#F4F4F4]">
                  {activeNodeForCard.voltagePU} p.u. · {activeNodeForCard.phaseAngleDeg}°
                </span>
              </div>
              <div className="shrink-0">
                <span className="font-sans text-[10px] text-slate-500 dark:text-[#A8A8A8] mr-1.5">Thermal</span>
                <span className="font-semibold text-slate-900 dark:text-[#F4F4F4]">
                  {activeNodeForCard.temperatureC}°C
                </span>
              </div>
              <div className="shrink-0">
                <span className="font-sans text-[10px] text-slate-500 dark:text-[#A8A8A8] mr-1.5">QAOA / C</span>
                <span className="font-semibold text-[#0F62FE] dark:text-[#78A9FF]">
                  {activeNodeForCard.quantumDispatchMW}/{activeNodeForCard.classicalDispatchMW} MW
                </span>
              </div>
              {typeof activeNodeForCard.lat === 'number' && typeof activeNodeForCard.lon === 'number' && (
                <div className="shrink-0">
                  <span className="font-sans text-[10px] text-slate-500 dark:text-[#A8A8A8] mr-1.5">GPS</span>
                  <span className="font-semibold text-slate-800 dark:text-[#E0E0E0]">
                    {formatLat(activeNodeForCard.lat)}, {formatLon(activeNodeForCard.lon)}
                  </span>
                </div>
              )}
              {typeof activeNodeForCard.solarWm2 === 'number' && typeof activeNodeForCard.windSpeed80mMs === 'number' && (
                <div className="shrink-0">
                  <span className="font-sans text-[10px] text-slate-500 dark:text-[#A8A8A8] mr-1.5">Solar/Wind</span>
                  <span className="font-semibold text-[#15803D] dark:text-[#42BE65]">
                    {activeNodeForCard.solarWm2} W/m² · {activeNodeForCard.windSpeed80mMs} m/s
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 100% Unobstructed 3D WebGL Viewport */}
      <div ref={viewportRef} className={`relative w-full ${heightClass}`}>
        <div
          ref={mountRef}
          className="h-full w-full"
          role="img"
          aria-label={`Interactive 3D block power grid visualization for ${topology.name}`}
        />

        {/* Optional Freely Draggable & Minimizable Floating Metrics Pad */}
        {padMode === 'floating' && activeNodeForCard && (
          <div
            ref={floatingPadRef}
            data-testid="three-node-telemetry-card"
            style={{ transform: `translate3d(${padPos.x}px, ${padPos.y}px, 0)` }}
            className={`absolute top-0 left-0 z-10 rounded-md border border-slate-300 dark:border-[#525252] bg-white/96 dark:bg-[#262626]/96 shadow-lg select-none ${
              padMinimized ? 'w-auto max-w-[270px]' : 'w-64'
            }`}
          >
            {/* Drag Handle Header */}
            <div
              onPointerDown={handlePadDragStart}
              onPointerMove={handlePadDragMove}
              onPointerUp={handlePadDragEnd}
              onPointerCancel={handlePadDragEnd}
              className={`flex items-center justify-between gap-2 px-2.5 py-1.5 ${
                padMinimized ? '' : 'border-b border-slate-100 dark:border-[#393939]'
              } ${isDraggingPad ? 'cursor-grabbing' : 'cursor-grab'}`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <GripHorizontal
                  className="h-3.5 w-3.5 text-slate-400 dark:text-[#8D8D8D] shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-[#F4F4F4] truncate">
                    {activeNodeForCard.name}
                  </div>
                  {!padMinimized && (
                    <div className="text-[10px] font-mono text-slate-500 dark:text-[#A8A8A8]">
                      {activeNodeForCard.id} · q[{activeNodeForCard.qubitIndex}] · {hoveredNode ? 'Hover' : 'Active'}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setPadMode('docked')}
                  aria-label="Dock metrics pad above grid"
                  title="Dock above grid (zero obstruction)"
                  className="rounded p-1 text-slate-500 dark:text-[#A8A8A8] hover:bg-slate-100 dark:hover:bg-[#353535] hover:text-slate-900 dark:hover:text-[#F4F4F4]"
                >
                  <PanelTop className="h-3 w-3" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setPadMinimized((v) => !v)}
                  aria-label={padMinimized ? 'Expand floating metrics pad' : 'Minimize floating metrics pad'}
                  title={padMinimized ? 'Expand' : 'Minimize'}
                  className="rounded p-1 text-slate-500 dark:text-[#A8A8A8] hover:bg-slate-100 dark:hover:bg-[#353535] hover:text-slate-900 dark:hover:text-[#F4F4F4]"
                >
                  {padMinimized ? (
                    <Maximize2 className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <Minimize2 className="h-3 w-3" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {!padMinimized && (
              <div className="p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <StatusIndicator status={activeNodeForCard.status} compact badgeStyle />
                  <span className="text-[10px] font-mono text-slate-500 dark:text-[#A8A8A8]">
                    Drag header to move
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-2.5 gap-y-1.5 text-[11px] font-mono tabular-nums">
                  <div>
                    <span className="text-slate-500 dark:text-[#A8A8A8] block font-sans text-[10px]">Load / Cap</span>
                    <span className="font-semibold text-slate-900 dark:text-[#F4F4F4] whitespace-nowrap">
                      {activeNodeForCard.loadMW}/{activeNodeForCard.capacityMW} MW ({utilPct}%)
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-[#A8A8A8] block font-sans text-[10px]">Voltage / Angle</span>
                    <span className="font-semibold text-slate-900 dark:text-[#F4F4F4] whitespace-nowrap">
                      {activeNodeForCard.voltagePU} p.u. · {activeNodeForCard.phaseAngleDeg}°
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-[#A8A8A8] block font-sans text-[10px]">Thermal</span>
                    <span className="font-semibold text-slate-900 dark:text-[#F4F4F4] whitespace-nowrap">
                      {activeNodeForCard.temperatureC}°C
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-[#A8A8A8] block font-sans text-[10px]">QAOA / Classical</span>
                    <span className="font-semibold text-[#0F62FE] dark:text-[#78A9FF] whitespace-nowrap">
                      {activeNodeForCard.quantumDispatchMW}/{activeNodeForCard.classicalDispatchMW} MW
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dedicated Non-Overlapping Bottom Camera + Legend Strip */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-200 dark:border-[#393939] bg-white dark:bg-[#1E1E1E] px-3.5 py-2 text-[11px] text-slate-600 dark:text-[#A8A8A8]">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          <div className="inline-flex items-center gap-0.5 rounded border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] p-0.5">
            {(
              [
                { id: 'iso', label: 'Isometric' },
                { id: 'top', label: 'Top-Down' },
                { id: 'low', label: 'Low Angle' },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => cameraPresetRef.current?.(preset.id)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded whitespace-nowrap transition-colors ${
                  activePreset === preset.id
                    ? 'bg-[#0F62FE] text-white'
                    : 'text-slate-700 dark:text-[#C6C6C6] hover:bg-slate-200/70 dark:hover:bg-[#353535]'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <span className="inline-flex items-center gap-1 font-medium text-[#15803D] dark:text-[#42BE65]">
            <span aria-hidden="true">■</span> Healthy (&lt;75%)
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-[#B45309] dark:text-[#F1C21B]">
            <span aria-hidden="true">■</span> Warning (75–89%)
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-[#B91C1C] dark:text-[#FA4D56]">
            <span aria-hidden="true">■</span> Alarming (≥90%)
          </span>
        </div>
        <div className="flex items-center gap-x-3.5">
          <span className="inline-flex items-center gap-1.5 font-medium text-[#0F62FE] dark:text-[#78A9FF]">
            <span className="inline-block h-1.5 w-3.5 rounded-xs bg-[#0F62FE] dark:bg-[#4589FF]" aria-hidden="true" />
            Qiskit
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-600 dark:text-[#A8A8A8]">
            <span className="inline-block h-1.5 w-3.5 rounded-xs bg-slate-500 dark:bg-[#6F6F6F]" aria-hidden="true" />
            Classical
          </span>
          <span className="hidden xl:inline text-[10px] font-mono text-slate-500 dark:text-[#8D8D8D]">
            Drag orbit · Scroll zoom
          </span>
        </div>
      </div>
    </div>
  );
}
