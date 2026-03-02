import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { CSSProperties } from 'react';

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
  muted:    '#555555',
  dim:      '#3a3a3a',
  dimmer:   '#282828',
  dimmest:  '#1e1e1e',
};

const font = "'Courier New', Courier, monospace";

// ─── Safe number helpers ───────────────────────────────────────────────────────
const safeNum = (v: any, fallback = 0): number =>
  v === null || v === undefined || isNaN(Number(v)) ? fallback : Number(v);
const fx = (v: any, d = 2): string => safeNum(v).toFixed(d);
const loc = (v: any): string => safeNum(v).toLocaleString();

// ─── Global styles ─────────────────────────────────────────────────────────────
const GlobalStyle = () => {
  useEffect(() => {
    const el = document.createElement('style');
    el.innerHTML = `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html, body, #root { height: 100%; }
      body { background: ${C.bg}; color: ${C.white}; font-family: ${font}; -webkit-font-smoothing: antialiased; }
      ::-webkit-scrollbar { width: 4px; height: 4px; }
      ::-webkit-scrollbar-track { background: ${C.surface}; }
      ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
      input::placeholder { color: #282828; }
      input:focus { outline: none; }
      button { cursor: pointer; font-family: ${font}; }
      a { text-decoration: none; }
      @keyframes spin    { to { transform: rotate(360deg); } }
      @keyframes pulse   { 0%,100% { opacity:0.35; } 50% { opacity:1; } }
      @keyframes shimmer { 0% { background-position:-600px 0; } 100% { background-position:600px 0; } }
      @keyframes fadeIn  { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
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
            style={{ position: 'absolute', bottom: '110%', left: '50%', transform: 'translateX(-50%)',
              marginBottom: 4, zIndex: 200, pointerEvents: 'none' }}>
            <div style={{ background: '#1c1c1c', border: '1px solid #2c2c2c', color: '#999', fontSize: 11,
              padding: '5px 10px', borderRadius: 7, whiteSpace: 'nowrap', boxShadow: '0 8px 24px rgba(0,0,0,0.7)' }}>
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
        fontFamily: font, fontSize: 12, padding: '9px 18px', borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontSize: 10 }}>✓</span> {message}
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0 40px', gap: 16 }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', border: '2px solid transparent',
        borderTopColor: C.green, borderRightColor: 'rgba(0,255,148,0.15)', animation: 'spin 1s linear infinite' }} />
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ color: C.green, fontSize: 12, letterSpacing: '0.3em', animation: 'pulse 1.8s infinite' }}>
          SCANNING ON-CHAIN
        </div>
        <div style={{ color: C.dim, fontSize: 11 }}>curve · holders · velocity · congestion</div>
      </div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 12 }}>
      {[...Array(6)].map((_, i) => (
        <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18,
          display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Sk w="30%" h={10} /><Sk w="60%" h={24} /><Sk h={10} /><Sk w="75%" h={10} />
        </div>
      ))}
    </div>
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
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.25em', color: C.muted }}>{title}</span>
    </div>
    {sub && <span style={{ fontSize: 10, color: C.dim, letterSpacing: '0.05em' }}>{sub}</span>}
  </div>
);

// ─── Stat cell ─────────────────────────────────────────────────────────────────
const Stat = ({ label, value, sub, color = C.white, tip, accent }: {
  label: string; value: React.ReactNode; sub?: string;
  color?: string; tip?: string; accent?: string;
}) => {
  const inner = (
    <div style={{ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 10, padding: '12px 14px',
      borderLeft: accent ? `2px solid ${accent}` : undefined, transition: 'border-color 0.15s' }}>
      <div style={{ fontSize: 9, letterSpacing: '0.22em', color: '#3a3a3a', marginBottom: 5, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>{sub}</div>}
    </div>
  );
  return tip ? <Tip text={tip}>{inner}</Tip> : inner;
};

// ─── Badge ─────────────────────────────────────────────────────────────────────
const Badge = ({ text, color, bg, border }: { text: string; color: string; bg: string; border: string }) => (
  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', padding: '3px 9px',
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
    style={{ fontFamily: font, fontSize: 12, fontWeight: 700, padding: '10px 20px', borderRadius: 10,
      border: primary ? 'none' : `1px solid #252525`,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      background: primary ? C.green : '#131313',
      color: primary ? '#000' : C.muted,
      transition: 'opacity 0.15s', ...s }}>
    {children}
  </motion.button>
);

