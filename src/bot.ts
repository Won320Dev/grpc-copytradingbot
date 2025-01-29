import TelegramBot from 'node-telegram-bot-api';
import * as config from './config';
import * as Solanalib from './solana';
import * as database from './db';
import { Position } from './models/Position';
import { CopyOrder } from './models/CopyOrder';
import { subscribe, unsubscribe } from './copytrade';
import { MyWallet } from './models/MyWallet';
import { Setting } from './models/Setting';
import { Trade } from './models/Trade';
import { TargetWallet } from './models/TargetWallet';
import { PublicKey } from '@solana/web3.js';
import { User } from './models/User';

export const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

// temp values
let inputState = new Map();
let messageIds = new Map();
let newOrder = new Map();
let changeOrder = new Map();
let settings = new Map();
let sellSettings = new Map();
let deleteMessages = new Map();
let withdrawSettings = new Map();

export const getSellSetting = (posId: string) => {
    return sellSettings.get(posId);
}

export const setSellSetting = (posId: string, data: any) => {
    console.log(`setSellSetting, posId = ${posId}, data = ${data}`);
    sellSettings.set(posId.toString(), data);
}

export const default_setting = {
    jitoTip: config.JITO_TIP,
    maxBuy: config.MAX_BUY,
    minLp: config.MIN_LP,
    takeProfit: config.TP,
    stopLoss: config.SL,
    fixedAutoSell: config.AUTO_SELL,
}

