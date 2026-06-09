import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { CSSProperties } from 'react';
import { Analytics } from "@vercel/analytics/react"
// ─── Types ────────────────────────────────────────────────────────────────────

interface BuySimulation {
  solAmount: number;
  tokensOut: string;
  priceBefore: number;
  priceAfter: number;
  priceImpact: number;
  newVirtualSol: string;
  newVirtualToken: string;
}

interface Holder {
  address: string;
  balance: string;
  percent: number;
}

interface LaunchAnalysis {
  isPumpToken: boolean;
  bondingCurve: {
    address: string;
    state: any;
    progressPercent: number;
    phase: 'EARLY' | 'MID' | 'LATE';
    currentPriceSol: number;
    mcapSol: number;
    liquidityDepthSol: number;
  };
  simulations: BuySimulation[];
  curveAnalytics: { explosionRatio: number; liquidityDepth: number };
  velocity: { recentTxCount: number; txPerHour: number };
  holders: {
    totalHolders: number;
    top10Percent: number;
    whaleDominance: number;
    concentrationScore: number;
    topHolders: Holder[];
  };
  congestion: { avgPriorityFee: number; congestionLevel: 'LOW' | 'MEDIUM' | 'HIGH' };
  alphaScore: number;
  timestamp: number;
}

// ─── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:       '#080808',
  surface:  '#101010',
  surface2: '#0c0c0c',
  surface3: '#141414',
  border:   '#1c1c1c',
  border2:  '#181818',
  green:    '#00FF94',
  greenDim: '#00C870',
  amber:    '#FFB800',
  red:      '#FF4444',
  blue:     '#4D9EFF',
  white:    '#ffffff',
  muted:    '#b4b4b4',
  dim:      '#8a8a8a',
  dimmer:   '#5a5a5a',
  dimmest:  '#1e1e1e',
};

const font = "'Courier New', Courier, monospace";

// ─── Safe number helpers ───────────────────────────────────────────────────────
const safeNum = (v: any, fallback = 0): number =>
  v === null || v === undefined || isNaN(Number(v)) ? fallback : Number(v);
const fx = (v: any, d = 2): string => safeNum(v).toFixed(d);
const loc = (v: any): string => safeNum(v).toLocaleString();

// ─── Graduated token detector ─────────────────────────────────────────────────
// A token is "graduated" when it moves from pump.fun bonding curve → Raydium.
// Signs: complete=true, OR realSolReserves=0 + progress=100%, OR mcapSol=0 + progress≥99%
const isGraduatedToken = (r: LaunchAnalysis): boolean => {
  if (!r.isPumpToken) return false;
  const state = r.bondingCurve?.state;
  if (state?.complete === true) return true;
  if (r.bondingCurve.progressPercent >= 99 && r.bondingCurve.liquidityDepthSol === 0) return true;
  return false;
};

// ─── Global styles ─────────────────────────────────────────────────────────────
const GlobalStyle = () => {
  useEffect(() => {
    const el = document.createElement('style');
    el.innerHTML = `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html, body, #root { height: 100%; }
      body { background: ${C.bg}; color: ${C.white}; font-family: ${font}; font-size: 15px; -webkit-font-smoothing: antialiased; }
      ::-webkit-scrollbar { width: 4px; height: 4px; }
      ::-webkit-scrollbar-track { background: ${C.surface}; }
      ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
      input::placeholder { color: #5a5a5a; }
      input:focus { outline: none; }
      button { cursor: pointer; font-family: ${font}; }
      a { text-decoration: none; }
      @keyframes spin    { to { transform: rotate(360deg); } }
      @keyframes pulse   { 0%,100% { opacity:0.35; } 50% { opacity:1; } }
      @keyframes shimmer { 0% { background-position:-600px 0; } 100% { background-position:600px 0; } }
      @keyframes fadeIn  { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      @keyframes gradPulse { 0%,100% { opacity:0.6; } 50% { opacity:1; } }
    `;
    document.head.appendChild(el);
    return () => { document.head.removeChild(el); };
  }, []);
  return null;
};

// ─── Animated counter ──────────────────────────────────────────────────────────
const AnimatedNumber = ({ value, duration = 1000, decimals = 0 }: { value: number; duration?: number; decimals?: number }) => {
  const [display, setDisplay] = useState(0);
  const start = useRef<number | null>(null);
  const raf   = useRef<number>(0);
  useEffect(() => {
    start.current = null;
    const tick = (ts: number) => {
      if (!start.current) start.current = ts;
      const p = Math.min((ts - start.current) / duration, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setDisplay(parseFloat((e * value).toFixed(decimals)));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration, decimals]);
  return <>{display.toFixed(decimals)}</>;
};

// ─── Tooltip ───────────────────────────────────────────────────────────────────
const Tip = ({ text, children }: { text: string; children: React.ReactNode }) => {
  const [v, setV] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setV(true)} onMouseLeave={() => setV(false)}>
      {children}
      <AnimatePresence>
        {v && (
          <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }} transition={{ duration: 0.1 }}
            style={{ position: 'absolute', bottom: '102%', left: '50%', transform: 'translateX(-50%)',
              marginBottom: 1, zIndex: 200, pointerEvents: 'none' }}>
            <div style={{ background: '#1c1c1c', border: '1px solid #2c2c2c', color: '#999', fontSize: 12,
              padding: '6px 12px', borderRadius: 8, whiteSpace: 'nowrap', boxShadow: '0 8px 24px rgba(0,0,0,0.7)' }}>
              {text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
};

// ─── Toast ─────────────────────────────────────────────────────────────────────
const Toast = ({ message, onClose }: { message: string; onClose: () => void }) => {
  useEffect(() => { const t = setTimeout(onClose, 2800); return () => clearTimeout(t); }, [onClose]);
  return (
    <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
      style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
        background: '#0a1f12', border: '1px solid rgba(0,255,148,0.25)', color: C.green,
        fontFamily: font, fontSize: 13, padding: '10px 20px', borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontSize: 11 }}>✓</span> {message}
    </motion.div>
  );
};

