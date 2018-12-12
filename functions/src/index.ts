import * as functions from 'firebase-functions';
import { database } from 'firebase-admin';
const admin = require('firebase-admin');
const request = require('request');
const http = require('http');
const moment = require('moment');

const BLOCKCYPHER_API_KEY = functions.config().blockcypher.key
const ETHERSCAN_API_KEY = functions.config().etherscan.key
const SECRET = functions.config().my.secret
const webhookCallbackUrl = `https://us-central1-monitor-3f707.cloudfunctions.net/webhookEndpoint?secret=${SECRET}`
const OUTGOING = 'outgoing'
const INCOMING = 'incoming'
const OTHER = 'other'

class Transaction {
  constructor(
    public txHash: string, // yes to leading 0x
    public dateString: string,
    public timeStamp: number,
    public type: string,
    public value: number,
    public fromAddress: string,
    public toAddress: string,
    public gasUsed: number,
    public gasPrice: number,
    public blockNumber: number,
    public blockHash: string,
    public walletAddress: string,
    public walletNickname: string
    // TODO: confirmations: number 
  ) { };
}

class TransactionMaker {
  static create(event: Transaction) {
    return new Transaction(
      event.txHash, event.dateString, event.timeStamp, event.type, event.value, event.fromAddress,
      event.toAddress, event.gasUsed, event.gasPrice, event.blockNumber, event.blockHash,
      event.walletAddress, event.walletNickname
    );
  }
}


admin.initializeApp(functions.config().firebase);


// NEW USER
exports.newUser = functions.auth.user().onCreate((user) => {
  const userObject = {
    email: user.email,
    createdOn: new Date(),
  };
  return admin.database().ref('users/' + user.uid).update(userObject);
});


// DELETE USER
exports.deleteUser = functions.auth.user().onDelete((user) => {
  let promisesArray = [];

  admin.database().ref('users/' + user.uid + '/wallets')
    .once('value', snapshot => {
      const wallets = snapshot.val()
      // console.log(wallets)
      const walletsArray = Object.keys(wallets).map(i => wallets[i]);
      walletsArray.map(element => {
        promisesArray.push(deleteWebhook(element.webhookId))
      });
      promisesArray.push(
        admin.database().ref('users/' + user.uid).remove()
          .catch((err) => console.log(err))
      )
    })

  function deleteWebhook(webhookId) {
    const blockcypherData = JSON.stringify({
      'token': BLOCKCYPHER_API_KEY
    })
    const webhookOptions = {
      host: 'api.blockcypher.com',
      port: '80',
      path: `/v1/eth/main/hooks/${webhookId}?token=${BLOCKCYPHER_API_KEY}`,
      method: 'DELETE', // DELETE method
      HEADERS: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(blockcypherData)
      }
    };
    const deleteWebhookId = new Promise(function (resolve, reject) {
      console.log('step 2: in promise');
      const myRequest = http.request(webhookOptions, function (response) {
        console.log('step 3: in request');
        // response.setEncoding('utf8');
        response.on('data', function (chunk) {
          console.log('step 4: in response');
          const parsedChunk = JSON.parse(chunk)
          console.log('Webhook Deleted 1');
          resolve(parsedChunk.statusCode)
        });
        response.on('end', function (data, err) {
          resolve(data);
        });
      })
      myRequest.write(blockcypherData)
      myRequest.end();
    });
    return deleteWebhookId;
  }
  return Promise.all(promisesArray);
})

// // DELETE WALLET WEBHOOK
// exports.deleteWallet = functions.database.ref('/users/{uid}/wallets/{walletId}').onDelete(async function (snap, context) {
//   // when wallet is removed from Database
//   console.log('step 1, loaded api')
//   const wallet = snap.val();
//   const webhookId = wallet.webhookId;
//   const blockcypherData = JSON.stringify({
//     'token': BLOCKCYPHER_API_KEY
//   })

//   const webhookOptions = {
//     host: 'api.blockcypher.com',
//     port: '80',
//     path: `/v1/eth/main/hooks/${webhookId}?token=${BLOCKCYPHER_API_KEY}`,
//     method: 'DELETE', // DELETE method
//     HEADERS: {
//       'Content-Type': 'application/json',
//       'Content-Length': Buffer.byteLength(blockcypherData)
//     }
//   };

//   const deleteWebhookId = new Promise(function (resolve, reject) {
//     console.log('step 2: in promise');
//     const myRequest = http.request(webhookOptions, function (response) {
//       console.log('step 3: in request');
//       // response.setEncoding('utf8');
//       response.on('data', function (chunk) {
//         console.log('step 4: in response');
//         const parsedChunk = JSON.parse(chunk)
//         console.log('Webhook Deleted 1');
//         resolve(parsedChunk.statusCode)
//       });
//       response.on('end', function (data, err) {
//         console.log('webhook deleted 2');
//         resolve();
//       });
//     })
//     myRequest.write(blockcypherData)
//     myRequest.end();
//   });
//   return deleteWebhookId
// });


// Send Welcome Email
// exports.sendWelcomeEmail = functions.auth.user().onCreate((user) => {
//   // ... https://github.com/firebase/functions-samples/blob/Node-8/quickstarts/email-users/functions/index.js
// });


