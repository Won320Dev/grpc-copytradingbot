import bs58 from 'bs58';
import {
  Commitment,
  Keypair,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  BlockhashWithExpiryBlockHeight,
  Finality,
  sendAndConfirmTransaction
} from "@solana/web3.js";

import {
  TOKEN_PROGRAM_ID,
  AccountLayout,
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getAssociatedTokenAddressSync,
  createCloseAccountInstruction,
  getAssociatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";

import { Metaplex } from "@metaplex-foundation/js";

import {
  Token,
  SPL_ACCOUNT_LAYOUT,
} from "@raydium-io/raydium-sdk";

import { calculateWithSlippageSell, DEFAULT_DECIMALS, PumpFunSDK } from "./pumpfunsdk";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { AnchorProvider } from "@coral-xyz/anchor";

import * as config from './config';

import axios from 'axios';
import { sha256 } from "js-sha256";
import { publicKey } from '@project-serum/anchor/dist/cjs/utils';

export const DEFAULT_COMMITMENT: Commitment = "finalized";
export const DEFAULT_FINALITY: Finality = "finalized";
export const SLIPPAGE_BASIS_POINTS = 1000n;

export const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";
export const LAMPORTS = LAMPORTS_PER_SOL;
export const USDC_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const jito_Validators = [
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
];
const endpoints = [
  "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles",
];

export const CONNECTION = new Connection(config.SOLANA_RPC_ENDPOINT, { wsEndpoint: config.SOLANA_WSS_ENDPOINT, commitment: "confirmed" });

export const createWallet = () => {
  let keypair = Keypair.generate();
  let publicKey = keypair.publicKey.toBase58();
  let privateKey = bs58.encode(keypair.secretKey);
  return { publicKey, privateKey };
}

export const getPublicKey = (privateKey: string) => {
  try {
    let keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    let publicKey = keypair.publicKey.toBase58();
    return publicKey;
  } catch (error) {
    return null;
  }
}

export const isValidAddress = (publicKey: string) => {
  try {
    const key = new PublicKey(publicKey);
    return true;
  } catch (error) {
    return false;
  }
}

export function shortenAddress(address: string) {
  try {
    const firstPart = address.slice(0, 6);
    const lastPart = address.slice(-4);
    return `${firstPart}...${lastPart}`;
  } catch (error) {
    return null;
  }
}

export function isNumber(inputText: string | undefined) {
  if (!inputText)
    return false;
  return !isNaN(parseFloat(inputText)) && isFinite(Number(inputText));
}

export async function getTokenAddressAndOwnerFromTokenAccount(connection: Connection, tokenAccountAddress: string) {
  try {
    const tokenAccountPubkey = new PublicKey(tokenAccountAddress);
    const accountInfo = await connection.getAccountInfo(tokenAccountPubkey);

    if (accountInfo === null) {
      return null;
    }

    const accountData = AccountLayout.decode(accountInfo.data);
    const mintAddress = new PublicKey(accountData.mint);

    const tokenAddress = mintAddress.toBase58();
    const ownerAddress = new PublicKey(accountData.owner).toBase58();

    return { tokenAddress, ownerAddress };

  } catch (error) {
    console.error('Error fetching token address:', error);
    return null;
  }
}

export const getTokenMetaData = async (CONNECTION: Connection, address: string) => {
  try {
    const metaplex = Metaplex.make(CONNECTION);
    const mintAddress = new PublicKey(address);
    const token = await metaplex.nfts().findByMint({ mintAddress: mintAddress });
    let mintInfo = null
    let totalSupply = 0
    let token_type = "spl-token"
    if (token) {
      const name = token.name;
      const symbol = token.symbol;
      const logo = token.json?.image;
      const description = token.json?.description;
      const extensions = token.json?.extensions;
      const decimals = token.mint.decimals;
      const renounced = token.mint.mintAuthorityAddress ? false : true;

      if (token.mint.currency.namespace === "spl-token") {
        mintInfo = await getMint(CONNECTION, mintAddress, "confirmed", TOKEN_PROGRAM_ID)
        token_type = "spl-token"
      } else {
        mintInfo = await getMint(CONNECTION, mintAddress, "confirmed", TOKEN_2022_PROGRAM_ID)
        token_type = "spl-token-2022"
      }
      if (mintInfo) {
        totalSupply = Number(mintInfo.supply / BigInt(10 ** decimals))
      }
      const metaData = { name, symbol, logo, decimals, address, totalSupply, description, extensions, renounced, type: token_type };
      console.log('metaData = ', metaData);
      return metaData;
    } else {
      console.log("utils.getTokenMetadata tokenInfo", token);
    }

  } catch (error) {
    console.log("getTokenMetadata", error);
  }
  return null
}

export const getBalance = async (connection: Connection, publicKey: string, lamports: boolean = false) => {
  try {
    const balance = await connection.getBalance(new PublicKey(publicKey));
    if (lamports)
      return balance;
    else
      return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.log('solana.ts getBalance error :', error);
    return 0;
  }
}

export const jupiter_swap = async (
  connection: Connection,
  privateKey: string,
  inputMint: string,
  outputMint: string,
  amount: number,
  swapMode: "ExactIn" | "ExactOut" = "ExactIn",
  jito_tip: number = 1000000,
  slippage: number = 500
) => {
  try {
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));

    const quoteResponse = await (
      await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippage}&swapMode=${swapMode}`
      )
    ).json();

    const { swapTransaction } = await (
      await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: keypair.publicKey.toString(),
          wrapAndUnwrapSol: true,
        })
      })
    ).json();

    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    const simulateResult = await connection.simulateTransaction(transaction);
    console.log('Jupiter SWap Trx Simulation result:', simulateResult);
    transaction.sign([keypair]);
    const txSignature = bs58.encode(transaction.signatures[0]);
    const latestBlockHash = await connection.getLatestBlockhash('processed');

    let result = await sendBundle(transaction, keypair, latestBlockHash, jito_tip);

    if (result) {
      console.log("http://solscan.io/tx/" + txSignature);
      return { success: true, signature: txSignature };
    } else {
      console.log("JuptierSwap Transaction failed");
      return { success: false, signature: null };
    }
  } catch (error) {
    console.log('JupiterSwap Transaction failed, error :', error);
    return { success: false, signature: null };
  }
}

export const pumpfun_buy = async (connection: Connection, privateKey: string, tokenAddress: string, amount: number, jito_tip: number, slippage: number = 50) => {
  try {

    let wallet = new NodeWallet(new Keypair());
    const provider = new AnchorProvider(CONNECTION, wallet, {
      commitment: "finalized",
    });
    let sdk = new PumpFunSDK(provider);
    let boundingCurveAccount = await sdk.getBondingCurveAccount(new PublicKey(tokenAddress));

    if (boundingCurveAccount) {
      const payer = getKeyPairFromPrivateKey(privateKey);
      const token = new PublicKey(tokenAddress);
      let buyResults = await sdk.buy(
        payer,
        token,
        BigInt(amount),
        SLIPPAGE_BASIS_POINTS,
        {
          unitLimit: 250000,
          unitPrice: 250000,
        },
      );

      return buyResults;
    } else {
      console.log('there is no bondingcurve');
      return null;
    }
  } catch (error) {
    console.log('jupiter swap failed');
    return null;
  }
}

export const pumpfun_sell = async (connection: Connection, privateKey: string, tokenAddress: string, amount: number, jito_tip: number, slippage: number = 50) => {
  try {

    let wallet = new NodeWallet(new Keypair());
    const provider = new AnchorProvider(CONNECTION, wallet, {
      commitment: "finalized",
    });
    let sdk = new PumpFunSDK(provider);
    let boundingCurveAccount = await sdk.getBondingCurveAccount(new PublicKey(tokenAddress));

    if (boundingCurveAccount) {
      const payer = getKeyPairFromPrivateKey(privateKey);
      const token = new PublicKey(tokenAddress);
      let sellResults = await sdk.sell(
        payer,
        token,
        BigInt(amount),
        SLIPPAGE_BASIS_POINTS,
        {
          unitLimit: 250000,
          unitPrice: 250000,
        },
      );
      return sellResults;
    } else {
      console.log('there is no bondingcurve');
      return null;
    }
  } catch (error) {
    console.log('jupiter swap failed');
    return null;
  }
}

export const pumpfun_position = async (tokenAddress: string, tokenAmount: number, slippageBasisPoints: bigint = 500n, commitment: Commitment = DEFAULT_COMMITMENT) => {
  try {

    let wallet = new NodeWallet(new Keypair());
    const provider = new AnchorProvider(CONNECTION, wallet, {
      commitment: "finalized",
    });
    let sdk = new PumpFunSDK(provider);
    let boundingCurveAccount = await sdk.getBondingCurveAccount(new PublicKey(tokenAddress));

    if (boundingCurveAccount) {
      let globalAccount = await sdk.getGlobalAccount(commitment);

      let minSolOutput = boundingCurveAccount.getSellPrice(
        BigInt(tokenAmount),
        globalAccount.feeBasisPoints
      );

      let sellAmountWithSlippage = calculateWithSlippageSell(
        minSolOutput,
        slippageBasisPoints
      );

      return sellAmountWithSlippage;
    } else {
      console.log('there is no bondingcurve');
      return null;
    }
  } catch (error) {
    console.log('jupiter swap failed');
    return null;
  }
}

export async function sendBundle(
  transaction: VersionedTransaction,
  payer: Keypair,
  lastestBlockhash: BlockhashWithExpiryBlockHeight,
  jitofee: number
) {
  const jito_validator_wallet = await getRandomValidator();
  try {
    const jitoFee_message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: lastestBlockhash.blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: jito_validator_wallet,
          lamports: jitofee,
        }),
      ],
    }).compileToV0Message();

    const jitoFee_transaction = new VersionedTransaction(jitoFee_message);
    jitoFee_transaction.sign([payer]);

    const serializedJitoFeeTransaction = bs58.encode(jitoFee_transaction.serialize());
    const serializedTransaction = bs58.encode(transaction.serialize());

    const final_transaction = [
      serializedJitoFeeTransaction,
      serializedTransaction,
    ];

    console.log("Sending bundles...");

    const { data } = await axios.post('https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles', {
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [final_transaction],
    })

    let bundleIds: any = [];
    if (data) {
      console.log(data);
      bundleIds = [
        data.result
      ];
    }

    console.log("Checking bundle's status...", bundleIds);
    const sentTime = Date.now();
    let confirmed = false;
    while (Date.now() - sentTime < 300000) { // 5 min

      try {
        const { data } = await axios.post(`https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles`,
          {
            jsonrpc: "2.0",
            id: 1,
            method: "getBundleStatuses",
            params: [
              bundleIds
            ],
          },
          {
            headers: {
              "Content-Type": "application/json",
            },
          }
        );

        if (data) {
          const bundleStatuses = data.result.value;
          console.log(`SentTime: ${sentTime}: Bundle Statuses:`, bundleStatuses);
          let success = true;

          for (let i = 0; i < bundleIds.length; i++) {
            const matched = bundleStatuses.find((item: any) => item && item.bundle_id === bundleIds[i]);
            if (!matched || matched.confirmation_status !== "confirmed") { // finalized
              success = false;
              break;
            }
          }

          if (success) {
            confirmed = true;
            break;
          }
        }
      } catch (err) {
        console.log("JITO ERROR:", err);
        break;
      }
      await sleep(1000);
    }
    return confirmed;
  } catch (e) {
    if (e instanceof axios.AxiosError) {
      console.log("Failed to execute the jito transaction");
    } else {
      console.log("Error during jito transaction execution: ", e);
    }
    return false;
  }
}

export async function sendSol(connection: Connection, sender: Keypair, receiver: PublicKey, amount: number) {
  try {
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: receiver,
        lamports: amount - 5000,
      })
    );
    const signature = await connection.sendTransaction(transaction, [sender]);

    if (signature)
      return true;
    else return false;
  } catch (error) {
    console.log('send sol error', error);
    return false;
  }
}

export async function jito_executeAndConfirm(
  CONNECTION: Connection,
  transaction: VersionedTransaction,
  payer: Keypair,
  lastestBlockhash: BlockhashWithExpiryBlockHeight,
  jitofee: number
) {
  console.log("Executing transaction (jito)...");
  const jito_validator_wallet = await getRandomValidator();
  console.log("Selected Jito Validator: ", jito_validator_wallet.toBase58());
  try {
    // const fee = new CurrencyAmount(Currency.SOL, jitofee, false).raw.toNumber();
    // console.log(`Jito Fee: ${fee / 10 ** 9} sol`);
    const jitoFee_message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: lastestBlockhash.blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: jito_validator_wallet,
          lamports: jitofee,
        }),
      ],
    }).compileToV0Message();

    const jitoFee_transaction = new VersionedTransaction(jitoFee_message);
    jitoFee_transaction.sign([payer]);
    const jitoTxSignature = bs58.encode(jitoFee_transaction.signatures[0]);
    const serializedJitoFeeTransaction = bs58.encode(
      jitoFee_transaction.serialize()
    );
    const serializedTransaction = bs58.encode(transaction.serialize());
    const final_transaction = [
      serializedJitoFeeTransaction,
      serializedTransaction,
    ];
    const requests = endpoints.map((url) =>
      axios.post(url, {
        jsonrpc: "2.0",
        id: 1,
        method: "sendBundle",
        params: [final_transaction],
      })
    );
    console.log("Sending tx to Jito validators...");
    const res = await Promise.all(requests.map((p) => p.catch((e) => e)));
    const success_res = res.filter((r) => !(r instanceof Error));
    if (success_res.length > 0) {
      console.log("Jito validator accepted the tx");
      const result = await jito_confirm(CONNECTION, jitoTxSignature, lastestBlockhash);
      if (result.confirmed)
        return true;
      else
        return false;
    } else {
      console.log("No Jito validators accepted the tx");
      return false;
    }
  } catch (e) {
    if (e instanceof axios.AxiosError) {
      console.log("Failed to execute the jito transaction");
    } else {
      console.log("Error during jito transaction execution: ", e);
    }
    return false;
  }
}

export function getKeyPairFromPrivateKey(privateKey: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(privateKey));
}

async function jito_confirm(CONNECTION: Connection, signature: string, latestBlockhash: BlockhashWithExpiryBlockHeight) {
  console.log("Confirming the jito transaction...");
  const confirmation = await CONNECTION.confirmTransaction(
    {
      signature,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      blockhash: latestBlockhash.blockhash,
    },
    "confirmed"
  );
  return { confirmed: !confirmation.value.err, signature };
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getRandomValidator() {
  const res =
    jito_Validators[Math.floor(Math.random() * jito_Validators.length)];
  return new PublicKey(res);
}

export const getPoolInfo = async (address: string) => {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
  const res = await axios.get(url);
  if (!res.data.pairs) {
    return null;
  }
  for (let pairInfo of res.data.pairs) {
    if (pairInfo.chainId === "solana") {
      const data: any = {}
      data.dex = pairInfo.dexId
      data.dexURL = pairInfo.url
      data.symbol = pairInfo.baseToken.symbol
      data.name = pairInfo.baseToken.name
      data.addr = pairInfo.baseToken.address
      data.priceUsd = pairInfo.priceUsd
      data.priceNative = pairInfo.priceNative
      data.volume = pairInfo.volume.m5
      data.priceChange = pairInfo.priceChange.m5
      if (pairInfo.liquidity != undefined) {
        data.liquidity = pairInfo.liquidity.usd
        data.pooledSOL = pairInfo.liquidity.quote
      }
      data.mc = pairInfo.fdv
      console.log('poolinfo = ', data);
      return data
    }
  }
  return null
}

export const getTokenBalance = async (connection: Connection, walletAddress: string, tokenAddress: string, lamports: boolean = false) => {
  const mint = new PublicKey(tokenAddress);
  const mintInfo = await getMint(connection, mint);
  const baseToken = new Token(TOKEN_PROGRAM_ID, tokenAddress, mintInfo.decimals);
  console.log('token =', baseToken);
  const walletTokenAccounts = await getWalletTokenAccount(connection, new PublicKey(walletAddress));
  let tokenBalance = 0;
  if (walletTokenAccounts && walletTokenAccounts.length > 0) {
    for (let walletTokenAccount of walletTokenAccounts) {
      if (walletTokenAccount.accountInfo.mint.toBase58() === tokenAddress) {
        if (lamports == true)
          tokenBalance = Number(walletTokenAccount.accountInfo.amount);
        else
          tokenBalance = Number(walletTokenAccount.accountInfo.amount) / 10 ** baseToken.decimals;
        break;
      }
    }

  }
  return tokenBalance;
};

export const getWalletTokenAccount = async (connection: Connection, wallet: PublicKey) => {
  const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
    programId: TOKEN_PROGRAM_ID,
  });
  return walletTokenAccount.value.map((i) => ({
    pubkey: i.pubkey,
    programId: i.account.owner,
    accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
  }));
};

export const getTokenPrice = async (tokenAddress: string, quoteTokenAddress: string) => {
  try {
    const url = `https://price.jup.ag/v6/price?ids=${tokenAddress}&vsToken=${quoteTokenAddress}`
    const resp = await axios.get(url);
    console.log('response = ', resp.data);
    let price;
    if (resp && resp.data && resp.data.data && resp.data.data[tokenAddress]) {
      price = resp.data.data[tokenAddress].price
      return price;
    }
  } catch (error) {
    console.log("getTokenPrice", error)
  }
  return null;
}