// ─── Skeleton ──────────────────────────────────────────────────────────────────
const Sk = ({ w = '100%', h = 14 }: { w?: string | number; h?: number }) => (
  <div style={{ width: w, height: h, borderRadius: 6,
    background: 'linear-gradient(90deg,#141414 25%,#1c1c1c 50%,#141414 75%)',
    backgroundSize: '600px 100%', animation: 'shimmer 1.5s infinite' }} />
);

// ─── Loading ───────────────────────────────────────────────────────────────────
const LoadingState = () => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '72px 0 48px', gap: 18 }}>
      <div style={{ width: 44, height: 44, borderRadius: '50%', border: '2px solid transparent',
        borderTopColor: C.green, borderRightColor: 'rgba(0,255,148,0.15)', animation: 'spin 1s linear infinite' }} />
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ color: C.green, fontSize: 13, letterSpacing: '0.3em', animation: 'pulse 1.8s infinite' }}>
          SCANNING ON-CHAIN
        </div>
        <div style={{ color: C.dim, fontSize: 12 }}>curve · holders · velocity · congestion</div>
      </div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))', gap: 16 }}>
      {[...Array(6)].map((_, i) => (
        <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 22,
          display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Sk w="30%" h={10} /><Sk w="60%" h={24} /><Sk h={10} /><Sk w="75%" h={10} />
        </div>
      ))}
    </div>
  </motion.div>
);

// ─── Graduated Banner ─────────────────────────────────────────────────────────
// Shown at the top when a token has graduated to Raydium.
// Explains why MCAP/Liquidity/Sims are 0 — the pump curve is empty.
const GraduatedBanner = ({ mint }: { mint: string }) => (
  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
    style={{ background: 'rgba(77,158,255,0.05)', border: '1px solid rgba(77,158,255,0.25)',
      borderRadius: 14, padding: '18px 22px', display: 'flex', flexWrap: 'wrap',
      alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 22, animation: 'gradPulse 2s infinite' }}>🎓</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, letterSpacing: '0.08em', marginBottom: 3 }}>
          TOKEN GRADUATED TO RAYDIUM
        </div>
        <div style={{ fontSize: 12, color: '#4a6a8a', lineHeight: 1.55 }}>
          This token completed its bonding curve and migrated to Raydium AMM.
          The pump.fun curve is empty — MCAP, liquidity, and buy simulations
          show <strong style={{ color: '#5a8aaa' }}>0</strong> because all SOL and tokens left this curve.
          Trade on Raydium instead.
        </div>
      </div>
    </div>
    <a
      href={`https://raydium.io/swap/?inputMint=sol&outputMint=${mint}`}
      target="_blank" rel="noopener noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
        letterSpacing: '0.1em', padding: '10px 16px', borderRadius: 9, color: C.blue,
        background: 'rgba(77,158,255,0.08)', border: '1px solid rgba(77,158,255,0.25)',
        whiteSpace: 'nowrap', transition: 'background 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(77,158,255,0.15)'}
      onMouseLeave={e => e.currentTarget.style.background = 'rgba(77,158,255,0.08)'}>
      Trade on Raydium →
    </a>
  </motion.div>
);

// ─── Score config ──────────────────────────────────────────────────────────────
const getScoreCfg = (s: number) => s >= 75
  ? { color: C.green,  glow: '0 0 40px rgba(0,255,148,0.5)',  border: 'rgba(0,255,148,0.18)', label: 'APE IT',  lBg: 'rgba(0,255,148,0.08)', lBorder: 'rgba(0,255,148,0.25)', ring: 'rgba(0,255,148,0.12)' }
  : s >= 50
  ? { color: C.amber,  glow: '0 0 40px rgba(255,184,0,0.5)',   border: 'rgba(255,184,0,0.18)',  label: 'DYOR',    lBg: 'rgba(255,184,0,0.08)',  lBorder: 'rgba(255,184,0,0.25)',  ring: 'rgba(255,184,0,0.12)'  }
  : { color: C.red,    glow: '0 0 40px rgba(255,68,68,0.5)',    border: 'rgba(255,68,68,0.18)',  label: 'ESCAPE',  lBg: 'rgba(255,68,68,0.08)',  lBorder: 'rgba(255,68,68,0.25)',  ring: 'rgba(255,68,68,0.12)'  };

const getPhaseCfg = (p: string) => p === 'EARLY'
  ? { color: C.green, bg: 'rgba(0,255,148,0.07)',  border: 'rgba(0,255,148,0.22)' }
  : p === 'MID'
  ? { color: C.amber, bg: 'rgba(255,184,0,0.07)',  border: 'rgba(255,184,0,0.22)' }
  : { color: C.red,   bg: 'rgba(255,68,68,0.07)',  border: 'rgba(255,68,68,0.22)'  };

const getCongCfg = (l: string) => l === 'LOW'
  ? { color: C.green, bg: 'rgba(0,255,148,0.07)',  border: 'rgba(0,255,148,0.22)' }
  : l === 'MEDIUM'
  ? { color: C.amber, bg: 'rgba(255,184,0,0.07)',  border: 'rgba(255,184,0,0.22)' }
  : { color: C.red,   bg: 'rgba(255,68,68,0.07)',  border: 'rgba(255,68,68,0.22)'  };

