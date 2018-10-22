# Devcon rewrite

This branch contains all of the changes that will be made for the full rewrite of our system post Spank hack.

Primary changes to client include:

- Switching to typescript
- Moving towards a generalized client that acts as a library for any use case (moves business logic to wallet/hub)
- Exposing contract handler functions publicly
- Exposing validation functions publicly
- Exposing utility functions publicly (signing, hash prep)

## Basic Contract Handlers

Contract-wrapping functions which validate inputs prior to submitting onchain
Functions currently on the contract:

- hubAuthorizedUpdate:
- userAuthorizedUpdate
- startExit
- startExitWithUpdate
- emptyChannelWithChallenge
- emptyChannel
- startExitThreads
- startExitThreadsWithUpdates
- emptyThreads
- recipientEmptyThreads
- nukeThreads

NOTE: will types for these functions come from typechain?

## Utils

Convenience functions which help users deal with generating hashes, signatures, and state:

<!-- what do we need here?
TODO go through Hub/client/wallet and look for overlaps -->

- createChannelStateUpdateFingerprint (internal? Should definitely be called by other utils/wrappers)
- recoverSignerFromChannelStateUpdate
- signChannelStateUpdate (we may not need this)
- createThreadStateUpdateFingerprint
- recoverSignerFromThreadStateUpdate
- signThreadStateUpdate (we may not need this)
- generateThreadRootHash
- generateMerkleTree

NOTE: do we want to include the `createChannelStateUpdate` and `createThreadStateUpdate` functions to be used between the client and the hub?

## State Generators

Functions which generate parameters that are ready to be submitted onchain for any case:

<!-- can we do this with a switch and just one generateState() method?
split by thread vs channel updates? -->

The channel state schema:

```javascript
bytes32 state = keccak256(
     abi.encodePacked(
         address(this),
         user,
         recipient,
         weiBalances, // [hub, user]
         tokenBalances, // [hub, user]
         pendingWeiDeposits, // [hub, user]
         pendingTokenDeposits, // [hub, user]
         pendingWeiWithdrawals, // [hub, user]
         pendingTokenWithdrawals, // [hub, user]
         txCount, // persisted onchain even when empty
         threadRoot,
         threadCount,
         timeout
     )
 );
```

The thread state schema: (not verified, thread dispute methods may change)

```javascript
bytes32 state = keccak256(
     abi.encodePacked(
         address(this),
         user,
         recipient,
         weiBalances, // [hub, user]
         tokenBalances, // [hub, user]
         txCount, // persisted onchain even when empty
     )
 );
```

The client will have the following methods to be used by the wallet:

- createChannelStateUpdate:

```javascript
const CHANNEL_UPDATE_TYPES = {
    'PAYMENT': ,
    'EXCHANGE': ,
    'PROPOSE_DEPOSIT': , // deposits in pending
    'CONFIRM_DEPOSIT': , // deposits in balance
    'PROPOSE_WITHDRAW': , // withdraw in pending
    'CONFIRM_WITHDRAW': , // withdraw in balance
    'OPEN_THREAD': ,
    'CLOSE_THREAD': ,
};

ChannelBalanceObject: {
    weiBalance: BN,
    tokenBalance: BN,
    pendingWeiDeposit: BN,
    pendingTokenDeposit: BN,
}

ChannelStateObject: {
    contractAddress: string, // ETH address
    user: string, // ETH address
    recipient: string, // ETH address
    weiBalances: Array<BN>, // [hub, user]
    tokenBalances: Array<BN>, // [hub, user]
    pendingWeiDeposits: Array<BN>, // [hub, user]
    pendingTokenDeposits: Array<BN>, // [hub, user]
    pendingWeiWithdrawals: Array<BN>, // [hub, user]
    pendingTokenWithdrawals: Array<BN>, // [hub, user]
    txCount: Array<BN>, // persisted onchain even when empty
    threadRoot: string,
    threadCount: BN,
    timeout: BN,
}

async createChannelStateUpdate({
    userBalance: ChannelBalanceObject,
    hubBalance: ChannelBalanceObject,
    type: CHANNEL_UPDATE_TYPES,
    timeout: Number,
    exchangeRate: string, // handle decimals in wallet or client?
    meta: Object, // should any validation be done here?
}): Promise<ChannelStateObject>
```

- createThreadStateUpdate:

```javascript
ThreadBalanceObject: {
    weiBalance: BN,
    tokenBalance: BN,
}

ThreadStateObject: {
    contractAddress: string, // ETH address
    user: string, // ETH address
    recipient: string, // ETH address
    weiBalances: Array<BN>, // [hub, user]
    tokenBalances: Array<BN>, // [hub, user]
    txCount: BN, // persisted onchain even when empty
}

async createThreadStateUpdate({
    userBalance: ThreadBalanceObject,
    recieverBalance: ThreadBalanceObject,
    meta: Object, // should any validation be done here?
}): Promise<ThreadStateObject>
```

Outstanding questions:

- Do we want to have a way for the client to simply "confirmUpdate" (e.g after pending)?
- Do we need the `PROPOSE_DEPOSIT` and `CONFIRM_DEPOSIT` types, or should it be just `DEPOSIT`
  - performer's wallet will constantly need to confirm hub deposits, but will not need to propose deposits
- Do we like the types?
  - still need to integrate typechain
- Need to finalize thread state object

## Top level wrappers

1. closeAllThreads

- closeThread for all open threads

2. depositAndExchange:

- deposit update
  - propose deposit update to hub
  - deposit on chain
  - confirm deposit update w/hub
- exchange update

3. deposit

- propose deposit update to hub
- deposit on chain
- confirm deposit update w/hub

4. exchangeAndWithdraw

- exchange update
- withdraw update
  - propose withdraw
  - withdraw on chain
  - confirm withdrawl with hub

5. withdraw

- propose withdrawl
- submit to chain
- cofirm deposit update w/hub

NOTE: I am not the best way to include these, since the client is supposed to be stateless and purely functional. Additionally, these functions may be best to include in a corresponding wallet impementation. Needs to be further discussed

- how will the client make web3 calls in contract handlers?
  - we can pass it in to the functions, or we can still instantiate the client with a web3 instance
- where will the client get information about the channels?
- how will the wallets of the user and performer communicate with each other when opening threads?
- do we want to have dispute wrappers (e.g `respondToDispute`)
- are `depositAndExchange` and `exchangeAndWithdraw` to use-case specific to be included into the client

## Validators

- validateChannelStateUpdate:

```javascript
async validateChannelStateUpdate({
  previous: ChannelStateObject, // may not need, could fetch previous?
  current: ChannelStateObject,
  type: CHANNEL_UPDATE_TYPES,
}): Promise<Boolean>;
```

- validateThreadStateUpdate:

```javascript
async validateThreadStateUpdate({
  previous: ThreadStateObject, // may not need, could fetch previous?
  current: ThreadStateObject,
}): Promise<Boolean>;
```

- isContained:

```javascript
async isContained({
    threadInitialState: ThreadStateObject,
    channel: ChannelStateObject // maybe just rootHash?
}): Promise<Boolean>;
```

- parameter validation should be mostly handled by typescript
  - additional error checking will also happen internally to the connext client
- should continue to use custom error handling