export const init = () => {
    bot.setMyCommands(
        [
            { command: 'start', description: 'Show main menu' },
            { command: 'copytrades', description: 'Manage copytrades' },
            { command: 'positions', description: 'Manage positions' },
            { command: 'trades', description: 'Show recent trades' },
            { command: 'settings', description: 'Manage settings' },
        ],
    ).catch((error) => {
        console.error('Error setting custom commands:', error);
    });

    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        // subscribe("sdfasdfas");
        const userName = msg.chat.username;
        if (config.privated && !config.ALLOWED.includes(Number(chatId))) {
            bot.sendMessage(config.ALERT_CHATID, `New User started ${msg.chat.username}, chatId = ${chatId}`);
            bot.sendMessage(chatId, "This is a private bot. Pleasae wait for approvement");
            return;
        }

        const user = await User.findOne({ chatId });
        if (!user) {
            console.log(`New User ${msg.chat.username}, chatId = ${chatId}`);
            bot.sendMessage(config.ALERT_CHATID, `New User started ${msg.chat.username}, chatId = ${chatId}`);
            const user = new User({ chatId, userName });
            await user.save();
        }

        const { title, buttons } = getUiOfStart(chatId);
        bot.sendMessage(chatId, title, {
            parse_mode: "HTML", reply_markup: {
                inline_keyboard: buttons
            },
        });
    }
    );

    bot.onText(/\/copytrades/, async (msg) => {
        const chatId = msg.chat.id;
        if (config.privated && !config.ALLOWED.includes(Number(chatId))) {
            bot.sendMessage(chatId, 'This is a private bot.');
            return;
        }
        const { title, buttons } = await getUiOfCopytrades(chatId);
        bot.sendMessage(chatId, title, {
            parse_mode: "HTML", reply_markup: {
                inline_keyboard: buttons
            },
        });
    });

    bot.onText(/\/positions/, async (msg) => {
        const chatId = msg.chat.id;
        if (config.privated && !config.ALLOWED.includes(Number(chatId))) {
            bot.sendMessage(chatId, 'This is a private bot.');
            return;
        }
        const { title, buttons } = await getUiOfPositions(chatId);
        if (!title || !buttons)
            bot.sendMessage(chatId, 'You have no any wallets to show positions').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) })
        else
            bot.sendMessage(chatId, title, {
                parse_mode: "HTML", reply_markup: {
                    inline_keyboard: buttons
                },
            });
    });

    bot.onText(/\/trades/, async (msg) => {
        const chatId = msg.chat.id;
        if (config.privated && !config.ALLOWED.includes(Number(chatId))) {
            bot.sendMessage(chatId, 'This is a private bot.');
            return;
        }
        const { title, buttons } = await getUiOfTrades(chatId);
        bot.sendMessage(chatId, title, {
            parse_mode: "Markdown", reply_markup: {
                inline_keyboard: buttons
            },
            disable_web_page_preview: true
        });

    });
    bot.onText(/\/settings/, async (msg) => {
        const chatId = msg.chat.id;
        const name = msg.from?.first_name || 'there';

        if (config.privated && !config.ALLOWED.includes(Number(chatId))) {
            bot.sendMessage(chatId, 'This is a private bot.');
            return;
        }

        const ui = await getUiOfSetting(chatId);
        if (ui)
            bot.sendMessage(chatId, ui.title, {
                parse_mode: "HTML", reply_markup: {
                    inline_keyboard: ui.buttons
                },
            });
    });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text || '';
        if (config.privated && !config.ALLOWED.includes(Number(chatId))) {
            bot.sendMessage(chatId, 'This is a private bot.');
            return;
        }
        if (chatId && text && inputState.get(chatId)) {
            if (inputState.get(chatId) == 'input_privatekey') {
                const publicKey = Solanalib.getPublicKey(text);
                if (!publicKey) {
                    bot.sendMessage(chatId, 'Invalid private key!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                } else {
                    const count = await database.getMyWalletsCount(chatId);
                    const wallet = await MyWallet.findOne({ chatId, publicKey });
                    if (wallet) {
                        bot.sendMessage(chatId, 'That wallet has already imported');
                        return;
                    }
                    await database.createMyWallet({ chatId, privateKey: text, publicKey, name: `W${count + 1}` });
                    const { title, buttons } = await getUiOfCopytrades(chatId);
                    const messageId = messageIds.get(chatId);
                    switchMenu(chatId, messageId, title, buttons);
                    bot.deleteMessage(chatId, msg.message_id);
                    bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    inputState.set(chatId, 'none');
                }
            } else if (inputState.get(chatId) == 'input_wallet_address') {
                const wallet = await database.getMyWallet(chatId, text);
                if (!wallet)
                    bot.sendMessage(chatId, 'Invalid wallet address!').then((msg) => {
                        setTimeout(() => {
                            bot.deleteMessage(chatId, msg.message_id);
                        }, 3000);
                    });
                else {
                    let order = newOrder.get(chatId);
                    order.myWalletName = wallet.name;
                    order.myWalletId = wallet._id;
                    newOrder.set(chatId, order);
                    const ui = await getUiOfCreateOrder(chatId);
                    if (ui) {
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    } else {
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    }

                }
            } else if (inputState.get(chatId) == 'input_target_address') {
                const isValid = await Solanalib.isValidAddress(text);
                if (!isValid)
                    bot.sendMessage(chatId, 'Invalid wallet address!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let order = newOrder.get(chatId);
                    order.targetWallet = text;
                    newOrder.set(chatId, order);
                    const ui = await getUiOfCreateOrder(chatId);
                    if (ui) {
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    } else {
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    }
                }
            } else if (inputState.get(chatId) == 'input_prop_rate') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0 || Number(text) > 100)
                    bot.sendMessage(chatId, 'Invalid percent value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let order = newOrder.get(chatId);
                    order.mode = 'prop';
                    order.propRate = Number(text);
                    newOrder.set(chatId, order);
                    const ui = await getUiOfCreateOrder(chatId);
                    if (ui) {
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    } else {
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    }
                }
            } else if (inputState.get(chatId) == 'input_fix_amount') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0)
                    bot.sendMessage(chatId, 'Invalid amount value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let order = newOrder.get(chatId);
                    order.mode = 'fix';
                    order.fixAmount = Number(text);
                    newOrder.set(chatId, order);
                    const ui = await getUiOfCreateOrder(chatId);
                    if (ui) {
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    } else {
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    }
                }
            } else if (inputState.get(chatId) == 'input_slippage_amount') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0 || Number(text) >= 100)
                    bot.sendMessage(chatId, 'Invalid slippage value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let order = newOrder.get(chatId);
                    order.slippage = Number(text);
                    newOrder.set(chatId, order);
                    const ui = await getUiOfCreateOrder(chatId);
                    if (ui)
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                    else
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                    bot.deleteMessage(chatId, msg.message_id);
                    bot.deleteMessage(chatId, deleteMessages.get(chatId));
                }
            } else if (inputState.get(chatId) == 'change_input_prop_rate') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0 || Number(text) > 100)
                    bot.sendMessage(chatId, 'Invalid percent value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let order = changeOrder.get(chatId);
                    order.mode = 'prop';
                    order.propRate = Number(text);
                    database.updateCopyOrder(order);
                    changeOrder.set(chatId, order);
                    const ui = await getUiOfChangeOrder(chatId);
                    if (ui) {
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    }
                }
            } else if (inputState.get(chatId) == 'change_input_fix_amount') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0)
                    bot.sendMessage(chatId, 'Invalid amount value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let order = changeOrder.get(chatId);
                    order.mode = 'fix';
                    order.fixAmount = Number(text);
                    database.updateCopyOrder(order);
                    changeOrder.set(chatId, order);
                    const ui = await getUiOfChangeOrder(chatId);
                    if (ui) {
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    }
                }
            } else if (inputState.get(chatId) == 'change_input_slippage_amount') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0 || Number(text) >= 100)
                    bot.sendMessage(chatId, 'Invalid slippage value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let order = changeOrder.get(chatId);
                    order.slippage = Number(text);
                    database.updateCopyOrder(order);
                    changeOrder.set(chatId, order);
                    const ui = await getUiOfChangeOrder(chatId);
                    if (ui) {
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    } else {
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    }

                }
            } else if (inputState.get(chatId) == 'input_jitotip_amount') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0)
                    bot.sendMessage(chatId, 'Invalid value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let setting = settings.get(chatId);
                    setting.jitoTip = Number(text);
                    await database.updateSetting(Number(chatId), setting);
                    settings.set(chatId, setting);
                    const ui = await getUiOfSetting(chatId);
                    if (ui)
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                    else
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                    bot.deleteMessage(chatId, msg.message_id);
                    bot.deleteMessage(chatId, deleteMessages.get(chatId));
                }
            } else if (inputState.get(chatId) == 'input_maxbuy_amount') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0)
                    bot.sendMessage(chatId, 'Invalid value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let setting = settings.get(chatId);
                    setting.maxBuy = Number(text);
                    await database.updateSetting(Number(chatId), setting);
                    settings.set(chatId, setting);
                    const ui = await getUiOfSetting(chatId);
                    if (ui)
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                    else
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                    bot.deleteMessage(chatId, msg.message_id);
                    bot.deleteMessage(chatId, deleteMessages.get(chatId));
                }
            } else if (inputState.get(chatId) == 'input_minlp_amount') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0)
                    bot.sendMessage(chatId, 'Invalid value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let setting = settings.get(chatId);
                    setting.minLp = Number(text);
                    await database.updateSetting(Number(chatId), setting);
                    settings.set(chatId, setting);
                    const ui = await getUiOfSetting(chatId);
                    if (ui)
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                    else
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                    bot.deleteMessage(chatId, msg.message_id);
                    bot.deleteMessage(chatId, deleteMessages.get(chatId));
                }
            } else if (inputState.get(chatId) == 'input_takeprofit_amount') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0)
                    bot.sendMessage(chatId, 'Invalid value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let order = newOrder.get(chatId);
                    order.tp = Number(text);
                    newOrder.set(chatId, order);
                    const ui = await getUiOfCreateOrder(chatId);
                    if (ui)
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                    else
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                    bot.deleteMessage(chatId, msg.message_id);
                    bot.deleteMessage(chatId, deleteMessages.get(chatId));
                }
            } else if (inputState.get(chatId) == 'change_takeprofit_amount') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0)
                    bot.sendMessage(chatId, 'Invalid value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let order = changeOrder.get(chatId);
                    order.tp = Number(text);
                    changeOrder.set(chatId, order);
                    database.updateCopyOrder(order);
                    const ui = await getUiOfChangeOrder(chatId);
                    if (ui) {

                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    }
                }
            } else if (inputState.get(chatId) == 'input_stoploss_amount') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0)
                    bot.sendMessage(chatId, 'Invalid value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let order = newOrder.get(chatId);
                    order.sl = Number(text);
                    newOrder.set(chatId, order);
                    const ui = await getUiOfCreateOrder(chatId);
                    if (ui) {
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                    } else {
                        bot.deleteMessage(chatId, messageIds.get(chatId))
                    }
                    bot.deleteMessage(chatId, msg.message_id);
                    bot.deleteMessage(chatId, deleteMessages.get(chatId));
                }
            } else if (inputState.get(chatId) == 'change_stoploss_amount') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0)
                    bot.sendMessage(chatId, 'Invalid value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let order = changeOrder.get(chatId);
                    order.sl = Number(text);
                    changeOrder.set(chatId, order);
                    database.updateCopyOrder(order);
                    const ui = await getUiOfChangeOrder(chatId);
                    if (ui) {

                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    }
                }
            } else if (inputState.get(chatId) == 'input_stoploss_amount') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0)
                    bot.sendMessage(chatId, 'Invalid value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let setting = settings.get(chatId);
                    setting.stopLoss = Number(text);
                    await database.updateSetting(Number(chatId), setting);
                    settings.set(chatId, setting);
                    const ui = await getUiOfSetting(chatId);
                    if (ui)
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                    else
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                    bot.deleteMessage(chatId, msg.message_id);
                    bot.deleteMessage(chatId, deleteMessages.get(chatId));
                }
            } else if (inputState.get(chatId) == 'input_autosell_amount') {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0)
                    bot.sendMessage(chatId, 'Invalid value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    let setting = settings.get(chatId);
                    setting.fixedAutoSell = Number(text);
                    await database.updateSetting(Number(chatId), setting);
                    settings.set(chatId, setting);
                    const ui = await getUiOfSetting(chatId);
                    if (ui)
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                    else
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                    bot.deleteMessage(chatId, msg.message_id);
                    bot.deleteMessage(chatId, deleteMessages.get(chatId));
                }
            } else if (inputState.get(chatId).startsWith('input_sell_amount_')) {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0 || Number(text) >= 100)
                    bot.sendMessage(chatId, 'Invalid value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    const posId = inputState.get(chatId).replace('input_sell_amount_', '');
                    const sellSetting = sellSettings.get(posId);
                    sellSetting.sellmode = text;
                    sellSettings.set(posId, sellSetting);
                    const { title, buttons } = await getUiOfSell(posId);
                    if (title && buttons) {
                        switchMenu(chatId, messageIds.get(chatId), title, buttons);
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    } else {
                        bot.sendMessage(chatId, 'Internal Error, Retry later');
                    }
                }
            } else if (inputState.get(chatId).startsWith('input_sell_slippage_amount_')) {
                const isNumber = Solanalib.isNumber(text);
                if (!isNumber || Number(text) <= 0 || Number(text) >= 100)
                    bot.sendMessage(chatId, 'Invalid value!').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                else {
                    const posId = inputState.get(chatId).replace('input_sell_slippage_amount_', '');
                    const sellSetting = sellSettings.get(posId);
                    sellSetting.slippage = text;
                    sellSettings.set(posId, sellSetting);
                    const { title, buttons } = await getUiOfSell(posId);
                    if (title && buttons) {
                        switchMenu(chatId, messageIds.get(chatId), title, buttons);
                        bot.deleteMessage(chatId, msg.message_id);
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    } else {
                        bot.sendMessage(chatId, 'No Position');
                        bot.deleteMessage(chatId, deleteMessages.get(chatId));
                    }
                }
            } else if (inputState.get(chatId) == 'rename_my_address') {
                const myWallet = await MyWallet.findOne({ publicKey: text });
                if (!myWallet) {
                    bot.sendMessage(chatId, 'You have no such wallet, Please check wallet address again');
                    return;
                }
                inputState.set(chatId, "none");
                await Solanalib.sleep(500);
                bot.deleteMessage(chatId, msg.message_id);
                await Solanalib.sleep(500);
                bot.deleteMessage(chatId, deleteMessages.get(chatId));
                const message = await bot.sendMessage(chatId, `Please input new name for wallet-${myWallet.name}-${myWallet.publicKey}`);
                bot.once('message', async (newMsg) => {
                    const walletName = newMsg.text; // Update wallet name
                    if (walletName) {
                        myWallet.name = walletName;
                        await myWallet.save();
                        const { title, buttons } = await getUiOfCopytrades(chatId);
                        switchMenu(chatId, messageIds.get(chatId), title, buttons);
                        await Solanalib.sleep(500);
                        bot.deleteMessage(chatId, message.message_id);
                        await Solanalib.sleep(500);
                        bot.deleteMessage(chatId, newMsg.message_id);
                    }
                });
            } else if (inputState.get(chatId) == 'rename_target_address') {
                const targetWallet = await TargetWallet.findOne({ chatId, publicKey: text });
                if (!targetWallet) {
                    bot.sendMessage(chatId, 'You have no such target wallet, Please check wallet address again');
                    return;
                }
                inputState.set(chatId, "none");
                await Solanalib.sleep(500);
                bot.deleteMessage(chatId, msg.message_id);
                await Solanalib.sleep(500);
                bot.deleteMessage(chatId, deleteMessages.get(chatId));
                const message = await bot.sendMessage(chatId, `Please input new name for target wallet-${targetWallet.name} - ${targetWallet.publicKey}`, { parse_mode: "HTML" });
                bot.once('message', async (newMsg) => {
                    const walletName = newMsg.text; // Update wallet name
                    if (walletName) {
                        targetWallet.name = walletName;
                        await targetWallet.save();
                        const { title, buttons } = await getUiOfCopytrades(chatId);
                        switchMenu(chatId, messageIds.get(chatId), title, buttons);
                        await Solanalib.sleep(500);
                        bot.deleteMessage(chatId, message.message_id);
                        await Solanalib.sleep(500);
                        bot.deleteMessage(chatId, newMsg.message_id);
                    }
                });
            } else if (inputState.get(chatId) == 'remove_address') {
                const myWallet = await MyWallet.findOne({ chatId, publicKey: text });
                const targetWallet = await TargetWallet.findOne({ chatId, publicKey: text });
                if (!myWallet && !targetWallet) {
                    bot.sendMessage(chatId, 'You have no such wallet, Please check wallet address again');
                    return;
                }

                if (myWallet) {

                    // check copyorders
                    const copytrades = await CopyOrder.find({ chatId, myWallet: myWallet._id });
                    if (copytrades && copytrades.length > 0) {
                        bot.sendMessage(chatId, 'You have copy orders with personal wallet');
                        return;
                    }

                    // check positions
                    const positions = await Position.find({ chatId, myWallet: myWallet._id });
                    if (positions && positions.length > 0) {
                        bot.sendMessage(chatId, 'You have positions with personal wallet');
                        return;
                    }

                    // delete wallet
                    await MyWallet.findOneAndDelete({ chatId, publicKey: text });

                    // delete trades
                    Trade.deleteMany({ chatId, myWallet: myWallet._id });

                    // update UI
                    const { title, buttons } = await getUiOfCopytrades(chatId);
                    switchMenu(chatId, messageIds.get(chatId), title, buttons);

                }

                if (targetWallet) {

                    // check copyorders
                    const copytrades = await CopyOrder.find({ chatId, targetWallet: targetWallet._id });
                    if (copytrades && copytrades.length > 0) {
                        bot.sendMessage(chatId, 'You have copy orders with target wallet');
                    }

                    // delete target wallet
                    await TargetWallet.findOneAndDelete({ chatId, publicKey: text });

                    // update UI
                    const { title, buttons } = await getUiOfCopytrades(chatId);
                    switchMenu(chatId, messageIds.get(chatId), title, buttons);

                }

                inputState.set(chatId, "none");
                await Solanalib.sleep(500);
                bot.deleteMessage(chatId, msg.message_id);
                await Solanalib.sleep(500);
                bot.deleteMessage(chatId, deleteMessages.get(chatId));

            } else if (inputState.get(chatId) == 'withdraw_my_address') {
                const myWallet = await MyWallet.findOne({ publicKey: text });
                if (!myWallet) {
                    bot.sendMessage(chatId, 'You have no such wallet, Please check wallet address again');
                    return;
                }
                inputState.set(chatId, "none");
                await Solanalib.sleep(500);
                bot.deleteMessage(chatId, msg.message_id);
                await Solanalib.sleep(500);
                bot.deleteMessage(chatId, deleteMessages.get(chatId));
                const message = await bot.sendMessage(chatId, `Please input withraw amount`);

            }
        }
    });

    bot.on('callback_query', async (query) => {
        // console.log("callback_query = ", query);
        try {
            const chatId = query.message!.chat.id;
            const messageId = query.message!.message_id;
            if (config.privated && !config.ALLOWED.includes(Number(chatId))) {
                bot.sendMessage(chatId, 'This is a private bot.');
                return;
            }
            const data = query.data;
            console.log(`callback query data = ${data}`);
            if (data) {
                if (data == 'copytrades') {
                    showCopyTrades(query);
                } else if (data == 'remove_trades') {
                    await Trade.deleteMany({ chatId });
                    const { title, buttons } = await getUiOfTrades(chatId);
                    switchMenu(chatId, messageId, title, buttons);
                } else if (data == 'wallets') {
                    showWallets(query);
                } else if (data.startsWith('refresh_withdraw_')) {
                    console.log('refresh_withdraw');
                    const wallet_id = data.replace('refresh_withdraw_', '');
                    const { title, buttons } = await getUiOfWithdrawSOL(wallet_id);
                    switchMenu(chatId, messageId, title, buttons);
                } else if (data == 'back_withdraw_wallets') {
                    const { title, buttons } = await getUiOfWithdrawWallets(chatId);
                    switchMenu(chatId, messageId, title, buttons);
                } else if (data.startsWith('withdraw_x_percent_')) {
                    const wallet_id = data.replace('withdraw_x_percent_', '');
                    const message = await bot.sendMessage(chatId, 'Please input withdraw percent');
                    bot.once('message', async (newMsg) => {
                        const percent = newMsg.text; // Update wallet name
                        if (percent && Solanalib.isNumber(percent) && Number(percent) > 0 && Number(percent) <= 100) {
                            const withdraw_setting = withdrawSettings.get(wallet_id);
                            withdraw_setting.mode = 'percent';
                            withdraw_setting.amount = Number(percent);
                            withdrawSettings.set(wallet_id, withdraw_setting);
                            const { title, buttons } = await getUiOfWithdrawSOL(wallet_id);
                            switchMenu(chatId, messageId, title, buttons);

                            // delete input messages
                            await Solanalib.sleep(500);
                            bot.deleteMessage(chatId, newMsg.message_id);
                            await Solanalib.sleep(500);
                            bot.deleteMessage(chatId, message.message_id);
                            //
                        } else {
                            bot.sendMessage(chatId, 'Invalid withdraw percent value, Please input correct value');
                        }
                    });

                } else if (data.startsWith('withdraw_100_')) {
                    const wallet_id = data.replace('withdraw_100_', '');
                    const withdraw_setting = withdrawSettings.get(wallet_id);
                    withdraw_setting.mode = 'percent';
                    withdraw_setting.amount = Number(100);
                    withdrawSettings.set(wallet_id, withdraw_setting);
                    const { title, buttons } = await getUiOfWithdrawSOL(wallet_id);
                    switchMenu(chatId, messageId, title, buttons);

                } else if (data.startsWith('withdraw_x_sol_')) {
                    const wallet_id = data.replace('withdraw_x_sol_', '');
                    const message = await bot.sendMessage(chatId, 'Please input SOL amount');
                    bot.once('message', async (newMsg) => {
                        const amount = newMsg.text; // Update wallet name
                        if (amount && Solanalib.isNumber(amount) && Number(amount) > 0) {
                            const withdraw_setting = withdrawSettings.get(wallet_id);
                            withdraw_setting.mode = 'fix';
                            withdraw_setting.amount = Number(amount);
                            withdrawSettings.set(wallet_id, withdraw_setting);
                            const { title, buttons } = await getUiOfWithdrawSOL(wallet_id);
                            switchMenu(chatId, messageId, title, buttons);

                            // delete input messages
                            await Solanalib.sleep(500);
                            bot.deleteMessage(chatId, newMsg.message_id);
                            await Solanalib.sleep(500);
                            bot.deleteMessage(chatId, message.message_id);
                            //
                        } else {
                            bot.sendMessage(chatId, 'Invalid withdraw percent value, Please input correct value');
                        }
                    });

                } else if (data.startsWith('withdraw_address_')) {
                    try {
                        const wallet_id = data.replace('withdraw_address_', '');
                        const message = await bot.sendMessage(chatId, 'Please input withdraw address');
                        bot.once('message', async (newMsg) => {
                            const address = newMsg.text; // Update wallet name
                            if (address && Solanalib.isValidAddress(address)) {
                                const withdraw_setting = withdrawSettings.get(wallet_id);
                                withdraw_setting.receiver = address;
                                withdrawSettings.set(wallet_id, withdraw_setting);
                                const { title, buttons } = await getUiOfWithdrawSOL(wallet_id);
                                switchMenu(chatId, messageId, title, buttons);

                                // delete input messages
                                await Solanalib.sleep(500);
                                bot.deleteMessage(chatId, newMsg.message_id);
                                await Solanalib.sleep(500);
                                bot.deleteMessage(chatId, message.message_id);
                                //
                            } else {
                                bot.sendMessage(chatId, 'Invalid withdraw percent value, Please input correct value');
                            }
                        });
                    } catch (error) {
                        console.log('error = ', error);
                    }
                } else if (data.startsWith('start_withdraw_')) {
                    try {
                        const wallet_id = data.replace('start_withdraw_', '');
                        const wallet = await MyWallet.findById(wallet_id);
                        const withdraw_setting = withdrawSettings.get(wallet_id);
                        if (!withdraw_setting.receiver) {
                            bot.sendMessage(chatId, 'Please set withdraw address');
                            return;
                        }
                        const balance = await Solanalib.getBalance(Solanalib.CONNECTION, wallet!.publicKey);
                        if (balance == 0) {
                            bot.sendMessage(chatId, 'There is no SOL to withdraw');
                        } else {
                            console.log(`chatId = ${chatId} withdraw_setting = `, withdraw_setting);
                            if (withdraw_setting.mode == 'fix') {
                                if (balance < withdraw_setting.amount) {
                                    bot.sendMessage(chatId, 'There are no SOL in the amount you entered. ');
                                    return;
                                } else {
                                    const keypair = Solanalib.getKeyPairFromPrivateKey(wallet!.privateKey);
                                    bot.sendMessage(chatId, `Withdrawing ${withdraw_setting.amount} SOL to wallet-${withdraw_setting.receiver}`);
                                    const result = await Solanalib.sendSol(Solanalib.CONNECTION, keypair, new PublicKey(withdraw_setting.receiver), Number(withdraw_setting.amount) * Solanalib.LAMPORTS);
                                    if (result)
                                        bot.sendMessage(chatId, `Withdrawing success.`);
                                    else
                                        bot.sendMessage(chatId, 'Withdrawing failed.');
                                }
                            } else { // percent
                                let amount = Math.min(balance * withdraw_setting.amount / 100, balance);
                                console.log('amount = ', amount);
                                const keypair = Solanalib.getKeyPairFromPrivateKey(wallet!.privateKey);
                                bot.sendMessage(chatId, `Withdrawing ${amount} SOL to wallet-${withdraw_setting.receiver}`);
                                const result = await Solanalib.sendSol(Solanalib.CONNECTION, keypair, new PublicKey(withdraw_setting.receiver), Math.round(amount * Solanalib.LAMPORTS));
                                if (result)
                                    bot.sendMessage(chatId, `Withdrawing success.`);
                                else
                                    bot.sendMessage(chatId, 'Withdrawing failed');
                            }
                        }
                    } catch (error) {
                        console.log('error', error);
                        bot.deleteMessage(chatId, messageId);
                    }
                } else if (data.startsWith('withdraw_wallet_')) {
                    const wallet_id = data.replace('withdraw_wallet_', '');
                    // save temp
                    withdrawSettings.set(wallet_id, { mode: 'percent', amount: '100', receiver: '' });
                    // end
                    const { title, buttons } = await getUiOfWithdrawSOL(wallet_id);
                    switchMenu(chatId, messageId, title, buttons);
                } else if (data == 'refresh_orders') {
                    const { title, buttons } = await getUiOfCopytrades(chatId);
                    switchMenu(chatId, messageId, title, buttons);
                } else if (data == 'back_to_walletlist') {
                    showPositions(query);
                } else if (data == 'trades') {
                    const { title, buttons } = await getUiOfTrades(chatId);
                    bot.sendMessage(chatId, title, {
                        parse_mode: "Markdown",
                        reply_markup: {
                            inline_keyboard: buttons
                        },
                        disable_web_page_preview: true
                    });
                } else if (data == 'settings') {
                    showSettings(query);
                } else if (data == 'back') {
                    showMain(query);
                } else if (data == 'back_to_orderlist') {
                    const { title, buttons } = await getUiOfCopytrades(chatId);
                    switchMenu(chatId, messageId, title, buttons);
                } else if (data == 'close') {
                    bot.deleteMessage(chatId, messageId);
                } else if (data == 'create_trade') {
                    newOrder.set(chatId, {
                        myWalletId: null,
                        myWalletName: null,
                        targetWallet: null,
                        mode: "prop",
                        propRate: 100,
                        fixAmount: 1,
                        slippage: 50,
                        tp: 50,
                        tpOn: true,
                        sl: 50,
                        slOn: true,
                    });
                    showCreateCopyTrade(query);
                } else if (data?.startsWith('show_trade')) {
                    const id = data.replace("show_trade_", "");
                    showOneTrade(query, id);
                } else if (data == 'positions') {
                    showPositions(query);
                } else if (data?.startsWith('position_')) {
                    const position_id = data.replace('position_', '');
                    showPosition(query, position_id);
                } else if (data?.startsWith('wallet_')) {
                    const wallet_id = data.replace('wallet_', '');
                    showPositionsOfWallet(query, wallet_id);
                } else if (data == 'create_wallet') {
                    generateWallet(query);
                } else if (data == 'import_wallet') {
                    bot.sendMessage(chatId, 'Please input private key of importing wallet').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_privatekey');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'your_wallet') {
                    bot.sendMessage(chatId, 'Please input a wallet address of yours').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_wallet_address');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'target_wallet') {
                    bot.sendMessage(chatId, 'Please input a wallet address of target').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_target_address');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'prop_100') {
                    let order = newOrder.get(chatId);
                    order.mode = "prop";
                    order.propRate = 100;
                    newOrder.set(chatId, order);
                    const ui = await getUiOfCreateOrder(chatId);
                    if (ui)
                        switchMenu(chatId, query.message!.message_id, ui.title, ui.buttons);
                    else
                        bot.deleteMessage(chatId, query.message!.message_id);
                } else if (data == 'prop_x') {
                    bot.sendMessage(chatId, 'Please input percent of proportional mode').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_prop_rate');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'fix_1') {
                    let order = newOrder.get(chatId);
                    order.mode = "fix";
                    order.fixAmount = 1;
                    newOrder.set(chatId, order);
                    const ui = await getUiOfCreateOrder(chatId);
                    if (ui)
                        switchMenu(chatId, query.message!.message_id, ui.title, ui.buttons);
                    else
                        bot.deleteMessage(chatId, query.message!.message_id);
                } else if (data == 'fix_x') {
                    bot.sendMessage(chatId, 'Please input SOL amount of fix mode').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_fix_amount');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'auto_slippage') {
                    let order = newOrder.get(chatId);
                    order.slippage = 0;
                    newOrder.set(chatId, order);
                    const ui = await getUiOfCreateOrder(chatId);
                    if (ui)
                        switchMenu(chatId, query.message!.message_id, ui.title, ui.buttons);
                    else
                        bot.deleteMessage(chatId, query.message!.message_id);
                } else if (data == 'x_slippage') {
                    bot.sendMessage(chatId, 'Please input slippage').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_slippage_amount');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'create_copy') {
                    const order = newOrder.get(chatId);
                    console.log('new copy order = ', order);
                    if (!order.myWalletId || !order.targetWallet) { bot.sendMessage(chatId, 'Please set neccessary options for new trade').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });; return; }
                    const wallet = await database.getMyWallet(chatId, order.targetWallet);
                    if (wallet) {
                        bot.sendMessage(chatId, 'The target wallet is the same as your personal wallet. Please set it again.');
                        return;
                    }
                    const savedOrder = await database.saveNewOrder(chatId, order);
                    if (savedOrder) {
                        subscribe(savedOrder._id as string); // websocket;
                        // checkPnlMonitor(savedOrder._id as string);
                        bot.sendMessage(chatId, 'New Copy Order is created').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) });
                    }
                    else {
                        bot.sendMessage(chatId, 'The Copy Trade is already ordered. Please try other wallets');
                    }
                    const { title, buttons } = await getUiOfCopytrades(chatId);
                    switchMenu(chatId, query.message!.message_id, title, buttons);
                } else if (data == 'change_prop_100') {
                    let order = changeOrder.get(chatId);
                    order.mode = "prop";
                    order.propRate = 100;
                    database.updateCopyOrder(order);
                    changeOrder.set(chatId, order);
                    const ui = await getUiOfChangeOrder(chatId);
                    if (ui)
                        switchMenu(chatId, query.message!.message_id, ui.title, ui.buttons);
                } else if (data == 'change_prop_x') {
                    bot.sendMessage(chatId, 'Please input percent of proportional mode').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'change_input_prop_rate');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'change_fix_1') {
                    let order = changeOrder.get(chatId);
                    order.mode = "fix";
                    order.fixAmount = 1;
                    database.updateCopyOrder(order);
                    changeOrder.set(chatId, order);
                    const ui = await getUiOfChangeOrder(chatId);
                    if (ui) {

                        switchMenu(chatId, query.message!.message_id, ui.title, ui.buttons);
                    }
                } else if (data == 'change_fix_x') {
                    bot.sendMessage(chatId, 'Please input SOL amount of fix mode').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'change_input_fix_amount');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'change_auto_slippage') {
                    let order = changeOrder.get(chatId);
                    order.slippage = 0;
                    database.updateCopyOrder(order);
                    changeOrder.set(chatId, order);
                    const ui = await getUiOfChangeOrder(chatId);
                    if (ui) {

                        switchMenu(chatId, query.message!.message_id, ui.title, ui.buttons);
                    }
                } else if (data == 'change_x_slippage') {
                    bot.sendMessage(chatId, 'Please input slippage').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'change_input_slippage_amount');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'copy_start') {
                    let order = changeOrder.get(chatId);
                    order.active = true;
                    await database.updateCopyOrder(order);
                    changeOrder.set(chatId, order);

                    const ui = await getUiOfChangeOrder(chatId);
                    if (ui) {

                        switchMenu(chatId, query.message!.message_id, ui.title, ui.buttons);
                        subscribe(order._id);
                        // checkPnlMonitor(order._id);
                    }
                } else if (data == 'copy_stop') {
                    let order = changeOrder.get(chatId);
                    order.active = false;
                    await database.updateCopyOrder(order);
                    changeOrder.set(chatId, order);
                    const ui = await getUiOfChangeOrder(chatId);
                    if (ui) {

                        switchMenu(chatId, query.message!.message_id, ui.title, ui.buttons);
                        unsubscribe(order._id);
                        // checkPnlMonitor(order._id);
                    }
                } else if (data == 'remove_order') {
                    let order = changeOrder.get(chatId);
                    // remove hook, pnl monitor
                    unsubscribe(order._id);
                    if (order.monitorId > 0)
                        clearInterval(order.monitorId);
                    //
                    const deleted = await database.deleteCopyOrder(order);
                    if (deleted) {
                        bot.sendMessage(chatId, 'Remove Order Success.');
                    } else {
                        bot.sendMessage(chatId, 'Remove Order Failed');
                    }
                    const { title, buttons } = await getUiOfCopytrades(chatId);
                    switchMenu(chatId, messageId, title, buttons);
                } else if (data == 'jito_tip') {
                    bot.sendMessage(chatId, 'Please input amount of jito tip').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_jitotip_amount');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'max_buy') {
                    bot.sendMessage(chatId, 'Please input amount of max buy').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_maxbuy_amount');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'min_lp') {
                    bot.sendMessage(chatId, 'Please input minimum LP size').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_minlp_amount');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'take_profit') {
                    bot.sendMessage(chatId, 'Please input percent of take profit').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_takeprofit_amount');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'take_profit_off') {
                    let order = newOrder.get(chatId);
                    order.tpOn = false;
                    newOrder.set(chatId, order);
                    const ui = await getUiOfCreateOrder(chatId);
                    if (ui)
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                    else
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                } else if (data == 'stop_loss_off') {
                    let order = newOrder.get(chatId);
                    order.slOn = false;
                    newOrder.set(chatId, order);
                    const ui = await getUiOfCreateOrder(chatId);
                    if (ui)
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                    else
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                } else if (data == 'take_profit_on') {
                    let order = newOrder.get(chatId);
                    order.tpOn = true;
                    newOrder.set(chatId, order);
                    const ui = await getUiOfCreateOrder(chatId);
                    if (ui)
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                    else
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                } else if (data == 'stop_loss_on') {
                    let order = newOrder.get(chatId);
                    order.slOn = true;
                    newOrder.set(chatId, order);

                    const ui = await getUiOfCreateOrder(chatId);
                    if (ui)
                        switchMenu(chatId, messageIds.get(chatId), ui.title, ui.buttons);
                    else
                        bot.deleteMessage(chatId, messageIds.get(chatId));
                } else if (data == 'change_take_profit_off') {
                    let order = changeOrder.get(chatId);
                    order.tpOn = false;
                    await database.updateCopyOrder(order);
                    changeOrder.set(chatId, order);
                    const ui = await getUiOfChangeOrder(chatId);
                    if (ui) {

                        switchMenu(chatId, messageId, ui.title, ui.buttons);
                        // checkPnlMonitor(order._id);
                    }
                } else if (data == 'change_stop_loss_off') {
                    let order = changeOrder.get(chatId);
                    order.slOn = false;
                    await database.updateCopyOrder(order);
                    changeOrder.set(chatId, order);
                    const ui = await getUiOfChangeOrder(chatId);
                    if (ui) {

                        switchMenu(chatId, messageId, ui.title, ui.buttons);
                        // checkPnlMonitor(order._id);
                    }
                } else if (data == 'change_take_profit_on') {
                    let order = changeOrder.get(chatId);
                    order.tpOn = true;
                    await database.updateCopyOrder(order);
                    changeOrder.set(chatId, order);
                    const ui = await getUiOfChangeOrder(chatId);
                    if (ui) {

                        switchMenu(chatId, messageId, ui.title, ui.buttons);
                        // checkPnlMonitor(order._id);
                    }
                } else if (data == 'change_stop_loss_on') {
                    let order = changeOrder.get(chatId);
                    order.slOn = true;
                    await database.updateCopyOrder(order);
                    changeOrder.set(chatId, order);
                    const ui = await getUiOfChangeOrder(chatId);
                    if (ui) {

                        switchMenu(chatId, messageId, ui.title, ui.buttons);
                        // checkPnlMonitor(order._id);
                    }
                } else if (data == 'stop_loss') {
                    bot.sendMessage(chatId, 'Please input percent of stop loss').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_stoploss_amount');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'change_take_profit') {
                    bot.sendMessage(chatId, 'Please input percent of take profit').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'change_takeprofit_amount');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'change_stop_loss') {
                    bot.sendMessage(chatId, 'Please input percent of stop loss').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'change_stoploss_amount');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'auto_sell_rate') {
                    bot.sendMessage(chatId, 'Please input percent of auto sell').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_autosell_amount');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'remove_order') {
                    bot.sendMessage(chatId, 'Please input percent of auto sell').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_autosell_amount');
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data == 'stop_all') {
                    const copyorders = await CopyOrder.find({ chatId });
                    if (copyorders.length > 0) {
                        for (let i = 0; i < copyorders.length; i++) {
                            copyorders[i].active = false;
                            await copyorders[i].save();
                            await unsubscribe(copyorders[i]._id as string);
                            // await checkPnlMonitor(copyorders[i]._id as string);
                        }
                        const { title, buttons } = await getUiOfCopytrades(chatId);
                        switchMenu(chatId, messageId, title, buttons);
                    }

                } else if (data == 'start_all') {
                    const copyorders = await CopyOrder.find({ chatId });
                    if (copyorders.length > 0) {
                        for (let i = 0; i < copyorders.length; i++) {
                            copyorders[i].active = true;
                            await copyorders[i].save();
                            await subscribe(copyorders[i]._id as string);
                            // await checkPnlMonitor(copyorders[i]._id as string);
                        }
                        const { title, buttons } = await getUiOfCopytrades(chatId);
                        switchMenu(chatId, messageId, title, buttons);
                    }

                } else if (data.startsWith('sell_auto_')) {
                    console.log("sell_auto_===================");
                    const posId = data.replace('sell_auto_', '');
                    // const sellSetting = sellSettings.get(posId);
                    let sellSetting = getSellSetting(posId);
                    sellSetting.sellmode = 'auto';
                    sellSettings.set(posId, sellSetting);
                    const { title, buttons } = await getUiOfSell(posId);
                    if (title && buttons)
                        switchMenu(chatId, messageId, title, buttons);
                    else
                        bot.sendMessage(chatId, 'No position');
                } else if (data.startsWith('sell_50_')) {
                    const posId = data.replace('sell_50_', '');
                    console.log('posId = ', posId);
                    console.log('sellSettings = ', sellSettings);
                    let sellSetting = getSellSetting(posId);
                    console.log('sellSetting = ', sellSetting);
                    sellSetting.sellmode = '50';
                    sellSettings.set(posId, sellSetting);
                    const { title, buttons } = await getUiOfSell(posId);
                    if (title && buttons)
                        switchMenu(chatId, messageId, title, buttons);
                    else
                        bot.sendMessage(chatId, 'No position');
                } else if (data.startsWith('sell_100_')) {
                    console.log("sell_100_slippage_================");
                    const posId = data.replace('sell_100_', '');
                    const sellSetting = sellSettings.get(posId);
                    sellSetting.sellmode = '100';
                    sellSettings.set(posId, sellSetting);
                    const { title, buttons } = await getUiOfSell(posId);
                    if (title && buttons)
                        switchMenu(chatId, messageId, title, buttons);
                    else
                        bot.sendMessage(chatId, 'No position');
                } else if (data.startsWith('sell_slippage_auto_')) {
                    console.log("sell_slippage_auto_================");
                    const posId = data.replace('sell_slippage_auto_', '');
                    const sellSetting = getSellSetting(posId);
                    sellSetting.slippage = 'auto';
                    sellSettings.set(posId, sellSetting);
                    const { title, buttons } = await getUiOfSell(posId);
                    if (title && buttons)
                        switchMenu(chatId, messageId, title, buttons);
                    else
                        bot.sendMessage(chatId, 'No position');
                } else if (data.startsWith('sell_slippage_15_')) {
                    const posId = data.replace('sell_slippage_15_', '');
                    const sellSetting = sellSettings.get(posId);
                    sellSetting.slippage = '15';
                    sellSettings.set(posId, sellSetting);
                    const { title, buttons } = await getUiOfSell(posId);
                    if (title && buttons)
                        switchMenu(chatId, messageId, title, buttons);
                    else
                        bot.sendMessage(chatId, 'No position');
                } else if (data.startsWith('sell_x_')) {
                    const posId = data.replace('sell_x_', '');
                    bot.sendMessage(chatId, 'Please input percent of sell').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_sell_amount_' + posId);
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data.startsWith('sell_slippage_x_')) {
                    const posId = data.replace('sell_slippage_x_', '');
                    bot.sendMessage(chatId, 'Please input percent of slippage').then((msg) => { deleteMessages.set(chatId, msg.message_id) });
                    inputState.set(chatId, 'input_sell_slippage_amount_' + posId);
                    messageIds.set(chatId, query.message!.message_id);
                } else if (data.startsWith('sell_')) {
                    console.log('================> Manual Sell Logic Start =============>');
                    const posId = data.replace('sell_', '');

                    const sellSetting = getSellSetting(posId);
                    console.log('sellSetting = ', sellSetting);

                    const position = await Position.findById(posId);
                    console.log('current position = ', position);

                    if (position) {

                        const myWallet = await MyWallet.findById(position?.myWallet);
                        console.log('my wallet = ', myWallet);

                        if (myWallet) {
                            let sellAmount;
                            let slippage;

                            // set sellamount
                            if (sellSetting.sellmode == 'auto') {
                                sellAmount = position.tokenBalance;
                            } else {
                                sellAmount = Math.floor(position.tokenBalance * (Number(sellSetting.sellmode)) / 100);
                            }

                            // set slippage
                            if (sellSetting.slippage == 'auto') {
                                slippage = 50;
                            } else {
                                slippage = Number(sellSetting.slippage);
                            }

                            bot.sendMessage(chatId, `Sell in progress...\n<code>${position.tokenAddress}</code>`, { parse_mode: "HTML" });

                            if (sellSetting.sellmode == 'auto') {

                                const globalSetting: any = await getGlobalSetting(chatId);
                                console.log('globalSetting = ', globalSetting);

                                const smallSell = Math.floor(sellAmount * Number(globalSetting.fixedAutoSell) / 100);
                                let sellSols = 0;
                                let sellTokens = 0;
                                const sentTime = Date.now();

                                while (sellAmount > 0 && Date.now() - sentTime < 60000) {

                                    const amount = Math.min(sellAmount, smallSell);
                                    let result;

                                    if (position.dex == 'pumpfun') {
                                        result = await Solanalib.pumpfun_sell(Solanalib.CONNECTION, myWallet.privateKey, position.tokenAddress, amount, Math.round(globalSetting.jitoTip * Solanalib.LAMPORTS));
                                    } else {
                                        result = await Solanalib.jupiter_swap(Solanalib.CONNECTION, myWallet.privateKey, position.tokenAddress, Solanalib.WSOL_ADDRESS, amount, "ExactIn", Math.round(globalSetting.jitoTip * Solanalib.LAMPORTS));
                                    }

                                    if (result && result.success && result.signature) {

                                        const sellInfo = await Solanalib.getSwapInfo(Solanalib.CONNECTION, result.signature);
                                        bot.sendMessage(chatId, `You sold ${amount / 10 ** position.tokenDecimals!} ${position.tokenSymbol}/${sellInfo?.solAmount! / (Solanalib.LAMPORTS)}SOL. Tx: http://solscan.io/tx/${result.signature} Wallet: ${myWallet.name}`);

                                        sellAmount -= Number(amount);
                                        sellSols += Number(sellInfo?.solAmount);
                                        sellTokens += Number(amount);

                                        // save history
                                        const trade = new Trade({
                                            chatId,
                                            myWallet: myWallet._id,
                                            buyOrSell: 'Sell',
                                            tokenSymbol: position.tokenSymbol,
                                            tokenAddress: position.tokenAddress,
                                            tokenAmount: Number(amount) / 10 ** position.tokenDecimals,
                                            solAmount: Number(sellInfo?.solAmount) / Solanalib.LAMPORTS,
                                            signature: result.signature
                                        });
                                        trade.save();
                                    }
                                }
                                bot.sendMessage(chatId, `Sell completed`);
                                position.tokenBalance -= Number(sellTokens);
                                if (position.tokenBalance > 0) {
                                    position.totalSellSols += Number(sellSols);
                                    position.sells += 1;
                                    await position.save();
                                    const { title, buttons } = await getUiOfSell(posId);
                                    if (title && buttons)
                                        switchMenu(chatId, messageId, title, buttons);
                                    else {
                                        bot.sendMessage(chatId, 'No Position');
                                        bot.deleteMessage(chatId, messageId);
                                    }
                                } else {
                                    position.totalSellSols += Number(sellSols);
                                    position.sells += 1;
                                    await position.save();
                                    const deleted = await Position.findByIdAndDelete(position._id);
                                    console.log('deleted position = ', deleted);
                                }

                            } else {
                                const globalSetting = await getGlobalSetting(chatId);
                                console.log('globalSetting = ', globalSetting);

                                let result;
                                if (position.dex == "pumpfun") {
                                    result = await Solanalib.pumpfun_sell(Solanalib.CONNECTION, myWallet.privateKey, position.tokenAddress, sellAmount, Math.round(globalSetting.jitoTip * Solanalib.LAMPORTS));
                                } else {
                                    result = await Solanalib.jupiter_swap(Solanalib.CONNECTION, myWallet.privateKey, position.tokenAddress, Solanalib.WSOL_ADDRESS, sellAmount, "ExactIn", Math.round(globalSetting.jitoTip * Solanalib.LAMPORTS));
                                }

                                if (result && result.success && result.signature) {

                                    const sellInfo = await Solanalib.getSwapInfo(Solanalib.CONNECTION, result.signature);

                                    bot.sendMessage(chatId, `You sold ${sellAmount / 10 ** position.tokenDecimals!} ${position.tokenSymbol}/${sellInfo?.solAmount! / (Solanalib.LAMPORTS)}SOL. Tx: http://solscan.io/tx/${result.signature} Wallet: ${myWallet.name}`);
                                    bot.sendMessage(chatId, `Sell completed`);

                                    position.tokenBalance -= Number(sellAmount);

                                    if (position.tokenBalance > 0) {
                                        position.totalSellSols += Number(sellInfo?.solAmount);
                                        position.sells += 1;
                                        await position.save();
                                        const { title, buttons } = await getUiOfSell(posId);
                                        if (title && buttons)
                                            switchMenu(chatId, messageId, title, buttons);
                                        else {
                                            bot.sendMessage(chatId, 'Server error');
                                            bot.deleteMessage(chatId, messageId);
                                        }
                                    } else {
                                        position.totalSellSols += Number(sellInfo?.solAmount);
                                        position.sells += 1;
                                        await position.save();
                                        await Position.findByIdAndDelete(posId);
                                    }

                                    // save history
                                    const trade = new Trade({
                                        chatId,
                                        myWallet: myWallet._id,
                                        buyOrSell: 'Sell',
                                        tokenSymbol: position.tokenSymbol,
                                        tokenAddress: position.tokenAddress,
                                        tokenAmount: Number(sellAmount) / 10 ** position.tokenDecimals,
                                        solAmount: Number(sellInfo?.solAmount) / Solanalib.LAMPORTS,
                                        signature: result.signature
                                    });
                                    trade.save();
                                }
                            }
                        }
                    }
                } else if (data.startsWith('sellpad_refresh_')) {
                    const posId = data.replace('sellpad_refresh_', '');
                    const sellSetting = getSellSetting(posId);
                    console.log('sellSetting = ', sellSetting);
                    const position = await Position.findById(posId);
                    console.log('current position = ', position);
                    const { title, buttons } = await getUiOfSell(posId);
                    if (title && buttons)
                        switchMenu(chatId, messageId, title, buttons);
                    else {
                        bot.sendMessage(chatId, 'No Position');
                        bot.deleteMessage(chatId, messageId);
                    }
                } else if (data == "rename_my_wallet") {
                    console.log('rename my wallet');
                    const message = await bot.sendMessage(chatId, 'Please input wallet address to change name');
                    inputState.set(chatId, 'rename_my_address');
                    deleteMessages.set(chatId, message.message_id);
                    messageIds.set(chatId, messageId);
                } else if (data == "rename_target_wallet") {
                    console.log('rename target wallet');
                    const message = await bot.sendMessage(chatId, 'Please input wallet address to change name');
                    inputState.set(chatId, 'rename_target_address');
                    deleteMessages.set(chatId, message.message_id);
                    messageIds.set(chatId, messageId);
                } else if (data == "remove_wallet") {
                    console.log('remove wallet');
                    const message = await bot.sendMessage(chatId, 'Please input wallet address to remove');
                    inputState.set(chatId, 'remove_address');
                    deleteMessages.set(chatId, message.message_id);
                    messageIds.set(chatId, messageId);
                } else if (data == "withdraw_my_wallet") {
                    console.log('withdraw my wallet');
                    const { title, buttons } = await getUiOfWithdrawWallets(chatId);
                    bot.sendMessage(chatId, title, { reply_markup: { inline_keyboard: buttons } });
                    messageIds.set(chatId, messageId);
                }
            }
        } catch (error) {
            console.log(error)
        }
    });
}