// ─── Shared card ───────────────────────────────────────────────────────────────
const Card = ({ children, s, idx = 0, glow }: {
  children: React.ReactNode; s?: CSSProperties; idx?: number; glow?: string;
}) => (
  <motion.div
    variants={{ hidden: { opacity: 0, y: 16 }, visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.35, ease: [0.22,1,0.36,1] } }) }}
    custom={idx} initial="hidden" animate="visible"
    style={{ background: C.surface, border: `1px solid ${glow || C.border}`, borderRadius: 14, ...s }}
  >{children}</motion.div>
);

// ─── Section label ─────────────────────────────────────────────────────────────
const SLabel = ({ icon, title, sub }: { icon: string; title: string; sub?: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.22em', color: C.muted }}>{title}</span>
    </div>
    {sub && <span style={{ fontSize: 11, color: C.dim, letterSpacing: '0.05em' }}>{sub}</span>}
  </div>
);

// ─── Stat cell ─────────────────────────────────────────────────────────────────
const Stat = ({ label, value, sub, color = C.white, tip, accent }: {
  label: string; value: React.ReactNode; sub?: string;
  color?: string; tip?: string; accent?: string;
}) => {
  const inner = (
    <div style={{ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 12, padding: '16px 18px',
      borderLeft: accent ? `3px solid ${accent}` : undefined, transition: 'border-color 0.15s' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', color: '#3a3a3a', marginBottom: 7, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>{sub}</div>}
    </div>
  );
  return tip ? <Tip text={tip}>{inner}</Tip> : inner;
};

// ─── Badge ─────────────────────────────────────────────────────────────────────
const Badge = ({ text, color, bg, border }: { text: string; color: string; bg: string; border: string }) => (
  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', padding: '5px 12px',
    borderRadius: 999, background: bg, border: `1px solid ${border}`, color }}>
    {text}
  </span>
);

// ─── Button ────────────────────────────────────────────────────────────────────
const Btn = ({ onClick, children, primary, disabled, s }: {
  onClick: () => void; children: React.ReactNode; primary?: boolean; disabled?: boolean; s?: CSSProperties;
}) => (
  <motion.button whileHover={{ scale: disabled ? 1 : 1.02 }} whileTap={{ scale: disabled ? 1 : 0.96 }}
    onClick={onClick} disabled={disabled}
    style={{ fontFamily: font, fontSize: 13, fontWeight: 700, padding: '12px 22px', borderRadius: 11,
      border: primary ? 'none' : `1px solid #252525`,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      background: primary ? C.green : '#131313',
      color: primary ? '#000' : C.muted,
      lineHeight: 1.2,
      transition: 'opacity 0.15s', ...s }}>
    {children}
  </motion.button>
);

// ─── Divider ───────────────────────────────────────────────────────────────────
const Divider = () => <div style={{ height: 1, background: C.border2, margin: '0' }} />;

// ─── Graduated sim placeholder ────────────────────────────────────────────────
// Replaces the buy simulation cards when token is graduated.
// Simulations are meaningless on an empty curve.
const GraduatedSimPlaceholder = ({ mint }: { mint: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '42px 24px', gap: 12, textAlign: 'center' }}>
    <div style={{ fontSize: 28 }}>🎓</div>
    <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, letterSpacing: '0.08em' }}>CURVE IS EMPTY</div>
    <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.6, maxWidth: 320 }}>
      Token graduated to Raydium. Buy simulations are unavailable — there are no tokens left in the pump.fun curve to purchase.
    </div>
    <a href={`https://raydium.io/swap/?inputMint=sol&outputMint=${mint}`}
      target="_blank" rel="noopener noreferrer"
      style={{ marginTop: 6, fontSize: 12, color: C.blue, display: 'flex', alignItems: 'center', gap: 5,
        padding: '8px 16px', borderRadius: 9, background: 'rgba(77,158,255,0.07)',
        border: '1px solid rgba(77,158,255,0.2)', transition: 'background 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(77,158,255,0.14)'}
      onMouseLeave={e => e.currentTarget.style.background = 'rgba(77,158,255,0.07)'}>
      Open on Raydium →
    </a>
  </div>
);

// ─── Main app ──────────────────────────────────────────────────────────────────
const MAX_RECENT = 5;
const SHELL_MAX_WIDTH = 1320;
const wrap: CSSProperties = { maxWidth: SHELL_MAX_WIDTH, margin: '0 auto', padding: '0 clamp(18px,3vw,32px)' };

