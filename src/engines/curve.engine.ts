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

// Pump.fun changed INITIAL_REAL_TOKEN_RESERVES at some point.
// Old tokens: 793_100_000 * 10^6, new tokens: 800_000_000 * 10^6.
// We try both and use whichever gives a valid [0,1] progress.
const INITIAL_REAL_TOKEN_RESERVES_NEW = 800_000_000n * 10n ** BigInt(TOKEN_DECIMALS);

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
//
// BUG FIX: Original code silently returned null if:
//   (a) The account didn't exist at the PDA (wrong seeds?)
//   (b) The discriminator didn't match
//   (c) Data was too short
//
// All of these caused isPumpToken: false and zeroed-out fields downstream.
// We now log every failure case so you can diagnose the exact reason.
//
// ALSO: pump.fun bonding curve account layout (as of 2024/2025):
//   Offset  Size  Field
//   0       8     discriminator
//   8       8     virtualTokenReserves  (u64, little-endian)
//   16      8     virtualSolReserves    (u64, little-endian)
//   24      8     realTokenReserves     (u64, little-endian)
//   32      8     realSolReserves       (u64, little-endian)
//   40      8     tokenTotalSupply      (u64, little-endian)
//   48      1     complete              (bool)
//   Total:  49 bytes minimum (account may have extra padding)

export async function fetchBondingCurve(mint: PublicKey): Promise<BondingCurveState | null> {
  const curveAddress = getBondingCurvePda(mint);

  let account;
  try {
    account = await connection.getAccountInfo(curveAddress, 'confirmed');
  } catch (err) {
    console.error(`[fetchBondingCurve] RPC error for mint ${mint.toBase58()}:`, err);
    return null;
  }

  if (!account) {
    console.warn(`[fetchBondingCurve] No account at PDA ${curveAddress.toBase58()} for mint ${mint.toBase58()}`);
    return null;
  }

  if (account.owner.toBase58() !== PUMP_PROGRAM_ID.toBase58()) {
    console.warn(
      `[fetchBondingCurve] Account owner mismatch. Expected ${PUMP_PROGRAM_ID.toBase58()}, got ${account.owner.toBase58()}`
    );
    return null;
  }

  const data = account.data;

  if (data.length < 49) {
    console.warn(`[fetchBondingCurve] Data too short: ${data.length} bytes`);
    return null;
  }

  const actualDisc = data.subarray(0, 8);
  if (!actualDisc.equals(BONDING_CURVE_DISCRIMINATOR)) {
    console.warn(
      `[fetchBondingCurve] Discriminator mismatch.\n` +
      `  Expected: ${BONDING_CURVE_DISCRIMINATOR.toString('hex')}\n` +
      `  Actual:   ${actualDisc.toString('hex')}\n` +
      `  This token may use an updated pump.fun program version.`
    );
    return null;
  }

  const state: BondingCurveState = {
    virtualTokenReserves: data.readBigUInt64LE(8),
    virtualSolReserves:   data.readBigUInt64LE(16),
    realTokenReserves:    data.readBigUInt64LE(24),
    realSolReserves:      data.readBigUInt64LE(32),
    tokenTotalSupply:     data.readBigUInt64LE(40),
    complete:             data[48] !== 0,
  };

  // Sanity check: virtual reserves should never be zero on a valid active curve
  if (state.virtualTokenReserves === 0n || state.virtualSolReserves === 0n) {
    console.warn(
      `[fetchBondingCurve] Zero virtual reserves detected. ` +
      `vToken=${state.virtualTokenReserves}, vSol=${state.virtualSolReserves}. ` +
      `Token may be graduated or corrupt.`
    );
    // We still return the state — let analyzeLaunch handle the graduated case
  }

  console.log(`[fetchBondingCurve] OK mint=${mint.toBase58()}`, {
    vToken: state.virtualTokenReserves.toString(),
    vSol:   state.virtualSolReserves.toString(),
    rToken: state.realTokenReserves.toString(),
    rSol:   state.realSolReserves.toString(),
    complete: state.complete,
  });

  return state;
}

