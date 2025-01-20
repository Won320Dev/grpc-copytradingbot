import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { CONNECTION } from "./config";
import { createWallet, getTokenAccount, getWalletTokenAccount, jupiter_swap, sleep, WSOL_ADDRESS } from "./solana"
import { User } from "./models/User";
import { CopyOrder } from "./models/CopyOrder";
import * as mongodb from './db';
import * as SolanaLib from './solana';
import WebSocket from "ws";
import { WS } from "./copytrade";
import * as Config from './config';
import bs58 from 'bs58';
// const test = async () => {

//     await mongodb.connect();
//     const copyOrder = await CopyOrder.findOne({ chatId: 7286035328 });


//     const tokenAddress = "HofiJ9z9S6C5aKc1XWdxQGuAzvHNiZcgMZEkDSHNpump";
//     const tokenBalance = 54757400799;


//     while (true) {

//         const quoteResponse = await (
//             await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${tokenAddress}&outputMint=${WSOL_ADDRESS}&amount=${tokenBalance}&slippageBps=50`
//             )
//         ).json();

//         const outSOlAmount = quoteResponse.outAmount;

//         console.log('outSolAmount = ', outSOlAmount / LAMPORTS_PER_SOL);

//         if (outSOlAmount > 0.1 * LAMPORTS_PER_SOL) {
//             const result = await jupiter_swap(CONNECTION, (copyOrder!.myWallet as any).privateKey, tokenAddress, WSOL_ADDRESS, tokenBalance, "ExactIn", 0.0015 * LAMPORTS_PER_SOL);
//             if (result.success) {
//                 console.log('Sell sucess');
//                 break;
//             }
//         }

//         await sleep(1000);
//     }

// }

