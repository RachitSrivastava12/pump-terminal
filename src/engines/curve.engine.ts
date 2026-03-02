import { PublicKey } from '@solana/web3.js';
import {
  connection,
  PUMP_PROGRAM_ID,
  LAMPORTS_PER_SOL,
  INITIAL_REAL_TOKEN_RESERVES,
  TOKEN_DECIMALS,
  TOTAL_SUPPLY,
  BONDING_CURVE_DISCRIMINATOR,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '../config';
import { BondingCurveState, BuySimulation, LaunchAnalysis, Holder } from '../types/pump.types';

// ─── Constants ────────────────────────────────────────────────────────────────

// Pump.fun charges exactly 1% fee on every buy taken from the SOL input
// BEFORE the AMM calculation. Only the net-of-fee SOL moves the reserves.
const PUMP_FEE_BPS = 100n; // 1% = 100 bps out of 10000

// ─── PDA helpers ─────────────────────────────────────────────────────────────

export function getBondingCurvePda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return pda;
}

// The bonding curve's associated token account that holds the unsold tokens.
// Seeds: [bondingCurvePda, TOKEN_PROGRAM_ID, mint] → ASSOCIATED_TOKEN_PROGRAM_ID
export function getAssociatedBondingCurve(mint: PublicKey, curveAddr: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [curveAddr.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

// ─── Fetch bonding curve on-chain state ───────────────────────────────────────

export async function fetchBondingCurve(mint: PublicKey): Promise<BondingCurveState | null> {
  const curveAddress = getBondingCurvePda(mint);
  const account = await connection.getAccountInfo(curveAddress, 'confirmed');

  if (!account || account.owner.toBase58() !== PUMP_PROGRAM_ID.toBase58()) return null;

  const data = account.data;
  if (data.length < 49 || !data.subarray(0, 8).equals(BONDING_CURVE_DISCRIMINATOR)) return null;

  return {
    virtualTokenReserves: data.readBigUInt64LE(8),
    virtualSolReserves:   data.readBigUInt64LE(16),
    realTokenReserves:    data.readBigUInt64LE(24),
    realSolReserves:      data.readBigUInt64LE(32),
    tokenTotalSupply:     data.readBigUInt64LE(40),
    complete:             data[48] !== 0,
  };
}

// ─── Buy simulation (1% fee applied) ─────────────────────────────────────────

export function decodeBuySimulation(curve: BondingCurveState, solAmountLamports: bigint): BuySimulation {
  const vSol   = curve.virtualSolReserves;
  const vToken = curve.virtualTokenReserves;

  const priceBefore =
    (Number(vSol) / LAMPORTS_PER_SOL) /
    (Number(vToken) / 10 ** TOKEN_DECIMALS);

  // Deduct 1% pump.fun fee — fee does NOT enter the curve reserves
  const feeAmount   = (solAmountLamports * PUMP_FEE_BPS) / 10000n;
  const solNetInput = solAmountLamports - feeAmount;

  // Constant-product AMM (matches on-chain integer division exactly)
  const newVSol   = vSol + solNetInput;
  const k         = vSol * vToken;
  const newVToken = k / newVSol;
  const tokensOut = vToken - newVToken;

  const priceAfter =
    (Number(newVSol) / LAMPORTS_PER_SOL) /
    (Number(newVToken) / 10 ** TOKEN_DECIMALS);

  const priceImpact = ((priceAfter - priceBefore) / priceBefore) * 100;

  return {
    solAmount:      Number(solAmountLamports) / LAMPORTS_PER_SOL,
    tokensOut:      tokensOut.toString(),
    priceBefore,
    priceAfter,
    priceImpact,
    newVirtualSol:   newVSol.toString(),
    newVirtualToken: newVToken.toString(),
  };
}

// ─── Phase ────────────────────────────────────────────────────────────────────

export function getCurvePhase(progress: number): 'EARLY' | 'MID' | 'LATE' {
  if (progress < 33) return 'EARLY';
  if (progress < 66) return 'MID';
  return 'LATE';
}

// ─── Priority fee (FIXED) ─────────────────────────────────────────────────────
//
// The root cause of "always 0":
//   connection.getRecentPrioritizationFees() with NO arguments returns a
//   global average where most slots show 0 because not all txs pay priority fees.
//
// The FIX:
//   Pass the pump.fun PROGRAM ID as the lockedWritableAccounts filter.
//   This returns fees specifically from recent pump.fun transactions — which
//   actually pay priority fees — giving a real, non-zero result.
//
// Source: https://solana.com/docs/rpc/http/getrecentprioritizationfees
//   "If this parameter is provided, the response will reflect a fee to land
//    a transaction locking all of the provided accounts as writable."
// Source: https://www.helius.dev/docs/rpc/guides/getrecentprioritizationfees
//   "A value of 0 often means no transactions in that slot paid an additional
//    priority fee for the given accounts."

async function getPumpPriorityFee(): Promise<{ avgPriorityFee: number; congestionLevel: 'LOW' | 'MEDIUM' | 'HIGH' }> {
  try {
    // Pass pump.fun program as the account filter — this scopes the fee
    // data to transactions that interact with pump.fun specifically.
    const fees = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: [PUMP_PROGRAM_ID],
    });

    if (!fees || fees.length === 0) {
      return { avgPriorityFee: 5000, congestionLevel: 'LOW' };
    }

    // Filter out zero-fee slots — those are slots where no one paid a priority
    // fee, not slots where the fee was actually 0. Including them drags the
    // average down to near-zero which is misleading.
    const nonZeroFees = fees.filter(f => f.prioritizationFee > 0);

    if (nonZeroFees.length === 0) {
      // All slots had zero fees — network is genuinely uncongested right now
      return { avgPriorityFee: 0, congestionLevel: 'LOW' };
    }

    // Use median of non-zero fees (more robust than mean — avoids outlier spikes)
    const sorted = nonZeroFees.map(f => f.prioritizationFee).sort((a, b) => a - b);
    const mid    = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];

    // Thresholds (microLamports per CU):
    //   LOW    < 10,000    → routine traffic, cheap txs
    //   MEDIUM 10k–100k   → moderate congestion
    //   HIGH   > 100,000  → heavy congestion, txs may fail without high fees
    const congestionLevel: 'LOW' | 'MEDIUM' | 'HIGH' =
      median > 100_000 ? 'HIGH' : median > 10_000 ? 'MEDIUM' : 'LOW';

    return { avgPriorityFee: median, congestionLevel };
  } catch {
    return { avgPriorityFee: 5000, congestionLevel: 'LOW' };
  }
}