// ─── Divider ───────────────────────────────────────────────────────────────────
const Divider = () => <div style={{ height: 1, background: C.border2, margin: '0' }} />;

// ─── Main app ──────────────────────────────────────────────────────────────────
const MAX_RECENT = 5;
const wrap: CSSProperties = { maxWidth: 1080, margin: '0 auto', padding: '0 20px' };

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
      const res = await fetch('http://localhost:3000/api/launch', {
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
      setError(e.message || 'Cannot reach backend on port 3000');
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

  const sc  = result ? getScoreCfg(result.alphaScore) : getScoreCfg(0);
  const clk = new Date(now).toLocaleTimeString('en-US', { hour12: false });

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.white, fontFamily: font }}>
      <GlobalStyle />

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header style={{ background: C.surface2, borderBottom: `1px solid ${C.border2}`, position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ ...wrap, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: C.green, color: '#000',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 13 }}>P</div>
            <span style={{ fontWeight: 900, fontSize: 14, letterSpacing: '-0.01em' }}>
              pump<span style={{ color: C.green }}>terminal</span>
            </span>
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5,
              background: C.surface3, border: `1px solid ${C.border}`, color: C.dim, letterSpacing: '0.05em' }}>
              BETA
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: C.dim }}>
            {autoRefresh && (
              <span style={{ color: C.green, display: 'flex', alignItems: 'center', gap: 5, animation: 'pulse 2s infinite' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, display: 'inline-block' }} />
                AUTO
              </span>
            )}
            <span style={{ fontVariantNumeric: 'tabular-nums', color: C.dim }}>{clk}</span>
          </div>
        </div>
      </header>

      <main style={{ ...wrap, paddingTop: 28, paddingBottom: 56 }}>

        {/* ── HERO ───────────────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
          style={{ paddingBottom: 4, marginBottom: 16 }}>
          <h1 style={{ fontSize: 'clamp(20px,3.5vw,28px)', fontWeight: 900, letterSpacing: '-0.025em',
            lineHeight: 1.2, marginBottom: 10 }}>
            On-chain intel for <span style={{ color: C.green }}>Pump.fun</span> launches.
          </h1>
          <p style={{ fontSize: 12, lineHeight: 1.8, color: '#4a4a4a', maxWidth: 580 }}>
            Paste any mint → get bonding curve phase, real buy simulations (with 1% fee),
            holder distribution, tx velocity, and an{' '}
            <span style={{ color: C.green }}>Alpha Score (0–100)</span>{' '}
            to decide <span style={{ color: C.green }}>ape or escape</span>.
            Pure on-chain via QuickNode. No paid APIs.
          </p>
        </motion.div>

        {/* Feature row */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
          {[['📈','Bonding Curve'],['💰','Buy Sims (1% fee)'],['👥','Holder Dist.'],['⚡','Velocity'],['🌐','Congestion'],['🎯','Alpha Score']].map(([icon,label],i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
              padding: '4px 10px', borderRadius: 999, background: C.surface, border: `1px solid ${C.border}`, color: C.muted }}>
              {icon} {label}
            </span>
          ))}
        </motion.div>

        {/* ── SEARCH ─────────────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
          style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="text" value={mint} onChange={e => setMint(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && analyze()}
              placeholder="Paste token mint address..."
              style={{ flex: 1, minWidth: 200, background: C.surface2, border: `1px solid ${C.border}`,
                borderRadius: 9, padding: '10px 14px', fontSize: 12, fontFamily: font, color: C.white }}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(0,255,148,0.4)'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(0,255,148,0.06)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = 'none'; }}
            />
            <div style={{ display: 'flex', gap: 7 }}>
              <Btn primary onClick={() => analyze()} disabled={loading || !mint} s={{ minWidth: 100 }}>
                {loading ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid transparent',
                      borderTopColor: '#000', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                    SCANNING
                  </span>
                ) : '⚡ SCAN'}
              </Btn>
              {result && <Btn onClick={() => analyze()} disabled={loading} s={{ padding: '10px 12px', fontSize: 15 }}>↺</Btn>}
              <Tip text={autoRefresh ? 'Auto-refresh ON every 15s — click to stop' : 'Enable 15s auto-refresh'}>
                <Btn onClick={() => setAutoRefresh(v => !v)} s={{
                  padding: '10px 12px', fontSize: 10, letterSpacing: '0.12em',
                  background: autoRefresh ? 'rgba(0,255,148,0.07)' : '#131313',
                  border: `1px solid ${autoRefresh ? 'rgba(0,255,148,0.28)' : '#252525'}`,
                  color: autoRefresh ? C.green : C.dim,
                }}>AUTO</Btn>
              </Tip>
            </div>
          </div>

          {recent.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
              marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border2}` }}>
              <span style={{ fontSize: 9, letterSpacing: '0.22em', color: C.dim }}>RECENT</span>
              {recent.map((s, i) => (
                <motion.button key={i} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                  onClick={() => { setMint(s); analyze(s); }}
                  style={{ fontFamily: font, fontSize: 10, padding: '3px 10px', borderRadius: 7,
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
                color: C.red, borderRadius: 10, padding: '12px 16px', fontSize: 12 }}>
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
            style={{ border: `1px dashed ${C.border}`, borderRadius: 14, padding: '52px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 26, marginBottom: 10 }}>🔎</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.white, marginBottom: 6 }}>Ready to scan</div>
            <p style={{ fontSize: 12, color: C.muted }}>
              Paste a Pump.fun mint above and hit{' '}
              <span style={{ color: C.green }}>⚡ SCAN</span>.
            </p>
          </motion.div>
        )}

        {/* ── RESULTS ────────────────────────────────────────────────────────── */}
        <AnimatePresence>
          {result && !loading && (
            <motion.div key={result.timestamp} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* ── SCORE + META HERO ────────────────────────────────────────── */}
              <Card idx={0} glow={sc.border} s={{ padding: 0, overflow: 'hidden' }}>
                {/* Top strip */}
                <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border2}`,
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                    {result.isPumpToken && <Badge text="PUMP.FUN ✓" color={C.green} bg="rgba(0,255,148,0.07)" border="rgba(0,255,148,0.2)" />}
                    <Badge text={`${result.bondingCurve.phase} PHASE`}
                      color={getPhaseCfg(result.bondingCurve.phase).color}
                      bg={getPhaseCfg(result.bondingCurve.phase).bg}
                      border={getPhaseCfg(result.bondingCurve.phase).border} />
                    {result.bondingCurve.state?.complete && (
                      <Badge text="GRADUATED" color={C.blue} bg="rgba(77,158,255,0.07)" border="rgba(77,158,255,0.2)" />
                    )}
                    <span style={{ fontSize: 10, color: C.dim }}>scanned {ago(result.timestamp)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Btn onClick={download} s={{ fontSize: 11, padding: '6px 12px' }}>↓ JSON</Btn>
                    <Btn onClick={() => copy(JSON.stringify(result, null, 2), 'Copied!')} s={{ fontSize: 11, padding: '6px 12px' }}>⧉ Copy</Btn>
                  </div>
                </div>

                {/* Main content */}
                <div style={{ padding: '20px', position: 'relative', overflow: 'hidden' }}>
                  {/* ambient glow */}
                  <div style={{ position: 'absolute', top: -60, right: -40, width: 280, height: 280,
                    borderRadius: '50%', background: sc.color, filter: 'blur(90px)', opacity: 0.05, pointerEvents: 'none' }} />

                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 32, alignItems: 'center', position: 'relative' }}>

                    {/* ALPHA SCORE */}
                    <Tip text="Composite: velocity (25pts) + distribution (30pts) + whale risk (20pts) + liquidity (15pts) + congestion (10pts)">
                      <div style={{ textAlign: 'center', minWidth: 140 }}>
                        <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                          transition={{ delay: 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                          style={{ fontSize: 'clamp(64px,9vw,88px)', fontWeight: 900, lineHeight: 1,
                            letterSpacing: '-0.05em', fontVariantNumeric: 'tabular-nums',
                            color: sc.color, textShadow: sc.glow }}>
                          <AnimatedNumber value={result.alphaScore} duration={1200} />
                        </motion.div>
                        <div style={{ fontSize: 9, letterSpacing: '0.25em', color: C.dim, margin: '5px 0 8px' }}>ALPHA SCORE / 100</div>
                        <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.18em',
                          padding: '4px 14px', borderRadius: 999,
                          background: sc.lBg, border: `1px solid ${sc.lBorder}`, color: sc.color }}>
                          {sc.label}
                        </span>
                      </div>
                    </Tip>

                    {/* CENTER: address + progress */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                      <div>
                        <div style={{ fontSize: 9, letterSpacing: '0.22em', color: C.dim, marginBottom: 4 }}>BONDING CURVE ADDRESS</div>
                        <button onClick={() => copy(result.bondingCurve.address, 'Address copied!')}
                          style={{ fontFamily: font, fontSize: 11, color: '#666', background: 'none', border: 'none',
                            cursor: 'pointer', textAlign: 'left', wordBreak: 'break-all', width: '100%' }}
                          onMouseEnter={e => e.currentTarget.style.color = '#999'}
                          onMouseLeave={e => e.currentTarget.style.color = '#666'}>
                          {result.bondingCurve.address}
                          <span style={{ color: C.dim, marginLeft: 6 }}>⧉</span>
                        </button>
                      </div>

                      {/* Progress bar */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.dim, marginBottom: 5 }}>
                          <span>Bonding curve fill progress</span>
                          <span style={{ color: C.green, fontWeight: 700 }}>{result.bondingCurve.progressPercent}%</span>
                        </div>
                        <div style={{ height: 5, borderRadius: 999, background: C.surface3, overflow: 'hidden' }}>
                          <motion.div initial={{ width: 0 }}
                            animate={{ width: `${Math.min(safeNum(result.bondingCurve.progressPercent), 100)}%` }}
                            transition={{ delay: 0.15, duration: 1, ease: [0.22,1,0.36,1] }}
                            style={{ height: '100%', borderRadius: 999,
                              background: `linear-gradient(90deg,${C.green},${C.greenDim})`,
                              boxShadow: '0 0 6px rgba(0,255,148,0.35)' }} />
                        </div>
                        <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>
                          {result.bondingCurve.progressPercent < 33 ? '🟢 Fresh launch — low competition' :
                           result.bondingCurve.progressPercent < 66 ? '🟡 Gaining traction' :
                           '🔴 Near graduation — high risk'}
                        </div>
                      </div>
                    </div>

                    {/* RIGHT: key numbers */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 120 }}>
                      <div style={{ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 10, padding: '10px 14px' }}>
                        <div style={{ fontSize: 9, letterSpacing: '0.2em', color: C.dim, marginBottom: 3 }}>MCAP</div>
                        <div style={{ fontSize: 20, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
                          {loc(result.bondingCurve.mcapSol)}
                        </div>
                        <div style={{ fontSize: 10, color: C.dim }}>SOL</div>
                      </div>
                      <div style={{ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 10, padding: '10px 14px' }}>
                        <div style={{ fontSize: 9, letterSpacing: '0.2em', color: C.dim, marginBottom: 3 }}>LIQUIDITY</div>
                        <div style={{ fontSize: 20, fontWeight: 900, color: C.green, fontVariantNumeric: 'tabular-nums' }}>
                          {fx(result.bondingCurve.liquidityDepthSol, 2)}
                        </div>
                        <div style={{ fontSize: 10, color: C.dim }}>SOL real</div>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* ── ROW 1: Curve details + Buy sims ─────────────────────────── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>

                {/* Bonding Curve */}
                <Card idx={1} s={{ padding: 18 }}>
                  <SLabel icon="📈" title="BONDING CURVE" />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <Stat label="TOKEN PRICE"
                      value={<span style={{ fontSize: 13 }}>{fx(result.bondingCurve.currentPriceSol, 10)}</span>}
                      sub="SOL per token" tip="Live price from the constant-product AMM" />
                    <Stat label="EXPLOSION"
                      value={`${safeNum(result.curveAnalytics.explosionRatio)}x`}
                      sub="upside to grad" color={C.amber}
                      accent={C.amber}
                      tip="Price multiple remaining if curve graduates to Raydium" />
                    <Stat label="REAL SOL IN"
                      value={fx(result.bondingCurve.liquidityDepthSol, 3)}
                      sub="SOL deposited" color={C.green}
                      accent={C.green}
                      tip="Actual SOL that has entered the bonding curve (not virtual)" />
                    <Stat label="PHASE"
                      value={result.bondingCurve.phase}
                      sub={`${result.bondingCurve.progressPercent}% filled`}
                      color={getPhaseCfg(result.bondingCurve.phase).color}
                      tip="EARLY <33% · MID 33–66% · LATE >66%" />
                  </div>
                </Card>

                {/* Buy Simulations */}
                <Card idx={2} s={{ padding: 18 }}>
                  <SLabel icon="💰" title="BUY SIMULATIONS" sub="incl. 1% pump.fun fee" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {result.simulations.map((sim, i) => {
                      const ic = sim.priceImpact > 5 ? C.red : sim.priceImpact > 2 ? C.amber : C.green;
                      const impactLabel = sim.priceImpact > 5 ? 'HIGH IMPACT' : sim.priceImpact > 2 ? 'MED IMPACT' : 'LOW IMPACT';
                      return (
                        <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.15 + i * 0.07 }}
                          style={{ background: C.surface2, border: `1px solid ${C.border2}`,
                            borderRadius: 10, padding: '12px 14px',
                            display: 'grid', gridTemplateColumns: '80px 1fr auto', alignItems: 'center', gap: 12 }}>
                          {/* SOL in */}
                          <div>
                            <div style={{ fontSize: 9, color: C.dim, letterSpacing: '0.15em' }}>SPEND</div>
                            <div style={{ fontSize: 17, fontWeight: 900, color: C.white }}>{sim.solAmount}</div>
                            <div style={{ fontSize: 10, color: C.dim }}>SOL</div>
                          </div>
                          {/* Tokens out */}
                          <div>
                            <div style={{ fontSize: 9, color: C.dim, letterSpacing: '0.15em' }}>RECEIVE</div>
                            <div style={{ fontSize: 17, fontWeight: 900, color: C.green, fontVariantNumeric: 'tabular-nums' }}>
                              {loc(sim.tokensOut)}
                            </div>
                            <div style={{ fontSize: 10, color: C.dim }}>tokens</div>
                          </div>
                          {/* Impact badge */}
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                              padding: '3px 7px', borderRadius: 6, color: ic,
                              background: `${ic}12`, border: `1px solid ${ic}30` }}>
                              {impactLabel}
                            </span>
                            <div style={{ fontSize: 10, color: ic, marginTop: 3 }}>+{fx(sim.priceImpact, 2)}%</div>
                          </div>
                        </motion.div>
                      );
                    })}
                    <div style={{ fontSize: 10, color: C.dim, textAlign: 'center', paddingTop: 2 }}>
                      All amounts after 1% pump.fun fee deducted
                    </div>
                  </div>
                </Card>
              </div>

              {/* ── ROW 2: Velocity + Congestion + Distribution ──────────────── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>

                {/* Velocity */}
                <Card idx={3} s={{ padding: 18 }}>
                  <SLabel icon="⚡" title="VELOCITY" />
                  <Tip text="Transactions per hour extrapolated from last 30 min window">
                    <div>
                      <div style={{ fontSize: 'clamp(40px,5vw,56px)', fontWeight: 900, color: C.green,
                        lineHeight: 1, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>
                        <AnimatedNumber value={safeNum(result.velocity.txPerHour)} duration={800} />
                      </div>
                      <div style={{ fontSize: 9, letterSpacing: '0.22em', color: C.dim, marginTop: 3, marginBottom: 14 }}>TX / HOUR</div>
                    </div>
                  </Tip>
                  <div style={{ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 9,
                    padding: '10px 12px', marginBottom: 10 }}>
                    <div style={{ fontSize: 9, color: C.dim, letterSpacing: '0.15em', marginBottom: 3 }}>LAST 30 MIN</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.white }}>
                      {safeNum(result.velocity.recentTxCount)} txs
                    </div>
                  </div>
                  {/* velocity bar */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.dim, marginBottom: 4 }}>
                      <span>activity</span>
                      <span>{safeNum(result.velocity.txPerHour) >= 200 ? 'HIGH' : safeNum(result.velocity.txPerHour) >= 50 ? 'MED' : 'LOW'}</span>
                    </div>
                    <div style={{ height: 3, borderRadius: 999, background: C.surface3, overflow: 'hidden' }}>
                      <motion.div initial={{ width: 0 }}
                        animate={{ width: `${Math.min(safeNum(result.velocity.txPerHour) / 500 * 100, 100)}%` }}
                        transition={{ delay: 0.3, duration: 0.8 }}
                        style={{ height: '100%', borderRadius: 999,
                          background: safeNum(result.velocity.txPerHour) >= 200 ? C.green : safeNum(result.velocity.txPerHour) >= 50 ? C.amber : C.red }} />
                    </div>
                  </div>
                </Card>

                {/* Congestion */}
                <Card idx={4} s={{ padding: 18 }}>
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
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 10,
                            padding: '9px 14px', marginBottom: 14, fontWeight: 900, fontSize: 12,
                            letterSpacing: '0.15em', background: cc.bg, border: `1px solid ${cc.border}`, color: cc.color }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: cc.color }} />
                          {result.congestion.congestionLevel}
                        </motion.div>
                        <Stat label="MEDIAN PRIORITY FEE"
                          value={result.congestion.avgPriorityFee === 0 ? '0' : loc(result.congestion.avgPriorityFee)}
                          sub="microLamports / CU"
                          tip="Median of non-zero fees from recent pump.fun txs" />
                        <div style={{ fontSize: 10, color: C.dim, marginTop: 10, lineHeight: 1.5 }}>{feeContext}</div>
                      </>
                    );
                  })()}
                </Card>

                {/* Distribution */}
                <Card idx={5} s={{ padding: 18 }}>
                  <SLabel icon="👥" title="DISTRIBUTION" sub="top 20 holders (RPC max)" />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
                <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', color: C.muted }}>◆ TOP HOLDERS</span>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5,
                      background: C.surface3, border: `1px solid ${C.border}`, color: C.dim }}>
                      top {result.holders.topHolders.length} shown
                    </span>
                    <span style={{ fontSize: 10, color: C.dim }}>· Solana RPC max = 20</span>
                  </div>
                  <span style={{ fontSize: 10, color: C.dim }}>click row → copy address</span>
                </div>
                <Divider />
                <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead style={{ position: 'sticky', top: 0, background: C.surface, zIndex: 5 }}>
                      <tr>
                        {['#','ADDRESS','BALANCE','% SUPPLY','RISK'].map((h, i) => (
                          <th key={i} style={{
                            padding: i === 0 ? '9px 10px 9px 20px' : '9px 14px',
                            textAlign: i > 1 ? 'right' : 'left',
                            fontSize: 9, fontWeight: 400, letterSpacing: '0.2em', color: C.dim,
                            borderBottom: `1px solid ${C.border2}`,
                            ...(i === 4 ? { paddingRight: 20 } : {})
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
                            <td style={{ padding: '10px 10px 10px 20px', color: C.dim, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                            <td style={{ padding: '10px 14px', color: C.green, fontFamily: font }}>
                              {h.address.slice(0, 8)}…{h.address.slice(-6)}
                              <span style={{ color: C.dim, marginLeft: 6, fontSize: 10 }}>⧉</span>
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                              {loc(h.balance)}
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700,
                              fontVariantNumeric: 'tabular-nums',
                              color: h.percent > 10 ? C.red : h.percent > 5 ? C.amber : C.green }}>
                              {fx(h.percent, 2)}%
                            </td>
                            <td style={{ padding: '10px 20px 10px 14px', textAlign: 'right' }}>
                              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                                padding: '2px 7px', borderRadius: 5, color: risk.color,
                                background: `${risk.color}12`, border: `1px solid ${risk.color}25` }}>
                                {risk.label}
                              </span>
                            </td>
                          </motion.tr>
                        );
                      }) : (
                        <tr><td colSpan={5} style={{ padding: '40px 24px', textAlign: 'center', color: C.dim, fontSize: 12 }}>
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
                  style={{ fontFamily: font, fontSize: 11, color: C.dim, background: 'none', border: 'none',
                    cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                  {showRaw ? '▲ hide raw json' : '▼ show raw json'}
                </button>
              </div>
              <AnimatePresence>
                {showRaw && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
                    <pre style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12,
                      padding: 16, overflowX: 'auto', maxHeight: 340, fontSize: 10, lineHeight: 1.6, color: C.dim }}>
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
      <footer style={{ borderTop: `1px solid ${C.border2}`, padding: '16px 20px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexWrap: 'wrap',
          alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 11, color: C.dim }}>
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