import { Schema, model, Document } from 'mongoose';

interface IPosition extends Document {
    chatId: number;
    copyOrder: Schema.Types.ObjectId;
    myWallet: Schema.Types.ObjectId;
    tokenSymbol: string;
    tokenAddress: string;
    tokenDecimals: number;
    tokenBalance: number;
    targetTokenBalance: number;
    buys: number;
    sells: number;
    totalBuySols: number;
    totalSellSols: number;
    dex: string;
}

const schema: Schema = new Schema({
    chatId: { type: Number, required: true },
    copyOrder: { type: Schema.Types.ObjectId, ref: 'CopyOrder' },
    myWallet: { type: Schema.Types.ObjectId, ref: 'MyWallet' },
    tokenSymbol: { type: String, required: true },
    tokenAddress: { type: String, required: true },
    tokenDecimals: { type: Number, required: true },
    tokenBalance: { type: Number, required: true },
    targetTokenBalance: { type: Number, required: true },
    buys: { type: Number, required: true },
    sells: { type: Number, required: true },
    totalBuySols: { type: Number, required: true },
    totalSellSols: { type: Number, required: true },
    dex: { type: String }
});

export const Position = model<IPosition>('Position', schema);