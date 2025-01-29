import bs58 from 'bs58';
import WebSocket from "ws";
import { CopyOrder } from "./models/CopyOrder";
import * as SolanaLib from './solana';
import { SOLANA_WSS_ENDPOINT } from "./config";
import { bot, default_setting, getGlobalSetting, getUiOfSell, setSellSetting } from "./bot";
import * as Config from './config';
import { Position } from "./models/Position";
import { MyWallet } from "./models/MyWallet";
import { Setting } from "./models/Setting";
import { Trade } from "./models/Trade";
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

// import { API_URLS } from '@raydium-io/raydium-sdk-v4'



import Client, {
    CommitmentLevel,
    SubscribeRequestAccountsDataSlice,
    SubscribeRequestFilterAccounts,
    SubscribeRequestFilterBlocks,
    SubscribeRequestFilterBlocksMeta,
    SubscribeRequestFilterEntry,
    SubscribeRequestFilterSlots,
    SubscribeRequestFilterTransactions
  } from "@triton-one/yellowstone-grpc";
//   import { SubscribeRequestPing } from "@triton-one/yellowstone-grpc/dist/grpc/geyser";
  import { VersionedTransactionResponse } from "@solana/web3.js";
  import { SolanaParser } from "@shyft-to/solana-transaction-parser";
  import { TransactionFormatter } from "../grpc/utils/transaction-formatter";
  import { RaydiumAmmParser } from "../grpc/parsers/raydium-amm-parser";
  import { LogsParser } from "../grpc/parsers/logs-parser";
  import { bnLayoutFormatter } from "../grpc/utils/bn-layout-formatter";
  import * as base58 from "bs58";
  import {
    LIQUIDITY_STATE_LAYOUT_V4,
    struct,
    u64,
    u8
  } from "@raydium-io/raydium-sdk";
  import { tOutPut } from "../grpc/utils/transactionOutput";
  import { decodeTransact } from "../grpc/utils/decodeTransaction";
import { copyFileSync } from 'fs';
import path from 'path';
import fs from 'fs';
//   import { forEach } from "lodash";

  const Cnlog = console.log;
  const logToFile = (message: string) => {
    const logFilePath = path.join(__dirname, 'logs', 'copytrade.log');
    const logMessage = `${message}\n`;
    fs.appendFileSync(logFilePath, logMessage, 'utf8');
};
  
  interface SubscribeRequest {
    accounts: { [key: string]: SubscribeRequestFilterAccounts };
    slots: { [key: string]: SubscribeRequestFilterSlots };
    transactions: { [key: string]: SubscribeRequestFilterTransactions };
    transactionsStatus: { [key: string]: SubscribeRequestFilterTransactions };
    blocks: { [key: string]: SubscribeRequestFilterBlocks };
    blocksMeta: { [key: string]: SubscribeRequestFilterBlocksMeta };
    entry: { [key: string]: SubscribeRequestFilterEntry };
    commitment?: CommitmentLevel | undefined;
    accountsDataSlice: SubscribeRequestAccountsDataSlice[];
    // ping?: SubscribeRequestPing | undefined;
  }
  
  const RAYDIUM_PUBLIC_KEY = RaydiumAmmParser.PROGRAM_ID;
  const TXN_FORMATTER = new TransactionFormatter();
  const raydiumAmmParser = new RaydiumAmmParser();
  const IX_PARSER = new SolanaParser([]);
  IX_PARSER.addParser(
    RaydiumAmmParser.PROGRAM_ID,
    raydiumAmmParser.parseInstruction.bind(raydiumAmmParser)
  );
  const LOGS_PARSER = new LogsParser();
  
  let buy = false;
  interface TokenInfo {
    address: string;
    decimal: number;
    amount: number;
  }
  
  const LAYOUT = struct([u8("type"), u64("amount")]);
  
  function calculateSlippage(amount: number, minAmountOut: number): number {
    const slippage = ((amount - minAmountOut) * 100) / amount;
    return slippage;
  }

export let WS = new WebSocket(SOLANA_WSS_ENDPOINT);

function startPing(ws: WebSocket) {
    setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
            // console.log('Ping sent');
        }
    }, 30000);
}


