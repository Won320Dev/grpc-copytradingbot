import { Schema, model, Document } from 'mongoose';

interface ITargetWallet extends Document {
    chatId: number;
    publicKey: string;
    name: string;
}

const schema: Schema = new Schema({
    chatId: { type: Number },
    publicKey: { type: String },
    name: { type: String },
});

export const TargetWallet = model<ITargetWallet>('TargetWallet', schema);