import "dotenv/config";
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
import { SubscribeRequestPing } from "@triton-one/yellowstone-grpc/dist/grpc/geyser";
import { VersionedTransactionResponse } from "@solana/web3.js";
import { SolanaParser } from "@shyft-to/solana-transaction-parser";
import { TransactionFormatter } from "./utils/transaction-formatter";
import { RaydiumAmmParser } from "./parsers/raydium-amm-parser";
import { LogsParser } from "./parsers/logs-parser";
import { bnLayoutFormatter } from "./utils/bn-layout-formatter";
import * as base58 from "bs58";
import {
  LIQUIDITY_STATE_LAYOUT_V4,
  struct,
  u64,
  u8
} from "@raydium-io/raydium-sdk";
import { tOutPut } from "./utils/transactionOutput";
import { decodeTransact } from "./utils/decodeTransaction";
import { forEach } from "lodash";

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
  ping?: SubscribeRequestPing | undefined;
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

function analyzeTx(trx: any, instructions: any) {
  const message = trx.transaction.message;
  const accountKeys = message.accountKeys.map((key: any) =>
    decodeTransact(key)
  );

  const meta = trx.meta;

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
  meta.innerInstructions.forEach((innerInstruction: any) => {
    if (
      accountKeys[
        message.instructions[innerInstruction.index].programIdIndex
      ] == "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
    ) {
      // raydium swap
      let num = 0;
      innerInstruction.instructions.forEach((ins: any) => {
        if (Array.from(ins.data)[0] == 3) {
          num = (num + 1) % 2;
          // transfer
          //@ts-ignore
          const from = accountKeys[Array.from(ins.accounts)[0]];
          //@ts-ignore
          const to = accountKeys[Array.from(ins.accounts)[1]];
          const data = LAYOUT.decode(Buffer.from(ins.data));

          const tokenBalance = meta.preTokenBalances.filter(
            (preTokenBalance: any) =>
              preTokenBalance.accountIndex == Array.from(ins.accounts)[num]
          );

          if (num == 1) {
            if (
              tokenBalance[0].mint ==
              "So11111111111111111111111111111111111111112"
            ) {
              isBuy = true;
              preSol = tokenBalance[0].uiTokenAmount.uiAmount;
              postSol = preSol + data.amount / 10 ** 9;
              solAmount = Number(data.amount);
            } else {
              token = tokenBalance[0].mint;
              isBuy = false;
              preToken = tokenBalance[0].uiTokenAmount.uiAmount;
              postToken =
                preToken +
                data.amount / 10 ** tokenBalance[0].uiTokenAmount.decimals;
              tokenAmount = Number(data.amount);
            }
          } else {
            if (
              tokenBalance[0].mint ==
              "So11111111111111111111111111111111111111112"
            ) {
              isBuy = false;
              preSol = tokenBalance[0].uiTokenAmount.uiAmount;
              postSol = preSol - data.amount / 10 ** 9;
              solAmount = Number(data.amount);
            } else {
              token = tokenBalance[0].mint;
              isBuy = true;
              preToken = tokenBalance[0].uiTokenAmount.uiAmount;
              postToken =
                preToken -
                data.amount / 10 ** tokenBalance[0].uiTokenAmount.decimals;
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
    postToken
  };
}

async function handleStream(client: Client, args: SubscribeRequest) {
  // Subscribe for events
  const stream = await client.subscribe();

  // Create `error` / `end` handler
  const streamClosed = new Promise<void>((resolve, reject) => {
    stream.on("error", (error) => {
      console.log("ERROR", error);
      reject(error);
      stream.end();
    });
    stream.on("end", () => {
      resolve();
    });
    stream.on("close", () => {
      resolve();
    });
  });

  // Handle updates
  stream.on("data", (data) => {
    // if (data?.transaction && flag) {
    if (data?.transaction) {
      const txn = TXN_FORMATTER.formTransactionFromJson(
        data.transaction,
        Date.now()
      );
      const parsedTxn = decodeRaydiumTxn(txn);
      //@ts-ignore
      if (parsedTxn?.instructions.length != 1) return;
      
      // console.log(
      //   "-----------------------------------------------result-----------------------------------------------"
      // );
      // console.log(
      //   "transaction--",
      //   JSON.stringify(data.transaction.transaction)
      // );

      const result = analyzeTx(
        data.transaction.transaction,
        parsedTxn?.instructions
      );

      console.log(
        // new Date(),
        // ":",
        // `New transaction https://translator.shyft.to/tx/${txn.transaction.signatures[0]} \n`,
        // JSON.stringify(parsedTxn, null, 2) + "\n",
        result,
        txn.transaction.signatures[0]
      );
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

async function subscribeCommand(client: Client, args: SubscribeRequest) {
  while (true) {
    try {
      await handleStream(client, args);
    } catch (error) {
      console.error("Stream error, restarting in 1 second...", error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const client = new Client(
  "http://grpc.solanavibestation.com:10000",
  "",
  {
    "grpc.max_receive_message_length": 256 * 1024 * 1024, // 64MiB
  }
);

const req: SubscribeRequest = {
  // accounts: {},
  accounts: {
    raydium: {
      account: [],
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
      owner: ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"]
    }
  },
  slots: {},
  transactions: {
    raydiumLiquidityPoolV4: {
      vote: false,
      failed: false,
      signature: undefined,
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
  ping: undefined,
  commitment: CommitmentLevel.PROCESSED
};

subscribeCommand(client, req);

function decodeRaydiumTxn(tx: VersionedTransactionResponse) {
  if (tx.meta?.err) return;

  const parsedIxs = IX_PARSER.parseTransactionWithInnerInstructions(tx);
  // const parsedIxs = IX_PARSER.parseParsedTransactionWithInnerInstructions(tx);
  // const parsedIxs = IX_PARSER.parseTransactionData(tx.transaction.message, tx.meta?.loadedAddresses);

  const programIxs = parsedIxs.filter(
    (ix) => ix.programId.equals(RAYDIUM_PUBLIC_KEY) && ix.name == "swapBaseIn"
  );

  if (programIxs.length === 0) return;

  //@ts-ignore
  // const LogsEvent = LOGS_PARSER.parse(programIxs, tx.meta.logMessages);
  // const result = { events: LogsEvent };
  // const result = { instructions: programIxs, events: LogsEvent };
  const result = { instructions: programIxs };
  bnLayoutFormatter(result);
  return result;
}