export const getUiOfWithdrawWallets = async (chatId: TelegramBot.ChatId) => {
    const title = 'Select wallet to withdraw SOL';
    const buttons = [];
    const wallets = await MyWallet.find({ chatId });
    for (let i = 0; i < wallets.length; i++) {
        buttons.push([{ text: `${wallets[i].name}`, callback_data: `withdraw_wallet_${wallets[i]._id}` }])
    }
    buttons.push([{ text: 'Close', callback_data: 'close' }]);
    return { title, buttons };
}

export const getUiOfSell = async (posId: string) => {
    const sellSetting = sellSettings.get(posId.toString());
    console.log('getUiOfSell, sellSetting = ', sellSetting);
    const position = await Position.findById(posId).populate('myWallet').exec();
    let title = null;
    let buttons = null;
    if (position) {
        const myWallet_publicKey = (position.myWallet as any).publicKey;
        const myWallet_name = (position.myWallet as any).name;
        const balance = await Solanalib.getBalance(config.CONNECTION, myWallet_publicKey);

        let outAmount;
        let pnlSOLDelta;
        let pnlSOL;

        if (position.dex == 'pumpfun') {
            outAmount = await Solanalib.pumpfun_position(position.tokenAddress, position.tokenBalance, Solanalib.SLIPPAGE_BASIS_POINTS);
            console.log('pumpfun position = ', outAmount);
            pnlSOLDelta = (Number(outAmount) + Number(position.totalSellSols) - Number(position.totalBuySols)) / Solanalib.LAMPORTS;
            pnlSOL = pnlSOLDelta * Solanalib.LAMPORTS / position.totalBuySols * 100;
        } else {
            const quoteResponse = await (
                await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${position.tokenAddress}&outputMint=${Solanalib.WSOL_ADDRESS}&amount=${position.tokenBalance}&slippageBps=50`
                )
            ).json();
            outAmount = quoteResponse.outAmount;
            pnlSOLDelta = (Number(outAmount) + Number(position.totalSellSols) - Number(position.totalBuySols)) / Solanalib.LAMPORTS;
            pnlSOL = pnlSOLDelta * Solanalib.LAMPORTS / position.totalBuySols * 100;
        }

        title = `🏆 Position
        
💳 ${myWallet_name}-<code>${myWallet_publicKey}</code>
Balance:<code>${balance}</code> SOL
Position:<code>${(Number(outAmount) / Solanalib.LAMPORTS)}</code> SOL

Token:<code>${position.tokenSymbol}</code>-📌<code>${position.tokenAddress}</code>
• Balance: <code>${position.tokenBalance / 10 ** position.tokenDecimals}</code>
• Buys: <code>${position.totalBuySols / Solanalib.LAMPORTS} SOL • (${position.buys} buys)</code>
• Sells: <code>${position.totalSellSols / Solanalib.LAMPORTS} SOL • (${position.sells} sells)</code>
• PNL SOL: <code>${pnlSOL} % (${pnlSOLDelta} SOL) ${pnlSOLDelta > 0 ? "🟩" : "🟥"}</code>
`;
        buttons = [
            [
                { text: `${sellSetting.sellmode == 'auto' ? '✅' : ''}Auto Sell`, callback_data: `sell_auto_${position._id}` },
                { text: `${sellSetting.sellmode == '50' ? '✅' : ''}Sell 50 % `, callback_data: `sell_50_${position._id}` },
                { text: `${sellSetting.sellmode == '100' ? '✅' : ''}Sell 100 % `, callback_data: `sell_100_${position._id}` },
                { text: `${sellSetting.sellmode != 'auto' && sellSetting.sellmode != '50' && sellSetting.sellmode != '100' ? `✅ Sell ✏️${sellSetting.sellmode} %` : 'Sell ✏️X %'} `, callback_data: `sell_x_${position._id}` },
            ],
            [
                { text: `${sellSetting.slippage == 'auto' ? '✅' : ''}Auto Slippage`, callback_data: `sell_slippage_auto_${position._id}` },
                { text: `${sellSetting.slippage == '15' ? '✅' : ''}Slippage 15 % `, callback_data: `sell_slippage_15_${position._id}` },
                { text: `${sellSetting.slippage != 'auto' && sellSetting.slippage != '15' ? `✅Slippage ✏️${sellSetting.slippage} % ` : 'Slippage ✏️X % '}`, callback_data: `sell_slippage_x_${position._id}` },
            ],
            [
                { text: `Sell`, callback_data: `sell_${position._id}` },
            ],
            [
                { text: `❌ Close`, callback_data: `close` },
                { text: `♻️ Refresh`, callback_data: `sellpad_refresh_${position._id}` },
            ],
        ];
    }
    return { title, buttons };
}

export const pnlMonitor = async () => {

    while (true) {

        const copyOrders = await CopyOrder.find();

        if (copyOrders.length > 0) {

            for (let i = 0; i < copyOrders.length; i++) {

                const copyOrder = await CopyOrder.findById(copyOrders[i]._id).populate('myWallet').populate('targetWallet').exec();

                if ((copyOrder!.slOn || copyOrder!.tpOn)) {

                    const globalSetting: any = await getGlobalSetting(copyOrder!.chatId);

                    const positions = await Position.find({ copyOrder: copyOrder!._id });

                    if (positions.length > 0) {

                        for (let i = 0; i < positions.length; i++) {

                            let check = async () => {
                                
                                if (positions[i].dex == 'pumpfun') {
                                    
                                    const outAmount = await Solanalib.pumpfun_position(positions[i].tokenAddress, positions[i].tokenBalance, Solanalib.SLIPPAGE_BASIS_POINTS);
                                    
                                    const pnlSOL = (Number(outAmount) + Number(positions[i].totalSellSols) - Number(positions[i].totalBuySols)) / positions[i].totalBuySols * 100;

                                    console.log(`check ${i}, pnl = ${pnlSOL}, tp = ${copyOrder!.tp}, sl = ${copyOrder!.sl}`);

                                    if ((copyOrder!.tpOn && pnlSOL >= Number(copyOrder!.tp)) || (copyOrder!.slOn && pnlSOL < Number(copyOrder!.sl * (-1)))) {

                                        const result = await Solanalib.pumpfun_sell(Solanalib.CONNECTION, (copyOrder!.myWallet as any).privateKey, positions[i].tokenAddress, positions[i].tokenBalance, Math.round(globalSetting.jitoTip * Solanalib.LAMPORTS));

                                        if (result && result.success && result.signature) {
                                            const swapInfo = await Solanalib.getSwapInfo(Solanalib.CONNECTION, result.signature);
                                            bot.sendMessage(copyOrder!.chatId, `You sold ${positions[i].tokenBalance / 10 ** positions[i].tokenDecimals!} ${positions[i].tokenSymbol}/${swapInfo?.solAmount! / Solanalib.LAMPORTS}SOL. Tx: http://solscan.io/tx/${result.signature} Wallet: ${(copyOrder!.myWallet as any).name}`);
                                            bot.sendMessage(copyOrder!.chatId, `Sell completed`);

                                            await Position.findByIdAndDelete(positions[i]._id);

                                            // save history
                                            const trade = new Trade({
                                                chatId: copyOrder!.chatId,
                                                myWallet: (copyOrder!.myWallet as any)._id,
                                                buyOrSell: 'Sell',
                                                tokenSymbol: positions[i].tokenSymbol,
                                                tokenAddress: positions[i].tokenAddress,
                                                tokenAmount: Number(positions[i].tokenBalance) / 10 ** positions[i].tokenDecimals,
                                                solAmount: Number(swapInfo?.solAmount!) / Solanalib.LAMPORTS,
                                                signature: result.signature
                                            });
                                            trade.save();
                                        }
                                    }
                                } else {
                                    
                                    const quoteResponse = await (
                                        await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${positions[i].tokenAddress}&outputMint=${Solanalib.WSOL_ADDRESS}&amount=${positions[i].tokenBalance}&slippageBps=50`
                                        )
                                    ).json();

                                    const pnlSOL = (Number(quoteResponse.outAmount) + Number(positions[i].totalSellSols) - Number(positions[i].totalBuySols)) / positions[i].totalBuySols * 100;

                                    console.log(`check ${i}, pnl = ${pnlSOL}, tp = ${copyOrder!.tp}, sl = ${copyOrder!.sl}`);

                                    if ((copyOrder!.tpOn && pnlSOL >= Number(copyOrder!.tp)) || (copyOrder!.slOn && pnlSOL < Number(copyOrder!.sl * (-1)))) {
                                        //sell all
                                        const result = await Solanalib.jupiter_swap(Solanalib.CONNECTION, (copyOrder!.myWallet as any).privateKey, positions[i].tokenAddress, Solanalib.WSOL_ADDRESS, positions[i].tokenBalance, "ExactIn", Math.round(globalSetting.jitoTip * Solanalib.LAMPORTS));

                                        if (result.success && result.signature) {

                                            const sellresult = await Solanalib.getSwapInfo(Solanalib.CONNECTION, result.signature);

                                            bot.sendMessage(copyOrder!.chatId, `You sold ${positions[i].tokenBalance / 10 ** positions[i].tokenDecimals!} ${positions[i].tokenSymbol}/${sellresult?.solAmount! / Solanalib.LAMPORTS}SOL. Tx: http://solscan.io/tx/${result.signature} Wallet: ${(copyOrder!.myWallet as any).name}`);
                                            bot.sendMessage(copyOrder!.chatId, `Sell completed`);

                                            await Position.findByIdAndDelete(positions[i]._id);

                                            // save history
                                            const trade = new Trade({
                                                chatId: copyOrder!.chatId,
                                                myWallet: (copyOrder!.myWallet as any)._id,
                                                buyOrSell: 'Sell',
                                                tokenSymbol: positions[i].tokenSymbol,
                                                tokenAddress: positions[i].tokenAddress,
                                                tokenAmount: Number(positions[i].tokenBalance) / 10 ** positions[i].tokenDecimals,
                                                solAmount: Number(sellresult?.solAmount!) / Solanalib.LAMPORTS,
                                                signature: result.signature
                                            });
                                            trade.save();
                                        }
                                    }
                                }
                            }
                            check();
                        }
                    }
                }
            }
        }
        await Solanalib.sleep(1000);
    }
}

