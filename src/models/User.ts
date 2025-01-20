import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
    chatId: number;
    userName: string;
}

const UserSchema: Schema = new Schema({
    chatId: { type: Number, required: true },
    userName: { type: String, required: true },
});

export const User = model<IUser>('User', UserSchema);