const App: React.FC = () => {
  const [mint, setMint]               = useState('HuizJtx758s4Lf9ZPEE49o6kdD8nZYeBoSVogVwupump');
  const [result, setResult]           = useState<LaunchAnalysis | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [showRaw, setShowRaw]         = useState(false);
  const [toast, setToast]             = useState('');
  const [now, setNow]                 = useState(Date.now());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [recent, setRecent]           = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('pump_recent') || '[]'); } catch { return []; }
  });
  const timer = useRef<any>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const analyze = useCallback(async (override?: string) => {
    const target = (override || mint).trim();
    if (!target) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? 'https://api.pumpterms.fun'}/api/launch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenMint: target }),
      });
      if (!res.ok) throw new Error(`Backend error (${res.status})`);
      const data: LaunchAnalysis = await res.json();
      setResult(data);
      setRecent(prev => {
        const u = [target, ...prev.filter(s => s !== target)].slice(0, MAX_RECENT);
        localStorage.setItem('pump_recent', JSON.stringify(u));
        return u;
      });
    } catch (e: any) {
      setError(e.message || 'Cannot reach backend at api.pumpterms.fun');
    } finally { setLoading(false); }
  }, [mint]);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (autoRefresh) timer.current = setInterval(() => analyze(), 15000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [autoRefresh, analyze]);

  const copy     = (text: string, msg = 'Copied!') => { navigator.clipboard.writeText(text); setToast(msg); };
  const download = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    a.download = `pump_${Date.now()}.json`; a.click();
    setToast('Downloaded');
  };
  const ago = (ts: number) => {
    const s = Math.floor((now - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  };

  // ── Derived state ─────────────────────────────────────────────────────────
  const graduated = result ? isGraduatedToken(result) : false;
  const sc        = result ? getScoreCfg(result.alphaScore) : getScoreCfg(0);
  const clk       = new Date(now).toLocaleTimeString('en-US', { hour12: false });
  // The mint being displayed (from result or current input)
  const displayMint = mint.trim();

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.white, fontFamily: font }}>
      <GlobalStyle />
      <Analytics />

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header style={{ background: C.surface2, borderBottom: `1px solid ${C.border2}`, position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ ...wrap, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 900, fontSize: 17, letterSpacing: '-0.01em' }}>
              pump<span style={{ color: C.green }}>terminal</span>
            </span>
            <span style={{ fontSize: 11, padding: '4px 9px', borderRadius: 6,
              background: C.surface3, border: `1px solid ${C.border}`, color: C.dim, letterSpacing: '0.05em' }}>
              BUY AT UR OWN RISK
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: C.dim }}>
            {autoRefresh && (
              <span style={{ color: C.green, display: 'flex', alignItems: 'center', gap: 6, animation: 'pulse 2s infinite' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, display: 'inline-block' }} />
                AUTO
              </span>
            )}
            <span style={{ fontVariantNumeric: 'tabular-nums', color: C.dim }}>{clk}</span>
          </div>
        </div>
      </header>

      <main style={{ ...wrap, paddingTop: 40, paddingBottom: 72 }}>

        {/* ── HERO ───────────────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
          style={{ paddingBottom: 6, marginBottom: 22 }}>
          <h1 style={{ fontSize: 'clamp(28px,4.4vw,44px)', fontWeight: 900, letterSpacing: '-0.025em',
            lineHeight: 1.12, marginBottom: 14 }}>
            On-chain intel for <span style={{ color: C.green }}>Pump.fun</span> launches.
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: '#5a5a5a', maxWidth: 760 }}>
            Paste any mint → get bonding curve phase, real buy simulations (with 1% fee),
            holder distribution, tx velocity, and an{' '}
            <span style={{ color: C.green }}>Alpha Score (0–100)</span>{' '}
            to decide <span style={{ color: C.green }}>ape or escape</span>.
            Pure on-chain via QuickNode. No paid APIs.
          </p>
        </motion.div>

        {/* Feature row */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
          {[['📈','Bonding Curve'],['💰','Buy Sims (1% fee)'],['👥','Holder Dist.'],['⚡','Velocity'],['🌐','Congestion'],['🎯','Alpha Score']].map(([icon,label],i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
              padding: '7px 12px', borderRadius: 999, background: C.surface, border: `1px solid ${C.border}`, color: C.muted }}>
              {icon} {label}
            </span>
          ))}
        </motion.div>

        {/* ── SEARCH ─────────────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
          style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 22, marginBottom: 18 }}>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input type="text" value={mint} onChange={e => setMint(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && analyze()}
              placeholder="Paste token mint address..."
              style={{ flex: 1, minWidth: 280, background: C.surface2, border: `1px solid ${C.border}`,
                borderRadius: 11, padding: '14px 16px', fontSize: 15, fontFamily: font, color: C.white }}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(0,255,148,0.4)'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(0,255,148,0.06)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = 'none'; }}
            />
            <div style={{ display: 'flex', gap: 9 }}>
              <Btn primary onClick={() => analyze()} disabled={loading || !mint} s={{ minWidth: 132 }}>
                {loading ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 14, height: 14, borderRadius: '50%', border: '1.5px solid transparent',
                      borderTopColor: '#000', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                    SCANNING
                  </span>
                ) : '⚡ SCAN'}
              </Btn>
              {result && <Btn onClick={() => analyze()} disabled={loading} s={{ padding: '12px 14px', fontSize: 17 }}>↺</Btn>}
              <Tip text={autoRefresh ? 'Auto-refresh ON every 15s — click to stop' : 'Enable 15s auto-refresh'}>
                <Btn onClick={() => setAutoRefresh(v => !v)} s={{
                  padding: '12px 14px', fontSize: 12, letterSpacing: '0.1em',
                  background: autoRefresh ? 'rgba(0,255,148,0.07)' : '#131313',
                  border: `1px solid ${autoRefresh ? 'rgba(0,255,148,0.28)' : '#252525'}`,
                  color: autoRefresh ? C.green : C.dim,
                }}>AUTO</Btn>
              </Tip>
            </div>
          </div>

          {recent.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
              marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border2}` }}>
              <span style={{ fontSize: 11, letterSpacing: '0.18em', color: C.dim }}>RECENT</span>
              {recent.map((s, i) => (
                <motion.button key={i} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                  onClick={() => { setMint(s); analyze(s); }}
                  style={{ fontFamily: font, fontSize: 11, padding: '6px 12px', borderRadius: 8,
                    background: C.surface2, border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer' }}>
                  {s.slice(0, 8)}…{s.slice(-6)}
                </motion.button>
              ))}
            </div>
          )}
        </motion.div>

        {/* ── ERROR ──────────────────────────────────────────────────────────── */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ background: 'rgba(255,68,68,0.05)', border: '1px solid rgba(255,68,68,0.18)',
                color: C.red, borderRadius: 12, padding: '14px 18px', fontSize: 13 }}>
                ⚠ {error}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── LOADING ────────────────────────────────────────────────────────── */}
        <AnimatePresence>{loading && <LoadingState />}</AnimatePresence>

        {/* ── EMPTY ──────────────────────────────────────────────────────────── */}
        {!result && !loading && !error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }}
            style={{ border: `1px dashed ${C.border}`, borderRadius: 16, padding: '72px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 34, marginBottom: 12 }}>🔎</div>
            <div style={{ fontWeight: 700, fontSize: 17, color: C.white, marginBottom: 8 }}>Ready to scan</div>
            <p style={{ fontSize: 14, color: C.muted }}>
              Paste a Pump.fun mint above and hit{' '}
              <span style={{ color: C.green }}>⚡ SCAN</span>.
            </p>
          </motion.div>
        )}

        {/* ── RESULTS ────────────────────────────────────────────────────────── */}
        <AnimatePresence>
          {result && !loading && (
            <motion.div key={result.timestamp} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* ── GRADUATED BANNER — shown above everything when token graduated ── */}
              {graduated && <GraduatedBanner mint={displayMint} />}

              {/* ── SCORE + META HERO ────────────────────────────────────────── */}
              <Card idx={0} glow={graduated ? 'rgba(77,158,255,0.18)' : sc.border} s={{ padding: 0, overflow: 'hidden' }}>
                {/* Top strip */}
                <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.border2}`,
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                    {result.isPumpToken && <Badge text="PUMP.FUN ✓" color={C.green} bg="rgba(0,255,148,0.07)" border="rgba(0,255,148,0.2)" />}
                    <Badge text={`${result.bondingCurve.phase} PHASE`}
                      color={getPhaseCfg(result.bondingCurve.phase).color}
                      bg={getPhaseCfg(result.bondingCurve.phase).bg}
                      border={getPhaseCfg(result.bondingCurve.phase).border} />
                    {graduated && (
                      <Badge text="GRADUATED 🎓" color={C.blue} bg="rgba(77,158,255,0.07)" border="rgba(77,158,255,0.2)" />
                    )}
                    <span style={{ fontSize: 11, color: C.dim }}>scanned {ago(result.timestamp)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn onClick={download} s={{ fontSize: 12, padding: '8px 14px' }}>↓ JSON</Btn>
                    <Btn onClick={() => copy(JSON.stringify(result, null, 2), 'Copied!')} s={{ fontSize: 12, padding: '8px 14px' }}>⧉ Copy</Btn>
                  </div>
                </div>

                {/* Main content */}
                <div style={{ padding: '28px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: -70, right: -44, width: 340, height: 340,
                    borderRadius: '50%', background: graduated ? C.blue : sc.color,
                    filter: 'blur(90px)', opacity: 0.05, pointerEvents: 'none' }} />

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 40, alignItems: 'center', position: 'relative' }}>

                    {/* ALPHA SCORE */}
                    <Tip text="Composite: velocity (25pts) + distribution (30pts) + whale risk (20pts) + liquidity (15pts) + congestion (10pts)">
                      <div style={{ textAlign: 'center', minWidth: 168 }}>
                        <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                          transition={{ delay: 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                          style={{ fontSize: 'clamp(82px,10vw,112px)', fontWeight: 900, lineHeight: 1,
                            letterSpacing: '-0.05em', fontVariantNumeric: 'tabular-nums',
                            color: graduated ? C.blue : sc.color,
                            textShadow: graduated ? '0 0 40px rgba(77,158,255,0.5)' : sc.glow }}>
                          <AnimatedNumber value={result.alphaScore} duration={1200} />
                        </motion.div>
                        <div style={{ fontSize: 11, letterSpacing: '0.22em', color: C.dim, margin: '7px 0 10px' }}>ALPHA SCORE / 100</div>
                        <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.16em',
                          padding: '6px 16px', borderRadius: 999,
                          background: graduated ? 'rgba(77,158,255,0.08)' : sc.lBg,
                          border: `1px solid ${graduated ? 'rgba(77,158,255,0.25)' : sc.lBorder}`,
                          color: graduated ? C.blue : sc.color }}>
                          {graduated ? 'GRADUATED' : sc.label}
                        </span>
                      </div>
                    </Tip>

                    {/* CENTER: address + progress */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
                      <div>
                        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: C.dim, marginBottom: 6 }}>BONDING CURVE ADDRESS</div>
                        <button onClick={() => copy(result.bondingCurve.address, 'Address copied!')}
                          style={{ fontFamily: font, fontSize: 13, color: '#777', background: 'none', border: 'none',
                            cursor: 'pointer', textAlign: 'left', wordBreak: 'break-all', width: '100%' }}
                          onMouseEnter={e => e.currentTarget.style.color = '#999'}
                          onMouseLeave={e => e.currentTarget.style.color = '#777'}>
                          {result.bondingCurve.address}
                          <span style={{ color: C.dim, marginLeft: 6 }}>⧉</span>
                        </button>
                      </div>

                      {/* Progress bar */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.dim, marginBottom: 7 }}>
                          <span>Bonding curve fill progress</span>
                          <span style={{ color: graduated ? C.blue : C.green, fontWeight: 700 }}>
                            {graduated ? '100%' : `${result.bondingCurve.progressPercent}%`}
                          </span>
                        </div>
                        <div style={{ height: 8, borderRadius: 999, background: C.surface3, overflow: 'hidden' }}>
                          <motion.div initial={{ width: 0 }}
                            animate={{ width: graduated ? '100%' : `${Math.min(safeNum(result.bondingCurve.progressPercent), 100)}%` }}
                            transition={{ delay: 0.15, duration: 1, ease: [0.22,1,0.36,1] }}
                            style={{ height: '100%', borderRadius: 999,
                              background: graduated
                                ? `linear-gradient(90deg,${C.blue},#3a8eef)`
                                : `linear-gradient(90deg,${C.green},${C.greenDim})`,
                              boxShadow: graduated ? '0 0 6px rgba(77,158,255,0.5)' : '0 0 6px rgba(0,255,148,0.35)' }} />
                        </div>
                        <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>
                          {graduated
                            ? '🎓 Graduated — trading on Raydium AMM now'
                            : result.bondingCurve.progressPercent < 33 ? '🟢 Fresh launch — low competition'
                            : result.bondingCurve.progressPercent < 66 ? '🟡 Gaining traction'
                            : '🔴 Near graduation — high risk'}
                        </div>
                      </div>
                    </div>

                    {/* RIGHT: MCAP + LIQUIDITY */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 160 }}>
                      <div style={{ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 12, padding: '14px 16px' }}>
                        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: C.dim, marginBottom: 5 }}>MCAP</div>
                        {graduated ? (
                          <>
                            <div style={{ fontSize: 15, fontWeight: 700, color: C.blue, fontVariantNumeric: 'tabular-nums' }}>
                              ON RAYDIUM
                            </div>
                            <div style={{ fontSize: 11, color: '#4a6a8a', marginTop: 3 }}>pump curve empty</div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: 24, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
                              {loc(result.bondingCurve.mcapSol)}
                            </div>
                            <div style={{ fontSize: 12, color: C.dim }}>SOL</div>
                          </>
                        )}
                      </div>
                      <div style={{ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 12, padding: '14px 16px' }}>
                        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: C.dim, marginBottom: 5 }}>LIQUIDITY</div>
                        {graduated ? (
                          <>
                            <div style={{ fontSize: 15, fontWeight: 700, color: C.blue }}>MIGRATED</div>
                            <div style={{ fontSize: 11, color: '#4a6a8a', marginTop: 3 }}>→ Raydium pool</div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: 24, fontWeight: 900, color: C.green, fontVariantNumeric: 'tabular-nums' }}>
                              {fx(result.bondingCurve.liquidityDepthSol, 2)}
                            </div>
                            <div style={{ fontSize: 12, color: C.dim }}>SOL real</div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* ── ROW 1: Curve details + Buy sims ─────────────────────────── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,360px),1fr))', gap: 16 }}>

                {/* Bonding Curve */}
                <Card idx={1} s={{ padding: 22 }}>
                  <SLabel icon="📈" title="BONDING CURVE" />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Stat label="TOKEN PRICE"
                      value={graduated
                        ? <span style={{ fontSize: 13, color: C.blue }}>SEE RAYDIUM</span>
                        : <span style={{ fontSize: 15 }}>{fx(result.bondingCurve.currentPriceSol, 10)}</span>}
                      sub={graduated ? 'curve is empty' : 'SOL per token'}
                      tip={graduated ? 'Token graduated — check Raydium for live price' : 'Live price from the constant-product AMM'} />
                    <Stat label="EXPLOSION"
                      value={graduated ? 'N/A' : `${safeNum(result.curveAnalytics.explosionRatio)}x`}
                      sub={graduated ? 'already graduated' : 'upside to grad'}
                      color={graduated ? C.dim : C.amber}
                      accent={graduated ? undefined : C.amber}
                      tip={graduated ? 'Token already graduated to Raydium' : 'Price multiple remaining if curve graduates to Raydium'} />
                    <Stat label="REAL SOL IN"
                      value={graduated ? '0.000' : fx(result.bondingCurve.liquidityDepthSol, 3)}
                      sub={graduated ? 'migrated to Raydium' : 'SOL deposited'}
                      color={graduated ? C.dim : C.green}
                      accent={graduated ? undefined : C.green}
                      tip={graduated ? 'All SOL migrated to Raydium on graduation' : 'Actual SOL that has entered the bonding curve (not virtual)'} />
                    <Stat label="PHASE"
                      value={graduated ? 'DONE' : result.bondingCurve.phase}
                      sub={graduated ? '100% — graduated' : `${result.bondingCurve.progressPercent}% filled`}
                      color={graduated ? C.blue : getPhaseCfg(result.bondingCurve.phase).color}
                      tip="EARLY <33% · MID 33–66% · LATE >66% · DONE = graduated" />
                  </div>
                </Card>

                {/* Buy Simulations */}
                <Card idx={2} s={{ padding: 22 }}>
                  <SLabel icon="💰" title="BUY SIMULATIONS" sub={graduated ? 'unavailable' : 'incl. 1% pump.fun fee'} />
                  {graduated ? (
                    <GraduatedSimPlaceholder mint={displayMint} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {result.simulations.map((sim, i) => {
                        const ic = sim.priceImpact > 5 ? C.red : sim.priceImpact > 2 ? C.amber : C.green;
                        const impactLabel = sim.priceImpact > 5 ? 'HIGH IMPACT' : sim.priceImpact > 2 ? 'MED IMPACT' : 'LOW IMPACT';
                        return (
                          <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.15 + i * 0.07 }}
                            style={{ background: C.surface2, border: `1px solid ${C.border2}`,
                              borderRadius: 12, padding: '14px 16px',
                              display: 'grid', gridTemplateColumns: '96px 1fr auto', alignItems: 'center', gap: 14 }}>
                            <div>
                              <div style={{ fontSize: 10, color: C.dim, letterSpacing: '0.14em' }}>SPEND</div>
                              <div style={{ fontSize: 20, fontWeight: 900, color: C.white }}>{sim.solAmount}</div>
                              <div style={{ fontSize: 12, color: C.dim }}>SOL</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: C.dim, letterSpacing: '0.14em' }}>RECEIVE</div>
                              <div style={{ fontSize: 20, fontWeight: 900, color: C.green, fontVariantNumeric: 'tabular-nums' }}>
                                {loc(sim.tokensOut)}
                              </div>
                              <div style={{ fontSize: 12, color: C.dim }}>tokens</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                                padding: '4px 8px', borderRadius: 7, color: ic,
                                background: `${ic}12`, border: `1px solid ${ic}30` }}>
                                {impactLabel}
                              </span>
                              <div style={{ fontSize: 12, color: ic, marginTop: 5 }}>+{fx(sim.priceImpact, 2)}%</div>
                            </div>
                          </motion.div>
                        );
                      })}
                      <div style={{ fontSize: 11, color: C.dim, textAlign: 'center', paddingTop: 4 }}>
                        All amounts after 1% pump.fun fee deducted
                      </div>
                    </div>
                  )}
                </Card>
              </div>

              {/* ── ROW 2: Velocity + Congestion + Distribution ──────────────── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 16 }}>

                {/* Velocity */}
                <Card idx={3} s={{ padding: 22 }}>
                  <SLabel icon="⚡" title="VELOCITY" />
                  <Tip text="Transactions per hour extrapolated from last 30 min window">
                    <div>
                      <div style={{ fontSize: 'clamp(52px,6vw,72px)', fontWeight: 900, color: C.green,
                        lineHeight: 1, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>
                        <AnimatedNumber value={safeNum(result.velocity.txPerHour)} duration={800} />
                      </div>
                      <div style={{ fontSize: 11, letterSpacing: '0.18em', color: C.dim, marginTop: 5, marginBottom: 18 }}>TX / HOUR</div>
                    </div>
                  </Tip>
                  <div style={{ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 11,
                    padding: '13px 15px', marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: C.dim, letterSpacing: '0.14em', marginBottom: 4 }}>LAST 30 MIN</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.white }}>
                      {safeNum(result.velocity.recentTxCount)} txs
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.dim, marginBottom: 6 }}>
                      <span>activity</span>
                      <span>{safeNum(result.velocity.txPerHour) >= 200 ? 'HIGH' : safeNum(result.velocity.txPerHour) >= 50 ? 'MED' : 'LOW'}</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 999, background: C.surface3, overflow: 'hidden' }}>
                      <motion.div initial={{ width: 0 }}
                        animate={{ width: `${Math.min(safeNum(result.velocity.txPerHour) / 500 * 100, 100)}%` }}
                        transition={{ delay: 0.3, duration: 0.8 }}
                        style={{ height: '100%', borderRadius: 999,
                          background: safeNum(result.velocity.txPerHour) >= 200 ? C.green : safeNum(result.velocity.txPerHour) >= 50 ? C.amber : C.red }} />
                    </div>
                  </div>
                </Card>

                {/* Congestion */}
                <Card idx={4} s={{ padding: 22 }}>
                  <SLabel icon="🌐" title="NETWORK" />
                  {(() => {
                    const cc = getCongCfg(result.congestion.congestionLevel);
                    const feeContext = result.congestion.avgPriorityFee === 0
                      ? 'Network is quiet — low-cost txs'
                      : result.congestion.avgPriorityFee < 10000
                      ? 'Cheap to transact right now'
                      : result.congestion.avgPriorityFee < 100000
                      ? 'Moderate fees — use 20k+ priority'
                      : 'Heavy congestion — use 100k+ priority';
                    return (
                      <>
                        <motion.div initial={{ scale: 0.88, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                          transition={{ delay: 0.22 }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 11,
                            padding: '11px 16px', marginBottom: 16, fontWeight: 900, fontSize: 13,
                            letterSpacing: '0.13em', background: cc.bg, border: `1px solid ${cc.border}`, color: cc.color }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: cc.color }} />
                          {result.congestion.congestionLevel}
                        </motion.div>
                        <Stat label="MEDIAN PRIORITY FEE"
                          value={result.congestion.avgPriorityFee === 0 ? '0' : loc(result.congestion.avgPriorityFee)}
                          sub="microLamports / CU"
                          tip="Median of non-zero fees from recent pump.fun txs" />
                        <div style={{ fontSize: 12, color: C.dim, marginTop: 12, lineHeight: 1.55 }}>{feeContext}</div>
                      </>
                    );
                  })()}
                </Card>

                {/* Distribution */}
                <Card idx={5} s={{ padding: 22 }}>
                  <SLabel icon="👥" title="DISTRIBUTION" sub="top 20 holders (RPC max)" />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Stat label="SHOWN"
                      value={safeNum(result.holders.totalHolders)}
                      sub="top accounts" tip="getTokenLargestAccounts — max 20 returned by Solana RPC" />
                    <Stat label="TOP 10 HOLD"
                      value={`${fx(result.holders.top10Percent, 1)}%`}
                      color={result.holders.top10Percent > 50 ? C.red : result.holders.top10Percent > 30 ? C.amber : C.green}
                      accent={result.holders.top10Percent > 50 ? C.red : result.holders.top10Percent > 30 ? C.amber : C.green}
                      sub="of supply" tip="% of total supply held by the top 10 wallets" />
                    <Stat label="WHALE #1"
                      value={`${fx(result.holders.whaleDominance, 1)}%`}
                      color={result.holders.whaleDominance > 20 ? C.red : result.holders.whaleDominance > 10 ? C.amber : C.green}
                      accent={result.holders.whaleDominance > 20 ? C.red : result.holders.whaleDominance > 10 ? C.amber : C.green}
                      sub="biggest wallet" tip="Single largest holder's % — main rug signal" />
                    <Stat label="CONC SCORE"
                      value={safeNum(result.holders.concentrationScore)}
                      color={result.holders.concentrationScore < 30 ? C.red : result.holders.concentrationScore < 60 ? C.amber : C.green}
                      sub="100=distributed" tip="100 = evenly distributed, 0 = fully concentrated" />
                  </div>
                </Card>
              </div>

              {/* ── HOLDERS TABLE ────────────────────────────────────────────── */}
              <Card idx={6} s={{ overflow: 'hidden', padding: 0 }}>
                <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', color: C.muted }}>◆ TOP HOLDERS</span>
                    <span style={{ fontSize: 11, padding: '4px 9px', borderRadius: 6,
                      background: C.surface3, border: `1px solid ${C.border}`, color: C.dim }}>
                      top {result.holders.topHolders.length} shown
                    </span>
                    <span style={{ fontSize: 11, color: C.dim }}>· Solana RPC max = 20</span>
                  </div>
                  <span style={{ fontSize: 11, color: C.dim }}>click row → copy address</span>
                </div>
                <Divider />
                <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead style={{ position: 'sticky', top: 0, background: C.surface, zIndex: 5 }}>
                      <tr>
                        {['#','ADDRESS','BALANCE','% SUPPLY','RISK'].map((h, i) => (
                          <th key={i} style={{
                            padding: i === 0 ? '12px 12px 12px 24px' : '12px 16px',
                            textAlign: i > 1 ? 'right' : 'left',
                            fontSize: 10, fontWeight: 400, letterSpacing: '0.18em', color: C.dim,
                            borderBottom: `1px solid ${C.border2}`,
                            ...(i === 4 ? { paddingRight: 24 } : {})
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.holders.topHolders.length > 0 ? result.holders.topHolders.map((h, i) => {
                        const risk = h.percent > 10 ? { label: 'HIGH', color: C.red } : h.percent > 5 ? { label: 'MED', color: C.amber } : { label: 'LOW', color: C.green };
                        return (
                          <motion.tr key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.025 * i }}
                            onClick={() => copy(h.address, 'Address copied!')}
                            style={{ borderBottom: `1px solid #111`, cursor: 'pointer',
                              background: i % 2 === 0 ? 'transparent' : '#0b0b0b' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                            onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : '#0b0b0b'}>
                            <td style={{ padding: '13px 12px 13px 24px', color: C.dim, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                            <td style={{ padding: '13px 16px', color: C.green, fontFamily: font }}>
                              {h.address.slice(0, 8)}…{h.address.slice(-6)}
                              <span style={{ color: C.dim, marginLeft: 7, fontSize: 11 }}>⧉</span>
                            </td>
                            <td style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                              {loc(h.balance)}
                            </td>
                            <td style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 700,
                              fontVariantNumeric: 'tabular-nums',
                              color: h.percent > 10 ? C.red : h.percent > 5 ? C.amber : C.green }}>
                              {fx(h.percent, 2)}%
                            </td>
                            <td style={{ padding: '13px 24px 13px 16px', textAlign: 'right' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                                padding: '4px 8px', borderRadius: 6, color: risk.color,
                                background: `${risk.color}12`, border: `1px solid ${risk.color}25` }}>
                                {risk.label}
                              </span>
                            </td>
                          </motion.tr>
                        );
                      }) : (
                        <tr><td colSpan={5} style={{ padding: '48px 28px', textAlign: 'center', color: C.dim, fontSize: 14 }}>
                          No holder data
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* ── RAW JSON ─────────────────────────────────────────────────── */}
              <div style={{ textAlign: 'center' }}>
                <button onClick={() => setShowRaw(v => !v)}
                  style={{ fontFamily: font, fontSize: 12, color: C.dim, background: 'none', border: 'none',
                    cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                  {showRaw ? '▲ hide raw json' : '▼ show raw json'}
                </button>
              </div>
              <AnimatePresence>
                {showRaw && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
                    <pre style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12,
                      padding: 18, overflowX: 'auto', maxHeight: 420, fontSize: 12, lineHeight: 1.6, color: C.dim }}>
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── FOOTER ─────────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: `1px solid ${C.border2}`, padding: '20px 0' }}>
        <div style={{ ...wrap, display: 'flex', flexWrap: 'wrap',
          alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 12, color: C.dim }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Powered by</span>
            <span style={{ fontWeight: 700, color: C.muted }}>QuickNode</span>
          </div>
          <a href="https://x.com/Rachit_twts" target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.dim, transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = C.white}
            onMouseLeave={e => e.currentTarget.style.color = C.dim}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.263 5.632zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            @Rachit_twts
          </a>
        </div>
      </footer>

      {/* ── TOAST ──────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {toast && <Toast message={toast} onClose={() => setToast('')} />}
      </AnimatePresence>
    </div>
  );
};

export default App;