export const getSwapInfo = async (data: any) => {
    try {
        const tx = data.params.result.transaction;
        const instructions = tx.transaction.message.instructions;
        const innerinstructions = tx.meta.innerInstructions;
        const accountKeys = tx?.transaction.message.accountKeys.map((ak: any) => ak.pubkey);
        const signer = accountKeys[0].toString();
        const logs = tx.meta.logMessages;
        let isSwap;
        let dex;
        let tokenAddress;
        let solAmount;
        let tokenAmount;
        let type;

        for (let i = 0; i < logs!.length; i++) {
            if (logs![i].includes('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 invoke')) { // Jupiter
                isSwap = true;
                dex = 'jupiter';
                for (let i = 0; i < instructions.length; i++) {
                    if (instructions[i].programId == "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4") {
                        console.log('index = ', i);
                        for (let j = 0; j < innerinstructions!.length; j++) {
                            if (innerinstructions![j].index === i) {
                                const length = innerinstructions![j].instructions.length;
                                let sendToken;
                                let sendAmount;
                                let receiveToken;
                                let receiveAmount;
                                for (let i = 0; i < length; i++) {
                                    if ((innerinstructions![j].instructions[i] as any).programId == 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
                                        if ((innerinstructions![j].instructions[i] as any).parsed.type == "transferChecked") {
                                            const data = await SolanaLib.getTokenAddressAndOwnerFromTokenAccount(Config.CONNECTION, (innerinstructions![j].instructions[i] as any).parsed.info.destination);
                                            // console.log('accountData = ', data);
                                            if (data && data.ownerAddress != "45ruCyfdRkWpRNGEqWzjCiXRHkZs8WXCLQ67Pnpye7Hp") { // Jutpiter Partner Referral Fee Vault
                                                sendToken = data.tokenAddress;
                                                sendAmount = (innerinstructions![j].instructions[i] as any).parsed.info.tokenAmount.amount;
                                                break;
                                            }
                                        }

                                        if ((innerinstructions![j].instructions[i] as any).parsed.type == "transfer") {
                                            const data = await SolanaLib.getTokenAddressAndOwnerFromTokenAccount(Config.CONNECTION, (innerinstructions![j].instructions[i] as any).parsed.info.destination);
                                            // console.log('accountData = ', data);
                                            if (data && data.ownerAddress != "45ruCyfdRkWpRNGEqWzjCiXRHkZs8WXCLQ67Pnpye7Hp") {
                                                sendToken = data.tokenAddress;
                                                sendAmount = (innerinstructions![j].instructions[i] as any).parsed.info.amount;
                                                break;
                                            }
                                        }
                                    }
                                }

                                console.log('tokenAddress = ', sendToken);
                                console.log('tokenAmount: ', sendAmount);

                                for (let i = length - 1; i >= 0; i--) {
                                    if ((innerinstructions![j].instructions[i] as any).programId == 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
                                        if ((innerinstructions![j].instructions[i] as any).parsed.type == "transferChecked") {
                                            const data = await SolanaLib.getTokenAddressAndOwnerFromTokenAccount(Config.CONNECTION, (innerinstructions![j].instructions[i] as any).parsed.info.source);
                                            // console.log('accountData = ', data);
                                            if (data) {
                                                receiveToken = data?.tokenAddress;
                                                receiveAmount = (innerinstructions![j].instructions[i] as any).parsed.info.tokenAmount.amount;
                                                break;
                                            }
                                        }

                                        if ((innerinstructions![j].instructions[i] as any).parsed.type == "transfer") {
                                            const data = await SolanaLib.getTokenAddressAndOwnerFromTokenAccount(Config.CONNECTION, (innerinstructions![j].instructions[i] as any).parsed.info.source);
                                            // console.log('accountData = ', data);
                                            if (data) {
                                                receiveToken = data.tokenAddress;
                                                receiveAmount = (innerinstructions![j].instructions[i] as any).parsed.info.amount;
                                                break;
                                            }
                                        }
                                    }
                                }

                                console.log('receiveToken = ', receiveToken);
                                console.log('receiveAmount = ', receiveAmount);

                                if (sendToken == 'So11111111111111111111111111111111111111112') {
                                    type = "buy";
                                    tokenAddress = receiveToken;
                                    solAmount = Number(sendAmount);
                                    tokenAmount = Number(receiveAmount);
                                } else if (receiveToken == 'So11111111111111111111111111111111111111112') {
                                    type = "sell";
                                    tokenAddress = sendToken;
                                    solAmount = Number(receiveAmount);
                                    tokenAmount = Number(sendAmount);
                                }
                                return { isSwap, dex, type, tokenAddress, solAmount, tokenAmount, signer };
                            }
                        }
                    }
                }
            } else if (logs![i].includes('Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 invoke')) { // only raydium
                isSwap = true;
                dex = 'raydium';
                // check instructions of raydium swap
                for (let i = 0; i < instructions.length; i++) {
                    if (instructions[i].programId == "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8") {
                        for (let j = 0; j < innerinstructions!.length; j++) {
                            if (innerinstructions![j].index === i) {

                                const [sendData, receiveData] = await Promise.all([
                                    SolanaLib.getTokenAddressAndOwnerFromTokenAccount(Config.CONNECTION, (innerinstructions![j].instructions[0] as any).parsed.info.destination),
                                    SolanaLib.getTokenAddressAndOwnerFromTokenAccount(Config.CONNECTION, (innerinstructions![j].instructions[1] as any).parsed.info.source)
                                ]);

                                const sendToken = sendData?.tokenAddress;
                                const receiveToken = receiveData?.tokenAddress;

                                const sendAmount = (innerinstructions![j].instructions[0] as any).parsed.info.amount;
                                const receiveAmount = (innerinstructions![j].instructions[1] as any).parsed.info.amount;

                                if (sendToken == 'So11111111111111111111111111111111111111112') {
                                    type = "buy";
                                    tokenAddress = receiveToken;
                                    solAmount = Number(sendAmount);
                                    tokenAmount = Number(receiveAmount);
                                } else if (receiveToken == 'So11111111111111111111111111111111111111112') {
                                    type = "sell";
                                    tokenAddress = sendToken;
                                    solAmount = Number(receiveAmount);
                                    tokenAmount = Number(sendAmount);
                                }
                                return { isSwap, dex, type, tokenAddress, solAmount, tokenAmount, signer };
                            }
                        }
                    }
                }

                // check inner instructions of raydium swap
                for (let i = 0; i < innerinstructions!.length; i++) {
                    const instructions = innerinstructions![i].instructions;
                    for (let j = 0; j < instructions.length; j++) {
                        if (instructions[j].programId == '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8') {
                            const [sendData, receiveData] = await Promise.all([
                                SolanaLib.getTokenAddressAndOwnerFromTokenAccount(Config.CONNECTION, (instructions[j + 1] as any).parsed.info.destination),
                                SolanaLib.getTokenAddressAndOwnerFromTokenAccount(Config.CONNECTION, (instructions[j + 2] as any).parsed.info.source)
                            ])

                            const sendToken = sendData?.tokenAddress;
                            const receiveToken = receiveData?.tokenAddress;

                            const sendAmount = (instructions[j + 1] as any).parsed.info.amount;
                            const receiveAmount = (instructions[j + 2] as any).parsed.info.amount;
                            if (sendToken == 'So11111111111111111111111111111111111111112') {
                                type = "buy";
                                tokenAddress = receiveToken;
                                solAmount = Number(sendAmount);
                                tokenAmount = Number(receiveAmount);
                            } else if (receiveToken == 'So11111111111111111111111111111111111111112') {
                                type = "sell";
                                tokenAddress = sendToken;
                                solAmount = Number(receiveAmount);
                                tokenAmount = Number(sendAmount);
                            }
                            return { isSwap, dex, type, tokenAddress, solAmount, tokenAmount, signer };
                        }
                    }
                }
            } else if (logs![i].includes('Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke')) {// pumpfun swap
                isSwap = true;
                dex = 'pumpfun';
                if (logs![i + 1] == 'Program log: Instruction: Sell') {
                    type = 'sell';
                    // check instructions
                    for (let i = 0; i < instructions.length; i++) {
                        if (instructions[i].programId == "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P") {
                            for (let j = 0; j < innerinstructions!.length; j++) {
                                if (innerinstructions![j].index === i) {
                                    const accountData = await SolanaLib.getTokenAddressAndOwnerFromTokenAccount(Config.CONNECTION, (innerinstructions![j].instructions[0] as any).parsed.info.destination);
                                    const tokenAddress = accountData?.tokenAddress;
                                    const tokenAmount = Number((innerinstructions![j].instructions[0] as any).parsed.info.amount);
                                    const data = (innerinstructions![j].instructions[1] as any).data;
                                    const bytedata = bs58.decode(data) as any;
                                    const hexString = bytedata.toString("hex");
                                    const solAmountBytes = hexString.substring(48 * 2, 56 * 2);
                                    const reversedSolAmountBytes = solAmountBytes.match(/.{1,2}/g)!.reverse().join("");
                                    const solAmount = Number("0x" + reversedSolAmountBytes);
                                    return { isSwap, dex, type, tokenAddress, solAmount, tokenAmount, signer };
                                }
                            }
                        }
                    }

                    // check inner instructions
                    for (let i = 0; i < innerinstructions!.length; i++) {
                        const instructions = innerinstructions![i].instructions;
                        for (let j = 0; j < instructions.length; j++) {
                            if (instructions[j].programId == '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') {
                                const accountData = await SolanaLib.getTokenAddressAndOwnerFromTokenAccount(Config.CONNECTION, (instructions[j + 1] as any).parsed.info.destination);
                                const tokenAddress = accountData?.tokenAddress;
                                const tokenAmount = Number((instructions[j + 1] as any).parsed.info.amount);
                                const data = (instructions[j + 2] as any).data;
                                const bytedata = bs58.decode(data) as any;
                                const hexString = bytedata.toString("hex");
                                const solAmountBytes = hexString.substring(48 * 2, 56 * 2);
                                const reversedSolAmountBytes = solAmountBytes.match(/.{1,2}/g)!.reverse().join("");
                                const solAmount = Number("0x" + reversedSolAmountBytes);
                                return { isSwap, dex, type, tokenAddress, solAmount, tokenAmount, signer };
                            }
                        }
                    }
                } else if (logs![i + 1] == 'Program log: Instruction: Buy') {
                    type = 'buy';
                    // check instructions
                    for (let i = 0; i < instructions.length; i++) {
                        if (instructions[i].programId == "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P") {
                            for (let j = 0; j < innerinstructions!.length; j++) {
                                if (innerinstructions![j].index === i) {
                                    const tokenAmount = Number((innerinstructions![j].instructions[0] as any).parsed.info.amount);
                                    const accountData = await SolanaLib.getTokenAddressAndOwnerFromTokenAccount(Config.CONNECTION, (innerinstructions![j].instructions[0] as any).parsed.info.source);
                                    const tokenAddress = accountData?.tokenAddress;
                                    const solAmount = Number((innerinstructions![j].instructions[1] as any).parsed.info.lamports);
                                    return { isSwap, dex, type, tokenAddress, solAmount, tokenAmount, signer };
                                }
                            }
                        }
                    }

                    // check inner instructions
                    for (let i = 0; i < innerinstructions!.length; i++) {
                        const instructions = innerinstructions![i].instructions;
                        for (let j = 0; j < instructions.length; j++) {
                            if (instructions[j].programId == '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') {
                                const tokenAmount = Number((instructions[j + 1] as any).parsed.info.amount);
                                const accountData = await SolanaLib.getTokenAddressAndOwnerFromTokenAccount(Config.CONNECTION, (instructions[j + 1] as any).parsed.info.source);
                                const tokenAddress = accountData?.tokenAddress;
                                const solAmount = Number((instructions[j + 2] as any).parsed.info.lamports);
                                return { isSwap, dex, type, tokenAddress, solAmount, tokenAmount, signer };
                            }
                        }
                    }
                }
            }
        }
        return null;
    } catch (error) {
        console.error('getSwapInfo error', error);
        return null;
    }
}