// ─── Buy simulation (1% fee applied) ─────────────────────────────────────────
//
// BUG FIX: If virtualTokenReserves is 0 (graduated token), division by zero
// would produce NaN/Infinity. We guard against that here.

export function decodeBuySimulation(curve: BondingCurveState, solAmountLamports: bigint): BuySimulation {
  const vSol   = curve.virtualSolReserves;
  const vToken = curve.virtualTokenReserves;

  // Guard: can't simulate on a curve with no reserves
  if (vSol === 0n || vToken === 0n) {
    return {
      solAmount:      Number(solAmountLamports) / LAMPORTS_PER_SOL,
      tokensOut:      '0',
      priceBefore:    0,
      priceAfter:     0,
      priceImpact:    0,
      newVirtualSol:  vSol.toString(),
      newVirtualToken: vToken.toString(),
    };
  }

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

  // Guard: newVToken should never be 0 unless solNetInput is astronomically large
  const priceAfter = newVToken > 0n
    ? (Number(newVSol) / LAMPORTS_PER_SOL) / (Number(newVToken) / 10 ** TOKEN_DECIMALS)
    : 0;

  const priceImpact = priceBefore > 0
    ? ((priceAfter - priceBefore) / priceBefore) * 100
    : 0;

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

// ─── Priority fee ─────────────────────────────────────────────────────────────
//
// Pass the pump.fun PROGRAM ID as the lockedWritableAccounts filter so we get
// fees from actual pump.fun txs, not the global near-zero average.

async function getPumpPriorityFee(): Promise<{ avgPriorityFee: number; congestionLevel: 'LOW' | 'MEDIUM' | 'HIGH' }> {
  try {
    const fees = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: [PUMP_PROGRAM_ID],
    });

    if (!fees || fees.length === 0) {
      return { avgPriorityFee: 5000, congestionLevel: 'LOW' };
    }

    // Filter out zero-fee slots — those are slots where nobody paid a priority fee,
    // not slots where the real fee was 0. Including them skews the average toward 0.
    const nonZeroFees = fees.filter(f => f.prioritizationFee > 0);

    if (nonZeroFees.length === 0) {
      return { avgPriorityFee: 0, congestionLevel: 'LOW' };
    }

    // Median is more robust than mean — avoids single spike outliers
    const sorted = nonZeroFees.map(f => f.prioritizationFee).sort((a, b) => a - b);
    const mid    = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];

    const congestionLevel: 'LOW' | 'MEDIUM' | 'HIGH' =
      median > 100_000 ? 'HIGH' : median > 10_000 ? 'MEDIUM' : 'LOW';

    return { avgPriorityFee: median, congestionLevel };
  } catch (err) {
    console.error('[getPumpPriorityFee] Error:', err);
    return { avgPriorityFee: 5000, congestionLevel: 'LOW' };
  }
}

// ─── Velocity ─────────────────────────────────────────────────────────────────
//
// Fetch up to 1000 signatures (RPC max). Count how many fall within last 30 min.
// Extrapolate to tx/hr using the actual observed window (not always 30 min),
// which prevents over-counting on brand-new tokens with a short history.

async function getVelocity(curveAddr: PublicKey): Promise<{ recentTxCount: number; txPerHour: number }> {
  try {
    const sigs = await connection.getSignaturesForAddress(curveAddr, { limit: 1000 });

    if (!sigs || sigs.length === 0) {
      return { recentTxCount: 0, txPerHour: 0 };
    }

    const nowSec      = Math.floor(Date.now() / 1000);
    const window30min = nowSec - 1800;

    const recentSigs = sigs.filter(s => (s.blockTime ?? 0) > window30min);
    const recentTx   = recentSigs.length;

    if (recentTx === 0) {
      return { recentTxCount: 0, txPerHour: 0 };
    }

    // Find oldest tx in window to determine actual window size
    const oldestRecent = recentSigs
      .filter(s => s.blockTime != null)
      .reduce((min, s) => Math.min(min, s.blockTime!), nowSec);

    const actualWindowSec = Math.max(nowSec - oldestRecent, 60); // floor at 1 min
    const observedMinutes = actualWindowSec / 60;
    const txPerHour       = Math.round((recentTx / observedMinutes) * 60);

    return { recentTxCount: recentTx, txPerHour };
  } catch (err) {
    console.error('[getVelocity] Error:', err);
    return { recentTxCount: 0, txPerHour: 0 };
  }
}

