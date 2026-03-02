import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';

dotenv.config();

export const QUICKNODE_RPC = process.env.QUICKNODE_RPC!;
if (!QUICKNODE_RPC) throw new Error('QUICKNODE_RPC not set in .env');

export const connection = new Connection(QUICKNODE_RPC, 'confirmed');

export const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const TOKEN_DECIMALS = 6;
export const TOTAL_SUPPLY = 1_000_000_000n * 10n ** BigInt(TOKEN_DECIMALS);
export const INITIAL_REAL_TOKEN_RESERVES = 793_100_000n * 10n ** BigInt(TOKEN_DECIMALS);

export const BONDING_CURVE_DISCRIMINATOR = Buffer.from([0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]);