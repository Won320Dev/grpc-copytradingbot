import mongoose, { Schema, Document } from 'mongoose';
import { MONGO_URI } from './config';
import { CopyOrder } from './models/CopyOrder';
import { MyWallet } from './models/MyWallet';
import { TargetWallet } from './models/TargetWallet';
import { User } from './models/User';
import { Setting } from './models/Setting';

export const connect = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

export const createMyWallet = async (data: any) => {
  try {
    const newOne = new MyWallet(data);
    await newOne.save();
    return true;
  } catch (error) {
    console.error('MyWallet, createOne, error = ', error);
    return false;
  }
}

export const getMyWallets = async (chatId: number) => {
  try {
    let wallets;
    wallets = await MyWallet.find({ chatId });
    return wallets;
  } catch (error) {
    console.error('MyWallet, getWallets, error = ', error);
    return null;
  }
}

export const getMyWalletsCount = async (chatId: number) => {
  try {
    const wallets = await MyWallet.find({ chatId });
    return wallets.length;
  } catch (error) {
    console.error('MyWallet, getMyWalletsCount, error = ', error);
    return 0;
  }
}

export const getTargetWallets = async (chatId: number) => {
  try {
    let wallets;
    wallets = await TargetWallet.find({ chatId });
    return wallets;
  } catch (error) {
    return null;
  }
}

export const getTargetWallet = async (chatId: number, publicKey: string) => {
  try {
    const wallet = await TargetWallet.findOne({ chatId, publicKey });
    return wallet;
  } catch (error) {
    return null;
  }
}

export const getTargetWalletById = async (id: string) => {
  try {
    const wallet = await TargetWallet.findById(id)
    return wallet;
  } catch (error) {
    return null;
  }
}

export const getCopyOrders = async (chatId: number) => {
  try {
    let orders;
    orders = await CopyOrder.find({ chatId }).populate('myWallet', 'name').populate('targetWallet', 'name').exec();
    return orders;
  } catch (error) {
    return null;
  }
}

export const getOrderById = async (id: string) => {
  try {
    const order = await CopyOrder.findById(id);
    return order;
  } catch (error) {
    return null;
  }
}

export const getMyWallet = async (chatId: number, address: string) => {
  try {
    const wallet = await MyWallet.findOne({ chatId, publicKey: address })
    return wallet;
  } catch (error) {
    return null;
  }
}

export const getMyWalletById = async (id: string) => {
  try {
    const wallet = await MyWallet.findById(id)
    return wallet;
  } catch (error) {
    return null;
  }
}

export const saveNewOrder = async (chatId: number, order: any) => {
  console.log('chatId  = ', chatId);
  try {
    let count = 0;
    let id;
    const wallet = await getTargetWallet(chatId, order.targetWallet);

    if (wallet) {
      id = wallet._id;
    } else {
      const wallets = await getTargetWallets(chatId);
      if (wallets)
        count = wallets.length;
      else
        count = 0;
      const twallet = new TargetWallet({
        chatId,
        publicKey: order.targetWallet,
        name: `T${count + 1}`
      })
      console.log('twallet = ', twallet);
      const saved = await twallet.save();
      console.log('saved = ', saved);
      id = saved._id;
    }

    const copyOrder = await CopyOrder.findOne({ myWallet: order.myWalletId, targetWallet: id });
    if (copyOrder) {
      console.log('duplicate copy order');
      return null;
    } else {
      const _order = {
        chatId,
        myWallet: order.myWalletId,
        targetWallet: id,
        active: true,
        mode: order.mode,
        propRate: order.propRate,
        fixAmount: order.fixAmount,
        slippage: order.slippage,
        tp: order.tp,
        tpOn: order.tpOn,
        sl: order.sl,
        slOn: order.slOn,
        monitorId: -1,
      }

      const newOrder = new CopyOrder(_order);

      const savedOrder = await newOrder.save();

      return savedOrder;
    }

  } catch (error) {
    console.log('saveNewOrder, error = ', error);
    return null;
  }
}

export const updateCopyOrder = async (data: any) => {
  try {
    let order = await CopyOrder.findById(data._id);
    if (order) {
      order.chatId = data.chatId;
      order.myWallet = data.myWallet;
      order.targetWallet = data.targetWallet;
      order.active = data.active;
      order.mode = data.mode;
      order.propRate = data.propRate;
      order.fixAmount = data.fixAmount;
      order.slippage = data.slippage;
      order.sl = data.sl;
      order.tp = data.tp;
      order.tpOn = data.tpOn;
      order.slOn = data.slOn;
      await order.save();
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

export const deleteCopyOrder = async (data: any) => {
  try {
    const deleted = await CopyOrder.findByIdAndDelete(data._id);
    return deleted;
  } catch (error) {
    return null;
  }
}

export const getSetting = async (chatId: number) => {
  try {
    const setting = await Setting.findOne({ chatId });
    return setting;
  } catch (error) {
    return null;
  }
}

export const updateSetting = async (chatId: number, data: any) => {
  try {
    console.log('updateSetting, data = ', data);
    const setting = await Setting.findOneAndUpdate({ chatId }, { chatId, ...data });
    if (!setting) {
      const setting = new Setting({ chatId, ...data });
      await setting.save();
    }
    return true;
  } catch (error) {
    return null;
  }
}