export const getSwapInfo = async (connection: Connection, signature: string) => {
  try {
    let tx: any;
    const start = Date.now();
    while (Date.now() - start < 300000) { // 5min
      tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
      if (tx != null && tx != undefined)
        break;
      await sleep(1000);
    }

    if (!tx)
      return null;
    // const blocktime = tx?.blockTime;
    const instructions = tx!.transaction.message.instructions;
    const innerinstructions = tx!.meta!.innerInstructions;
    const accountKeys = tx?.transaction.message.accountKeys.map((ak: any) => ak.pubkey);
    const signer = accountKeys[0].toString();
    const logs = tx?.meta?.logMessages;

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
          if (instructions[i].programId.toBase58() == "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4") {
            console.log('index = ', i);
            for (let j = 0; j < innerinstructions!.length; j++) {
              if (innerinstructions![j].index === i) {
                const length = innerinstructions![j].instructions.length;
                let sendToken;
                let sendAmount;
                let receiveToken;
                let receiveAmount;
                for (let i = 0; i < length; i++) {
                  if ((innerinstructions![j].instructions[i] as any).programId.toBase58() == 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
                    if ((innerinstructions![j].instructions[i] as any).parsed.type == "transferChecked") {
                      const data = await getTokenAddressAndOwnerFromTokenAccount(connection, (innerinstructions![j].instructions[i] as any).parsed.info.destination);
                      // console.log('accountData = ', data);
                      if (data && data.ownerAddress != "45ruCyfdRkWpRNGEqWzjCiXRHkZs8WXCLQ67Pnpye7Hp") { // Jutpiter Partner Referral Fee Vault
                        sendToken = data.tokenAddress;
                        sendAmount = (innerinstructions![j].instructions[i] as any).parsed.info.tokenAmount.amount;
                        break;
                      }
                    }

                    if ((innerinstructions![j].instructions[i] as any).parsed.type == "transfer") {
                      const data = await getTokenAddressAndOwnerFromTokenAccount(connection, (innerinstructions![j].instructions[i] as any).parsed.info.destination);
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
                  if ((innerinstructions![j].instructions[i] as any).programId.toBase58() == 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
                    if ((innerinstructions![j].instructions[i] as any).parsed.type == "transferChecked") {
                      const data = await getTokenAddressAndOwnerFromTokenAccount(connection, (innerinstructions![j].instructions[i] as any).parsed.info.source);
                      // console.log('accountData = ', data);
                      if (data) {
                        receiveToken = data?.tokenAddress;
                        receiveAmount = (innerinstructions![j].instructions[i] as any).parsed.info.tokenAmount.amount;
                        break;
                      }
                    }

                    if ((innerinstructions![j].instructions[i] as any).parsed.type == "transfer") {
                      const data = await getTokenAddressAndOwnerFromTokenAccount(connection, (innerinstructions![j].instructions[i] as any).parsed.info.source);
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
          if (instructions[i].programId.toBase58() == "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8") {
            for (let j = 0; j < innerinstructions!.length; j++) {
              if (innerinstructions![j].index === i) {

                const [sendData, receiveData] = await Promise.all([
                  getTokenAddressAndOwnerFromTokenAccount(connection, (innerinstructions![j].instructions[0] as any).parsed.info.destination),
                  getTokenAddressAndOwnerFromTokenAccount(connection, (innerinstructions![j].instructions[1] as any).parsed.info.source)
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
            if (instructions[j].programId.toBase58() == '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8') {
              const [sendData, receiveData] = await Promise.all([
                getTokenAddressAndOwnerFromTokenAccount(connection, (instructions[j + 1] as any).parsed.info.destination),
                getTokenAddressAndOwnerFromTokenAccount(connection, (instructions[j + 2] as any).parsed.info.source)
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
            if (instructions[i].programId.toBase58() == "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P") {
              for (let j = 0; j < innerinstructions!.length; j++) {
                if (innerinstructions![j].index === i) {
                  const accountData = await getTokenAddressAndOwnerFromTokenAccount(connection, (innerinstructions![j].instructions[0] as any).parsed.info.destination);
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
              if (instructions[j].programId.toBase58() == '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') {
                const accountData = await getTokenAddressAndOwnerFromTokenAccount(connection, (instructions[j + 1] as any).parsed.info.destination);
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
            if (instructions[i].programId.toBase58() == "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P") {
              for (let j = 0; j < innerinstructions!.length; j++) {
                if (innerinstructions![j].index === i) {
                  const tokenAmount = Number((innerinstructions![j].instructions[0] as any).parsed.info.amount);
                  const accountData = await getTokenAddressAndOwnerFromTokenAccount(connection, (innerinstructions![j].instructions[0] as any).parsed.info.source);
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
              if (instructions[j].programId.toBase58() == '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') {
                const tokenAmount = Number((instructions[j + 1] as any).parsed.info.amount);
                const accountData = await getTokenAddressAndOwnerFromTokenAccount(connection, (instructions[j + 1] as any).parsed.info.source);
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
    console.log('solana.ts getSwapInfo error: ', error);
    return null;
  }
}

export async function closeTokenAccount(connection: Connection, wallet: Keypair, tokenAccountPublicKey: PublicKey) {
  const destinationPublicKey = wallet.publicKey;
  const transaction = new Transaction().add(
    createCloseAccountInstruction(
      tokenAccountPublicKey,     // Token account to close
      destinationPublicKey,      // Destination for remaining SOL
      wallet.publicKey,          // Owner of the token account
      [],                        // Signers, typically empty here as we use `wallet`
      TOKEN_PROGRAM_ID           // SPL Token Program ID
    )
  );
  const signature = await sendAndConfirmTransaction(connection, transaction, [wallet]);
  console.log("Token account closed. Transaction signature:", signature);
}

export async function getTokenAccount(walletAddress: string, tokenMintAddress: string) {
  // Convert wallet and token addresses to PublicKey instances
  const walletPublicKey = new PublicKey(walletAddress);
  const tokenMintPublicKey = new PublicKey(tokenMintAddress);

  // Get the associated token account address for the wallet and token mint
  const tokenAccountAddress = await getAssociatedTokenAddress(
    tokenMintPublicKey,        // The mint of the token
    walletPublicKey,           // The wallet address
    false,                     // Allow owner off curve (usually false)
    TOKEN_PROGRAM_ID,          // SPL Token program ID
    ASSOCIATED_TOKEN_PROGRAM_ID // Associated Token program ID
  );
  console.log("Token account address:", tokenAccountAddress.toBase58());
  return tokenAccountAddress;
}

export const printSOLBalance = async (
  connection: Connection,
  pubKey: PublicKey,
  info: string = ""
) => {
  const balance = await connection.getBalance(pubKey);
  console.log(
    `${info ? info + " " : ""}${pubKey.toBase58()}:`,
    balance / LAMPORTS_PER_SOL,
    `SOL`
  );
};

export const getSPLBalance = async (
  connection: Connection,
  mintAddress: PublicKey,
  pubKey: PublicKey,
  allowOffCurve: boolean = false
) => {
  try {
    let ata = getAssociatedTokenAddressSync(mintAddress, pubKey, allowOffCurve);
    const balance = await connection.getTokenAccountBalance(ata, "processed");
    return balance.value.uiAmount;
  } catch (e) { }
  return null;
};

export const printSPLBalance = async (
  connection: Connection,
  mintAddress: PublicKey,
  user: PublicKey,
  info: string = ""
) => {
  const balance = await getSPLBalance(connection, mintAddress, user);
  if (balance === null) {
    console.log(
      `${info ? info + " " : ""}${user.toBase58()}:`,
      "No Account Found"
    );
  } else {
    console.log(`${info ? info + " " : ""}${user.toBase58()}:`, balance);
  }
};

export const baseToValue = (base: number, decimals: number): number => {
  return base * Math.pow(10, decimals);
};

export const valueToBase = (value: number, decimals: number): number => {
  return value / Math.pow(10, decimals);
};

//i.e. account:BondingCurve
export function getDiscriminator(name: string) {
  return sha256.digest(name).slice(0, 8);
}

export const buildVersionedTx = async (
  connection: Connection,
  payer: PublicKey,
  tx: Transaction,
  commitment: Commitment = DEFAULT_COMMITMENT
): Promise<VersionedTransaction> => {
  const blockHash = (await connection.getLatestBlockhash(commitment))
    .blockhash;

  let messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockHash,
    instructions: tx.instructions,
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
};