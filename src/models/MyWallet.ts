import { Schema, model, Document } from 'mongoose';

interface IMyWallet extends Document {
    chatId: number;
    privateKey: string;
    publicKey: string;
    name: string;
}

const schema: Schema = new Schema({
    chatId: { type: Number, required: true },
    privateKey: { type: String, required: true, unique: true },
    publicKey: { type: String, required: true, unique: true },
    name: { type: String, required: true },
});

export const MyWallet = model<IMyWallet>('MyWallet', schema);