import { Schema, model, Document } from 'mongoose';

interface ISetting extends Document {
    chatId: number;
    jitoTip: number;
    maxBuy: number;
    minLp: number;
    takeProfit: number;
    stopLoss: number;
    fixedAutoSell: number;
}

const schema: Schema = new Schema({
    chatId: { type: Number, required: true, unique: true },
    jitoTip: { type: Number },
    maxBuy: { type: Number },
    minLp: { type: Number },
    takeProfit: { type: Number },
    stopLoss: { type: Number },
    fixedAutoSell: { type: Number },
});

export const Setting = model<ISetting>('Setting', schema);