const getUiOfCreateOrder = async (chatId: TelegramBot.ChatId) => {
    try {
        const order = newOrder.get(chatId);

        const [mywallets, targetwallets] = await Promise.all([
            database.getMyWallets(Number(chatId)),
            database.getTargetWallets(Number(chatId))
        ]);

        let title = `✨ New Copy Trade\n\n💳 My Wallets\n`;

        if (mywallets && mywallets.length)
            for (let i = 0; i < mywallets?.length; i++) {
                title += `✏️<code>${mywallets[i].name}</code>-<code>${mywallets[i].publicKey}</code >\n`
            }
        else
            title += '  no wallet\n';

        title += '\n🎯 Target Wallets:\n';

        if (targetwallets && targetwallets.length)
            for (let i = 0; i < targetwallets?.length; i++) {
                title += `✏️<code>${targetwallets[i].name}</code>-<code>${targetwallets[i].publicKey}</code >\n`
            }
        else
            title += '  no wallet\n\n';

        title += `\n💡 Please configure settings of new copy trade\n1.Select My Wallet\n2.Select Target Wallet\n3.Select Trade Mode(Fix or Prop) \n4.Select TP / SL\n5.Finally Create`;
        const buttons = [
            [
                { text: `💳 My Wallet-${order.myWalletName}`, callback_data: `your_wallet` },
                { text: `🎯 Target Wallet-${Solanalib.shortenAddress(order.targetWallet)}`, callback_data: `target_wallet` }
            ],
            [
                { text: `Buy Option`, callback_data: `none` }
            ],
            [
                { text: `${order.mode == "prop" && order.propRate == 100 ? "✅" : ""}Prop - 100 % `, callback_data: 'prop_100' },
                { text: `${order.mode == "prop" && order.propRate != 100 ? `✅Prop - ✏️${order.propRate} % ` : `Prop - ✏️X % `}`, callback_data: 'prop_x' }
            ],
            [
                { text: `${order.mode == "fix" && order.fixAmount == 1 ? "✅" : ""}Fix - 1 SOL`, callback_data: 'fix_1' },
                { text: `${order.mode == "fix" && order.fixAmount != 1 ? `✅Fix - ✏️${order.fixAmount} SOL` : `Fix - ✏️X SOL`}`, callback_data: 'fix_x' },
            ],
            [
                { text: `Sell Option`, callback_data: `none` }
            ],
            [
                { text: `Take Profit : + ✏️${order.tp} % `, callback_data: `take_profit` },
                { text: `${order.tpOn ? 'On' : 'Off'}`, callback_data: `${order.tpOn ? 'take_profit_off' : 'take_profit_on'}` }
            ],
            [
                { text: `Stop Loss : - ✏️${order.sl} % `, callback_data: `stop_loss` },
                { text: `${order.slOn ? 'On' : 'Off'}`, callback_data: `${order.slOn ? 'stop_loss_off' : 'stop_loss_on'}` }
            ],
            // [
            //     { text: `Slippage`, callback_data: `none` }
            // ],
            // [
            //     { text: `${ order.slippage == 0 ? "✅" : "" }Auto Slippage`, callback_data: 'auto_slippage' },
            //     { text: `${ order.slippage != 0 ? `✅Slippage - ✏️${order.slippage} %` : `Slippage - ✏️X %` }`, callback_data: 'x_slippage' }
            // ],
            [
                { text: `✨ Create`, callback_data: 'create_copy' }
            ],
            [
                { text: `🔙 Back`, callback_data: 'back_to_orderlist' }
            ]
        ];
        return { title, buttons };
    } catch (error) {
        console.error('Error', error);
        return null;
    }

}

