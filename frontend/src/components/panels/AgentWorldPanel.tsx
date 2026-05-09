/**
 * AgentWorldPanel — Neural constellation visualization.
 *
 * Each agent is a living organism — a pulsing nucleus surrounded by orbiting
 * thought fragments. When idle, they drift slowly in a dark void. When active,
 * they ignite — tendrils of light reach outward, orbiting particles accelerate,
 * and energy arcs connect collaborating agents. The whole system breathes.
 *
 * Think: if you could see thought happening.
 */
import { useEffect, useRef, useCallback } from 'react';
import { useUIStore } from '@/stores';
import type { Agent } from '@/types';

// ─── Agent visual state ─────────────────────────────────────────────
interface Node {
  name: string;
  role: string;
  x: number; y: number;      // current position (normalized 0-1)
  homeX: number; homeY: number;
  vx: number; vy: number;    // drift velocity
  energy: number;             // 0 = dormant, 1 = fully active (smooth transition)
  phase: number;              // unique phase offset for animations
  hue: number;                // color identity (degrees)
  orbitals: Orbital[];        // thought fragments orbiting this node
  pulseTimer: number;         // ripple on status change
  prevStatus: string;
  radius: number;             // base radius
}

interface Orbital {
  angle: number;
  dist: number;
  speed: number;
  size: number;
  brightness: number;
}

interface Arc {
  from: number; to: number;
  life: number; max: number;
  width: number;
}

interface Ripple {
  x: number; y: number;
  radius: number;
  maxRadius: number;
  life: number;
  hue: number;
}

// ─── Color helpers ──────────────────────────────────────────────────
function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

function nameToHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  // Spread across pleasing range, avoiding muddy yellows
  const hues = [200, 280, 340, 160, 30, 310, 180, 50, 240, 120];
  return hues[Math.abs(h) % hues.length];
}

// ─── Layout: agents arranged in a loose constellation ───────────────
function arrangeNodes(count: number): { x: number; y: number }[] {
  if (count <= 1) return [{ x: 0.5, y: 0.5 }];
  const positions: { x: number; y: number }[] = [];
  // Central node (Prax) + ring around it
  positions.push({ x: 0.5, y: 0.48 });
  const ringCount = count - 1;
  for (let i = 0; i < ringCount; i++) {
    const angle = (i / ringCount) * Math.PI * 2 - Math.PI / 2;
    const rx = 0.22 + Math.sin(i * 2.7) * 0.06;
    const ry = 0.20 + Math.cos(i * 3.1) * 0.05;
    positions.push({
      x: 0.5 + Math.cos(angle) * rx,
      y: 0.48 + Math.sin(angle) * ry,
    });
  }
  return positions;
}

// ─── Main Component ─────────────────────────────────────────────────
interface Props {
  projectId: string;
  agents: Agent[];
  isVisible: boolean;
  onClose: () => void;
  onAgentClick?: (agent: Agent) => void;
}