const client = new Client(
    "http://grpc.solanavibestation.com:10000",
    "",
    {
      "grpc.max_receive_message_length": 256 * 1024 * 1024, // 64MiB
    }
  );
  
  const req: SubscribeRequest = {    
    accounts: {
      raydium: {
        account: [],
        // filters: [],
        filters: [
          {
            memcmp: {
              offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf("quoteMint").toString(), // Filter for only tokens paired with SOL
              base58: "So11111111111111111111111111111111111111112"
            }
          },
          {
            memcmp: {
              offset:
                LIQUIDITY_STATE_LAYOUT_V4.offsetOf("marketProgramId").toString(),
              base58: "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX"
            }
          },
          {
            memcmp: {
              offset:
                LIQUIDITY_STATE_LAYOUT_V4.offsetOf(
                  "swapQuoteInAmount"
                ).toString(),
              bytes: Uint8Array.from([0])
            }
          },
          {
            memcmp: {
              offset:
                LIQUIDITY_STATE_LAYOUT_V4.offsetOf(
                  "swapBaseOutAmount"
                ).toString(),
              bytes: Uint8Array.from([0])
            }
          }
        ],
        owner: ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"] // Raydium Liquidity Pool V4 address                
        // owner: ["6wobj2reg57xW6ZDG6AxuHDqHSzGnVa6wEHwjbQxmT9P"] // My wallet address
        // owner: [] // My wallet address
      }
    },    
    slots: {},
    transactions: {
      raydiumLiquidityPoolV4: {
        vote: false,
        failed: false,
        signature: undefined,
        // accountInclude: ["5hJ7jJxuPbwzoaSqpAj7iJita5Ufc9acFuR9VKEWVSGm"],        
        // accountInclude: ["6wobj2reg57xW6ZDG6AxuHDqHSzGnVa6wEHwjbQxmT9P"],        
        accountInclude: [RAYDIUM_PUBLIC_KEY.toBase58()],
        accountExclude: [],
        accountRequired: []
      }
    },
    transactionsStatus: {},
    entry: {},
    blocks: {},
    blocksMeta: {},
    accountsDataSlice: [],
    // ping: undefined,
    commitment: CommitmentLevel.PROCESSED
  };

async function handleStream(client: Client, args: SubscribeRequest, id: string) {
    // Subscribe for events
    const stream = await client.subscribe();
    let copyOrder = await CopyOrder.findById(id).populate('targetWallet').exec();
  
    // Create `error` / `end` handler
    const streamClosed = new Promise<void>((resolve, reject) => {
      stream.on("error", (error: any) => {
        console.log("ERROR", error);
        reject(error);
        stream.end();
      });
      stream.on("end", () => {
        resolve();
      });
      stream.on("close", () => {
        resolve();
        return;
      });
    });
  
    // let isFirstTransaction = true; // Flag to indicate if the transaction is the first one
    // Handle updates
    stream.on("data", async (data: any) => {
      // Cnlog("data===========", data);      
      logToFile(`data========== ${JSON.stringify(data)}`);
      if (data?.transaction) {
        // Cnlog("data.transaction===========", data.transaction);
        logToFile(`data.transation================== ${JSON.stringify(data.transaction)}`);
        const txn = TXN_FORMATTER.formTransactionFromJson(
          data.transaction,
          Date.now()
        );

        // Cnlog("txn signature===========", txn.transaction.signatures[0]);        
        logToFile(`txn signature================== ${JSON.stringify(txn.transaction.signatures[0])}`);

        const parsedTxn = decodeRaydiumTxn(txn);
      //@ts-ignore
      // Cnlog("parsedTxn===========", parsedTxn, parsedTxn?.instructions.length);
      logToFile(`parsedTxn================== ${JSON.stringify(parsedTxn)}, ${JSON.stringify(parsedTxn?.instructions.length)}`);
      
        if (parsedTxn?.instructions.length != 1) return;

        // if (isFirstTransaction) {

        const result = analyzeTx(
            data.transaction.transaction,
            parsedTxn?.instructions
          );

          // if ((result.postSol ?? 0) > 100)
        // console.log("analyzeTX result==========", result, txn.transaction.signatures[0]);        
        logToFile(`analyzeTX result================== ${JSON.stringify(result)}, ${JSON.stringify(txn.transaction.signatures[0])}`);
                    
        if (!result) return;

          const targetSwapInfo: { isSwap: boolean; dex?: string; tokenAddress?: string; tokenAmount?: number; solAmount?: number; 
            type?: string; signer?: string; postsol?: number; posttoken?: number; swapOwner?: string } = { isSwap: false };
          targetSwapInfo.isSwap = true;
          targetSwapInfo.dex = 'raydium';
          targetSwapInfo.tokenAddress = result.token;
          targetSwapInfo.solAmount = result.solAmount;
          targetSwapInfo.tokenAmount = result.tokenAmount;
          targetSwapInfo.type = result.isBuy? "buy" : "sell";
          targetSwapInfo.postsol = result.postSol;
          targetSwapInfo.posttoken = result.postToken;
          targetSwapInfo.signer = (copyOrder?.targetWallet as any).publicKey;
          targetSwapInfo.swapOwner = result.swapOwner;

          // if ((targetSwapInfo.postsol ?? 0) > 100)
            // Cnlog("targetSwapInfo===========", targetSwapInfo);       
          logToFile(`targetSwapInfo================== ${JSON.stringify(targetSwapInfo)}`);     
        
        if (targetSwapInfo
          && targetSwapInfo.isSwap
          && targetSwapInfo.dex != "pumpfun"
          && targetSwapInfo.signer
          && targetSwapInfo.solAmount
          && targetSwapInfo.tokenAddress
          && targetSwapInfo.tokenAmount
          && targetSwapInfo.type
        ) {
          // if ((targetSwapInfo.postsol ?? 0) > 100)
            handleSwap(id, targetSwapInfo);
        }
      }
    });
  
    // Send subscribe request
    await new Promise<void>((resolve, reject) => {
      stream.write(args, (err: any) => {
        if (err === null || err === undefined) {
          resolve();
        } else {
          reject(err);
        }
      });
    }).catch((reason) => {
      console.error(reason);
      throw reason;
    });

    await streamClosed;
  }