const getUiOfChangeOrder = async (chatId: TelegramBot.ChatId) => {
    try {
        const order = changeOrder.get(chatId);

        console.log('getUiOfChangeOrder, order = ', order);

        const [mywallet, targetwallet] = await Promise.all([database.getMyWalletById(order.myWallet), database.getTargetWalletById(order.targetWallet)]);

        const title = `Manage Copy Trade\n\n💳 My Wallet: ${mywallet!.name} - <code>${mywallet!.publicKey} </code>\n🎯 Target Wallet: ${targetwallet!.name}-<code>${targetwallet!.publicKey}</code>`;
        const buttons = [
            [
                { text: `${order.active ? '🟢 Started' : '🟡 Stopped'}`, callback_data: `${order.active ? 'copy_stop' : 'copy_start'}` }
            ],
            [
                { text: `Buy Option`, callback_data: `none` }
            ],
            [
                { text: `${order.mode == "prop" && order.propRate == 100 ? "✅" : ""}Prop - 100 % `, callback_data: 'change_prop_100' },
                { text: `${order.mode == "prop" && order.propRate != 100 ? `✅Prop - ✏️${order.propRate} % ` : `Prop - ✏️X % `}`, callback_data: 'change_prop_x' }
            ],
            [
                { text: `${order.mode == "fix" && order.fixAmount == 1 ? "✅" : ""}Fix - 1 SOL`, callback_data: 'change_fix_1' },
                { text: `${order.mode == "fix" && order.fixAmount != 1 ? `✅Fix - ✏️${order.fixAmount} SOL` : `Fix - ✏️X SOL`}`, callback_data: 'change_fix_x' },
            ],
            [
                { text: `Sell Option`, callback_data: `none` }
            ],
            [
                { text: `Take Profit : + ✏️${order.tp} % `, callback_data: `change_take_profit` },
                { text: `${order.tpOn ? 'On' : 'Off'}`, callback_data: `${order.tpOn ? 'change_take_profit_off' : 'change_take_profit_on'}` }
            ],
            [
                { text: `Stop Loss : - ✏️${order.sl} % `, callback_data: `change_stop_loss` },
                { text: `${order.slOn ? 'On' : 'Off'}`, callback_data: `${order.slOn ? 'change_stop_loss_off' : 'change_stop_loss_on'}` }
            ],
            // [
            //     { text: `Slippage`, callback_data: `none` }
            // ],
            // [
            //     { text: `${ order.slippage == 0 ? "✅" : "" }Auto Slippage`, callback_data: 'change_auto_slippage' },
            //     { text: `${ order.slippage != 0 ? `✅Slippage - ✏️${order.slippage} %` : `Slippage - ✏️X %` }`, callback_data: 'change_x_slippage' }
            // ],
            [
                { text: `🔙 Back`, callback_data: 'back_to_orderlist' },
                { text: `🗑️ Remove`, callback_data: 'remove_order' }
            ]
        ];
        return { title, buttons };
    } catch (error) {
        console.log('getUiOfChangeOrder error:', error);
        return null;
    }
}