export function AgentWorldPanel({ agents, isVisible, onAgentClick }: Props) {
  const darkMode = useUIStore((s) => s.darkMode);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    nodes: Node[];
    arcs: Arc[];
    ripples: Ripple[];
    tick: number;
    w: number; h: number;
    bgStars: { x: number; y: number; size: number; twinkleSpeed: number }[];
    mouseX: number; mouseY: number;
    hoverIdx: number;
  }>({
    nodes: [], arcs: [], ripples: [],
    tick: 0, w: 800, h: 600,
    bgStars: [],
    mouseX: -1, mouseY: -1,
    hoverIdx: -1,
  });

  // Init background particles
  useEffect(() => {
    const s = stateRef.current;
    if (!s.bgStars.length) {
      for (let i = 0; i < 150; i++) {
        s.bgStars.push({
          x: Math.random(), y: Math.random(),
          size: 0.3 + Math.random() * 1.2,
          twinkleSpeed: 0.01 + Math.random() * 0.03,
        });
      }
    }
  }, []);

  // Sync agent data → nodes
  useEffect(() => {
    const s = stateRef.current;
    const positions = arrangeNodes(agents.length);
    const existing = new Map(s.nodes.map(n => [n.name, n]));

    // Rebuild node list in agent order
    const newNodes: Node[] = [];
    agents.forEach((agent, i) => {
      let node = existing.get(agent.name);
      const pos = positions[i] || { x: 0.5, y: 0.5 };

      if (!node) {
        // Create orbitals
        const orbCount = 3 + Math.floor(Math.random() * 4);
        const orbitals: Orbital[] = [];
        for (let o = 0; o < orbCount; o++) {
          orbitals.push({
            angle: Math.random() * Math.PI * 2,
            dist: 0.4 + Math.random() * 0.6,
            speed: (0.01 + Math.random() * 0.02) * (Math.random() > 0.5 ? 1 : -1),
            size: 0.5 + Math.random() * 1.5,
            brightness: 0.3 + Math.random() * 0.7,
          });
        }

        node = {
          name: agent.name,
          role: agent.role || '',
          x: pos.x + (Math.random() - 0.5) * 0.02,
          y: pos.y + (Math.random() - 0.5) * 0.02,
          homeX: pos.x,
          homeY: pos.y,
          vx: 0, vy: 0,
          energy: 0,
          phase: Math.random() * Math.PI * 2,
          hue: nameToHue(agent.name),
          orbitals,
          pulseTimer: 0,
          prevStatus: agent.status,
          radius: agent.name === 'Prax' ? 1.3 : 1,
        };
      } else {
        // Update home position if arrangement changed
        node.homeX = pos.x;
        node.homeY = pos.y;
      }

      // Status transition
      const wasActive = node.prevStatus === 'working' || node.prevStatus === 'blocked';
      const isActive = agent.status === 'working' || agent.status === 'blocked';

      if (isActive && !wasActive) {
        node.pulseTimer = 40;
        // Create arcs to other active nodes
        for (const other of newNodes) {
          if (other.energy > 0.3) {
            s.arcs.push({
              from: newNodes.indexOf(other),
              to: newNodes.length,
              life: 60 + Math.random() * 40,
              max: 100,
              width: 1 + Math.random() * 2,
            });
          }
        }
        // Ripple
        s.ripples.push({
          x: node.x, y: node.y,
          radius: 0, maxRadius: 0.15,
          life: 40, hue: node.hue,
        });
      } else if (!isActive && wasActive) {
        s.ripples.push({
          x: node.x, y: node.y,
          radius: 0, maxRadius: 0.08,
          life: 25, hue: node.hue,
        });
      }

      node.prevStatus = agent.status;
      newNodes.push(node);
    });

    s.nodes = newNodes;
  }, [agents]);

  // Mouse tracking for hover glow
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const s = stateRef.current;
    s.mouseX = (e.clientX - rect.left) / rect.width;
    s.mouseY = (e.clientY - rect.top) / rect.height;

    // Find hover
    s.hoverIdx = -1;
    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i];
      const dx = s.mouseX - n.x;
      const dy = s.mouseY - n.y;
      if (dx * dx + dy * dy < 0.003) {
        s.hoverIdx = i;
        break;
      }
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    stateRef.current.mouseX = -1;
    stateRef.current.mouseY = -1;
    stateRef.current.hoverIdx = -1;
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    const s = stateRef.current;

    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i];
      const dx = mx - n.x;
      const dy = my - n.y;
      if (dx * dx + dy * dy < 0.003) {
        const real = agents.find(a => a.name === n.name);
        if (real && onAgentClick) onAgentClick(real);
        // Click ripple
        s.ripples.push({
          x: n.x, y: n.y,
          radius: 0, maxRadius: 0.1,
          life: 30, hue: n.hue,
        });
        return;
      }
    }
  }, [agents, onAgentClick]);

  // Resize
  useEffect(() => {
    if (!isVisible || !containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        stateRef.current.w = e.contentRect.width;
        stateRef.current.h = e.contentRect.height;
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [isVisible]);

  // Render loop
  useEffect(() => {
    if (!isVisible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let animId: number;

    const render = () => {
      const s = stateRef.current;
      s.tick++;
      const { w, h, tick } = s;
      canvas.width = w;
      canvas.height = h;

      const activeCount = s.nodes.filter(n => n.energy > 0.3).length;
      const dark = darkMode;

      // ── Background ──
      const bg = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.7);
      if (dark) {
        bg.addColorStop(0, activeCount > 0 ? '#08090f' : '#050608');
        bg.addColorStop(0.6, '#030406');
        bg.addColorStop(1, '#010102');
      } else {
        bg.addColorStop(0, '#f8f9fc');
        bg.addColorStop(0.6, '#f0f2f8');
        bg.addColorStop(1, '#e8eaf2');
      }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // ── Background stars / dots ──
      for (const star of s.bgStars) {
        const twinkle = Math.sin(tick * star.twinkleSpeed + star.x * 100) * 0.5 + 0.5;
        const alpha = twinkle * (dark ? 0.4 : 0.12) * star.size;
        ctx.fillStyle = dark
          ? `rgba(180, 200, 255, ${alpha})`
          : `rgba(100, 120, 180, ${alpha})`;
        ctx.fillRect(star.x * w, star.y * h, star.size, star.size);
      }

      // ── Subtle grid ──
      ctx.strokeStyle = dark ? 'rgba(40, 60, 100, 0.03)' : 'rgba(140, 160, 200, 0.06)';
      ctx.lineWidth = 0.5;
      const gridSize = 40;
      for (let gx = 0; gx < w; gx += gridSize) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
      }
      for (let gy = 0; gy < h; gy += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
      }

      // ── Update nodes ──
      for (const node of s.nodes) {
        const isActive = node.prevStatus === 'working' || node.prevStatus === 'blocked';
        const targetEnergy = isActive ? 1 : 0;
        node.energy += (targetEnergy - node.energy) * 0.03;

        // Gentle drift toward home + breathing motion
        const breathX = Math.sin(tick * 0.008 + node.phase) * 0.008;
        const breathY = Math.cos(tick * 0.006 + node.phase * 1.3) * 0.006;
        node.vx += (node.homeX + breathX - node.x) * 0.02;
        node.vy += (node.homeY + breathY - node.y) * 0.02;

        // Active nodes drift more
        if (node.energy > 0.5) {
          node.vx += Math.sin(tick * 0.02 + node.phase) * 0.0003;
          node.vy += Math.cos(tick * 0.015 + node.phase) * 0.0003;
        }

        node.vx *= 0.92;
        node.vy *= 0.92;
        node.x += node.vx;
        node.y += node.vy;

        if (node.pulseTimer > 0) node.pulseTimer--;

        // Update orbitals
        for (const orb of node.orbitals) {
          orb.angle += orb.speed * (1 + node.energy * 3);
        }
      }

      // ── Draw connection web (dormant) ──
      ctx.lineWidth = 0.5;
      for (let i = 0; i < s.nodes.length; i++) {
        for (let j = i + 1; j < s.nodes.length; j++) {
          const a = s.nodes[i], b = s.nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.35) {
            const alpha = (1 - dist / 0.35) * (dark ? 0.06 : 0.1) * (1 + (a.energy + b.energy) * 2);
            ctx.strokeStyle = dark
              ? `rgba(100, 140, 200, ${alpha})`
              : `rgba(80, 100, 180, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(a.x * w, a.y * h);
            ctx.lineTo(b.x * w, b.y * h);
            ctx.stroke();
          }
        }
      }

      // ── Energy arcs (active connections) ──
      s.arcs = s.arcs.filter(arc => {
        arc.life--;
        if (arc.life <= 0) return false;
        const a = s.nodes[arc.from], b = s.nodes[arc.to];
        if (!a || !b) return false;

        const progress = 1 - arc.life / arc.max;
        const alpha = Math.sin(progress * Math.PI) * 0.6;

        // Bezier arc with midpoint offset
        const mx = (a.x + b.x) / 2 + Math.sin(tick * 0.05 + arc.from) * 0.03;
        const my = (a.y + b.y) / 2 + Math.cos(tick * 0.04 + arc.to) * 0.03;

        ctx.strokeStyle = hsl((a.hue + b.hue) / 2, 70, 60, alpha);
        ctx.lineWidth = arc.width * alpha;
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.quadraticCurveTo(mx * w, my * h, b.x * w, b.y * h);
        ctx.stroke();

        // Traveling spark
        const t = (tick * 0.03 + arc.from * 0.5) % 1;
        const sx = a.x * (1 - t) * (1 - t) + mx * 2 * t * (1 - t) + b.x * t * t;
        const sy = a.y * (1 - t) * (1 - t) + my * 2 * t * (1 - t) + b.y * t * t;
        ctx.fillStyle = hsl((a.hue + b.hue) / 2, 80, 75, alpha);
        ctx.beginPath();
        ctx.arc(sx * w, sy * h, 2, 0, Math.PI * 2);
        ctx.fill();

        return true;
      });

      // ── Ripples ──
      s.ripples = s.ripples.filter(r => {
        r.radius += (r.maxRadius - r.radius) * 0.08;
        r.life--;
        if (r.life <= 0) return false;
        const alpha = (r.life / 40) * 0.4;
        ctx.strokeStyle = hsl(r.hue, 60, 60, alpha);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(r.x * w, r.y * h, r.radius * w, 0, Math.PI * 2);
        ctx.stroke();
        return true;
      });

      // ── Draw nodes ──
      for (let i = 0; i < s.nodes.length; i++) {
        const node = s.nodes[i];
        const nx = node.x * w;
        const ny = node.y * h;
        const baseR = (20 + node.energy * 12) * node.radius;
        const isHovered = i === s.hoverIdx;

        // Outer glow
        const glowR = baseR * (2 + node.energy * 2);
        const glow = ctx.createRadialGradient(nx, ny, 0, nx, ny, glowR);
        const glowAlpha = (dark ? 0.04 : 0.06) + node.energy * (dark ? 0.12 : 0.15) + (isHovered ? 0.06 : 0);
        glow.addColorStop(0, hsl(node.hue, dark ? 60 : 50, dark ? 50 : 55, glowAlpha));
        glow.addColorStop(0.5, hsl(node.hue, dark ? 50 : 40, dark ? 40 : 50, glowAlpha * 0.3));
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(nx - glowR, ny - glowR, glowR * 2, glowR * 2);

        // Orbitals (thought fragments)
        for (const orb of node.orbitals) {
          const orbR = baseR * orb.dist * (1 + node.energy * 0.5);
          const ox = nx + Math.cos(orb.angle) * orbR;
          const oy = ny + Math.sin(orb.angle) * orbR;
          const alpha = (0.2 + node.energy * 0.6) * orb.brightness;
          ctx.fillStyle = dark
            ? hsl(node.hue, 50, 65, alpha)
            : hsl(node.hue, 60, 50, alpha + 0.1);
          ctx.beginPath();
          ctx.arc(ox, oy, orb.size * (1.5 + node.energy * 0.8), 0, Math.PI * 2);
          ctx.fill();
        }

        // Tendrils (active only)
        if (node.energy > 0.2) {
          ctx.strokeStyle = hsl(node.hue, 50, 55, node.energy * 0.15);
          ctx.lineWidth = 0.8;
          for (let t = 0; t < 6; t++) {
            const tAngle = (t / 6) * Math.PI * 2 + tick * 0.005 + node.phase;
            const tLen = baseR * (1.5 + Math.sin(tick * 0.03 + t * 1.2) * 0.5) * node.energy;
            ctx.beginPath();
            ctx.moveTo(nx, ny);
            const cpx = nx + Math.cos(tAngle + 0.3) * tLen * 0.6;
            const cpy = ny + Math.sin(tAngle + 0.3) * tLen * 0.6;
            ctx.quadraticCurveTo(cpx, cpy,
              nx + Math.cos(tAngle) * tLen,
              ny + Math.sin(tAngle) * tLen);
            ctx.stroke();
          }
        }

        // Core
        const corePulse = 1 + Math.sin(tick * 0.06 + node.phase) * 0.1 * (1 + node.energy);
        const coreR = baseR * 0.45 * corePulse;
        const coreGrad = ctx.createRadialGradient(nx, ny, 0, nx, ny, coreR);
        const coreL = 40 + node.energy * 30;
        coreGrad.addColorStop(0, hsl(node.hue, 60, coreL + 20, 0.9));
        coreGrad.addColorStop(0.6, hsl(node.hue, 50, coreL, 0.6));
        coreGrad.addColorStop(1, hsl(node.hue, 40, coreL - 10, 0));
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(nx, ny, coreR, 0, Math.PI * 2);
        ctx.fill();

        // Inner bright point
        ctx.fillStyle = hsl(node.hue, 30, 85, 0.4 + node.energy * 0.4);
        ctx.beginPath();
        ctx.arc(nx, ny, coreR * 0.3, 0, Math.PI * 2);
        ctx.fill();

        // Pulse ring on status change
        if (node.pulseTimer > 0) {
          const pr = baseR * (1 + (40 - node.pulseTimer) / 40 * 2);
          ctx.strokeStyle = hsl(node.hue, 70, 60, node.pulseTimer / 40 * 0.5);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(nx, ny, pr, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Label
        const nameSize = Math.max(12, Math.min(16, w * 0.018));
        const labelAlpha = 0.4 + node.energy * 0.5 + (isHovered ? 0.2 : 0);
        ctx.fillStyle = dark
          ? hsl(node.hue, 30, 80, labelAlpha)
          : hsl(node.hue, 50, 30, labelAlpha + 0.2);
        ctx.font = `${isHovered ? 'bold ' : ''}${nameSize}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(node.name, nx, ny + baseR + nameSize + 4);

        // Status label on hover — positioned below name with clear gap
        if (isHovered) {
          const status = node.energy > 0.3 ? 'ACTIVE' : 'DORMANT';
          const statusSize = Math.max(10, nameSize - 3);
          const statusY = ny + baseR + nameSize + statusSize + 8;
          // Background pill for readability
          const statusW = ctx.measureText(status).width + 12;
          ctx.fillStyle = dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.8)';
          ctx.beginPath();
          ctx.roundRect(nx - statusW / 2, statusY - statusSize + 1, statusW, statusSize + 4, 4);
          ctx.fill();
          ctx.fillStyle = node.energy > 0.3
            ? (dark ? hsl(140, 60, 60, 0.9) : hsl(140, 60, 35, 0.9))
            : (dark ? hsl(node.hue, 20, 55, 0.7) : hsl(node.hue, 20, 45, 0.7));
          ctx.font = `bold ${statusSize}px monospace`;
          ctx.fillText(status, nx, statusY);
        }
      }

      // ── Status bar ──
      const barH = 28;
      const barFont = Math.max(11, w * 0.014);
      ctx.fillStyle = dark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.7)';
      ctx.fillRect(0, h - barH, w, barH);
      ctx.strokeStyle = dark ? 'rgba(60,80,120,0.2)' : 'rgba(140,160,200,0.3)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, h - barH); ctx.lineTo(w, h - barH); ctx.stroke();

      ctx.font = `${barFont}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillStyle = dark ? 'rgba(120, 160, 200, 0.6)' : 'rgba(80, 100, 150, 0.7)';
      ctx.fillText(`${s.nodes.length} agents`, 14, h - barH / 2 + 4);
      ctx.textAlign = 'center';
      ctx.fillStyle = activeCount > 0
        ? (dark ? 'rgba(100, 220, 160, 0.7)' : 'rgba(40, 160, 90, 0.8)')
        : (dark ? 'rgba(120, 160, 200, 0.35)' : 'rgba(100, 120, 160, 0.5)');
      ctx.fillText(
        activeCount > 0 ? `${activeCount} active` : 'all dormant',
        w / 2, h - barH / 2 + 4,
      );
      ctx.textAlign = 'right';
      ctx.fillStyle = dark ? 'rgba(120, 160, 200, 0.35)' : 'rgba(100, 120, 160, 0.5)';
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      ctx.fillText(time, w - 14, h - barH / 2 + 4);

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [isVisible, darkMode]);

  if (!isVisible) return null;

  return (
    <div className={`flex-1 flex flex-col min-w-0 ${darkMode ? 'bg-black' : 'bg-[#f0f2f8]'}`}>
      <div ref={containerRef} className="flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ cursor: 'pointer', width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}
