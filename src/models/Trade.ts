import { Schema, model, Document } from 'mongoose';

interface ITrade extends Document {
    chatId: number;
    myWallet: Schema.Types.ObjectId;
    buyOrSell: string;
    tokenSymbol: string;
    tokenAddress: string;
    tokenAmount: number;
    solAmount: number;
    signature: string;
    pnl: number;
}

const schema: Schema = new Schema({
    chatId: { type: Number, required: true },
    myWallet: { type: Schema.Types.ObjectId, ref: 'MyWallet' },
    buyOrSell: { type: String, required: true },
    tokenSymbol: { type: String, required: true },
    tokenAddress: { type: String, required: true },
    tokenAmount: { type: Number, required: true },
    solAmount: { type: Number, required: true},
    signature: { type: String, required: true },
    pnl: { type: Number } 
});

export const Trade = model<ITrade>('Trade', schema);