const generateWallet = async (query: TelegramBot.CallbackQuery) => {
    if (query.message) {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const { publicKey, privateKey } = Solanalib.createWallet();
        console.log('publicKey = ', publicKey);
        const count = await database.getMyWalletsCount(chatId);
        await database.createMyWallet({ chatId, privateKey, publicKey, name: `W${count + 1}` });
        const { title, buttons } = await getUiOfCopytrades(chatId);
        switchMenu(chatId, messageId, title, buttons);
    }
}

async function switchMenu(chatId: TelegramBot.ChatId, messageId: number | undefined, title: string, json_buttons: any) {
    const keyboard = {
        inline_keyboard: json_buttons,
        resize_keyboard: true,
        one_time_keyboard: true,
        force_reply: true
    };

    try {
        await bot.editMessageText(title, { chat_id: chatId, message_id: messageId, reply_markup: keyboard, disable_web_page_preview: true, parse_mode: 'HTML' })
    } catch (error) {
        console.log(error)
    }
}

const showCopyTrades = async (query: TelegramBot.CallbackQuery) => {
    if (query.message) {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const { title, buttons } = await getUiOfCopytrades(chatId);
        switchMenu(chatId, messageId, title, buttons);
    }
}

const showWallets = async (query: TelegramBot.CallbackQuery) => {
    if (query.message) {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const { title, buttons } = await getUiOfWallets(chatId);
        switchMenu(chatId, messageId, title, buttons);
    }
}

