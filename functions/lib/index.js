"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const functions = require("firebase-functions");
const admin = require('firebase-admin');
const request = require('request');
const http = require('http');
const BLOCKCYPHER_API_KEY = functions.config().blockcypher.key;
const ETHERSCAN_API_KEY = functions.config().etherscan.key;
const webhookCallbackUrl = 'https://webhook.site/59b866ec-c133-43c7-8bfa-9e78722da7ff';
const OUTGOING = 'outgoing';
const INCOMING = 'incoming';
const OTHER = 'other';
class Transaction {
    constructor(txHash, // yes to leading 0x
    dateString, timeStamp, type, value, fromAddress, toAddress, gasUsed, gasPrice, blockNumber, blockHash, walletAddress, walletNickname
    // TODO: confirmations: number 
    ) {
        this.txHash = txHash;
        this.dateString = dateString;
        this.timeStamp = timeStamp;
        this.type = type;
        this.value = value;
        this.fromAddress = fromAddress;
        this.toAddress = toAddress;
        this.gasUsed = gasUsed;
        this.gasPrice = gasPrice;
        this.blockNumber = blockNumber;
        this.blockHash = blockHash;
        this.walletAddress = walletAddress;
        this.walletNickname = walletNickname;
    }
    ;
}
class TransactionMaker {
    static create(event) {
        return new Transaction(event.txHash, event.dateString, event.timeStamp, event.type, event.value, event.fromAddress, event.toAddress, event.gasUsed, event.gasPrice, event.blockNumber, event.blockHash, event.walletAddress, event.walletNickname);
    }
}
admin.initializeApp(functions.config().firebase);
exports.newUser = functions.auth.user().onCreate((user) => {
    const userObject = {
        email: user.email,
        createdOn: new Date(),
        theme: "light"
    };
    return admin.database().ref('users/' + user.uid).set(userObject);
});
exports.deleteUser = functions.auth.user().onDelete((user) => {
    return admin.database().ref('users/' + user.uid).remove()
        .catch((err) => console.log(err));
});
// Send Welcome Email
// export const sendWelcomeEmail = functions.auth.user().onCreate((user) => {
//   // ... https://github.com/firebase/functions-samples/blob/Node-8/quickstarts/email-users/functions/index.js
// });
exports.newWallet = functions.database.ref('/users/{uid}/wallets/{walletId}')
    // Grab array of old transactions
    .onCreate(function (snap, context) {
    return __awaiter(this, void 0, void 0, function* () {
        const wallet = snap.val();
        const walletAddress = wallet.address;
        const walletNickname = wallet.nickname;
        // get balance
        const optionsForEtherscanBalance = {
            url: `https://api.etherscan.io/api?module=account&action=balance&address=${walletAddress}&tag=latest&apikey=${ETHERSCAN_API_KEY}`,
            json: true
        };
        const getBalance = new Promise(function (resolve, reject) {
            request(optionsForEtherscanBalance, function (err, resp) {
                if (err) {
                    console.log(err);
                    reject({ err: err });
                }
                resolve(parseInt(resp.body.result) / (1000000000000000000));
            });
        });
        // etherscan for past transactions
        const optionsForEtherscanTx = {
            url: `http://api.etherscan.io/api?module=account&action=txlist&address=${walletAddress}&startblock=0&endblock=99999999&sort=asc&apikey=${ETHERSCAN_API_KEY}`,
            json: true
        };
        const getTransactions = new Promise(function (resolve, reject) {
            request(optionsForEtherscanTx, function (err, resp) {
                if (err) {
                    console.log(err);
                    reject({ err: err });
                }
                resolve(standardizeTransactions('etherscan', resp.body.result)); // resolve with standardized transactions
            });
        });
        // blockcypher for future transactions
        function addWebhookIdToDatabase(id) {
            console.log('id:', id);
        }
        const blockcypherData = JSON.stringify({
            url: webhookCallbackUrl,
            'event': 'confirmed-tx',
            'address': walletAddress,
            'token': BLOCKCYPHER_API_KEY
        });
        console.log('blockcypher api key:', BLOCKCYPHER_API_KEY);
        const webhookOptions = {
            host: 'api.blockcypher.com',
            port: '80',
            path: '/v1/eth/main/hooks',
            method: 'POST',
            HEADERS: {
                'Content-Type': 'application/json',
                'Content-Length': blockcypherData.length
            }
        };
        const getWebhookId = new Promise(function (resolve, reject) {
            const myRequest = http.request(webhookOptions, function (response) {
                // console.log(res.statusCode)
                response.setEncoding('utf8');
                response.on('data', function (chunk) {
                    const parsedChunk = JSON.parse(chunk);
                    const { id } = parsedChunk;
                    console.log('Webhook:', parsedChunk);
                    resolve(id);
                });
            });
            myRequest.write(blockcypherData);
            myRequest.end();
        });
        const balance = yield getBalance;
        const transactions = yield getTransactions; // wait for API to resolve
        const webhookId = yield getWebhookId;
        return Promise.all([
            // add balance to wallet
            snap.ref.child('balance')
                .set(balance)
                .then(() => {
                console.log('balance updated');
            }),
            // add webhook id to wallet
            snap.ref.child('webhookId')
                .set(webhookId)
                .then(() => {
                console.log('webhookId set:', webhookId);
            }),
            // add old transactions
            snap.ref.child('transactions')
                .set(transactions)
                .then(() => {
                console.log('transactions set');
                return snap.ref.child('isFetchingTransactions')
                    .set(false)
                    .then(() => {
                    console.log('isFetchingTransactions set to false');
                });
            })
        ]);
        // function deleteWallet(walletAddressToDelete: string): void {
        //   // TODO
        //   console.log('should Delete Wallet', walletAddressToDelete)
        // }
        function standardizeTransactions(sourceName, data) {
            // STEP THREE: Standardize All Transaction Data
            console.log('standardize txs');
            // standardize txs from etherscan or blockcypher
            const txs = [];
            const etherscan = sourceName === 'etherscan';
            if (etherscan && data.length !== 0) {
                console.log(data);
                data.map((x) => {
                    let type;
                    const dateString = new Date(x.timeStamp * 1000).toUTCString();
                    if (x.from === walletAddress)
                        type = OUTGOING;
                    else if (x.to === walletAddress)
                        type = INCOMING;
                    else
                        type = OTHER;
                    const transaction = TransactionMaker.create({
                        txHash: x.hash,
                        type,
                        blockNumber: parseInt(x.blockNumber),
                        blockHash: x.blockHash,
                        fromAddress: x.from,
                        toAddress: x.to,
                        value: parseInt(x.value) / (1000000000000000000),
                        gasUsed: parseInt(x.gas),
                        gasPrice: parseInt(x.gasPrice),
                        timeStamp: parseInt(x.timeStamp),
                        dateString,
                        walletAddress,
                        walletNickname
                    });
                    txs.push(transaction);
                });
            }
            else {
                data.map((x) => {
                    let type;
                    if ('0x' + x.addresses[0] === walletAddress)
                        type = OUTGOING;
                    else if (x.addresses[1] === walletAddress)
                        type = INCOMING;
                    else
                        type = OTHER;
                    const transaction = TransactionMaker.create({
                        txHash: '0x' + x.hash,
                        type,
                        blockNumber: x.block_height,
                        blockHash: '0x' + x.block_hash,
                        fromAddress: '0x' + x.addresses[0],
                        toAddress: '0x' + x.addresses[1],
                        value: x.total,
                        gasUsed: x.gas_used,
                        gasPrice: x.gas_price,
                        timeStamp: x.confirmed,
                        dateString: x.confirmed,
                        walletAddress,
                        walletNickname
                    });
                    txs.push(transaction);
                });
            }
            if (!txs)
                return [];
            else
                return txs;
        }
        // working glitch server: https://glitch.com/edit/#!/monitor-etherscan-starter?path=server.js:28:23
        // writing firebase functions in typescript: https://firebase.google.com/docs/functions/typescript
        // FOR https API:
        // export const helloWorld = functions.https.onRequest((request, response) => {
        //     response.send('Hello from Firebase Functions');
        // });
        // function createWebhook(): void {
        // STEP FIVE: Create Webhook for new Transactions:
        //   console.log('should create Webhook now')
        // }
        // STEP THREE: Respond to Webhook requests:
        // Add transaction to database
        // Send cloud message to user https://firebase.google.com/docs/cloud-messaging/
        // subscribing to a topic: https://firebase.google.com/docs/cloud-messaging/android/topic-messaging#subscribe_the_client_app_to_a_topic
        // push notifications: https://medium.com/yale-sandbox/react-native-push-notifications-with-firebase-cloud-functions-74b832d45386
    });
});
//# sourceMappingURL=index.js.map