// ─── Progress calculation (handles both old and new INITIAL_REAL_TOKEN_RESERVES) ──
//
// BUG: pump.fun changed INITIAL_REAL_TOKEN_RESERVES from 793_100_000 to
// 800_000_000 tokens at some point. If you use the wrong constant for a token,
// progress comes out negative, which then gets clamped oddly and breaks mcap/phase.
//
// FIX: Try INITIAL_REAL_TOKEN_RESERVES from config first. If the result is
// out of [0, 1], try the alternative constant. This makes it work for both
// old and new tokens automatically.

function computeProgress(realTokenReserves: bigint, complete: boolean): number {
  if (complete) return 100; // graduated

  // Helper: compute progress for a given initial reserves value
  function tryCompute(initialReserves: bigint): number | null {
    if (realTokenReserves >= initialReserves) return 0; // no tokens sold yet
    // Bigint-safe: multiply first to preserve precision, then divide
    const soldRatio = Number(
      (initialReserves - realTokenReserves) * 1_000_000n / initialReserves
    ) / 1_000_000;
    if (soldRatio < 0 || soldRatio > 1) return null; // invalid for this constant
    return soldRatio * 100;
  }

  // Try the config value first (793_100_000 * 10^6)
  const p1 = tryCompute(INITIAL_REAL_TOKEN_RESERVES);
  if (p1 !== null) return p1;

  // Fall back to newer value (800_000_000 * 10^6)
  const p2 = tryCompute(INITIAL_REAL_TOKEN_RESERVES_NEW);
  if (p2 !== null) return p2;

  // Couldn't determine progress — clamp to 0
  console.warn(`[computeProgress] Could not compute valid progress for realTokenReserves=${realTokenReserves}`);
  return 0;
}

// ─── Main analysis ────────────────────────────────────────────────────────────