const getUiOfWallets = async (chatId: TelegramBot.ChatId) => {
    const [mywallets, targetwallets] = await Promise.all([
        database.getMyWallets(Number(chatId)),
        database.getTargetWallets(Number(chatId))
    ]);

    let title = `👤 Manage Wallets\n\nYou can create, import, remove personal wallet and target wallet\n\n 💳 My Wallets\n`;

    if (mywallets && mywallets.length)
        for (let i = 0; i < mywallets?.length; i++) {
            let balance = await Solanalib.getBalance(config.CONNECTION, mywallets[i].publicKey);
            title += `< code > ${mywallets[i].name} </code>-<code>${mywallets[i].publicKey}</code > -<code>${balance} </code> SOL\n`
        }
    else
        title += '  no wallet\n';

    title += '\n🎯 Target Wallets:\n';

    if (targetwallets && targetwallets.length)
        for (let i = 0; i < targetwallets?.length; i++) {
            title += `<code>${targetwallets[i].name}</code>-<code>${targetwallets[i].publicKey}</code >\n`
        }
    else
        title += '  no wallet\n\n';

    const buttons = [];

    buttons.push(
        [
            { text: `✨ Generate Wallet`, callback_data: 'create_wallet' },
            { text: `📥 Import Wallet`, callback_data: 'import_wallet' },
        ]
    );

    buttons.push(
        [
            { text: `🔙 Back`, callback_data: 'back' },
            { text: `♻️ Refresh`, callback_data: 'refresh_wallets' },
        ]
    );
    return { title, buttons };
}

const getUiOfCopytrades = async (chatId: TelegramBot.ChatId) => {
    const [mywallets, targetwallets, copyorders] = await Promise.all([
        database.getMyWallets(Number(chatId)),
        database.getTargetWallets(Number(chatId)),
        database.getCopyOrders(Number(chatId))
    ]);

    let title = `👤 Manage Wallets & Copy Trades\n\nYou can create, import, rename wallet and create copy trade\n\n 💳 My Wallets\n`;

    if (mywallets && mywallets.length)
        for (let i = 0; i < mywallets?.length; i++) {
            let balance = await Solanalib.getBalance(config.CONNECTION, mywallets[i].publicKey);
            title += `${mywallets[i].name}-<code>${mywallets[i].publicKey}</code>-<code>${balance}</code> SOL\n`
        }
    else
        title += '  no wallet\n';

    title += '\n🎯 Target Wallets:\n';

    if (targetwallets && targetwallets.length)
        for (let i = 0; i < targetwallets?.length; i++) {
            title += `${targetwallets[i].name}-<code>${targetwallets[i].publicKey}</code >\n`
        }
    else
        title += '  no wallet\n\n';

    const buttons = [
        [
            { text: `➕ New Copy Trade`, callback_data: 'create_trade' }
        ]
    ];

    let allStopped = true;

    if (copyorders && copyorders.length > 0) {
        for (let i = 0; i < copyorders?.length; i++) {
            if (copyorders[i].active)
                allStopped = false;
            if ((copyorders[i] as any).targetWallet)
                buttons.push([{ text: `${copyorders[i].active ? '🟢 ' : '🟡 '}${(copyorders[i].myWallet as any).name} -> ${(copyorders[i].targetWallet as any).name}`, callback_data: `show_trade_${copyorders[i]._id}` }]);
        }
        buttons.push([
            { text: `${allStopped ? "Start All" : "Pause All"}`, callback_data: `${allStopped ? "start_all" : "stop_all"}` },
        ]);

        title += '\n🟢 Active Trade\n🟡 Inactive Trade';
    }

    buttons.push(
        [
            { text: `✨ Generate My Wallet`, callback_data: 'create_wallet' },
            { text: `📥 Import My Wallet`, callback_data: 'import_wallet' },
        ]
    );

    buttons.push(
        [
            { text: `💳 Rename My Wallet`, callback_data: 'rename_my_wallet' },
            { text: `🎯 Rename Target Wallet`, callback_data: 'rename_target_wallet' },
        ]
    );

    buttons.push(
        [
            { text: `❌ Remove Wallet`, callback_data: 'remove_wallet' },
            { text: `💰 Withdraw`, callback_data: 'withdraw_my_wallet' },
        ]
    );

    buttons.push(
        [
            { text: `🔙 Back`, callback_data: 'back' },
            { text: `♻️ Refresh`, callback_data: 'refresh_orders' },
        ]
    );
    return { title, buttons };
}

