# Devcon rewrite
This branch contains all of the changes that will be made for the full rewrite of our system post Spank hack.

Primary changes to client include:
- Switching to typescript
- Moving towards a generalized client that acts as a library for any use case (moves business logic to wallet/hub)
- Exposing contract handler functions publicly 
- Exposing validation functions publicly
- Exposing utility functions publicly (signing, hash prep)

## Basic Contract handlers
Contract-wrapping functions which validate inputs prior to submitting onchain
Functions currently on the contract:
- hubAuthorizedUpdate
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

## Utils
Convenience functions which help users deal with states, signing and hashes
//what do we need here? TODO go through Hub/client/wallet and look for overlaps
- createChannelStateUpdateFingerprint (internal? Should definitely be called by other utils/wrappers)
- recoverSignerFromChannelStateUpdate
- createThreadStateUpdateFingerprint
- recoverSignerFromThreadStateUpdate
- createChannelStateUpdate
- createThreadStateUpdate
- generateThreadRootHash
- generateMerkleTree

## State Generators
Functions which generate state that is ready to be submitted onchain for any case
//can we do this with a switch and just one generateSwitch() method?
//split by thread vs channel updates?

//state schema:
```
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

#### channel updates
- deposit 
- withdraw
- update
#### thread updates
- initial/create(?)
- update
- close/withdraw

## Top level wrappers
Do everything related to a specific common flow like deposit/withdraw/deposit with exchange

## Validators
//TODO
