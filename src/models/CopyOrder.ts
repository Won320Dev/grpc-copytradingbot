import { Schema, model, Document } from 'mongoose';

interface ICopyOrder extends Document {
    chatId: number;
    myWallet: Schema.Types.ObjectId;
    targetWallet: Schema.Types.ObjectId;
    active: boolean;
    mode: string;
    propRate: number;
    fixAmount: number;
    slippage: number;
    tp: number;
    tpOn: boolean;
    sl: number;
    slOn: boolean;
    subscriptionId: number;
    monitorId: number;
}

const schema: Schema = new Schema({
    chatId: { type: Number, required: true },
    myWallet: { type: Schema.Types.ObjectId, ref: 'MyWallet' },
    targetWallet: { type: Schema.Types.ObjectId, ref: 'TargetWallet' },
    active: { type: Boolean, default: true },
    mode: { type: String },
    propRate: { type: Number },
    fixAmount: { type: Number },
    slippage: { type: Number },
    tp: { type: Number },
    tpOn: { type: Boolean },
    sl: { type: Number },
    slOn: { type: Boolean },
    subscriptionId: { type: Number },
    monitorId: { type: Number }
});

export const CopyOrder = model<ICopyOrder>('Order', schema);