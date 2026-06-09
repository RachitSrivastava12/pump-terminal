"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BONDING_CURVE_DISCRIMINATOR = exports.INITIAL_REAL_TOKEN_RESERVES = exports.TOTAL_SUPPLY = exports.TOKEN_DECIMALS = exports.LAMPORTS_PER_SOL = exports.ASSOCIATED_TOKEN_PROGRAM_ID = exports.TOKEN_PROGRAM_ID = exports.PUMP_PROGRAM_ID = exports.connection = exports.QUICKNODE_RPC = void 0;
const web3_js_1 = require("@solana/web3.js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.QUICKNODE_RPC = process.env.QUICKNODE_RPC;
if (!exports.QUICKNODE_RPC)
    throw new Error('QUICKNODE_RPC not set in .env');
exports.connection = new web3_js_1.Connection(exports.QUICKNODE_RPC, 'confirmed');
exports.PUMP_PROGRAM_ID = new web3_js_1.PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
exports.TOKEN_PROGRAM_ID = new web3_js_1.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
exports.ASSOCIATED_TOKEN_PROGRAM_ID = new web3_js_1.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
exports.LAMPORTS_PER_SOL = 1_000_000_000;
exports.TOKEN_DECIMALS = 6;
exports.TOTAL_SUPPLY = 1000000000n * 10n ** BigInt(exports.TOKEN_DECIMALS);
exports.INITIAL_REAL_TOKEN_RESERVES = 793100000n * 10n ** BigInt(exports.TOKEN_DECIMALS);
exports.BONDING_CURVE_DISCRIMINATOR = Buffer.from([0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]);
