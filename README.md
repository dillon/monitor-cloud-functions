# monitor-cloud-functions
Firebase Cloud Functions for Ethereum transaction "Monitor" app
Repository for the mobile app built with react-native can be found here: [github.com/dillon/monitor](https://github.com/dillon/monitor).

1. `newUser` creates a corresponding database entry for each new user sign up.
2. `deleteUser` deletes all corresponding database info and deletes all associated webhooks users who delete their firebase auth account
3. `newWallet` fetches balance and most recent 10,000 transactions for new wallets via the Etherscan API and populates the Firebase Realtime Database. Also listens for new transactions by creating a webhook with the BlockCypher API
4. `webhookEndpoint` a webhook callback function that accents new transactions, sends a push notification to the user associated with the wallet and populates the Firebase Realtime Database with new transactions.
