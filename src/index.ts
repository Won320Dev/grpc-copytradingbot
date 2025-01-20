import * as telegrambot from "./bot";
import * as mongodb from './db';
// import * as copytrade from './copytrade';
// const { grpcStart } = require("./copytrade.js")

const start = async () => {
    await mongodb.connect();
    telegrambot.init();
    // copytrade.startService(copytrade.WS);
    // grpcStart("3LkGTjNsF2zWc2ddBPHYyEJJZKqbdHJDgfjztxnjwL5R");
    telegrambot.pnlMonitor();
}

start();