// NEW WALLET
exports.newWallet = functions.database.ref('/users/{uid}/wallets/{walletId}').onCreate(async function (snap, context) {
  const wallet = snap.val();
  const walletId = context.params.walletId
  const walletAddress: string = wallet.address;
  const walletNickname: string = wallet.nickname;
  const uid: string = context.params.uid

  // get balance
  const optionsForEtherscanBalance = {
    url: `https://api.etherscan.io/api?module=account&action=balance&address=${walletAddress}&tag=latest&apikey=${ETHERSCAN_API_KEY}`,
    json: true
  }
  const getBalance = new Promise(function (resolve, reject) {
    request(optionsForEtherscanBalance, function (err, resp) {
      if (err) {
        console.log(err);
        reject({ err: err });
      }
      resolve(parseInt(resp.body.result) / (1000000000000000000))
    })
  })

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

  // curl -sd '{"event": "confirmed-tx", "address": "14ddda446688b73161aa1382f4e4343353af6fc8", "url": "https://webhook.site/ccb360a4-7409-4e82-8820-f61f3b0ac3cd"}' https://api.blockcypher.com/v1/eth/main/hooks?token=117cfc5e59ea48b9a0fadb9a24ba4702

  const blockcypherData = JSON.stringify({
    url: webhookCallbackUrl + `&walletAddress=${walletAddress}&walletId=${walletId}&walletNickname=${walletNickname}&uid=${uid}`,
    'event': 'confirmed-tx',
    'address': (walletAddress[0] === '0' && walletAddress[1] === 'x') ? walletAddress.substr(2) : walletAddress,
    'token': BLOCKCYPHER_API_KEY
  })

  console.log('blockcypher api key:', BLOCKCYPHER_API_KEY)

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
        const parsedChunk = JSON.parse(chunk)
        const { id } = parsedChunk;
        console.log('Webhook:', parsedChunk);
        resolve(id)
      });
    })
    myRequest.write(blockcypherData)
    myRequest.end();
  });

  const balance = await getBalance
  const transactions = await getTransactions // wait for API to resolve
  const webhookId = await getWebhookId

  return Promise.all([
    // add balance to wallet
    snap.ref.child('balance')
      .set(balance)
      .then(() => {
        console.log('balance updated')
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
          })
      })
  ]);

  function standardizeTransactions(sourceName: string, data) {
    // STEP THREE: Standardize All Transaction Data
    console.log('standardize txs')
    // standardize txs from etherscan or blockcypher
    const txs = [];
    if (data.length !== 0) {
      console.log(data);
      data.map((x) => {
        let type: string;
        const dateString = new Date(x.timeStamp * 1000).toUTCString()
        if (x.from === walletAddress) type = OUTGOING
        else if (x.to === walletAddress) type = INCOMING
        else type = OTHER
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
      })
    }
    if (!txs) return [];
    else return txs
  }

  // working glitch server: https://glitch.com/edit/#!/monitor-etherscan-starter?path=server.js:28:23
  // writing firebase functions in typescript: https://firebase.google.com/docs/functions/typescript
  // FOR https API:
  // exports.helloWorld = functions.https.onRequest((request, response) => {
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


// WEBHOOK HTTPS ENDPOINT
exports.webhookEndpoint = functions.https.onRequest((req, res) => {
  // Grab the text parameter.
  const secret = req.query.secret
  const uid = req.query.uid
  const walletAddress = req.query.walletAddress
  const walletNickname = req.query.walletNickname
  const walletId = req.query.walletId
  // const transaction = req.body
  if (secret === SECRET) {
    console.log(req.body)
    const x = req.body
    let type: string;
    if ('0x' + x.addresses[0] === walletAddress) type = OUTGOING
    else if ('0x' + x.addresses[1] === walletAddress) type = INCOMING
    else type = OTHER
    const transaction = TransactionMaker.create({
      txHash: '0x' + x.hash, // adding leading 0x,
      type,
      blockNumber: x.block_height,
      blockHash: '0x' + x.block_hash, // adding leading 0x
      fromAddress: '0x' + x.addresses[0],
      toAddress: '0x' + x.addresses[1],
      value: x.total,
      gasUsed: x.gas_used,
      gasPrice: x.gas_price,
      timeStamp: moment(x.confirmed).unix(),
      dateString: x.confirmed,
      walletAddress,
      walletNickname
    })
    //  res.send('hi');
    // Push the new message into the Realtime Database using the Firebase Admin SDK.
    // return admin.database().ref(`/users/${uid}/wallets/${walletId}/transactions`)
    // return admin.database().ref(`users/${uid}/wallets/`)
    if (admin) {
      return admin.database().ref(`users/${uid}/wallets/${walletId}`)
        .child('transactions')
        .push().set(transaction)
        .then((snapshot) => {
          // Redirect with 303 SEE OTHER to the URL of the pushed object in the Firebase console.
          console.log('success')
          res.redirect(303, 'done');
          return
        })
        .catch(err => {
          console.log(err.message || 'error caught 1');
          res.send(err.message)
          return
        });
    } else {
      res.redirect(303, 'done 2');
      return
    }
  } else {
    return res.send('Denied');
  }
});