const showSettings = async (query: TelegramBot.CallbackQuery) => {
    if (query.message) {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const ui = await getUiOfSetting(chatId);
        if (ui)
            switchMenu(chatId, messageId, ui.title, ui.buttons);
        else
            bot.deleteMessage(chatId, messageId);
    }
}

export const getGlobalSetting = async (chatId: TelegramBot.ChatId) => {
    const setting = await Setting.findOne({ chatId });
    if (setting)
        return setting;
    else
        return default_setting;
}

const getUiOfSetting = async (chatId: TelegramBot.ChatId) => {
    try {
        let setting = await database.getSetting(Number(chatId));

        if (setting) {
            settings.set(chatId, {
                jitoTip: setting.jitoTip,
                maxBuy: setting.maxBuy,
                minLp: setting.minLp,
                takeProfit: setting.takeProfit,
                stopLoss: setting.stopLoss,
                fixedAutoSell: setting.fixedAutoSell
            })
        } else {
            settings.set(chatId, default_setting);
        }

        setting = settings.get(chatId);

        const title = `⚙️ Settings\n\nYou can configure default settings on here`;
        const buttons = [
            [
                { text: `Jito Tip : ${setting!.jitoTip} SOL`, callback_data: 'jito_tip' },
            ],
            [
                { text: `Max Buy : ${setting!.maxBuy} SOL`, callback_data: `max_buy` },
                { text: `Minimum LP : ${setting!.minLp} SOL`, callback_data: `min_lp` }
            ],
            // [
            //     { text: `Take Profit : +${setting!.takeProfit} % `, callback_data: `take_profit` },
            //     { text: `Stop Loss : -${setting!.stopLoss} % `, callback_data: `stop_loss` }
            // ],
            [
                { text: `Fixed Auto Sell : ${setting!.fixedAutoSell} % `, callback_data: `auto_sell_rate` },
            ],
            [
                { text: `🔙 Back`, callback_data: 'back' },
            ]
        ];
        return { title, buttons };
    } catch (error) {
        return null;
    }
}

const showMain = (query: TelegramBot.CallbackQuery) => {
    if (query.message) {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const { title, buttons } = getUiOfStart(chatId);
        switchMenu(chatId, messageId, title, buttons);
    }
}

const getUiOfStart = (chatId: TelegramBot.ChatId) => {
    const title = `🎖️ Solana Copy Trading Bot 🎖️\n\n💡 Create wallet, Deposite SOL and create copy trade`;
    const buttons = [
        [
            { text: `🏆 CopyTrades`, callback_data: `copytrades` }
        ],
        [
            { text: `📊 Positions`, callback_data: `positions` },
            { text: `📜 Trades`, callback_data: 'trades' },
        ],
        [
            { text: `⚙️ Settings`, callback_data: 'settings' },
            { text: `❌ Close`, callback_data: 'close' },
        ]
    ];
    return { title, buttons };
}

const getUiOfWithdrawSOL = async (wallet_id: string) => {

    const wallet = await MyWallet.findById(wallet_id);
    const balance = await Solanalib.getBalance(Solanalib.CONNECTION, wallet!.publicKey);

    const withdraw_setting = withdrawSettings.get(wallet_id);

    console.log('withdraw_setting = ', withdraw_setting);

    const title = `Withdraw SOL\n\n Wallet: ${wallet!.name}-${wallet!.publicKey}\n Balance: ${balance} SOL`;

    const buttons = [
        [
            { text: `Back`, callback_data: 'back_withdraw_wallets' },
            { text: 'Refresh', callback_data: `refresh_withdraw_${wallet!._id}` }
        ],
        [
            { text: `${withdraw_setting.mode == 'percent' && withdraw_setting.amount != 100 ? `✅✏️${withdraw_setting.amount} %` : '✏️X %'}`, callback_data: `withdraw_x_percent_${wallet_id}` },
            { text: `${withdraw_setting.mode == 'percent' && withdraw_setting.amount == 100 ? '✅100 %' : '100 %'}`, callback_data: `withdraw_100_${wallet_id}` }
        ],
        [
            { text: `${withdraw_setting.mode == 'fix' && withdraw_setting.amount ? `✅✏️${withdraw_setting.amount} SOL` : '✏️X SOL'}`, callback_data: `withdraw_x_sol_${wallet_id}` }
        ],
        [
            { text: `${withdraw_setting.receiver ? `To: ${withdraw_setting.receiver}` : 'Set Withdraw Address'}`, callback_data: `withdraw_address_${wallet_id}` }
        ],
        [
            { text: `Withdraw`, callback_data: `start_withdraw_${wallet_id}` }
        ]
    ];

    return { title, buttons };

}

const showCreateCopyTrade = async (query: TelegramBot.CallbackQuery) => {
    if (query.message) {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const ui = await getUiOfCreateOrder(chatId);
        if (ui)
            switchMenu(chatId, messageId, ui.title, ui.buttons);
        else
            bot.deleteMessage(chatId, messageId);
    }
}

const showOneTrade = async (query: TelegramBot.CallbackQuery, id: string) => {
    if (query.message && id) {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        const order = await database.getOrderById(id);
        console.log('showOneTrade = ', order);
        changeOrder.set(chatId, order);
        const ui = await getUiOfChangeOrder(chatId);
        if (ui) {
            switchMenu(chatId, messageId, ui.title, ui.buttons);
        } else {
            bot.deleteMessage(chatId, messageId);
        }
    }
}

const getUiOfTrades = async (chatId: TelegramBot.ChatId) => {

    let title = null;
    let buttons = null;

    const trades = await Trade.find({ chatId }).sort({ _id: -1 }).limit(20).populate('myWallet').exec();
    console.log('trades = ', trades);
    if (!trades || trades.length == 0) {
        title = `
        📜 Recent Trades
        
No trades`;
        buttons = [
            [
                { text: `❌ Close`, callback_data: `close` },
            ],
        ];
    } else {
        title = `📜 Recent Trades\n\n`;
        for (let i = 0; i < trades.length; i++) {
            title += `• Wallet-${(trades[i].myWallet as any).name}\n`;
            title += `• Direction:${trades[i].buyOrSell}\n`;
            title += `• Amount:${trades[i].tokenAmount}${trades[i].tokenSymbol}/${trades[i].solAmount}SOL\n`;
            title += `• [txLink](http://solscan.io/tx/${trades[i].signature})\n\n`;
        }
        buttons = [
            [
                { text: `❌ Close`, callback_data: `close` },
                { text: `🗑️ Remove`, callback_data: `remove_trades` },
            ],
        ];
    }
    return { title, buttons };
}

const showPositions = async (query: TelegramBot.CallbackQuery) => {
    if (query.message) {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const { title, buttons } = await getUiOfPositions(chatId);
        if (!title || !buttons) {
            bot.sendMessage(chatId, 'You have no any wallets to show positions').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) })
        } else {
            switchMenu(chatId, messageId, title, buttons);
        }
    }
}

const showPositionsOfWallet = async (query: TelegramBot.CallbackQuery, wallet_id: string) => {
    if (query.message) {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const { title, buttons } = await getUiOfPositionsOfWallet(chatId, wallet_id);
        if (!title || !buttons) {
            bot.sendMessage(chatId, 'You have no any positions in this wallet').then((msg) => { setTimeout(() => { bot.deleteMessage(chatId, msg.message_id) }, 3000) })
        } else {
            switchMenu(chatId, messageId, title, buttons);
        }
    }
}

const getUiOfPositionsOfWallet = async (chatId: TelegramBot.ChatId, wallet_id: string) => {
    let title = null;
    let buttons = null;


    let positions;
    positions = await Position.find({ chatId, myWallet: wallet_id });

    if (positions && positions.length > 0) {
        title = '📊 Select Token\n\nPlease select token to show position\n';
        buttons = [];
        for (let i = 0; i < positions.length; i++) {
            buttons.push([
                { text: `token - ${positions[i].tokenSymbol}`, callback_data: `position_${positions[i]._id}` }]
            );
        }
        buttons.push([{ text: `🔙 Back`, callback_data: `back_to_walletlist` }]);
    }
    return { title, buttons };
}

const getUiOfPositions = async (chatId: TelegramBot.ChatId) => {
    let title = null;
    let buttons = null;
    buttons = [];
    let wallets;
    wallets = await MyWallet.find({ chatId });

    if (wallets && wallets.length > 0) {

        title = '📊 Select Wallet\n\nPlease select wallet to show position\n';

        for (let i = 0; i < wallets.length; i++) {
            buttons.push([
                { text: `Wallet ${i + 1} ( ${wallets[i].name} )`, callback_data: `wallet_${wallets[i]._id}` }]
            );
        }

        buttons.push([{ text: `🔙 Back`, callback_data: `back` }]);
    }
    return { title, buttons };
}

const showPosition = async (query: TelegramBot.CallbackQuery, position_id: string) => {
    if (query.message) {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        const sellSetting = sellSettings.get(position_id);

        if (!sellSetting) {
            sellSettings.set(position_id, {
                sellmode: 'auto',
                slippage: 'auto'
            });
        }

        const { title, buttons } = await getUiOfSell(position_id)
        if (title && buttons)
            bot.sendMessage(chatId, title, {
                parse_mode: "HTML", reply_markup: {
                    inline_keyboard: buttons
                },
            });
        else {
            bot.sendMessage(chatId, 'No position');
        }
    }
}