// ─── Velocity (FIXED) ─────────────────────────────────────────────────────────
//
// The root cause of "always 100":
//   limit: 50 means you fetch at most 50 signatures. If a token has ≥50 total
//   txs, you always get 50 back. All 50 happened in the last 30 minutes on a
//   fresh token → recentTx = 50 → txPerHour = 50 × 2 = 100. Always.
//
// The FIX:
//   Fetch up to 1000 signatures (the RPC maximum in a single call).
//   Then accurately count how many fall within the last 30 minutes.
//   This gives a real rate, not a capped rate.
//
//   Also: if a token is brand new (<30 min old), we extrapolate correctly
//   from the actual age rather than always assuming a 30-min window.

async function getVelocity(curveAddr: PublicKey): Promise<{ recentTxCount: number; txPerHour: number }> {
  try {
    // Fetch up to 1000 sigs (RPC max per call). For brand-new tokens this
    // covers the full history. For older tokens, the 30-min window will be
    // well within the first 1000 txs since pump.fun tokens move fast.
    const sigs = await connection.getSignaturesForAddress(curveAddr, { limit: 1000 });

    if (!sigs || sigs.length === 0) {
      return { recentTxCount: 0, txPerHour: 0 };
    }

    const nowSec      = Math.floor(Date.now() / 1000);
    const window30min = nowSec - 1800; // 30 minutes ago in unix seconds

    const recentSigs = sigs.filter(s => (s.blockTime ?? 0) > window30min);
    const recentTx   = recentSigs.length;

    // Determine the actual observed window to avoid inflating the rate on
    // fresh tokens. If the oldest tx in the 30-min window is only 5 minutes
    // old, extrapolating × 2 would over-count.
    let txPerHour: number;

    if (recentTx === 0) {
      txPerHour = 0;
    } else {
      // Find oldest blockTime in the recent window
      const oldestRecent = recentSigs
        .filter(s => s.blockTime)
        .reduce((min, s) => Math.min(min, s.blockTime!), nowSec);

      const actualWindowSec = Math.max(nowSec - oldestRecent, 60); // at least 1 min
      const observedMinutes = actualWindowSec / 60;

      // Extrapolate to per-hour based on actual observed window
      txPerHour = Math.round((recentTx / observedMinutes) * 60);
    }

    return { recentTxCount: recentTx, txPerHour };
  } catch {
    return { recentTxCount: 0, txPerHour: 0 };
  }
}