export const subscribe = async (id: string) => {
    let copyOrder = await CopyOrder.findById(id).populate('targetWallet').exec();
    if (copyOrder) {
        while (true) {
            try {
              req.transactions.raydiumLiquidityPoolV4.accountInclude[0] = (copyOrder?.targetWallet as any).publicKey; //subscribe specific wallet
              // req.transactions.raydiumLiquidityPoolV4.accountInclude[0] = "CkUZV387xnoGpF7wC2moMa6mPmAgCvTT4pWgzq4M9fCD"; //subscribe specific wallet
              // req.transactions.raydiumLiquidityPoolV4.accountInclude[0] = "6wobj2reg57xW6ZDG6AxuHDqHSzGnVa6wEHwjbQxmT9P"; //subscribe specific wallet
              // Cnlog("req==================", req.transactions.raydiumLiquidityPoolV4.accountInclude);              
              logToFile(`req================== ${JSON.stringify(req.transactions.raydiumLiquidityPoolV4.accountInclude)}`);
              await handleStream(client, req, id);
            } catch (error) {
              console.error("Stream error, restarting in 1 second...", error);
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    }
    
        // while (true) {
        //     try {
        //       await handleStream(client, req);
        //     } catch (error) {
        //       console.error("Stream error, restarting in 1 second...", error);
        //       await new Promise((resolve) => setTimeout(resolve, 1000));
        //     }
        // }
    
}

export const unsubscribe = async (id: string) => {
    const copyOrder = await CopyOrder.findById(id);
    if (copyOrder) {
        // console.log('==========> WebSocket transaction unsubscribe copyorder: ', copyOrder);
        // const subscriptionId = copyOrder.subscriptionId;
        // const request = {
        //     jsonrpc: "2.0",
        //     id: id,
        //     method: "transactionUnsubscribe",
        //     params: [subscriptionId]
        // };
        // WS.send(JSON.stringify(request));
        const stream = await client.subscribe();
        stream.end();
    }
}

const handleSwap = async (subscriptionId: any, targetSwapInfo: any) => {
    try {
        const copyOrder = await CopyOrder.findById(subscriptionId).populate('myWallet').populate('targetWallet').exec();        

        if (copyOrder) {
            // console.log('copytrade.ts handleSwap copyorder: ', copyOrder);
            const chatId = copyOrder.chatId;
            const myWalletId = (copyOrder.myWallet as any)._id;
            const myWallet_privateKey = (copyOrder.myWallet as any).privateKey;
            const myWallet_publicKey = (copyOrder.myWallet as any).publicKey;
            const myWallet_name = (copyOrder.myWallet as any).name;
            // const targetWallet_publicKey = (copyOrder.targetWallet as any).publicKey;
            const mode = copyOrder.mode; // buymode
            const propRate = copyOrder.propRate; // buy amount
            const fixAmount = copyOrder.fixAmount; // buy amount
            const slippage = copyOrder.slippage; // slippage
            const active = copyOrder.active; // active

            let jitoTip;
            let maxBuy;
            let minLp;
            let takeProfit;
            let stopLoss;
            let fixedAutoSell;

            const setting = await Setting.findOne({ chatId });

            if (setting) {
                jitoTip = setting.jitoTip;
                maxBuy = setting.maxBuy;
                minLp = setting.minLp;
                takeProfit = setting.takeProfit;
                stopLoss = setting.stopLoss;
                fixedAutoSell = setting.fixedAutoSell;
            } else {
                jitoTip = default_setting.jitoTip;
                maxBuy = default_setting.maxBuy;
                minLp = default_setting.minLp;
                takeProfit = default_setting.takeProfit;
                stopLoss = default_setting.stopLoss;
                fixedAutoSell = default_setting.fixedAutoSell;
            }

            if (targetSwapInfo.type == "buy") {
                let amount = Math.round(Math.min((mode == "fix") ? fixAmount * SolanaLib.LAMPORTS : (targetSwapInfo.solAmount) * propRate / 100, maxBuy * SolanaLib.LAMPORTS));
                console.log('==============> Calculated Copy Buy SOL Amount: ', amount);

                // wallet balance check
                const balance = await SolanaLib.getBalance(Config.CONNECTION, myWallet_publicKey, true);
                Cnlog("balance============", balance, amount, jitoTip, amount+jitoTip*LAMPORTS_PER_SOL+3000000);
                if (balance < amount + jitoTip*LAMPORTS_PER_SOL + 3000000) {
                    bot.sendMessage(chatId, `Can't Copy Buy due to Insufficient balance - ${myWallet_name}-<code>${myWallet_publicKey}</code>-${balance / LAMPORTS_PER_SOL} SOL`, { parse_mode: "HTML" });
                    return;
                }

                bot.sendMessage(chatId, `Buy in progress... \n<code>${targetSwapInfo.tokenAddress}</code>`, { parse_mode: 'HTML' });
                let swapResult;
                if (targetSwapInfo.dex == "pumpfun") {
                    let i = 0;
                    let retry = 5;
                    while (i < retry) {
                        swapResult = await SolanaLib.pumpfun_buy(SolanaLib.CONNECTION, myWallet_privateKey, targetSwapInfo.tokenAddress, amount, Math.round(jitoTip * SolanaLib.LAMPORTS));
                        if (swapResult && swapResult.success)
                            break;
                        i++;
                        console.log('--------> PumpFun Copy Buy Retry Number = ', i);
                    }
                } else {
                    swapResult = await SolanaLib.jupiter_swap(SolanaLib.CONNECTION, myWallet_privateKey, SolanaLib.WSOL_ADDRESS, targetSwapInfo.tokenAddress, amount, "ExactIn", Math.round(jitoTip * SolanaLib.LAMPORTS));
                    logToFile(`swapResult================== ${JSON.stringify(swapResult)}`);
                }

                if (swapResult && swapResult.success && swapResult.signature) {

                    const copySwapInfo = await SolanaLib.getSwapInfo(SolanaLib.CONNECTION, swapResult.signature);
                    logToFile(`copySwapInfo================== ${JSON.stringify(copySwapInfo)}`);

                    const pos = await Position.findOne({
                        chatId: chatId,
                        myWallet: myWalletId,
                        tokenAddress: targetSwapInfo.tokenAddress
                    });

                    let tokenSymbol;
                    let tokenDecimals;

                    if (pos) {
                        tokenSymbol = pos.tokenSymbol;
                        tokenDecimals = pos.tokenDecimals;
                    } else {
                        const tokenMetaData = await SolanaLib.getTokenMetaData(SolanaLib.CONNECTION, targetSwapInfo.tokenAddress);
                        tokenSymbol = tokenMetaData?.symbol;
                        tokenDecimals = tokenMetaData?.decimals;
                    }

                    bot.sendMessage(chatId, `You bought ${copySwapInfo!.tokenAmount! / (10 ** tokenDecimals!)} ${tokenSymbol}/${amount / SolanaLib.LAMPORTS}SOL. Tx: http://solscan.io/tx/${swapResult.signature} Wallet: ${myWallet_name}`);
                    bot.sendMessage(chatId, `Buy completed`);

                    // update position database
                    let savedPos;
                    if (pos) {
                        pos.tokenBalance += Number(copySwapInfo?.tokenAmount);
                        pos.targetTokenBalance += Number(targetSwapInfo.tokenAmount),
                            pos.buys += 1;
                        pos.totalBuySols += Number(amount);
                        savedPos = await pos.save();
                    } else {
                        let newPos = new Position({
                            chatId: chatId,
                            copyOrder: copyOrder._id,
                            myWallet: myWalletId,
                            tokenSymbol: tokenSymbol,
                            tokenAddress: targetSwapInfo.tokenAddress,
                            tokenDecimals: tokenDecimals!,
                            tokenBalance: Number(copySwapInfo?.tokenAmount),
                            targetTokenBalance: Number(targetSwapInfo.tokenAmount),
                            buys: 1,
                            sells: 0,
                            totalBuySols: amount,
                            totalSellSols: 0,
                            dex: targetSwapInfo.dex
                        });
                        savedPos = await newPos.save();
                    }
                    //- update position database

                    setSellSetting(savedPos._id as string, {
                        sellmode: 'auto',
                        slippage: 'auto'
                    })

                    // show sell pad
                    const { title, buttons } = await getUiOfSell(savedPos._id as string);

                    if (title && buttons) {
                        bot.sendMessage(chatId, title, {
                            parse_mode: "HTML", reply_markup: {
                                inline_keyboard: buttons
                            },
                        })
                    }

                    // history save
                    const trade = new Trade({
                        chatId,
                        myWallet: myWalletId,
                        buyOrSell: 'Buy',
                        tokenSymbol: savedPos.tokenSymbol,
                        tokenAddress: savedPos.tokenAddress,
                        tokenAmount: Number(copySwapInfo?.tokenAmount) / 10 ** tokenDecimals!,
                        solAmount: Number(amount) / SolanaLib.LAMPORTS,
                        signature: swapResult.signature
                    });
                    trade.save();

                } else {
                    // bot.sendMessage(chatId, `Buy failed`);
                }
            } else { // if target sell
                const [myWallet, balance] = await Promise.all([
                    MyWallet.findOne({ publicKey: myWallet_publicKey }),
                    SolanaLib.getBalance(Config.CONNECTION, myWallet_publicKey, true)
                ])

                if (balance < jitoTip + 1000000) { // 1000000 transaction
                    bot.sendMessage(chatId, `Can't Copy Sell due to Insufficient balance - ${myWallet_name}-${myWallet_publicKey}-${balance / LAMPORTS_PER_SOL} SOL`);
                    return;
                }

                const pos = await Position.findOne({
                    chatId: chatId,
                    myWallet: myWallet!._id,
                    tokenAddress: targetSwapInfo.tokenAddress
                });

                if (pos) {
                    let sellAmount = Math.min(pos.tokenBalance, Math.floor(pos.tokenBalance * targetSwapInfo.tokenAmount / (pos.targetTokenBalance)));
                    console.log('=============> Calculated Copy Sell Amount = ', sellAmount);

                    bot.sendMessage(chatId, `Sell in progress...\n${targetSwapInfo.tokenAddress}`, { parse_mode: "HTML" });

                    let swapResult;
                    if (targetSwapInfo.dex == "pumpfun") {
                        let i = 0;
                        let retry = 5;
                        while (i < retry) {
                            swapResult = await SolanaLib.pumpfun_sell(SolanaLib.CONNECTION, myWallet_privateKey, targetSwapInfo.tokenAddress, sellAmount, Math.round(jitoTip * SolanaLib.LAMPORTS));
                            if (swapResult && swapResult.success)
                                break;
                            i++;
                            console.log('========> PumpFun Copy Sell Retry Number = ', i);
                        }
                    } else {
                        swapResult = await SolanaLib.jupiter_swap(SolanaLib.CONNECTION, myWallet_privateKey, targetSwapInfo.tokenAddress, SolanaLib.WSOL_ADDRESS, sellAmount, "ExactIn", jitoTip * SolanaLib.LAMPORTS);
                    }

                    if (swapResult && swapResult.success && swapResult.signature) {

                        const copySwapInfo = await SolanaLib.getSwapInfo(SolanaLib.CONNECTION, swapResult.signature);

                        console.log('========> Copy Sell Result : ', copySwapInfo);

                        const tokenDecimals = pos.tokenDecimals;
                        const tokenSymbol = pos.tokenSymbol;

                        bot.sendMessage(chatId, `You sold ${sellAmount / 10 ** tokenDecimals!} ${tokenSymbol}/${copySwapInfo!.solAmount! / (SolanaLib.LAMPORTS)}SOL. Tx: http://solscan.io/tx/${swapResult.signature} Wallet: ${myWallet_name}`);
                        bot.sendMessage(chatId, `Sell completed`);

                        // update position
                        pos.tokenBalance -= Number(sellAmount);
                        if (pos.tokenBalance > 0) {
                            pos.totalSellSols += Number(copySwapInfo?.solAmount);
                            pos.sells += 1;
                            pos.targetTokenBalance -= targetSwapInfo.tokenAmount;
                            await pos.save();

                            // show sell pad
                            const { title, buttons } = await getUiOfSell(pos._id as string);
                            if (title && buttons) {
                                bot.sendMessage(chatId, title, {
                                    parse_mode: "HTML", reply_markup: {
                                        inline_keyboard: buttons
                                    },
                                })
                            }

                        } else {
                            pos.totalSellSols += Number(copySwapInfo?.solAmount);
                            pos.sells += 1;
                            pos.targetTokenBalance -= targetSwapInfo.tokenAmount;
                            await pos.save();
                            const deleted = await Position.findByIdAndDelete(pos._id);
                            console.log('deleted position = ', deleted);
                        }

                        // save history    
                        const trade = new Trade({
                            chatId,
                            myWallet: myWalletId,
                            buyOrSell: 'Sell',
                            tokenSymbol: pos.tokenSymbol,
                            tokenAddress: pos.tokenAddress,
                            tokenAmount: Number(sellAmount) / 10 ** pos.tokenDecimals,
                            solAmount: Number(copySwapInfo?.solAmount) / SolanaLib.LAMPORTS,
                            signature: swapResult.signature
                        });
                        await trade.save();

                        console.log('===========> Copy Sell End');
                    } else {
                        pos.targetTokenBalance -= targetSwapInfo.tokenAmount;
                        await pos.save();
                        bot.sendMessage(chatId, `Sell failed`);
                    }
                }
            }
        } else {
            console.log('copytrade.ts handleswap copyorder not exist');
        }
    } catch (error) {
        console.error('handleSwap ERROR = ', error);
    }
}

export const getSwapInfo = async (data: any) => {
    try {
        // console.log('data.transaction.transaction = ', data.transaction.transaction); // ==== tx
        // const tx = data.params.result.transaction;
        const tx = data.transaction.transaction;
        const instructions = tx.transaction.message.instructions;
        // Cnlog("instuctions=========", instructions);
        const innerinstructions = tx.meta.innerInstructions;
        // Cnlog("innerinstructions=========", innerinstructions);
        // console.log("tx======", tx);
        // const accountKeys = tx?.transaction.message.accountKeys.map((ak: any) => ak.pubkey);
        const accountKeys = tx?.transaction.message.accountKeys.map((key: any) =>  decodeTransact(key));
        // Cnlog('accountKeys ====== ', accountKeys);
        // const signer = accountKeys[0].toString();
        const signer = accountKeys[0].toString();
        // Cnlog('accountKeys[0] = ', signer);
        const logs = tx.meta.logMessages;
        // Cnlog("logs==========", logs);
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
                Cnlog('instructions length======', instructions.length);
                for (let i = 0; i < instructions.length; i++) {
                    Cnlog('programId========', instructions[i].programId);

                    if (instructions[i].programId == "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8") {
                        Cnlog('innerinstructions length======', innerinstructions.length);
                        for (let j = 0; j < innerinstructions!.length; j++) {
                            if (innerinstructions![j].index === i) {

                                const [sendData, receiveData] = await Promise.all([
                                    SolanaLib.getTokenAddressAndOwnerFromTokenAccount(Config.CONNECTION, (innerinstructions![j].instructions[0] as any).parsed.info.destination),
                                    SolanaLib.getTokenAddressAndOwnerFromTokenAccount(Config.CONNECTION, (innerinstructions![j].instructions[1] as any).parsed.info.source)
                                ]);
                                Cnlog('sendData========', sendData, receiveData);

                                const sendToken = sendData?.tokenAddress;
                                const receiveToken = receiveData?.tokenAddress;

                                const sendAmount = (innerinstructions![j].instructions[0] as any).parsed.info.amount;
                                const receiveAmount = (innerinstructions![j].instructions[1] as any).parsed.info.amount;
                                Cnlog('sendToken=========', sendToken, receiveToken, sendAmount, receiveAmount);

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
                                Cnlog('result=========', isSwap, dex, type, tokenAddress, solAmount, tokenAmount, signer );
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

function decodeRaydiumTxn(tx: VersionedTransactionResponse) {
    if (tx.meta?.err) return;
    
    const parsedIxs = IX_PARSER.parseTransactionWithInnerInstructions(tx);
    // const parsedIxs = IX_PARSER.parseParsedTransactionWithInnerInstructions(tx);
    // const parsedIxs = IX_PARSER.parseTransactionData(tx.transaction.message, tx.meta?.loadedAddresses);
  
    parsedIxs.forEach((ix: any) => {
      // Cnlog("ix======", ix);
      logToFile(`ix================== ${JSON.stringify(ix)}`);
    })    

    const programIxs = parsedIxs.filter(      
      (ix: any) =>         
        ix.programId.equals(RAYDIUM_PUBLIC_KEY) && ix.name == "swapBaseIn"            
    );  
    
    // Cnlog("programIxs.length=====", programIxs.length);    
    logToFile(`programIxs.length================== ${JSON.stringify(programIxs.length)}`);
    if (programIxs.length === 0) return;
  
    //@ts-ignore
    // const LogsEvent = LOGS_PARSER.parse(programIxs, tx.meta.logMessages);
    // const result = { events: LogsEvent };
    // const result = { instructions: programIxs, events: LogsEvent };
    const result = { instructions: programIxs };
    // Cnlog("result=====", result);
    logToFile(`result================== ${JSON.stringify(result)}`);
    bnLayoutFormatter(result);
    return result;
  }
  

  function analyzeTx(trx: any, instructions: any) {
    const message = trx.transaction.message;
    const accountKeys = message.accountKeys.map((key: any) =>       
      decodeTransact(key)    
    );
  
    logToFile(`accountKeys================== ${JSON.stringify(accountKeys)}`);
    const meta = trx.meta;
    // Cnlog("meta==========", meta);
    logToFile(`meta================== ${JSON.stringify(meta)}`);
  
    let isBuy = false;
    let solAmount = 0;
    let tokenAmount = 0;
    let slippage = 0;
    let preSol = 0;
    let postSol = 0;
    let preToken = 0;
    let postToken = 0;
    let token = "";
    let flag = false;
    let swapOwner = "";
    meta.innerInstructions.forEach((innerInstruction: any) => {
      // Cnlog("message=======", message);
      logToFile(`message================== ${JSON.stringify(message)}`);
      // Cnlog("innersdfadsfasdfasdfsdfsdf====", accountKeys[message.instructions[innerInstruction.index].programIdIndex]); // raydium swap or other program id index check here 
      logToFile(`innersdfadsfasdfasdfsdfsdf================== ${JSON.stringify(accountKeys[message.instructions[innerInstruction.index].programIdIndex])}`);
      // Cnlog("messageinstructions====", message.instructions[innerInstruction.index]);
      logToFile(`messageinstructions================== ${JSON.stringify(message.instructions[innerInstruction.index])}`);
      
      if (
        accountKeys[
          message.instructions[innerInstruction.index].programIdIndex
        // ] == "routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS" //AMM
        ] == "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8" ||
        accountKeys[
          message.instructions[innerInstruction.index].programIdIndex
        ] == "routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS" //AMM
        
      ) {

        // Cnlog("prebalances===postbalances===", meta.preBalances[0]/10**9, meta.postBalances[0]/10**9, meta.preTokenBalances[0].uiTokenAmount.uiAmount, meta.postTokenBalances[0].uiTokenAmount.uiAmount);
        preSol = meta.preBalances[0]/10**9;
        postSol = meta.postBalances[0]/10**9;
        preToken = meta.preTokenBalances[0].uiTokenAmount.uiAmount;
        postToken = meta.postTokenBalances[0].uiTokenAmount.uiAmount;
        swapOwner = meta.preTokenBalances[0].owner;


        // raydium swap
        let num = 0;
        // let num = 1;
        innerInstruction.instructions.forEach((ins: any) => {
          // Cnlog("ins=======", ins, ins.data, ins.accounts, Array.from(ins.data)[0]);
          logToFile(`ins================== ${JSON.stringify(ins)} ${JSON.stringify(ins.data)} ${JSON.stringify(ins.accounts)}
          ${JSON.stringify(Array.from(ins.data)[0])}`);
          // Cnlog("ins_decode=======", LAYOUT.decode(Buffer.from(ins.data)), LAYOUT.decode(Buffer.from(ins.accounts)), 
          // Array.from(ins.data)[0], Array.from(ins.data)[1], Array.from(ins.accounts)[0], Array.from(ins.accounts)[1]);
          logToFile(`ins_decode================== ${JSON.stringify(LAYOUT.decode(Buffer.from(ins.data)))} ${JSON.stringify(LAYOUT.decode(Buffer.from(ins.accounts)))} 
          ${JSON.stringify(Array.from(ins.data)[0])} ${JSON.stringify(Array.from(ins.data)[1])} ${JSON.stringify(Array.from(ins.accounts)[0])} ${JSON.stringify(Array.from(ins.accounts)[1])}`);

          if (Array.from(ins.data)[0] == 3) { ////////???????????? 3 means withdraw. it's right.
            num = (num + 1) % 2;
            // transfer
            //@ts-ignore 
            const from = accountKeys[Array.from(ins.accounts)[0]];
            //@ts-ignore
            const to = accountKeys[Array.from(ins.accounts)[1]];
            const data: any = LAYOUT.decode(Buffer.from(ins.data));
  
            // Cnlog("from======to=====", from, to, data);
            logToFile(`from======to======================= ${JSON.stringify(from)} ${JSON.stringify(to)} ${JSON.stringify(data)}`);            
            // Cnlog("Array.from(ins.accounts)[num]======", Array.from(ins.accounts)[num], num);
            logToFile(`Array.from(ins.accounts)[num]=============== ${JSON.stringify(Array.from(ins.accounts)[num])} ${JSON.stringify(num)}`);
            
            const tokenBalance = meta.preTokenBalances.filter(
              (preTokenBalance: any) =>
                preTokenBalance.accountIndex == Array.from(ins.accounts)[num]
            );
            // Cnlog("tokenBalance=======", tokenBalance);
            logToFile(`tokenBalance============= ${JSON.stringify(tokenBalance)}`);
  
            if (num == 1) {
            // if (num == 0) {
              if (
                tokenBalance[0].mint ==
                "So11111111111111111111111111111111111111112"
              ) {
                isBuy = true;                
                solAmount = Number(data.amount);
              } else {
                token = tokenBalance[0].mint;
                isBuy = false;                
                tokenAmount = Number(data.amount);
              }
            } else {
              if (
                tokenBalance[0].mint ==
                "So11111111111111111111111111111111111111112"
              ) {
                isBuy = false;                
                solAmount = Number(data.amount);
              } else {
                token = tokenBalance[0].mint;
                isBuy = true;                
                tokenAmount = Number(data.amount);
              }
            }
  
            flag = true;
          }
        });
      }
    });
  
    if (!flag) return {};
    if (instructions[0].name == "swapBaseIn") {
      slippage = isBuy
        ? calculateSlippage(tokenAmount, instructions[0].args.minimumAmountOut)
        : calculateSlippage(solAmount, instructions[0].args.minimumAmountOut);
    }
  
    return {
      isBuy,
      minAmountOut: instructions[0].args.minimumAmountOut,
      slippage,
      solAmount,
      tokenAmount,
      token,
      preSol,
      postSol,
      preToken,
      postToken,
      swapOwner,
    };
  }
  