function startPing(ws: WebSocket) {
    setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
            // console.log('Ping sent');
        }
    }, 30000);
}

const test = (ws: WebSocket) => {
    ws.on('open', async function open() {
        console.log('WebSocket is open');
        const targetWallets: any = [];
        // Generate random 200 of target wallets
        for (let i = 0; i < 200; i++) {
            const { publicKey, privateKey } = createWallet();
            targetWallets.push(publicKey);
        }
        // Add more one target wallet to trade really for testing
        targetWallets.push("hnu5iBK8UoHb51UFsH1RYTUAYdrhjHvV5YMTf9T1CYN");

        const request = {
            jsonrpc: "2.0",
            id: 'multi wallet track',
            method: "transactionSubscribe",
            params: [
                {
                    failed: false,
                    accountInclude: targetWallets
                },
                {
                    commitment: "processed",
                    encoding: "jsonParsed",
                    transactionDetails: "full",
                    maxSupportedTransactionVersion: 0
                }
            ]
        };
        ws.send(JSON.stringify(request));
        startPing(ws);
    });

    ws.on('message', async function incoming(data) {
        const messageStr = data.toString('utf8');
        try {
            const messageObj = JSON.parse(messageStr);

            if (messageObj.method == "transactionNotification") {

                const subscriptionId = messageObj.params.subscription;
                const signature = messageObj.params.result.signature;
                console.log('signature = ', signature);
                const targetSwapInfo = await getSwapInfo(messageObj);

                if (targetSwapInfo
                    && targetSwapInfo.isSwap
                    && targetSwapInfo.dex != "pumpfun"
                    && targetSwapInfo.signer
                    && targetSwapInfo.solAmount
                    && targetSwapInfo.tokenAddress
                    && targetSwapInfo.tokenAmount
                    && targetSwapInfo.type
                ) {
                    console.log('Target buy New token', targetSwapInfo);
                }
            }
        } catch (e) {
            console.error('WebSocket message handle error :', e);
        }
    });

    ws.on('error', function error(err) {
        return;
    });

    ws.on('close', function close() {
        console.log('WebSocket is closed');
    });
}

test(WS);