export interface BondingCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

export interface BuySimulation {
  solAmount: number;
  tokensOut: string; // bigint string
  priceBefore: number; // SOL per token
  priceAfter: number;
  priceImpact: number; // %
  newVirtualSol: string;
  newVirtualToken: string;
}

export interface Holder {
  address: string;
  balance: string; // bigint string
  percent: number;
}

export interface LaunchAnalysis {
  isPumpToken: boolean;
  bondingCurve: {
    address: string;
    state: BondingCurveState;
    progressPercent: number;
    phase: 'EARLY' | 'MID' | 'LATE';
    currentPriceSol: number;
    mcapSol: number;
    liquidityDepthSol: number; // realSolReserves
  };
  simulations: BuySimulation[];
  curveAnalytics: {
    explosionRatio: number; // potential upside to graduation
    liquidityDepth: number;
  };
  velocity: {
    recentTxCount: number; // last 30 min
    txPerHour: number;
  };
  holders: {
    totalHolders: number;
    top10Percent: number;
    whaleDominance: number; // % held by top 5 holders
    concentrationScore: number; // 0-100 (lower = better distributed)
    topHolders: Holder[];
  };
  congestion: {
    avgPriorityFee: number; // microLamports
    congestionLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  alphaScore: number; // 0-100
  timestamp: number;
}