// ─── Main analysis ────────────────────────────────────────────────────────────

export async function analyzeLaunch(mintStr: string): Promise<LaunchAnalysis> {
  const mint       = new PublicKey(mintStr);
  const curveState = await fetchBondingCurve(mint);

  if (!curveState) {
    return {
      isPumpToken: false,
      bondingCurve: {} as any,
      simulations: [],
      curveAnalytics: { explosionRatio: 0, liquidityDepth: 0 },
      velocity:       { recentTxCount: 0, txPerHour: 0 },
      holders:        { totalHolders: 0, top10Percent: 0, whaleDominance: 0, concentrationScore: 0, topHolders: [] },
      congestion:     { avgPriorityFee: 0, congestionLevel: 'LOW' },
      alphaScore:     0,
      timestamp:      Date.now(),
    } as LaunchAnalysis;
  }

  // ── Progress (bigint-safe formula) ──────────────────────────────────────────
  const progressRaw =
    curveState.realTokenReserves >= INITIAL_REAL_TOKEN_RESERVES
      ? 0
      : 1 - Number(curveState.realTokenReserves * 10000n / INITIAL_REAL_TOKEN_RESERVES) / 10000;

  const progress = progressRaw * 100; // 0.00 – 100.00
  const phase    = getCurvePhase(progress);

  // ── Price and market cap ────────────────────────────────────────────────────
  const currentPriceSol =
    (Number(curveState.virtualSolReserves) / LAMPORTS_PER_SOL) /
    (Number(curveState.virtualTokenReserves) / 10 ** TOKEN_DECIMALS);

  const mcapSol = (Number(TOTAL_SUPPLY) / 10 ** TOKEN_DECIMALS) * currentPriceSol;

  // ── Buy simulations ─────────────────────────────────────────────────────────
  const simAmounts  = [0.1, 0.5, 1.0].map(s => BigInt(Math.floor(s * LAMPORTS_PER_SOL)));
  const simulations = simAmounts.map(amt => decodeBuySimulation(curveState, amt));

  // ── Curve analytics ─────────────────────────────────────────────────────────
  // Explosion ratio: remaining upside multiple from current progress to 100%.
  // Example: at 10% progress, ratio = (100-10)/10 = 9x remaining potential.
  const explosionRatio =
    progress > 0.5
      ? Math.min(500, Math.round((100 - progress) / progress))
      : 100; // brand new token — cap at 100x as a conservative default

  const liquidityDepth = Number(curveState.realSolReserves) / LAMPORTS_PER_SOL;

  const curveAddr = getBondingCurvePda(mint);

  // ── Fetch velocity, holders, congestion in parallel ─────────────────────────
  const [velocityData, congestionData, largestAccounts] = await Promise.all([
    getVelocity(curveAddr),
    getPumpPriorityFee(),
    connection.getTokenLargestAccounts(mint),
  ]);

  const { recentTxCount, txPerHour } = velocityData;
  const { avgPriorityFee, congestionLevel } = congestionData;

  // ── Holders ─────────────────────────────────────────────────────────────────
  // getTokenLargestAccounts returns at most 20 accounts. We exclude the
  // bonding curve's own ATA (which holds unsold supply — not a real holder).
  const associatedBondingCurve = getAssociatedBondingCurve(mint, curveAddr);
  const assocBCStr             = associatedBondingCurve.toBase58();

  const totalSupplyHuman = Number(TOTAL_SUPPLY) / 10 ** TOKEN_DECIMALS;

  const holders: Holder[] = largestAccounts.value
    .filter(acc => acc.address.toBase58() !== assocBCStr)
    .map(acc => ({
      address: acc.address.toBase58(),
      balance: acc.amount.toString(),
      // uiAmount is already decimal-adjusted (e.g. 1500000.5)
      percent: ((acc.uiAmount ?? 0) / totalSupplyHuman) * 100,
    }))
    .sort((a, b) => Number(b.balance) - Number(a.balance))
    .slice(0, 20);

  // NOTE: getTokenLargestAccounts only ever returns top 20 accounts.
  // This is a Solana RPC limitation — we cannot get the true total holder
  // count without an indexer. We label this honestly in the UI.
  const topHoldersShown = holders.length;

  // top10Percent: sum of percent fields already computed correctly from uiAmount above
  const top10Percent = holders.slice(0, 10).reduce((s, h) => s + h.percent, 0);

  // Whale dominance = single biggest holder's % (most meaningful rug signal)
  const whaleDominance = holders.length > 0 ? holders[0].percent : 0;

  // Concentration score: 100 = perfectly even, 0 = one wallet holds everything
  const concentrationScore = Math.max(0, Math.min(100, Math.round(100 - top10Percent)));

  // ── Alpha Score (fixed — was always near 100) ────────────────────────────────
  //
  // Old bug: base started at 40, and the component math could easily push it
  // to 100+ on almost any token. Fixed below with proper 0-base and hard caps.
  //
  // Component caps (total = 100):
  //   Velocity     0–25  pts  (200 tx/hr = max 25)
  //   Distribution 0–30  pts  (top10% hold = 0% → 30pts, = 100% → 0pts)
  //   Whale risk   0–20  pts  (biggest holder = 0% → 20pts, ≥ 50% → 0pts)
  //   Liquidity    0–15  pts  (10 SOL real locked = max 15)
  //   Congestion   0–10  pts  (LOW=10, MEDIUM=5, HIGH=0)
  //
  // A dead token with 0 velocity, 80% whale, and high congestion → ~8 pts
  // A healthy token with 300 tx/hr, distributed holders, 8 SOL locked → ~85 pts

  let score = 0;

  // Velocity: 200 tx/hr → full 25 pts
  score += Math.min(25, (txPerHour / 200) * 25);

  // Distribution: lower top-10 concentration = better
  score += Math.max(0, (1 - top10Percent / 100) * 30);

  // Whale risk: biggest holder ≥ 50% = 0 pts, = 0% = 20 pts
  score += Math.max(0, Math.min(20, (1 - whaleDominance / 50) * 20));

  // Liquidity: 10 SOL real locked = max 15 pts
  score += Math.min(15, (liquidityDepth / 10) * 15);

  // Congestion: LOW = easier to snipe, HIGH = expensive/competitive
  score += congestionLevel === 'LOW' ? 10 : congestionLevel === 'MEDIUM' ? 5 : 0;

  score = Math.max(0, Math.min(100, Math.round(score)));

  // ── Serialize bigints to strings for JSON ───────────────────────────────────
  const safeState = {
    virtualTokenReserves: curveState.virtualTokenReserves.toString(),
    virtualSolReserves:   curveState.virtualSolReserves.toString(),
    realTokenReserves:    curveState.realTokenReserves.toString(),
    realSolReserves:      curveState.realSolReserves.toString(),
    tokenTotalSupply:     curveState.tokenTotalSupply.toString(),
    complete:             curveState.complete,
  };

  return {
    isPumpToken: true,
    bondingCurve: {
      address:          curveAddr.toBase58(),
      state:            safeState as unknown as BondingCurveState,
      progressPercent:  Math.round(progress * 100) / 100,
      phase,
      currentPriceSol,
      mcapSol:          Math.round(mcapSol * 100) / 100,
      liquidityDepthSol: liquidityDepth,
    },
    simulations,
    curveAnalytics: { explosionRatio, liquidityDepth },
    velocity:       { recentTxCount, txPerHour },
    holders: {
      totalHolders:       topHoldersShown, // honest: top 20 max from RPC
      top10Percent:       Math.round(top10Percent * 10) / 10,
      whaleDominance:     Math.round(whaleDominance * 10) / 10,
      concentrationScore: concentrationScore,
      topHolders:         holders,
    },
    congestion: { avgPriorityFee, congestionLevel },
    alphaScore: score,
    timestamp:  Date.now(),
  };
}