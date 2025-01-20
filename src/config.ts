
import { Connection } from "@solana/web3.js";

// Bot Config
export const BOT_NAME = "copytradingbotsample20250107_bot";
export const BOT_ID = "copytradingbotsample20250107_bot";
export const BOT_TOKEN = '8191922694:AAHGTRvh7yeVEztm_k7R5TzpNH3f90GpWUk';

// MONGODB Config
export const MONGO_URI = `mongodb://127.0.0.1:27017/${BOT_NAME}`;

// Solana Config
export const SOLANA_RPC_ENDPOINT = 'https://wispy-shy-crater.solana-mainnet.quiknode.pro/4d3746b1286f90794017693f9eee937f46abaaaf';
export const SOLANA_WSS_ENDPOINT = 'wss://evocative-dry-daylight.solana-mainnet.quiknode.pro/10a7953b98a40e76ccd94b6e1101857fe307a1b7';

export const CONNECTION = new Connection(SOLANA_RPC_ENDPOINT);

// Setting Config
export const JITO_TIP = 0.001;
export const MAX_BUY = 1;
export const MIN_LP = 60;
export const TP = 5;
export const SL = 90;
export const AUTO_SELL = 50;

export const ALERT_CHATID = 6909840347;

export const privated = false;
export const ALLOWED = [
    6909840347, // ME
];