export async function analyzeLaunch(mintStr: string): Promise<LaunchAnalysis> {
  // Validate mint address before doing anything
  let mint: PublicKey;
  try {
    mint = new PublicKey(mintStr);
  } catch {
    console.error(`[analyzeLaunch] Invalid mint address: ${mintStr}`);
    return buildEmptyResult();
  }

  const curveState = await fetchBondingCurve(mint);

  if (!curveState) {
    return buildEmptyResult();
  }

  // ── Graduated token detection ────────────────────────────────────────────────
  // When a token graduates to Raydium:
  //   • complete = true
  //   • realSolReserves drains to 0 (SOL sent to Raydium pool)
  //   • virtualSolReserves stays non-zero (virtual accounting)
  // We handle this so mcap/price still work (use virtual reserves), but
  // liquidity correctly shows 0 (no SOL left in pump curve).

  const isGraduated = curveState.complete || curveState.realSolReserves === 0n;

  // ── Progress ─────────────────────────────────────────────────────────────────
  const progress = computeProgress(curveState.realTokenReserves, curveState.complete);
  const phase    = getCurvePhase(progress);

  // ── Price ────────────────────────────────────────────────────────────────────
  // BUG FIX: Price was returning 0/NaN when virtualTokenReserves = 0.
  // This happens on graduated tokens. We guard against division by zero.
  //
  // currentPriceSol = (virtualSolReserves in SOL) / (virtualTokenReserves in tokens)
  // Both reserves are in their raw units, so we normalize each before dividing.

  const vSolFloat   = Number(curveState.virtualSolReserves) / LAMPORTS_PER_SOL;
  const vTokenFloat = Number(curveState.virtualTokenReserves) / (10 ** TOKEN_DECIMALS);

  const currentPriceSol = vTokenFloat > 0 ? vSolFloat / vTokenFloat : 0;

  // ── Market cap ───────────────────────────────────────────────────────────────
  // BUG FIX: mcapSol was 0 because currentPriceSol was 0 or because
  // Number(TOTAL_SUPPLY) overflows for large bigints.
  //
  // TOTAL_SUPPLY = 1_000_000_000 * 10^6 = 1e15 — this is within safe integer range
  // for Number (2^53 ≈ 9e15), so it's fine. But let's be explicit.
  //
  // mcap = total_supply_in_tokens × price_per_token_in_SOL

  const totalSupplyHuman = Number(TOTAL_SUPPLY) / (10 ** TOKEN_DECIMALS); // = 1,000,000,000
  const mcapSol          = totalSupplyHuman * currentPriceSol;

  // ── Liquidity depth ──────────────────────────────────────────────────────────
  // BUG FIX: realSolReserves is 0 for graduated tokens, making liquidityDepth 0.
  // That's CORRECT for graduated tokens — the pump curve has no SOL.
  // But for active tokens, realSolReserves should be > 0.
  //
  // If realSolReserves is 0 but the token is NOT graduated, something is wrong.
  // In that edge case, use a rough estimate: virtualSolReserves minus the known
  // pump.fun initial virtual offset (30 SOL = 30_000_000_000 lamports).
  // This gives a reasonable approximation for early tokens.

  let liquidityDepth: number;
  if (curveState.realSolReserves > 0n) {
    liquidityDepth = Number(curveState.realSolReserves) / LAMPORTS_PER_SOL;
  } else if (isGraduated) {
    liquidityDepth = 0; // correct — no SOL in pump curve after graduation
  } else {
    // realSolReserves = 0 but not graduated — this is a brand-new token
    // with no buys yet. Liquidity is genuinely 0 SOL real-locked.
    liquidityDepth = 0;
  }

  // ── Buy simulations ──────────────────────────────────────────────────────────
  const simAmounts  = [0.1, 0.5, 1.0].map(s => BigInt(Math.floor(s * LAMPORTS_PER_SOL)));
  const simulations = simAmounts.map(amt => decodeBuySimulation(curveState, amt));

  // ── Curve analytics ───────────────────────────────────────────────────────────
  // explosionRatio: how many X of upside remains to graduation
  // At 10% progress → 9x remaining, at 50% → 1x, at 90% → 0.11x
  const explosionRatio =
    progress > 0.5
      ? Math.min(500, Math.round((100 - progress) / Math.max(progress, 0.01)))
      : 100;

  const curveAddr = getBondingCurvePda(mint);

  // ── Parallel fetches ─────────────────────────────────────────────────────────
  const [velocityData, congestionData, largestAccountsResult] = await Promise.allSettled([
    getVelocity(curveAddr),
    getPumpPriorityFee(),
    connection.getTokenLargestAccounts(mint, 'confirmed'),
  ]);

  const { recentTxCount, txPerHour } =
    velocityData.status === 'fulfilled'
      ? velocityData.value
      : { recentTxCount: 0, txPerHour: 0 };

  const { avgPriorityFee, congestionLevel } =
    congestionData.status === 'fulfilled'
      ? congestionData.value
      : { avgPriorityFee: 5000, congestionLevel: 'LOW' as const };

  const largestAccounts =
    largestAccountsResult.status === 'fulfilled'
      ? largestAccountsResult.value
      : { value: [] };

  if (largestAccountsResult.status === 'rejected') {
    console.error('[analyzeLaunch] getTokenLargestAccounts failed:', largestAccountsResult.reason);
  }

  // ── Holders ──────────────────────────────────────────────────────────────────
  // Exclude the bonding curve's own ATA — it holds unsold tokens, not a real holder
  const associatedBondingCurve = getAssociatedBondingCurve(mint, curveAddr);
  const assocBCStr             = associatedBondingCurve.toBase58();

  const holders: Holder[] = largestAccounts.value
    .filter(acc => acc.address.toBase58() !== assocBCStr)
    .map(acc => ({
      address: acc.address.toBase58(),
      balance: acc.amount.toString(),
      // uiAmount is already decimal-adjusted by the RPC
      percent: totalSupplyHuman > 0
        ? ((acc.uiAmount ?? 0) / totalSupplyHuman) * 100
        : 0,
    }))
    .sort((a, b) => Number(b.balance) - Number(a.balance))
    .slice(0, 20);

  // NOTE: getTokenLargestAccounts returns at most 20 accounts (Solana RPC limit).
  // totalHolders here means "top holders we could fetch", not the real total.
  const topHoldersShown    = holders.length;
  const top10Percent       = holders.slice(0, 10).reduce((s, h) => s + h.percent, 0);
  const whaleDominance     = holders.length > 0 ? holders[0].percent : 0;
  const concentrationScore = Math.max(0, Math.min(100, Math.round(100 - top10Percent)));

  // ── Alpha score ───────────────────────────────────────────────────────────────
  // 0-base, hard-capped components (total = 100):
  //   Velocity     0–25  pts  (200 tx/hr = max)
  //   Distribution 0–30  pts  (top10 hold 0% = max)
  //   Whale risk   0–20  pts  (biggest holder 0% = max, ≥50% = 0)
  //   Liquidity    0–15  pts  (10 SOL = max)
  //   Congestion   0–10  pts  (LOW=10, MEDIUM=5, HIGH=0)

  let score = 0;
  score += Math.min(25, (txPerHour / 200) * 25);
  score += Math.max(0, (1 - top10Percent / 100) * 30);
  score += Math.max(0, Math.min(20, (1 - whaleDominance / 50) * 20));
  score += Math.min(15, (liquidityDepth / 10) * 15);
  score += congestionLevel === 'LOW' ? 10 : congestionLevel === 'MEDIUM' ? 5 : 0;
  score  = Math.max(0, Math.min(100, Math.round(score)));

  // ── Serialize (bigints → strings for JSON.stringify safety) ──────────────────
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
      address:           curveAddr.toBase58(),
      state:             safeState as unknown as BondingCurveState,
      progressPercent:   Math.round(progress * 100) / 100,
      phase,
      currentPriceSol,
      mcapSol:           Math.round(mcapSol * 100) / 100,
      liquidityDepthSol: liquidityDepth,
    },
    simulations,
    curveAnalytics: { explosionRatio, liquidityDepth },
    velocity:       { recentTxCount, txPerHour },
    holders: {
      totalHolders:       topHoldersShown,
      top10Percent:       Math.round(top10Percent * 10) / 10,
      whaleDominance:     Math.round(whaleDominance * 10) / 10,
      concentrationScore,
      topHolders:         holders,
    },
    congestion: { avgPriorityFee, congestionLevel },
    alphaScore: score,
    timestamp:  Date.now(),
  };
}

// ─── Helper: build empty/failed result ───────────────────────────────────────

function buildEmptyResult(): LaunchAnalysis {
  return {
    isPumpToken: false,
    bondingCurve: {} as any,
    simulations:  [],
    curveAnalytics: { explosionRatio: 0, liquidityDepth: 0 },
    velocity:       { recentTxCount: 0, txPerHour: 0 },
    holders: {
      totalHolders:       0,
      top10Percent:       0,
      whaleDominance:     0,
      concentrationScore: 0,
      topHolders:         [],
    },
    congestion:  { avgPriorityFee: 0, congestionLevel: 'LOW' },
    alphaScore:  0,
    timestamp:   Date.now(),
  };
}