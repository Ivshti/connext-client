const channelManagerAbi = require("../artifacts/ChannelManager.json");
const util = require("ethereumjs-util");
const Web3 = require("web3");
const validate = require("validate.js");
const {
  validateBalance,
  validateTipPurchaseMeta,
  validatePurchasePurchaseMeta,
  validateWithdrawalPurchaseMeta,
  ChannelOpenError,
  ParameterValidationError,
  ContractError,
  ThreadOpenError,
  ChannelUpdateError,
  ThreadUpdateError,
  ChannelCloseError,
  ThreadCloseError
} = require("./helpers/Errors");
const MerkleTree = require("./helpers/MerkleTree");
const Utils = require("./helpers/utils");
const crypto = require("crypto");
const networking = require("./helpers/networking");
const tokenAbi = require("human-standard-token-abi");

// Channel enums
const CHANNEL_STATES = {
  OPENED: 0,
  JOINED: 1,
  SETTLING: 2,
  SETTLED: 3
};

// thread enums
const THREAD_STATES = {
  OPENED: 0,
  JOINED: 1,
  SETTLING: 2,
  SETTLED: 3
};

// Purchase metadata enum
const META_TYPES = {
  TIP: 0,
  PURCHASE: 1,
  UNCATEGORIZED: 2,
  WITHDRAWAL: 3
};

const PAYMENT_TYPES = {
  LEDGER: 0,
  VIRTUAL: 1
};

const CHANNEL_TYPES = {
  ETH: 0,
  TOKEN: 1,
  TOKEN_ETH: 2
};

// ***************************************
// ******* PARAMETER VALIDATION **********
// ***************************************
validate.validators.isPositiveBnString = value => {
  let bnVal;
  if (Web3.utils.isBN(value)) {
    bnVal = value;
  } else {
    // try to convert to BN
    try {
      bnVal = Web3.utils.toBN(value);
    } catch (e) {
      return `${value} cannot be converted to BN`;
    }
  }

  if (bnVal.isNeg()) {
    return `${value} cannot be negative`;
  } else {
    return null;
  }
};
validate.validators.isValidChannelType = value => {
  if (!value) {
    return `Value vannot be undefined`;
  } else if (CHANNEL_TYPES[value] === -1) {
    return `${value} is not a valid channel type`;
  }
};
validate.validators.isValidDepositObject = value => {
  if (!value) {
    return `Value cannot be undefined`;
  } else if (!value.tokenDeposit && !value.weiDeposit) {
    return `${value} does not contain tokenDeposit or weiDeposit fields`;
  }
  if (value.tokenDeposit && !validateBalance(value.tokenDeposit)) {
    return `${value.tokenDeposit} is not a valid token deposit`;
  }

  if (value.weiDeposit && !validateBalance(value.weiDeposit)) {
    return `${value.weiDeposit} is not a valid eth deposit`;
  }

  return null;
};

validate.validators.isValidMeta = value => {
  if (!value) {
    return `Value cannot be undefined.`;
  } else if (!value.receiver) {
    return `${value} does not contain a receiver field`;
  } else if (!Web3.utils.isAddress(value.receiver)) {
    return `${value.receiver} is not a valid ETH address`;
  } else if (!value.type) {
    return `${value} does not contain a type field`;
  }

  let isValid, ans;

  switch (META_TYPES[value.type]) {
    case 0: // TIP
      isValid = validateTipPurchaseMeta(value);
      ans = isValid
        ? null
        : `${JSON.stringify(
            value
          )} is not a valid TIP purchase meta, missing one or more fields: streamId, performerId, performerName`;
      return ans;
    case 1: // PURCHASE
      isValid = validatePurchasePurchaseMeta(value);
      ans = isValid
        ? null
        : `${JSON.stringify(
            value
          )} is not a valid PURCHASE purchase meta, missing one or more fields: productSku, productName`;
      return ans;
    case 2: // UNCATEGORIZED -- no validation
      return null;
    case 3: // WITHDRAWAL
      isValid = validateWithdrawalPurchaseMeta(value);
      ans = isValid
        ? null
        : `${JSON.stringify(value)} is not a valid WITHDRAWAL purchase meta.`;
      return ans;
    default:
      return `${value.type} is not a valid purchase meta type`;
  }
};

validate.validators.isChannelStatus = value => {
  if (CHANNEL_STATES[value] === -1) {
    return null;
  } else {
    return `${value} is not a valid lc state`;
  }
};

validate.validators.isBN = value => {
  if (Web3.utils.isBN(value)) {
    return null;
  } else {
    return `${value} is not BN.`;
  }
};

validate.validators.isHex = value => {
  if (Web3.utils.isHex(value)) {
    return null;
  } else {
    return `${value} is not hex string.`;
  }
};

validate.validators.isHexStrict = value => {
  // for ledgerIDs
  if (Web3.utils.isHexStrict(value)) {
    return null;
  } else {
    return `${value} is not hex string prefixed with 0x.`;
  }
};

validate.validators.isArray = value => {
  if (Array.isArray(value)) {
    return null;
  } else {
    return `${value} is not an array.`;
  }
};

validate.validators.isObj = value => {
  if (value instanceof Object && value) {
    return null;
  } else {
    return `${value} is not an object.`;
  }
};

validate.validators.isAddress = value => {
  if (Web3.utils.isAddress(value)) {
    return null;
  } else {
    return `${value} is not address.`;
  }
};

validate.validators.isBool = value => {
  if (typeof value === typeof true) {
    return null;
  } else {
    return `${value} is not a boolean.`;
  }
};

validate.validators.isPositiveInt = value => {
  if (value >= 0) {
    return null;
  } else {
    return `${value} is not a positive integer.`;
  }
};

validate.validators.isThreadState = value => {
  if (!value.channelId || !Web3.utils.isHexStrict(value.channelId)) {
    return `Thread state does not contain valid channelId: ${JSON.stringify(
      value
    )}`;
  }
  if (value.nonce == null || value.nonce < 0) {
    return `Thread state does not contain valid nonce: ${JSON.stringify(
      value
    )}`;
  }
  if (!value.partyA || !Web3.utils.isAddress(value.partyA)) {
    return `Thread state does not contain valid partyA: ${JSON.stringify(
      value
    )}`;
  }
  if (!value.partyB || !Web3.utils.isAddress(value.partyB)) {
    return `Thread state does not contain valid partyB: ${JSON.stringify(
      value
    )}`;
  }
  // valid state may have weiBalanceA/tokenBalanceA
  // or valid states may have balanceA objects
  if (value.weiBalanceA != null) {
    // must also contain all other fields
    if (
      value.weiBalanceB == null ||
      value.tokenBalanceA == null ||
      value.tokenBalanceB == null
    ) {
      return `Thread state does not contain valid balances: ${JSON.stringify(
        value
      )}`;
    }
  } else if (value.balanceA != null) {
    if (
      validate.validators.isValidDepositObject(value.balanceA) ||
      validate.validators.isValidDepositObject(value.balanceB)
    ) {
      return `Thread state does not contain valid balances: ${JSON.stringify(
        value
      )}`;
    }
  } else {
    return `Thread state does not contain valid balances: ${JSON.stringify(
      value
    )}`;
  }

  return null;
};

validate.validators.isChannelObj = value => {
  if (CHANNEL_STATES[value.state] === -1) {
    return `Channel object does not contain valid state: ${JSON.stringify(
      value
    )}`;
  }
  if (!value.channelId || !Web3.utils.isHexStrict(value.channelId)) {
    return `Channel object does not contain valid channelId: ${JSON.stringify(
      value
    )}`;
  }
  if (value.nonce == null || value.nonce < 0) {
    return `Channel object does not contain valid nonce: ${JSON.stringify(
      value
    )}`;
  }
  if (!value.partyA || !Web3.utils.isAddress(value.partyA)) {
    return `Channel object does not contain valid partyA: ${JSON.stringify(
      value
    )}`;
  }
  if (!value.partyI || !Web3.utils.isAddress(value.partyI)) {
    return `Channel object does not contain valid partyI: ${JSON.stringify(
      value
    )}`;
  }
  if (value.numOpenThread == null || value.numOpenThread < 0) {
    return `Channel object does not contain valid number of numOpenThread: ${JSON.stringify(
      value
    )}`;
  }
  if (!value.threadRootHash || !Web3.utils.isHexStrict(value.threadRootHash)) {
    return `Channel object does not contain valid threadRootHash: ${JSON.stringify(
      value
    )}`;
  }
  if (value.weiBalanceA == null) {
    return `Channel object does not contain valid weiBalanceA: ${JSON.stringify(
      value
    )}`;
  }
  if (value.weiBalanceI == null) {
    return `Channel object does not contain valid weiBalanceI: ${JSON.stringify(
      value
    )}`;
  }
  if (value.tokenBalanceA == null) {
    return `Channel object does not contain valid tokenBalanceA: ${JSON.stringify(
      value
    )}`;
  }
  if (value.tokenBalanceI == null) {
    return `Channel object does not contain valid tokenBalanceI: ${JSON.stringify(
      value
    )}`;
  }
  return null;
};

/**
 *
 * Class representing an instance of a Connext client.
 */
class Connext {
  /**
   *
   * Create an instance of the Connext client.
   *
   * @constructor
   * @example
   * const Connext = require('connext')
   * const connext = new Connext(web3)
   * @param {Object} params - the constructor object
   * @param {Web3} params.web3 - the web3 instance
   * @param {String} params.hubAddress - ETH address of the hub
   * @param {String} params.hubUrl - url of hub server
   * @param {String} params.contractAddress - address of deployed ChannelManager contract
   * @param {String} params.hubAuth - token authorizing client package to make requests to hub
   */
  constructor(
    { web3, hubAddress = "", hubUrl = "", contractAddress = "", hubAuth = "" },
    web3Lib = Web3
  ) {
    this.web3 = new web3Lib(web3.currentProvider); // convert legacy web3 0.x to 1.x
    this.hubAddress = hubAddress.toLowerCase();
    this.hubUrl = hubUrl;
    this.channelManagerInstance = new this.web3.eth.Contract(
      channelManagerAbi.abi,
      contractAddress
    );
    this.config = {
      headers: {
        Cookie: `hub.sid=${hubAuth};`,
        Authorization: `Bearer ${hubAuth}`
      },
      withAuth: true
    };
    this.networking = networking(hubUrl, false);
  }

  // ***************************************
  // *********** HAPPY CASE FNS ************
  // ***************************************

  /**
   * Opens a channel with the hub at the address provided when instantiating the Connext instance with the given initial deposits.
   *
   * Uses the internal web3 instance to call the createChannel function on the Channel Manager contract, and logs the transaction hash of the channel creation. The function returns the ID of the created channel.
   *
   * Once the channel is created on chain, users should call the requestJoinChannel function to request that the hub joins the channel with the provided deposit. This deposit is the amount the viewer anticipates others will pay them for the duration of the channel. This function should be called on a timeout sufficient for the hub to detect the channel and add it to its database.
   *
   * If the hub is unresponsive, or does not join the channel within the challenge period, the client function "channelOpenTimeoutContractHandler" can be called by the client to recover the funds.
   *
   * @example
   * // sender must approve token transfer
   * // for channel manager contract address before calling
   * const initialDeposits = {
   *    tokenDeposit: Web3.utils.toBN('1000'),
   *    weiDeposit: Web3.utils.toBN('1000')
   * }
   * const challenge = 3600 // period to wait in disputes
   * const tokenAddress = '0xaacb...'
   * const channelId = await connext.openChannel({ initialDeposits, challenge, tokenAddress })
   *
   * @param {Object} initialDeposits - deposits in wei (must have at least one deposit)
   * @param {BN} initialDeposits.weiDeposit - deposit in wei (may be null for ETH only channels)
   * @param {BN} initialDeposits.tokenDeposit - deposit in tokens (may be null)
   * @param {Number} challenge - challenge period in seconds
   * @param {String} tokenAddress - address of token deposit.
   * @param {String} sender - (optional) counterparty with hub in ledger channel, defaults to accounts[0]
   * @returns {Promise} resolves to the channel id of the created channel
   */
  async openChannel({
    initialDeposits,
    challenge,
    tokenAddress = null,
    sender = null
  }) {
    // validate params
    const methodName = "openChannel";
    const isValidDepositObject = { presence: true, isValidDepositObject: true };
    const isAddress = { presence: true, isAddress: true };
    const isPositiveInt = { presence: true, isPositiveInt: true };
    Connext.validatorsResponseToError(
      validate.single(initialDeposits, isValidDepositObject),
      methodName,
      "initialDeposits"
    );
    Connext.validatorsResponseToError(
      validate.single(challenge, isPositiveInt),
      methodName,
      "challenge"
    );
    if (tokenAddress) {
      Connext.validatorsResponseToError(
        validate.single(tokenAddress, isAddress),
        methodName,
        "tokenAddress"
      );
    }
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }

    // determine channel type
    const { weiDeposit, tokenDeposit } = initialDeposits;
    let channelType;
    if (weiDeposit && tokenDeposit) {
      // token and eth
      channelType = Object.keys(CHANNEL_TYPES)[2];
    } else if (tokenDeposit) {
      channelType = Object.keys(CHANNEL_TYPES)[1];
    } else if (weiDeposit) {
      channelType = Object.keys(CHANNEL_TYPES)[0];
    } else {
      throw new ChannelOpenError(
        methodName,
        `Error determining channel deposit types.`
      );
    }
    // verify channel does not exist between ingrid and sender
    let channel = await this.getChannelByPartyA(sender);
    if (
      channel != null &&
      CHANNEL_STATES[channel.status] === CHANNEL_STATES.JOINED
    ) {
      throw new ChannelOpenError(
        methodName,
        401,
        `PartyA has open channel with hub, ID: ${channel.channelId}`
      );
    }

    // verify opening state channel with different account
    if (sender.toLowerCase() === this.hubAddress.toLowerCase()) {
      throw new ChannelOpenError(
        methodName,
        "Cannot open a channel with yourself"
      );
    }

    // generate additional initial lc params
    const channelId = Connext.getNewChannelId();

    const contractResult = await this.createChannelContractHandler({
      channelId,
      challenge,
      initialDeposits,
      channelType,
      tokenAddress: tokenAddress ? tokenAddress : null,
      sender
    });
    console.log("tx hash:", contractResult.transactionHash);

    return channelId;
  }

  /**
   * Requests that the hub joins the channel with the provided channelId and deposits.
   *
   * The requested deposit amounts should reflect the amount the channel partyA expects to be paid for the duration of the capital.
   *
   * @example
   * const channelId = await connext.openChannel({ initialDeposits, challenge, tokenAddress })
   * await connext.joinChannel({ channelId })
   *
   * @param {Object} hubDeposit - (optional) requested deposits in the channel from the hub. Defaults to a 0 deposit.
   * @param {BN} hubDeposit.weiDeposit - (optional) weiDeposit requested from hub
   * @param {BN} hubDeposit.tokenDeposit - (optional) tokenDeposit requested from hub.
   * @param {String} channelId - channelId of the channel you would like to join.
   * @returns {Promise} resolves to hubs response to the channel join.
   *
   */
  async requestJoinChannel({ hubDeposit, channelId }) {
    const methodName = "requestJoinChannel";
    const isHex = { presence: true, isHex: true };
    const isValidDepositObject = { presence: true, isValidDepositObject: true };
    if (hubDeposit) {
      Connext.validatorsResponseToError(
        validate.single(hubDeposit, isValidDepositObject),
        methodName,
        "hubDeposit"
      );
    } else {
      hubDeposit = {
        weiDeposit: Web3.utils.toBN("0"),
        tokenDeposit: Web3.utils.toBN("0")
      };
    }

    Connext.validatorsResponseToError(
      validate.single(channelId, isHex),
      methodName,
      "channelId"
    );

    const { weiDeposit, tokenDeposit } = hubDeposit;
    // post to hub join endpoint with same params
    try {
      const response = await this.networking.post(`channel/join`, {
        weiBalanceI: weiDeposit ? weiDeposit.toString() : "0",
        tokenBalanceI: tokenDeposit ? tokenDeposit.toString() : "0",
        channelId
      });
      return response.data;
    } catch (e) {
      throw new ChannelOpenError(methodName, `Error joining channel.`);
    }
  }

  /**
   * Adds a deposit to an existing channel by calling the contract function "deposit" using the internal web3 instance.
   *
   * Can be used by any either channel party.
   *
   * If sender is not supplied, it defaults to accounts[0]. If the recipient is not supplied, it defaults to the sender.
   *
   *
   * @example
   * // create deposit object
   * const deposits = {
   *    tokenDeposit: Web3.utils.toBN('1000'),
   *    weiDeposit: Web3.utils.toBN('1000')
   * }
   * const txHash = await connext.deposit(deposit)
   *
   * @param {Object} deposits - deposit object
   * @param {BN} deposits.weiDeposit - value of the channel deposit in ETH
   * @param {BN} deposits.tokenDeposit - value of the channel deposit in tokens
   * @param {String} tokenAddress - (optional, for testing) contract address of channel tokens. If not provided, takes from channel object.
   * @param {String} sender - (optional) ETH address sending funds to the ledger channel
   * @param {String} recipient - (optional) ETH address recieving funds in their ledger channel
   * @returns {Promise} resolves to the transaction hash of the onchain deposit.
   */
  async deposit(
    deposits,
    sender = null,
    recipient = sender,
    tokenAddress = null
  ) {
    // validate params
    const methodName = "deposit";
    const isValidDepositObject = { presence: true, isValidDepositObject: true };
    const isAddress = { presence: true, isAddress: true };
    Connext.validatorsResponseToError(
      validate.single(deposits, isValidDepositObject),
      methodName,
      "deposits"
    );
    const accounts = await this.web3.eth.getAccounts();
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      sender = accounts[0].toLowerCase();
    }
    if (recipient) {
      Connext.validatorsResponseToError(
        validate.single(recipient, isAddress),
        methodName,
        "recipient"
      );
    } else {
      recipient = accounts[0].toLowerCase();
    }

    const channel = await this.getChannelByPartyA(recipient);
    // verify channel is open
    if (CHANNEL_STATES[channel.status] !== CHANNEL_STATES.LCS_OPENED) {
      throw new ChannelUpdateError(
        methodName,
        "Channel is not in the right state"
      );
    }
    // verify recipient is in channel
    if (
      channel.partyA.toLowerCase() !== recipient.toLowerCase() &&
      channel.partyI.toLowerCase() !== recipient.toLowerCase()
    ) {
      throw new ChannelUpdateError(
        methodName,
        "Recipient is not member of channel"
      );
    }

    // call contract handler
    const contractResult = await this.depositContractHandler({
      channelId: channel.channelId,
      deposits,
      recipient,
      sender,
      tokenAddress
    });

    let sig;
    // post new sig
    const newWeiBalanceA = deposits.weiDeposit
      ? Web3.utils.toBN(channel.weiBalanceA).add(deposits.weiDeposit)
      : Web3.utils.toBN(channel.weiBalanceA);
    const newTokenBalanceA = deposits.tokenDeposit
      ? Web3.utils.toBN(channel.tokenBalanceA).add(deposits.tokenDeposit)
      : Web3.utils.toBN(channel.tokenBalanceA);

    if (contractResult) {
      // generate signed update and post to hub
      sig = await this.createChannelStateUpdate({
        channelId: channel.channelId,
        nonce: channel.nonce + 1,
        numOpenThread: channel.numOpenThread,
        threadRootHash: channel.threadRootHash,
        partyA: channel.partyA,
        partyI: channel.partyI,
        balanceA: {
          weiDeposit: newWeiBalanceA,
          tokenDeposit: newTokenBalanceA
        },
        balanceI: {
          weiDeposit: Web3.utils.toBN(channel.weiBalanceI),
          tokenDeposit: Web3.utils.toBN(channel.tokenBalanceI)
        },
        deposit: deposits
      });
    } else {
      throw new ChannelUpdateError(
        methodName,
        "Error with contract transaction"
      );
    }

    const result = await this.networking.post(
      `channel/${channel.channelId}/deposit`,
      {
        sig: sig,
        deposit: deposits.weiDeposit
          ? deposits.weiDeposit.toString()
          : deposits.tokenDeposit.toString(),
        isToken: deposits.weiDeposit ? false : true
      }
    );

    return result.data;
  }

  /**
   * Opens a thread between "to" and "sender" with the hub acting as an intermediary. Both users must have a channel open with the hub.
   *
   * If there is no deposit provided, then 100% of the channel balance is added to the thread. This function is to be called by the payor (sender), and is intended to open a unidirectional channel with the payee (to).
   *
   * Signs a copy of the initial thread state, and generates a proposed channel update to the hub for countersigning reflecting the thread creation.
   *
   * @example
   * const myFriendsAddress = "0x627306090abaB3A6e1400e9345bC60c78a8BEf57"
   * await connext.openThread({ to: myFriendsAddress })
   *
   * @param {Object} params - the method object
   * @param {String} params.to - ETH address you want to open a virtual channel with
   * @param {Object} params.deposit - (optional) deposit object for the virtual channel, defaults to the entire channel balances
   * @param {Object} params.deposit.weiDeposit - (optional) wei deposit into thread
   * @param {BN} params.deposit.weiDeposit - token deposit into thread
   * @param {String} params.sender - (optional) who is initiating the virtual channel creation, defaults to accounts[0]
   * @returns {Promise} resolves to the virtual channel ID recieved by Ingrid
   */

  async openThread({ to, deposit = null, sender = null }) {
    // validate params
    const methodName = "openThread";
    const isAddress = { presence: true, isAddress: true };
    const isValidDepositObject = { presence: true, isValidDepositObject: true };
    Connext.validatorsResponseToError(
      validate.single(to, isAddress),
      methodName,
      "to"
    );
    if (deposit) {
      Connext.validatorsResponseToError(
        validate.single(deposit, isValidDepositObject),
        methodName,
        "deposit"
      );
    }
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }
    // not opening channel with yourself
    if (sender.toLowerCase() === to.toLowerCase()) {
      throw new ThreadOpenError(
        methodName,
        "Cannot open a channel with yourself"
      );
    }

    const subchanA = await this.getChannelByPartyA(sender);
    const subchanB = await this.getChannelByPartyA(to);

    // validate the subchannels exist
    if (!subchanB || !subchanA) {
      throw new ThreadOpenError(
        methodName,
        "Missing one or more required subchannels"
      );
    }
    // subchannels in right state
    if (
      subchanB.status !== Object.keys(CHANNEL_STATES)[CHANNEL_STATES.JOINED] ||
      subchanA.status !== Object.keys(CHANNEL_STATES)[CHANNEL_STATES.JOINED]
    ) {
      throw new ThreadOpenError(
        methodName,
        "One or more required subchannels are in the incorrect state"
      );
    }

    // validate subchanA has enough to deposit or set deposit
    if (deposit === null) {
      // use entire subchanA balance
      deposit = {
        tokenDeposit: Web3.utils.toBN(subchanA.tokenBalanceA),
        weiDeposit: Web3.utils.toBN(subchanA.weiBalanceA)
      };
    }
    if (
      deposit.tokenDeposit &&
      Web3.utils.toBN(subchanA.tokenBalanceA).lt(deposit.tokenDeposit)
    ) {
      throw new ThreadOpenError(
        methodName,
        "Insufficient value to open channel with provided token deposit"
      );
    }
    if (
      deposit.weiDeposit &&
      Web3.utils.toBN(subchanA.weiBalanceA).lt(deposit.weiDeposit)
    ) {
      throw new ThreadOpenError(
        methodName,
        "Insufficient value to open channel with provided ETH deposit"
      );
    }

    // vc does not already exist
    let thread = await this.getThreadByParties({ partyA: sender, partyB: to });
    if (thread) {
      throw new ThreadOpenError(
        methodName,
        451,
        `Parties already have open virtual channel: ${thread.channelId}`
      );
    }

    // detemine update type
    let updateType;
    if (deposit.weiDeposit && deposit.tokenDeposit) {
      // token and eth
      updateType = Object.keys(CHANNEL_TYPES)[2];
    } else if (deposit.tokenDeposit) {
      updateType = Object.keys(CHANNEL_TYPES)[1];
    } else if (deposit.weiDeposit) {
      updateType = Object.keys(CHANNEL_TYPES)[0];
    } else {
      throw new ThreadOpenError(
        methodName,
        `Error determining channel deposit types.`
      );
    }

    // generate initial vcstate
    const threadId = Connext.getNewChannelId();
    const threadInitialState = {
      channelId: threadId,
      nonce: 0,
      partyA: sender,
      partyB: to.toLowerCase(),
      balanceA: deposit,
      balanceB: {
        tokenDeposit: Web3.utils.toBN("0"),
        weiDeposit: Web3.utils.toBN("0")
      },
      updateType,
      signer: sender
    };
    const threadSig = await this.createThreadStateUpdate(threadInitialState);
    const channelSig = await this.createChannelUpdateOnThreadOpen({
      threadInitialState,
      channel: subchanA,
      signer: sender
    });

    // ingrid should add vc params to db
    try {
      const response = await this.networking.post(`thread/`, {
        threadId,
        partyA: sender.toLowerCase(),
        partyB: to.toLowerCase(),
        partyI: subchanA.partyI,
        subchanA: subchanA.channelId,
        subchanB: subchanB.channelId,
        weiBalanceA: deposit.weiDeposit ? deposit.weiDeposit.toString() : "0",
        weiBalanceB: "0",
        tokenBalanceA: deposit.tokenDeposit
          ? deposit.tokenDeposit.toString()
          : "0",
        weiBond: deposit.weiDeposit ? deposit.weiDeposit.toString() : "0",
        tokenBond: deposit.tokenDeposit ? deposit.tokenDeposit.toString() : "0",
        tokenBalanceB: "0",
        threadSig,
        channelSig
      });
    } catch (e) {
      throw new ThreadOpenError(methodName, e.message);
    }
    return threadId;
  }

  /**
   * Sends a state update in a channel. Updates of these type represent an in channel payment to or from the hub.
   *
   * The balance objects represent the final balances of partyA (balanceA) and the hub (balanceB) following the update.
   *
   * @example
   * const { channelId } = await connext.getChannelByPartyA()
   * const payment = Web3.utils.toBN('10')
   * const balanceA = {
   *    tokenDeposit: Web3.utils.toBN(channel.tokenBalanceA).sub(payment),
   *    weiDeposit: Web3.utils.toBN(channel.weiBalanceA).sub(payment)
   * }
   * const balanceB = {
   *    tokenDeposit: Web3.utils.toBN(channel.tokenBalanceA).add(payment),
   *    weiDeposit: Web3.utils.toBN(channel.weiBalanceA).add(payment)
   * }
   * await connext.updateChannel({ channelId, balanceA, balanceB })
   *
   * @param {Object} params - the method object
   * @param {String} params.channelId - the channelId of the channel you are updating
   * @param {Object} params.balanceA - final balance of partyA in channel
   * @param {BN} params.balanceA.weiDeposit - (optional) final wei balance of partyA in channel
   * @param {BN} params.balanceA.tokenDeposit - (optional) final token balance of partyA in channel
   * @param {Object} params.balanceB - final balance of hub in channel
   * @param {BN} params.balanceB.weiDeposit - (optional) final wei balance of hub in channel
   * @param {BN} params.balanceB.tokenDeposit - (optional) final token balance of hub in channel
   *
   */
  async updateChannel({ channelId, balanceA, balanceB, sender = null }) {
    const methodName = "channelUpdateHandler";
    const isAddress = { presence: true, isAddress: true };
    const isHexStrict = { presence: true, isHexStrict: true };
    const isValidDepositObject = { presence: true, isValidDepositObject: true };

    if (!sender) {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0];
    }
    // validate inputs
    Connext.validatorsResponseToError(
      validate.single(sender, isAddress),
      methodName,
      "sender"
    );
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceA, isValidDepositObject),
      methodName,
      "balanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceB, isValidDepositObject),
      methodName,
      "balanceB"
    );
    const channel = await this.getChannelById(channelId);
    // must exist
    if (!channel) {
      throw new ChannelUpdateError(methodName, "Channel not found");
    }
    // must be joined
    if (CHANNEL_STATES[channel.status] !== CHANNEL_STATES.JOINED) {
      throw new ChannelUpdateError(methodName, "Channel is in invalid state");
    }
    // must be senders channel
    if (
      channel.partyA.toLowerCase() !== sender.toLowerCase() &&
      channel.partyI.toLowerCase() !== sender.toLowerCase()
    ) {
      throw new ChannelUpdateError(methodName, "Not your channel");
    }
    // check what type of update
    let updateType;
    if (
      balanceA.weiDeposit &&
      balanceA.tokenDeposit &&
      balanceB.weiDeposit &&
      balanceB.tokenDeposit
    ) {
      // token and eth
      updateType = Object.keys(CHANNEL_TYPES)[2];
    } else if (balanceA.tokenDeposit && balanceB.tokenDeposit) {
      updateType = Object.keys(CHANNEL_TYPES)[1];
    } else if (balanceA.weiDeposit && balanceB.weiDeposit) {
      updateType = Object.keys(CHANNEL_TYPES)[0];
    }

    const channelWeiBal = Web3.utils
      .toBN(channel.weiBalanceA)
      .add(Web3.utils.toBN(channel.weiBalanceI));
    const channelTokenBal = Web3.utils
      .toBN(channel.tokenBalanceA)
      .add(Web3.utils.toBN(channel.tokenBalanceI));
    let proposedWeiBalance, proposedTokenBalance;

    switch (CHANNEL_TYPES[updateType]) {
      case CHANNEL_TYPES.ETH:
        if (balanceB.weiDeposit.lte(Web3.utils.toBN(channel.weiBalanceI))) {
          throw new ChannelUpdateError(
            methodName,
            "Channel updates can only increase hub ETH balance"
          );
        }
        proposedWeiBalance = Web3.utils
          .toBN(balanceA.weiDeposit)
          .add(balanceB.weiDeposit); // proposed balance
        break;

      case CHANNEL_TYPES.TOKEN:
        if (balanceB.tokenDeposit.lte(Web3.utils.toBN(channel.tokenBalanceI))) {
          throw new ChannelUpdateError(
            methodName,
            "Channel updates can only increase hub balance"
          );
        }
        proposedTokenBalance = Web3.utils
          .toBN(balanceA.tokenDeposit)
          .add(balanceB.tokenDeposit);
        break;

      case CHANNEL_TYPES.TOKEN_ETH:
        if (balanceB.weiDeposit.lte(Web3.utils.toBN(channel.weiBalanceI))) {
          throw new ChannelUpdateError(
            methodName,
            "Channel updates can only increase hub ETH balance"
          );
        }
        if (balanceB.tokenDeposit.lte(Web3.utils.toBN(channel.tokenBalanceI))) {
          throw new ChannelUpdateError(
            methodName,
            "Channel updates can only increase hub balance"
          );
        }
        proposedWeiBalance = Web3.utils
          .toBN(balanceA.weiDeposit)
          .add(balanceB.weiDeposit);
        proposedTokenBalance = Web3.utils
          .toBN(balanceA.tokenDeposit)
          .add(balanceB.tokenDeposit);
        break;
      default:
        throw new ChannelUpdateError(
          methodName,
          "Error determining channel deposit types."
        );
    }

    if (proposedWeiBalance && !proposedWeiBalance.eq(channelWeiBal)) {
      throw new ChannelUpdateError(
        methodName,
        "Channel ETH balance cannot change"
      );
    }

    if (proposedTokenBalance && !proposedTokenBalance.eq(channelTokenBal)) {
      throw new ChannelUpdateError(
        methodName,
        "Channel token balance cannot change"
      );
    }

    // generate signature
    let state = {
      channelId,
      nonce: channel.nonce + 1,
      numOpenThread: channel.numOpenThread,
      threadRootHash: channel.threadRootHash,
      partyA: channel.partyA,
      partyI: channel.partyI,
      balanceA,
      balanceI: balanceB,
      signer: sender
    };
    const sig = await this.createChannelStateUpdate(state);
    // post to hub
    const response = await this.networking.post(`channel/${channelId}/update`, {
      nonce: state.nonce,
      weiBalanceA: balanceA.weiDeposit ? balanceA.weiDeposit.toString() : "0",
      weiBalanceI: balanceB.weiDeposit ? balanceB.weiDeposit.toString() : "0",
      tokenBalanceA: balanceA.tokenDeposit
        ? balanceA.tokenDeposit.toString()
        : "0",
      tokenBalanceI: balanceB.tokenDeposit
        ? balanceB.tokenDeposit.toString()
        : "0",
      threadRootHash: state.threadRootHash,
      numOpenThread: state.numOpenThread,
      sigA: sig,
      sigI: ""
    });
    return response.data;
  }

  /**
   * Sends a state update in a thread. Updates of these type are unidirectional and can only facilitate payments from thread partyA to thread partyB.
   *
   * The balance objects represent the final balances of partyA (balanceA) and the hub (partyB) following the update.
   *
   * @example
   * const { threadId } = await connext.getThreadByParties({ partyA, partyB })
   * const payment = Web3.utils.toBN('10')
   * const balanceA = {
   *    tokenDeposit: Web3.utils.toBN(channel.tokenBalanceA).sub(payment),
   *    weiDeposit: Web3.utils.toBN(channel.weiBalanceA).sub(payment)
   * }
   * const balanceB = {
   *    tokenDeposit: Web3.utils.toBN(channel.tokenBalanceA).add(payment),
   *    weiDeposit: Web3.utils.toBN(channel.weiBalanceA).add(payment)
   * }
   * await connext.updateThread({ threadId, balanceA, balanceB })
   *
   * @param {String} threadId - the threadId of the thread you are updating
   * @param {Object} balanceA - final balance of partyA in thread
   * @param {BN} balanceA.weiDeposit - (optional) final wei balance of partyA in thread
   * @param {BN} balanceA.tokenDeposit - (optional) final token balance of partyA in thread
   * @param {Object} balanceB - final balance of partyB in thread
   * @param {BN} balanceB.weiDeposit - (optional) final wei balance of partyB in thread
   * @param {BN} balanceB.tokenDeposit - (optional) final token balance of partyB in thread
   * @param {String} sender - (optional) signer of balance update, defaults to accounts[0]
   *
   */
  async updateThread({ threadId, balanceA, balanceB, sender = null }) {
    // validate params
    const methodName = "updateThread";
    const isHexStrict = { presence: true, isHexStrict: true };
    const isValidDepositObject = { presence: true, isValidDepositObject: true };
    const isAddress = { presence: true, isAddress: true };

    if (!sender) {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0];
    }
    Connext.validatorsResponseToError(
      validate.single(sender, isAddress),
      methodName,
      "sender"
    );
    Connext.validatorsResponseToError(
      validate.single(threadId, isHexStrict),
      methodName,
      "threadId"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceA, isValidDepositObject),
      methodName,
      "balanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceB, isValidDepositObject),
      methodName,
      "balanceB"
    );
    // get the thread
    const thread = await this.getThreadById(threadId);
    // must exist
    if (!thread) {
      throw new ThreadUpdateError(methodName, "Thread not found");
    }
    // channel must be opening or opened
    if (THREAD_STATES[thread.state] === 3) {
      throw new ThreadUpdateError(methodName, "Thread is in invalid state");
    }
    if (sender.toLowerCase() !== thread.partyA.toLowerCase()) {
      throw new ThreadUpdateError(
        methodName,
        "Thread updates can only be made by partyA."
      );
    }

    // check what type of update
    let updateType;
    if (
      balanceA.weiDeposit &&
      balanceA.tokenDeposit &&
      balanceB.weiDeposit &&
      balanceB.tokenDeposit
    ) {
      // token and eth
      updateType = Object.keys(CHANNEL_TYPES)[2];
    } else if (balanceA.tokenDeposit && balanceB.tokenDeposit) {
      updateType = Object.keys(CHANNEL_TYPES)[1];
    } else if (balanceA.weiDeposit && balanceB.weiDeposit) {
      updateType = Object.keys(CHANNEL_TYPES)[0];
    }

    const threadEthBalance = Web3.utils
      .toBN(thread.weiBalanceA)
      .add(Web3.utils.toBN(thread.weiBalanceB));
    const threadTokenBalance = Web3.utils
      .toBN(thread.tokenBalanceA)
      .add(Web3.utils.toBN(thread.tokenBalanceB));
    let proposedWeiBalance, proposedTokenBalance;
    switch (CHANNEL_TYPES[updateType]) {
      case CHANNEL_TYPES.ETH:
        if (balanceB.weiDeposit.lte(Web3.utils.toBN(thread.weiBalanceB))) {
          throw new ThreadUpdateError(
            methodName,
            "Thread updates can only increase partyB ETH balance"
          );
        }
        proposedWeiBalance = Web3.utils
          .toBN(balanceA.weiDeposit)
          .add(balanceB.weiDeposit); // proposed balance
        break;

      case CHANNEL_TYPES.TOKEN:
        if (balanceB.tokenDeposit.lte(Web3.utils.toBN(thread.tokenBalanceB))) {
          throw new ThreadUpdateError(
            methodName,
            "Thread updates can only increase partyB token balance"
          );
        }
        proposedTokenBalance = Web3.utils
          .toBN(balanceA.tokenDeposit)
          .add(balanceB.tokenDeposit);
        break;

      case CHANNEL_TYPES.TOKEN_ETH:
        if (balanceB.weiDeposit.lte(Web3.utils.toBN(thread.weiBalanceB))) {
          throw new ThreadUpdateError(
            methodName,
            "Thread updates can only increase partyB ETH balance"
          );
        }
        if (balanceB.tokenDeposit.lte(Web3.utils.toBN(thread.tokenBalanceB))) {
          throw new ThreadUpdateError(
            methodName,
            "Thread updates can only increase partyB token balance"
          );
        }
        proposedWeiBalance = Web3.utils
          .toBN(balanceA.weiDeposit)
          .add(balanceB.weiDeposit);
        proposedTokenBalance = Web3.utils
          .toBN(balanceA.tokenDeposit)
          .add(balanceB.tokenDeposit);
        break;
      default:
        throw new ThreadUpdateError(
          methodName,
          "Error determining thread deposit types."
        );
    }

    if (proposedWeiBalance && !proposedWeiBalance.eq(threadEthBalance)) {
      throw new ThreadUpdateError(
        methodName,
        "Thread ETH balance cannot change"
      );
    }

    if (proposedTokenBalance && !proposedTokenBalance.eq(threadTokenBalance)) {
      throw new ThreadUpdateError(
        methodName,
        "Thread token balance cannot change"
      );
    }

    // generate new state update
    const state = {
      channelId: threadId,
      nonce: thread.nonce + 1,
      partyA: thread.partyA,
      partyB: thread.partyB,
      balanceA: balanceA,
      balanceB: balanceB,
      updateType,
      signer: sender
    };
    const sig = await this.createThreadStateUpdate(state);
    // post to hub
    const response = await this.networking.post(`thread/${threadId}/update`, {
      weiBalanceA: proposedWeiBalance
        ? balanceA.weiDeposit.toString()
        : Web3.utils.toBN(thread.weiBalanceA).toString(),
      weiBalanceB: proposedWeiBalance
        ? balanceB.weiDeposit.toString()
        : Web3.utils.toBN(thread.weiBalanceB).toString(),
      tokenBalanceA: proposedTokenBalance
        ? balanceA.tokenDeposit.toString()
        : Web3.utils.toBN(thread.tokenBalanceA).toString(),
      tokenBalanceB: proposedTokenBalance
        ? balanceB.tokenDeposit.toString()
        : Web3.utils.toBN(thread.tokenBalanceB).toString(),
      nonce: thread.nonce + 1,
      sigA: sig
    });

    return response.data;
  }

  /**
   * Closes a thread. May be called by either member of the thread.
   *
   * Retrieves the latest thread update, and decomposes it into the final channel updates for the subchans.
   *
   * The thread agent who called this function signs the closing channel update, and forwards the signature to the hub.
   *
   * The hub verifies the signature, returns its signature of the channel update, and proposes the corresponding update for the other thread participant.
   *
   * If the hub does not cosign the proposed channel update, the caller may enter the on-chain dispute phase calling updateChannelState, initThread, settleThread, and withdraw.
   *
   * @example
   * const { threadId } = await connext.getThreadByParties({ partyA, partyB })
   * await connext.closeThread(threadId)
   * @param {String} threadId - ID of the thread to close
   * @param {String} sender - (optional) sender of the closeThread account. Default to accounts[0]. Must be partyA or partyB in thread.
   * @returns {Promise} resolves to true if the thread was closed otherwise throws an error
   */
  async closeThread(threadId, sender = null) {
    // validate params
    const methodName = "closeThread";
    const isHexStrict = { presence: true, isHexStrict: true };
    const isAddress = { presence: true, isAddress: true };
    Connext.validatorsResponseToError(
      validate.single(threadId, isHexStrict),
      methodName,
      "threadId"
    );
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }

    // get latest state in thread
    const thread = await this.getThreadById(threadId);
    if (!thread) {
      throw new ThreadCloseError(methodName, "Thread not found");
    }
    // must be opened or opening
    if (
      THREAD_STATES[thread.status] !== THREAD_STATES.OPENED &&
      THREAD_STATES[thread.status] !== THREAD_STATES.JOINED
    ) {
      throw new ThreadCloseError(methodName, "Thread is in invalid state");
    }
    const latestThreadState = await this.getLatestThreadState(threadId);
    const weiBalanceA = Web3.utils.toBN(latestThreadState.weiBalanceA);
    const weiBalanceB = Web3.utils.toBN(latestThreadState.weiBalanceB);
    const tokenBalanceA = Web3.utils.toBN(latestThreadState.tokenBalanceA);
    const tokenBalanceB = Web3.utils.toBN(latestThreadState.tokenBalanceB);
    // verify latestThreadState was signed by agentA
    const signer = Connext.recoverSignerFromThreadStateUpdate({
      sig: latestThreadState.sigA,
      channelId: threadId,
      nonce: latestThreadState.nonce,
      partyA: thread.partyA,
      partyB: thread.partyB,
      weiBalanceA,
      weiBalanceB,
      tokenBalanceA,
      tokenBalanceB,
      weiBond: weiBalanceA.add(weiBalanceB),
      tokenBond: tokenBalanceA.add(tokenBalanceB)
    });
    if (signer.toLowerCase() !== thread.partyA.toLowerCase()) {
      throw new ThreadCloseError(
        methodName,
        "Incorrect signer detected on latest thread update"
      );
    }

    latestThreadState.channelId = threadId;
    latestThreadState.partyA = thread.partyA;
    latestThreadState.partyB = thread.partyB;
    // get partyA channel
    const subchan = await this.getChannelByPartyA(sender);
    // generate decomposed channel update
    const sigAtoI = await this.createChannelUpdateOnThreadClose({
      latestThreadState,
      subchan,
      signer: sender.toLowerCase()
    });

    // request ingrid closes thread with this update
    const fastCloseSig = await this.fastCloseThreadHandler({
      sig: sigAtoI,
      signer: sender.toLowerCase(),
      threadId
    });

    if (!fastCloseSig) {
      throw new ThreadCloseError(
        methodName,
        651,
        "Hub did not cosign proposed channel update, call initThread and settleThread"
      );
    }
    // ingrid cosigned update
    return fastCloseSig;
  }

  /**
   * Closes many threads by calling closeThread on each threadID in the provided array.
   *
   * @example
   * const threads = [
   *     0xasd310..,
   *     0xadsf11..,
   * ]
   * await connext.closeThreads(channels)
   * @param {String[]} threadIds - array of virtual channel IDs you wish to close
   * @param {String} sender - (optional) sender of closeThreads call, must be partyA or partyB in thread. Defaults to accounts[0]
   */
  async closeThreads(threadIds, sender = null) {
    const methodName = "closeThreads";
    const isArray = { presence: true, isArray: true };
    const isAddress = { presence: true, isAddress: true };
    Connext.validatorsResponseToError(
      validate.single(threadIds, isArray),
      methodName,
      "threadIds"
    );
    if (!sender) {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0];
    }
    Connext.validatorsResponseToError(
      validate.single(sender, isAddress),
      methodName,
      "sender"
    );
    // should this try to fast close any of the channels?
    // or just immediately force close in dispute many channels
    let fnMap = new Map();
    threadIds.map(threadId => fnMap.set([threadId, sender], this.closeThread));
    let results = [];
    for (const [parameters, fn] of fnMap.entries()) {
      try {
        console.log(`Closing channel: ${parameters[0]}...`);
        const result = await fn.apply(this, parameters);
        results.push(result);
        console.log(`Channel closed.`);
      } catch (e) {
        console.log(`Error closing channel.`);
        results.push(new ThreadCloseError(methodName, e.message));
      }
    }
    return results;
  }

  /**
   * Closes an existing channel.
   *
   * All threads must be closed before a channel can be closed.
   *
   * Generates the state update from the latest hub signed state with fast-close flag.
   *
   * The hub countersigns the closing update if it matches what has been signed previously, and the channel will fast close by calling consensusCloseChannel on the contract.
   *
   * If the state update doesn't match what the hub previously signed, an error is thrown and the wallet should enter the dispute fase by calling updateChannelState with the fastCloseFlad, then withdraw.
   *
   * @example
   * const success = await connext.closeChannel()
   *
   * @param {String} sender - (optional) who the transactions should be sent from, defaults to accounts[0]
   * @returns {Promise} resolves to the on chain transaction hash of the consensusClose function
   */
  async closeChannel(sender = null) {
    const methodName = "closeChannel";
    const isAddress = { presence: true, isAddress: true };
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }
    const channel = await this.getChannelByPartyA(sender.toLowerCase());
    // channel must be open
    if (CHANNEL_STATES[channel.status] !== CHANNEL_STATES.JOINED) {
      throw new ChannelCloseError(methodName, "Channel is in invalid state");
    }
    // sender must be channel member
    if (
      sender.toLowerCase() !== channel.partyA &&
      sender.toLowerCase() !== channel.partyI
    ) {
      throw new ChannelCloseError(methodName, "Not your channel");
    }

    // get latest i-signed lc state update
    let channelState = await this.getLatestChannelState(channel.channelId);
    if (channelState) {
      // numOpenThread?
      if (Number(channelState.numOpenThread) !== 0) {
        throw new ChannelCloseError(
          methodName,
          "Cannot close channel with open VCs"
        );
      }
      // empty root hash?
      if (
        channelState.threadRootHash !==
        Connext.generateThreadRootHash({ threadInitialStates: [] })
      ) {
        throw new ChannelCloseError(
          methodName,
          "Cannot close channel with open VCs"
        );
      }

      // i-signed?
      const signer = Connext.recoverSignerFromChannelStateUpdate({
        sig: channelState.sigI,
        isClose: false,
        channelId: channel.channelId,
        nonce: channelState.nonce,
        numOpenThread: channelState.numOpenThread,
        threadRootHash: channelState.threadRootHash,
        partyA: channel.partyA,
        partyI: channel.partyI,
        weiBalanceA: Web3.utils.toBN(channelState.weiBalanceA),
        weiBalanceI: Web3.utils.toBN(channelState.weiBalanceI),
        tokenBalanceA: Web3.utils.toBN(channelState.tokenBalanceA),
        tokenBalanceI: Web3.utils.toBN(channelState.tokenBalanceI)
      });
      if (signer.toLowerCase() !== channel.partyI.toLowerCase()) {
        throw new ChannelCloseError(methodName, "Hub did not sign update");
      }
    } else {
      // no state updates made in LC
      // PROBLEM: ingrid doesnt return lcState, just uses empty
      channelState = {
        isClose: false,
        channelId: channel.channelId,
        nonce: 0,
        numOpenThread: 0,
        threadRootHash: Connext.generateThreadRootHash({
          threadInitialStates: []
        }),
        partyA: channel.partyA,
        partyI: channel.partyI,
        weiBalanceA: Web3.utils.toBN(channel.weiBalanceA),
        weiBalanceI: Web3.utils.toBN(channel.weiBalanceI),
        tokenBalanceA: Web3.utils.toBN(channel.tokenBalanceA),
        tokenBalanceI: Web3.utils.toBN(channel.tokenBalanceI)
      };
    }

    // generate same update with fast close flag and post
    let sigParams = {
      isClose: true,
      channelId: channel.channelId,
      nonce: channelState.nonce + 1,
      numOpenThread: channelState.numOpenThread,
      threadRootHash: channelState.threadRootHash,
      partyA: channel.partyA,
      partyI: channel.partyI,
      balanceA: {
        tokenDeposit: Web3.utils.toBN(channelState.tokenBalanceA),
        weiDeposit: Web3.utils.toBN(channelState.weiBalanceA)
      },
      balanceI: {
        tokenDeposit: Web3.utils.toBN(channelState.tokenBalanceI),
        weiDeposit: Web3.utils.toBN(channelState.weiBalanceI)
      },
      signer: sender
    };
    const sig = await this.createChannelStateUpdate(sigParams);
    const finalState = await this.fastCloseChannelHandler({
      sig,
      channelId: channel.channelId
    });
    if (!finalState.sigI) {
      throw new ChannelCloseError(
        methodName,
        601,
        "Hub did not countersign proposed update, channel could not be fast closed."
      );
    }

    const response = await this.consensusCloseChannelContractHandler({
      channelId: channel.channelId,
      nonce: channelState.nonce + 1,
      balanceA: {
        tokenDeposit: Web3.utils.toBN(channelState.tokenBalanceA),
        weiDeposit: Web3.utils.toBN(channelState.weiBalanceA)
      },
      balanceI: {
        tokenDeposit: Web3.utils.toBN(channelState.tokenBalanceI),
        weiDeposit: Web3.utils.toBN(channelState.weiBalanceI)
      },
      sigA: sig,
      sigI: finalState.sigI,
      sender: sender.toLowerCase()
    });

    return response.transactionHash;
  }

  // ***************************************
  // ************* DISPUTE FNS *************
  // ***************************************

  /**
   * Withdraws bonded funds from channel after a channel it is challenge closed and the dispute timer has elapsed.
   *
   * @example
   * try {
   *   const success = await connext.closeChannel(channelId)
   * } catch (e) {
   *   if (e.statusCode === 601) {
   *      await connext.updateChannelState()
   *      // wait out challenge period
   *      await connext.withdraw()
   *   }
   * }
   *
   * @param {String} sender - (optional) the person sending the on chain transaction, defaults to accounts[0]
   * @returns {Promise} resolves to the transaction hash from calling byzantineCloseChannels
   */
  async withdraw(sender = null) {
    const methodName = "withdraw";
    const isAddress = { presence: true, isAddress: true };
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }
    const channel = await this.getChannelByPartyA(sender);
    const results = await this.byzantineCloseChannelContractHandler({
      lcId: channel.channelId,
      sender: sender
    });
    return results;
  }

  /**
   * Verifies and cosigns the latest channel state update.
   *
   * @example
   * const { channelId } = await connext.getChannelIdByPartyA()
   * await connext.cosignLatestChannelUpdate(channelId)
   *
   * @param {String} channelId - channel id
   * @param {String} sender - (optional) the person who cosigning the update, defaults to accounts[0]
   * @returns {Promise} resolves to the cosigned channel state update
   */
  async cosignLatestChannelUpdate(channelId, sender = null) {
    const methodName = "cosignLatestChannelUpdate";
    const isHexStrict = { presence: true, isHexStrict: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }
    const channel = await this.getChannelById(channelId);
    if (channel == null) {
      throw new ChannelUpdateError(methodName, "Channel not found");
    }
    if (channel.partyA !== sender.toLowerCase()) {
      throw new ChannelUpdateError(methodName, "Incorrect signer detected");
    }
    if (CHANNEL_STATES[channel.status] !== CHANNEL_STATES.LCS_OPENED) {
      throw new ChannelUpdateError(methodName, "Channel is in invalid state");
    }
    // TO DO
    let latestState = await this.getLatestChannelState(lcId, ["sigI"]);
    const result = await this.cosignChannelUpdate({
      channelId,
      nonce: latestState.nonce,
      sender
    });
    return result;
  }

  /**
   * Verifies and cosigns the channel state update indicated by the provided nonce.
   *
   * @example
   * const { channelId } = await connext.getChannelIdByPartyA()
   * const nonce = 4
   * await connext.cosignLatestChannelUpdate({ channelId, nonce })
   *
   * @param {Object} params - the method object
   * @param {String} params.channelId - channel id
   * @param {Number} params.nonce - nonce of update you would like to cosign
   * @param {String} params.sender - (optional) the person who cosigning the update, defaults to accounts[0]
   * @returns {Promise} resolves to the cosigned ledger channel state update
   */
  async cosignChannelUpdate({ channelId, nonce, sender = null }) {
    const methodName = "cosignChannelUpdate";
    const isHexStrict = { presence: true, isHexStrict: true };
    const isPositiveInt = { presence: true, isPositiveInt: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    Connext.validatorsResponseToError(
      validate.single(nonce, isPositiveInt),
      methodName,
      "nonce"
    );
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }
    const channel = await this.getChannelById(channelId);
    if (channel == null) {
      throw new ChannelUpdateError(methodName, "Channel not found");
    }
    if (channel.partyA !== sender.toLowerCase()) {
      throw new ChannelUpdateError(methodName, "Incorrect signer detected");
    }
    if (CHANNEL_STATES[channel.status] !== CHANNEL_STATES.LCS_OPENED) {
      throw new ChannelUpdateError(methodName, "Channel is in invalid state");
    }
    if (nonce > channel.nonce) {
      throw new ChannelUpdateError(methodName, "Invalid nonce detected");
    }

    // TO DO: factor out into above section
    let state = await this.getChannelStateByNonce({ channelId, nonce });

    // verify sigI
    const signer = Connext.recoverSignerFromChannelStateUpdate({
      sig: state.sigI,
      isClose: state.isClose,
      channelId,
      nonce,
      numOpenThread: state.numOpenThread,
      threadRootHash: state.threadRootHash,
      partyA: sender,
      partyI: this.hubAddress,
      weiBalanceA: Web3.utils.toBN(state.weiBalanceA),
      weiBalanceI: Web3.utils.toBN(state.weiBalanceI),
      tokenBalanceA: Web3.utils.toBN(state.tokenBalanceA),
      tokenBalanceI: Web3.utils.toBN(state.tokenBalanceI)
    });
    if (signer.toLowerCase() !== this.hubAddress.toLowerCase()) {
      throw new ChannelUpdateError(methodName, "Invalid signature detected");
    }

    state.signer = state.partyA;
    state.channelId = channelId;
    const sigA = await this.createChannelStateUpdate(state);
    const response = await this.networking.post(
      `channel/${channelId}/update/${nonce}/cosign`,
      {
        sig: sigA
      }
    );
    return response.data;
  }

  // ***************************************
  // *********** STATIC METHODS ************
  // ***************************************

  /**
   * Returns a new channel id that is a random hex string.
   *
   * @returns {String} a random 32 byte channel ID.
   */
  static getNewChannelId() {
    const buf = crypto.randomBytes(32);
    const channelId = Web3.utils.bytesToHex(buf);
    return channelId;
  }

  /**
   * Hashes the channel state using web3's soliditySha3.
   *
   * @param {Object} params - the method object (representing channel state)
   * @param {String} params.channelId - channelId
   * @param {Boolean} params.isClose - flag indicating whether or not this is closing state
   * @param {Number} params.nonce - the sequence of the channel update
   * @param {Number} params.numOpenThread - the number of open threads  associated with this channel
   * @param {String} params.threadRootHash - the root hash of the Merkle tree containing all initial states of the open threads
   * @param {String} params.partyA - ETH address of partyA in the channel
   * @param {String} params.partyI - ETH address of the hub
   * @param {BN} params.weiBalanceA - wei balance of partyA
   * @param {BN} params.weiBalanceI - wei balance of hub
   * @param {BN} params.tokenBalanceA - wei balance of partyA
   * @param {BN} params.tokenBalanceI - wei balance of hub
   *
   * @returns {String} the hash of the state data
   */
  static createChannelStateUpdateFingerprint({
    channelId,
    isClose,
    nonce,
    numOpenThread,
    threadRootHash,
    partyA,
    partyI,
    weiBalanceA,
    weiBalanceI,
    tokenBalanceA,
    tokenBalanceI
  }) {
    // validate params
    const methodName = "createChannelStateUpdateFingerprint";
    // validate
    // validatorOpts
    const isHex = { presence: true, isHex: true };
    const isHexStrict = { presence: true, isHexStrict: true };
    const isBN = { presence: true, isBN: true };
    const isAddress = { presence: true, isAddress: true };
    const isPositiveInt = { presence: true, isPositiveInt: true };
    const isBool = { presence: true, isBool: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    Connext.validatorsResponseToError(
      validate.single(isClose, isBool),
      methodName,
      "isClose"
    );
    Connext.validatorsResponseToError(
      validate.single(nonce, isPositiveInt),
      methodName,
      "nonce"
    );
    Connext.validatorsResponseToError(
      validate.single(numOpenThread, isPositiveInt),
      methodName,
      "numOpenThread"
    );
    Connext.validatorsResponseToError(
      validate.single(threadRootHash, isHex),
      methodName,
      "threadRootHash"
    );
    Connext.validatorsResponseToError(
      validate.single(partyA, isAddress),
      methodName,
      "partyA"
    );
    Connext.validatorsResponseToError(
      validate.single(partyI, isAddress),
      methodName,
      "partyI"
    );
    Connext.validatorsResponseToError(
      validate.single(weiBalanceA, isBN),
      methodName,
      "weiBalanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(weiBalanceI, isBN),
      methodName,
      "weiBalanceI"
    );
    Connext.validatorsResponseToError(
      validate.single(tokenBalanceA, isBN),
      methodName,
      "tokenBalanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(tokenBalanceI, isBN),
      methodName,
      "tokenBalanceI"
    );
    // generate state update to sign
    const hash = Web3.utils.soliditySha3(
      { type: "bytes32", value: channelId },
      { type: "bool", value: isClose },
      { type: "uint256", value: nonce },
      { type: "uint256", value: numOpenThread },
      { type: "bytes32", value: threadRootHash },
      { type: "address", value: partyA }, // address will be returned bytepadded
      { type: "address", value: partyI }, // address is returned bytepadded
      { type: "uint256", value: weiBalanceA },
      { type: "uint256", value: weiBalanceI },
      { type: "uint256", value: tokenBalanceA },
      { type: "uint256", value: tokenBalanceI }
    );
    return hash;
  }

  /**
   * Recovers the signer from the hashed data generated by the Connext.createChannelStateUpdateFingerprint function.
   *
   * @param {Object} params - the method object (representing channel state)
   * @param {String} params.sig - signature you are recovering signer from
   * @param {String} params.channelId - channelId
   * @param {Boolean} params.isClose - flag indicating whether or not this is closing state
   * @param {Number} params.nonce - the sequence of the channel update
   * @param {Number} params.numOpenThread - the number of open threads  associated with this channel
   * @param {String} params.threadRootHash - the root hash of the Merkle tree containing all initial states of the open threads
   * @param {String} params.partyA - ETH address of partyA in the channel
   * @param {String} params.partyI - ETH address of the hub
   * @param {BN} params.weiBalanceA - wei balance of partyA
   * @param {BN} params.weiBalanceI - wei balance of hub
   * @param {BN} params.tokenBalanceA - wei balance of partyA
   * @param {BN} params.tokenBalanceI - wei balance of hub
   *
   * @returns {String} the ETH address of the signer of this update.
   */
  static recoverSignerFromChannelStateUpdate({
    sig,
    channelId,
    isClose,
    nonce,
    numOpenThread,
    threadRootHash,
    partyA,
    partyI,
    weiBalanceA,
    weiBalanceI,
    tokenBalanceA,
    tokenBalanceI
  }) {
    const methodName = "recoverSignerFromChannelStateUpdate";
    // validate
    // validatorOpts
    const isHexStrict = { presence: true, isHexStrict: true };
    const isHex = { presence: true, isHex: true };
    const isBN = { presence: true, isBN: true };
    const isAddress = { presence: true, isAddress: true };
    const isPositiveInt = { presence: true, isPositiveInt: true };
    const isBool = { presence: true, isBool: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );

    Connext.validatorsResponseToError(
      validate.single(sig, isHex),
      methodName,
      "sig"
    );

    Connext.validatorsResponseToError(
      validate.single(isClose, isBool),
      methodName,
      "isClose"
    );

    Connext.validatorsResponseToError(
      validate.single(nonce, isPositiveInt),
      methodName,
      "nonce"
    );
    Connext.validatorsResponseToError(
      validate.single(numOpenThread, isPositiveInt),
      methodName,
      "numOpenThread"
    );
    Connext.validatorsResponseToError(
      validate.single(threadRootHash, isHex),
      methodName,
      "threadRootHash"
    );
    Connext.validatorsResponseToError(
      validate.single(partyA, isAddress),
      methodName,
      "partyA"
    );
    Connext.validatorsResponseToError(
      validate.single(partyI, isAddress),
      methodName,
      "partyI"
    );
    Connext.validatorsResponseToError(
      validate.single(weiBalanceA, isBN),
      methodName,
      "weiBalanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(weiBalanceI, isBN),
      methodName,
      "weiBalanceI"
    );
    Connext.validatorsResponseToError(
      validate.single(tokenBalanceA, isBN),
      methodName,
      "tokenBalanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(tokenBalanceI, isBN),
      methodName,
      "tokenBalanceI"
    );

    console.log(
      "recovering signer from:",
      JSON.stringify({
        sig,
        channelId,
        isClose,
        nonce,
        numOpenThread,
        threadRootHash,
        partyA,
        partyI,
        weiBalanceA: weiBalanceA.toString(),
        weiBalanceI: weiBalanceI.toString(),
        tokenBalanceA: tokenBalanceA.toString(),
        tokenBalanceI: tokenBalanceI.toString()
      })
    );
    // generate fingerprint
    let fingerprint = Connext.createChannelStateUpdateFingerprint({
      channelId,
      isClose,
      nonce,
      numOpenThread,
      threadRootHash,
      partyA,
      partyI,
      weiBalanceA,
      weiBalanceI,
      tokenBalanceA,
      tokenBalanceI
    });
    fingerprint = util.toBuffer(fingerprint);

    const prefix = Buffer.from("\x19Ethereum Signed Message:\n");
    const prefixedMsg = util.sha3(
      Buffer.concat([
        prefix,
        Buffer.from(String(fingerprint.length)),
        fingerprint
      ])
    );
    const res = util.fromRpcSig(sig);
    const pubKey = util.ecrecover(prefixedMsg, res.v, res.r, res.s);
    const addrBuf = util.pubToAddress(pubKey);
    const addr = util.bufferToHex(addrBuf);

    console.log("recovered:", addr);
    return addr;
  }

  /**
   * Hashes data from a thread state update using web3's soliditySha3.
   *
   * @param {Object} params - the method object
   * @param {String} params.channelId - ID of the thread you are creating a state update for
   * @param {Number} params.nonce - the sequence of the state update
   * @param {String} params.partyA - ETH address of partyA
   * @param {String} params.partyB - ETH address of partyB
   * @param {BN} params.weiBalanceA - wei balance of partyA
   * @param {BN} params.weiBalanceB - wei balance of partyB
   * @param {BN} params.tokenBalanceA - wei balance of partyA
   * @param {BN} params.tokenBalanceB - wei balance of partyB
   * @param {BN} params.tokenBond - total token amount in thread
   * @param {BN} params.weiBond - total wei amount in thread
   *
   * @returns {String} hash of the thread state
   */
  static createThreadStateUpdateFingerprint({
    channelId,
    nonce,
    partyA,
    partyB,
    weiBalanceA,
    weiBalanceB,
    tokenBalanceA,
    tokenBalanceB,
    weiBond,
    tokenBond
  }) {
    const methodName = "createThreadStateUpdateFingerprint";
    // typecast balances incase chained
    const isPositiveBnString = { presence: true, isPositiveBnString: true };
    Connext.validatorsResponseToError(
      validate.single(weiBalanceA, isPositiveBnString),
      methodName,
      "weiBalanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(weiBalanceB, isPositiveBnString),
      methodName,
      "weiBalanceB"
    );
    Connext.validatorsResponseToError(
      validate.single(tokenBalanceA, isPositiveBnString),
      methodName,
      "tokenBalanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(tokenBalanceB, isPositiveBnString),
      methodName,
      "tokenBalanceB"
    );
    Connext.validatorsResponseToError(
      validate.single(weiBond, isPositiveBnString),
      methodName,
      "weiBond"
    );
    Connext.validatorsResponseToError(
      validate.single(tokenBond, isPositiveBnString),
      methodName,
      "tokenBond"
    );
    weiBalanceA = Web3.utils.toBN(weiBalanceA);
    weiBalanceB = Web3.utils.toBN(weiBalanceB);
    tokenBalanceA = Web3.utils.toBN(tokenBalanceA);
    tokenBalanceB = Web3.utils.toBN(tokenBalanceB);
    weiBond = Web3.utils.toBN(weiBond);
    tokenBond = Web3.utils.toBN(tokenBond);
    // validate
    const isHexStrict = { presence: true, isHexStrict: true };
    const isAddress = { presence: true, isAddress: true };
    const isPositiveInt = { presence: true, isPositiveInt: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    Connext.validatorsResponseToError(
      validate.single(nonce, isPositiveInt),
      methodName,
      "nonce"
    );
    Connext.validatorsResponseToError(
      validate.single(partyA, isAddress),
      methodName,
      "partyA"
    );

    Connext.validatorsResponseToError(
      validate.single(partyB, isAddress),
      methodName,
      "partyB"
    );

    const hubBondWei = weiBalanceA.add(weiBalanceB);
    const hubBondToken = tokenBalanceA.add(tokenBalanceB);

    if (!hubBondWei.eq(weiBond)) {
      throw new ThreadUpdateError(
        methodName,
        `Invalid weiBond supplied: ${weiBond.toString()}. Expected: ${hubBondWei.toString()}`
      );
    }

    if (!hubBondToken.eq(tokenBond)) {
      throw new ThreadUpdateError(
        methodName,
        `Invalid weiBond supplied: ${tokenBond.toString()}. Expected: ${hubBondToken.toString()}`
      );
    }

    // generate state update to sign
    const hash = Web3.utils.soliditySha3(
      { type: "bytes32", value: channelId },
      { type: "uint256", value: nonce },
      { type: "address", value: partyA },
      { type: "address", value: partyB },
      { type: "uint256", value: tokenBond },
      { type: "uint256", value: weiBond },
      { type: "uint256", value: weiBalanceA },
      { type: "uint256", value: weiBalanceB },
      { type: "uint256", value: tokenBalanceA },
      { type: "uint256", value: tokenBalanceB }
    );
    return hash;
  }

  /**
   * Recovers the signer from the hashed data generated by the Connext.createThreadStateUpdateFingerprint function.
   *
   * @param {Object} params - the method object
   * @param {String} params.sig - signature you are recovering signer from
   * @param {String} params.channelId - ID of the thread you are creating a state update for
   * @param {Number} params.nonce - the sequence of the state update
   * @param {String} params.partyA - ETH address of partyA
   * @param {String} params.partyB - ETH address of partyB
   * @param {BN} params.weiBalanceA - wei balance of partyA
   * @param {BN} params.weiBalanceB - wei balance of partyB
   * @param {BN} params.tokenBalanceA - wei balance of partyA
   * @param {BN} params.tokenBalanceB - wei balance of partyB
   * @param {BN} params.tokenBond - total token amount in thread
   * @param {BN} params.weiBond - total wei amount in thread
   *
   * @returns {String} ETH address of the signer
   */
  static recoverSignerFromThreadStateUpdate({
    sig,
    channelId,
    nonce,
    partyA,
    partyB,
    weiBalanceA,
    weiBalanceB,
    tokenBalanceA,
    tokenBalanceB,
    weiBond,
    tokenBond
  }) {
    const methodName = "recoverSignerFromThreadStateUpdate";
    // validate
    // typecast balances incase chained
    const isPositiveBnString = { presence: true, isPositiveBnString: true };
    Connext.validatorsResponseToError(
      validate.single(weiBalanceA, isPositiveBnString),
      methodName,
      "weiBalanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(weiBalanceB, isPositiveBnString),
      methodName,
      "weiBalanceB"
    );
    Connext.validatorsResponseToError(
      validate.single(tokenBalanceA, isPositiveBnString),
      methodName,
      "tokenBalanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(tokenBalanceB, isPositiveBnString),
      methodName,
      "tokenBalanceB"
    );
    Connext.validatorsResponseToError(
      validate.single(weiBond, isPositiveBnString),
      methodName,
      "weiBond"
    );
    Connext.validatorsResponseToError(
      validate.single(tokenBond, isPositiveBnString),
      methodName,
      "tokenBond"
    );
    weiBalanceA = Web3.utils.toBN(weiBalanceA);
    weiBalanceB = Web3.utils.toBN(weiBalanceB);
    tokenBalanceA = Web3.utils.toBN(tokenBalanceA);
    tokenBalanceB = Web3.utils.toBN(tokenBalanceB);
    weiBond = Web3.utils.toBN(weiBond);
    tokenBond = Web3.utils.toBN(tokenBond);
    // validatorOpts'
    const isHex = { presence: true, isHex: true };
    const isHexStrict = { presence: true, isHexStrict: true };
    const isBN = { presence: true, isBN: true };
    const isAddress = { presence: true, isAddress: true };
    const isPositiveInt = { presence: true, isPositiveInt: true };

    Connext.validatorsResponseToError(
      validate.single(sig, isHex),
      methodName,
      "sig"
    );

    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    Connext.validatorsResponseToError(
      validate.single(nonce, isPositiveInt),
      methodName,
      "nonce"
    );

    Connext.validatorsResponseToError(
      validate.single(partyA, isAddress),
      methodName,
      "partyA"
    );

    Connext.validatorsResponseToError(
      validate.single(partyB, isAddress),
      methodName,
      "partyB"
    );

    const expectedWeiBond = weiBalanceA.add(weiBalanceB);
    const expectedTokenBond = tokenBalanceA.add(tokenBalanceB);

    if (!expectedWeiBond.eq(weiBond)) {
      throw new ThreadUpdateError(
        `Invalid weiBond supplied: ${weiBond.toString()}. Expected: ${expectedWeiBond.toString()}`
      );
    }

    if (!expectedTokenBond.eq(tokenBond)) {
      throw new ThreadUpdateError(
        `Invalid weiBond supplied: ${tokenBond.toString()}. Expected: ${expectedTokenBond.toString()}`
      );
    }

    console.log(
      "recovering signer from:",
      JSON.stringify({
        sig,
        channelId,
        nonce,
        partyA,
        partyB,
        weiBalanceA: weiBalanceA.toString(),
        weiBalanceB: weiBalanceB.toString(),
        tokenBalanceA: tokenBalanceA.toString(),
        tokenBalanceB: tokenBalanceB.toString(),
        weiBond: weiBond.toString(),
        tokenBond: tokenBond.toString()
      })
    );
    let fingerprint = Connext.createThreadStateUpdateFingerprint({
      channelId,
      nonce,
      partyA,
      partyB,
      weiBalanceA,
      weiBalanceB,
      tokenBalanceA,
      tokenBalanceB,
      weiBond,
      tokenBond
    });
    fingerprint = util.toBuffer(fingerprint);
    const prefix = Buffer.from("\x19Ethereum Signed Message:\n");
    const prefixedMsg = util.sha3(
      Buffer.concat([
        prefix,
        Buffer.from(String(fingerprint.length)),
        fingerprint
      ])
    );
    const res = util.fromRpcSig(sig);
    const pubKey = util.ecrecover(prefixedMsg, res.v, res.r, res.s);
    const addrBuf = util.pubToAddress(pubKey);
    const addr = util.bufferToHex(addrBuf);
    console.log("recovered:", addr);

    return addr;
  }

  // ***************************************
  // ********** SIGNATURE METHODS **********
  // ***************************************

  /**
   * Generates a signed channel state update.
   *
   * @param {Object} params - the method object
   * @param {Boolean} params.isClose - (optional) flag indicating whether or not this is closing state, defaults to false
   * @param {String} params.channelId - ID of the channel you are updating
   * @param {Number} params.nonce - the sequence of update
   * @param {Number} params.numOpenThread - the number of open threads associated with this channel
   * @param {String} params.threadRootHash - the root hash of the Merkle tree containing all initial states of the open threads
   * @param {String} params.partyA - ETH address of partyA in the channel
   * @param {String} params.partyI - (optional) ETH address of the hub, defaults to this.hubAddress
   * @param {Object} params.balanceA - updated balance of partyA
   * @param {BN} params.balanceA.weiDeposit - (optional) final wei balance of partyA in channel
   * @param {BN} params.balanceA.tokenDeposit - (optional) final token balance of partyA in channel
   * @param {Object} params.balanceI - final balance of hub in channel
   * @param {BN} params.balanceI.weiDeposit - (optional) final wei balance of hub in channel
   * @param {BN} params.balanceI.tokenDeposit - (optional) final token balance of hub in channel
   * @param {Boolean} params.unlockedAccountPresent - (optional) whether to use sign or personal sign, defaults to false if in prod and true if in dev
   * @param {String} params.signer - (optional) ETH address of person signing data, defaults to account[0]
   * @param {Object} params.hubBond - (optional) should be supplied if creating or closing a thread
   * @param {Object} params.deposit - (optional) should be supplied if creating a deposit into a channel
   * @returns {String} signature of signer on data provided
   */
  async createChannelStateUpdate({
    isClose = false, // default isnt close LC
    channelId,
    nonce,
    numOpenThread,
    threadRootHash,
    partyA,
    partyI = this.hubAddress, // default to ingrid
    balanceA,
    balanceI,
    unlockedAccountPresent = process.env.DEV ? process.env.DEV : false, // true if hub or ingrid, dev needs unsigned
    signer = null,
    hubBond = null,
    deposit = null
  }) {
    const methodName = "createChannelStateUpdate";
    // validate
    // validatorOpts
    const isHexStrict = { presence: true, isHexStrict: true };
    const isHex = { presence: true, isHex: true };
    const isBN = { presence: true, isBN: true };
    const isAddress = { presence: true, isAddress: true };
    const isPositiveInt = { presence: true, isPositiveInt: true };
    const isBool = { presence: true, isBool: true };
    const isValidDepositObject = { presence: true, isValidDepositObject: true };

    Connext.validatorsResponseToError(
      validate.single(isClose, isBool),
      methodName,
      "isClose"
    );
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    Connext.validatorsResponseToError(
      validate.single(nonce, isPositiveInt),
      methodName,
      "nonce"
    );
    Connext.validatorsResponseToError(
      validate.single(numOpenThread, isPositiveInt),
      methodName,
      "numOpenThread"
    );
    Connext.validatorsResponseToError(
      validate.single(threadRootHash, isHex),
      methodName,
      "threadRootHash"
    );
    Connext.validatorsResponseToError(
      validate.single(partyA, isAddress),
      methodName,
      "partyA"
    );
    Connext.validatorsResponseToError(
      validate.single(partyI, isAddress),
      methodName,
      "partyI"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceA, isValidDepositObject),
      methodName,
      "balanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceI, isValidDepositObject),
      methodName,
      "balanceI"
    );
    if (hubBond) {
      Connext.validatorsResponseToError(
        validate.single(hubBond, isValidDepositObject),
        methodName,
        "hubBond"
      );
      hubBond.tokenDeposit = hubBond.tokenDeposit
        ? hubBond.tokenDeposit
        : Web3.utils.toBN("0");
      hubBond.weiDeposit = hubBond.weiDeposit
        ? hubBond.weiDeposit
        : Web3.utils.toBN("0");
    } else {
      // set to zero
      hubBond = {
        weiDeposit: Web3.utils.toBN("0"),
        tokenDeposit: Web3.utils.toBN("0")
      };
    }

    if (deposit) {
      Connext.validatorsResponseToError(
        validate.single(deposit, isValidDepositObject),
        methodName,
        "deposit"
      );
      deposit.weiDeposit = deposit.weiDeposit
        ? deposit.weiDeposit
        : Web3.utils.toBN("0");
      deposit.tokenDeposit = deposit.tokenDeposit
        ? deposit.tokenDeposit
        : Web3.utils.toBN("0");
    } else {
      deposit = {
        weiDeposit: Web3.utils.toBN("0"),
        tokenDeposit: Web3.utils.toBN("0")
      };
    }
    if (signer) {
      Connext.validatorsResponseToError(
        validate.single(signer, isAddress),
        methodName,
        "signer"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      signer = accounts[0].toLowerCase();
    }
    // signer must be in lc
    if (
      signer.toLowerCase() !== partyA.toLowerCase() &&
      signer.toLowerCase() !== partyI.toLowerCase()
    ) {
      throw new ChannelUpdateError(methodName, "Invalid signer detected");
    }

    // validate update
    const emptyRootHash = Connext.generateThreadRootHash({
      threadInitialStates: []
    });
    const channel = await this.getChannelById(channelId);
    let proposedWeiBalance, proposedTokenBalance;
    if (channel == null) {
      // set initial balances to 0 if thread does not exist
      channel.weiBalanceA = "0";
      channel.weiBalanceB = "0";
      channel.tokenBalanceA = "0";
      channel.tokenBalanceB = "0";
      // generating opening cert
      if (nonce !== 0) {
        throw new ChannelOpenError(methodName, "Invalid nonce detected");
      }
      if (numOpenThread !== 0) {
        throw new ChannelOpenError(
          methodName,
          "Invalid numOpenThread detected"
        );
      }
      if (threadRootHash !== emptyRootHash) {
        throw new ChannelOpenError(
          methodName,
          "Invalid threadRootHash detected"
        );
      }
      if (partyA === partyI) {
        throw new ChannelOpenError(
          methodName,
          "Cannot open channel with yourself"
        );
      }
      if (balanceA.weiDeposit && balanceI.weiDeposit) {
        // channel includes ETH
        proposedWeiBalance = balanceA.weiDeposit.add(balanceI.weiDeposit);
      }
      if (balanceA.tokenDeposit && balanceI.tokenDeposit) {
        // channel includes token
        proposedTokenBalance = balanceA.tokenDeposit.add(balanceI.tokenDeposit);
      }
    } else {
      // updating existing lc
      // must be open
      if (CHANNEL_STATES[channel.status] === 3) {
        throw new ChannelUpdateError(
          methodName,
          "Channel is in invalid state to accept updates"
        );
      }
      // nonce always increasing
      if (nonce < channel.nonce) {
        throw new ChannelUpdateError(methodName, "Invalid nonce");
      }
      // only open/close 1 vc per update, or dont open any
      if (
        Math.abs(Number(numOpenThread) - Number(channel.numOpenThread)) !== 1 &&
        Math.abs(Number(numOpenThread) - Number(channel.numOpenThread)) !== 0
      ) {
        throw new ChannelUpdateError(
          methodName,
          "Invalid number of numOpenThread proposed"
        );
      }
      // parties cant change
      if (
        partyA.toLowerCase() !== channel.partyA.toLowerCase() ||
        partyI.toLowerCase() !== channel.partyI.toLowerCase()
      ) {
        throw new ChannelUpdateError(methodName, "Invalid channel parties");
      }
      if (balanceA.weiDeposit && balanceI.weiDeposit) {
        // channel includes ETH
        proposedWeiBalance = balanceA.weiDeposit.add(balanceI.weiDeposit);
      }
      if (balanceA.tokenDeposit && balanceI.tokenDeposit) {
        // channel includes token
        proposedTokenBalance = balanceA.tokenDeposit.add(balanceI.tokenDeposit);
      }
      // no change in total balance
      // add ledger channel balances of both parties from previously, subctract new balance of vc being opened
      let isOpeningVc = numOpenThread - channel.numOpenThread === 1;
      // verify updates dont change channel balance
      let ethChannelBalance = isOpeningVc
        ? Web3.utils
            .toBN(channel.weiBalanceA)
            .add(Web3.utils.toBN(channel.weiBalanceI))
            .add(deposit.weiDeposit)
            .sub(hubBond.weiDeposit)
        : Web3.utils
            .toBN(channel.weiBalanceA)
            .add(Web3.utils.toBN(channel.weiBalanceI))
            .add(deposit.weiDeposit)
            .add(hubBond.weiDeposit);

      let tokenChannelBalance = isOpeningVc
        ? Web3.utils
            .toBN(channel.tokenBalanceA)
            .add(Web3.utils.toBN(channel.tokenBalanceI))
            .add(deposit.tokenDeposit)
            .sub(hubBond.tokenDeposit)
        : Web3.utils
            .toBN(channel.tokenBalanceA)
            .add(Web3.utils.toBN(channel.tokenBalanceI))
            .add(deposit.tokenDeposit)
            .add(hubBond.tokenDeposit);

      if (proposedWeiBalance && !proposedWeiBalance.eq(ethChannelBalance)) {
        throw new ChannelUpdateError(
          methodName,
          "Invalid ETH balance proposed"
        );
      }
      if (
        proposedTokenBalance &&
        !proposedTokenBalance.eq(tokenChannelBalance)
      ) {
        throw new ChannelUpdateError(
          methodName,
          "Invalid token balance proposed"
        );
      }
    }

    console.log(
      "signing:",
      JSON.stringify({
        isClose,
        channelId,
        nonce,
        numOpenThread,
        threadRootHash,
        partyA,
        partyI,
        weiBalanceA: proposedWeiBalance ? balanceA.weiDeposit.toString() : "0",
        weiBalanceI: proposedWeiBalance ? balanceI.weiDeposit.toString() : "0",
        tokenBalanceA: proposedTokenBalance
          ? balanceA.tokenDeposit.toString()
          : "0",
        tokenBalanceI: proposedTokenBalance
          ? balanceI.tokenDeposit.toString()
          : "0"
      })
    );
    // generate sig
    const hash = Connext.createChannelStateUpdateFingerprint({
      channelId,
      isClose,
      nonce,
      numOpenThread,
      threadRootHash,
      partyA,
      partyI,
      weiBalanceA: proposedWeiBalance
        ? balanceA.weiDeposit
        : Web3.utils.toBN("0"),
      weiBalanceI: proposedWeiBalance
        ? balanceI.weiDeposit
        : Web3.utils.toBN("0"),
      tokenBalanceA: proposedTokenBalance
        ? balanceA.tokenDeposit
        : Web3.utils.toBN("0"),
      tokenBalanceI: proposedTokenBalance
        ? balanceI.tokenDeposit
        : Web3.utils.toBN("0")
    });
    let sig;
    if (unlockedAccountPresent) {
      sig = await this.web3.eth.sign(hash, signer);
    } else {
      sig = await this.web3.eth.personal.sign(hash, signer);
    }
    console.log("sig:", sig);
    return sig;
  }

  /**
   * Creates a signed thread state update
   *
   * @param {Object} params - the method object
   * @param {String} params.channelId - ID of the thread you are updatign
   * @param {Number} params.nonce - the sequence of the state update
   * @param {String} params.partyA - ETH address of partyA
   * @param {String} params.partyB - ETH address of partyB
   * @param {Number} params.balanceA - updated balance of partyA
   * @param {BN} params.balanceA.weiDeposit - updated party A wei balance
   * @param {BN} params.balanceA.tokenDeposit - updated partyA token balance
   * @param {Object} params.balanceB - updated partB balance object
   * @param {BN} params.balanceB.weiDeposit - updated partyB wei balance
   * @param {BN} params.balanceB.tokenDeposit - updated partyB token balance
   * @param {Boolean} params.unlockedAccountPresent - (optional) whether to use sign or personal sign, defaults to false if in prod and true if in dev
   *
   * @param {String} params.signer - (optional) ETH address of person signing data, defaults to account[0]
   * @returns {String} signature of signer on data provided
   */
  async createThreadStateUpdate({
    channelId,
    nonce,
    partyA,
    partyB,
    balanceA,
    balanceB,
    updateType,
    unlockedAccountPresent = process.env.DEV ? process.env.DEV : false,
    signer = null // if true, use sign over personal.sign. dev needs true
  }) {
    // validate
    const methodName = "createThreadStateUpdate";
    // validate
    // validatorOpts'
    const isHexStrict = { presence: true, isHexStrict: true };
    const isValidDepositObject = { presence: true, isValidDepositObject: true };
    const isAddress = { presence: true, isAddress: true };
    const isPositiveInt = { presence: true, isPositiveInt: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    Connext.validatorsResponseToError(
      validate.single(nonce, isPositiveInt),
      methodName,
      "nonce"
    );
    Connext.validatorsResponseToError(
      validate.single(partyA, isAddress),
      methodName,
      "partyA"
    );
    Connext.validatorsResponseToError(
      validate.single(partyB, isAddress),
      methodName,
      "partyB"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceA, isValidDepositObject),
      methodName,
      "balanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceB, isValidDepositObject),
      methodName,
      "balanceB"
    );
    // verify subchannel
    const subchanA = await this.getChannelByPartyA(partyA);

    // verify channel state update
    let thread = await this.getThreadById(channelId);
    let proposedWeiBalance, proposedTokenBalance;
    if (thread === null) {
      // channel does not exist, generating opening state
      if (nonce !== 0) {
        throw new ThreadOpenError(methodName, "Invalid nonce detected");
      }
      if (balanceB.weiDeposit && !balanceB.weiDeposit.isZero()) {
        throw new ThreadOpenError(
          methodName,
          "Invalid initial ETH balanceB detected"
        );
      }
      if (balanceB.tokenDeposit && !balanceB.tokenDeposit.isZero()) {
        throw new ThreadOpenError(
          methodName,
          "Invalid initial token balanceB detected"
        );
      }
      if (partyA.toLowerCase() === partyB.toLowerCase()) {
        throw new ThreadOpenError(
          methodName,
          "Cannot open thread with yourself"
        );
      }
      if (balanceA.weiDeposit) {
        // update includes eth
        if (Web3.utils.toBN(subchanA.weiBalanceA).lt(balanceA.weiDeposit)) {
          throw new ThreadOpenError(
            methodName,
            "Insufficient ETH channel balance detected"
          );
        }
        proposedWeiBalance = balanceA.weiDeposit;
      }
      if (balanceA.tokenDeposit) {
        if (Web3.utils.toBN(subchanA.tokenBalanceA).lt(balanceA.tokenDeposit)) {
          throw new ThreadOpenError(
            methodName,
            "Insufficient ETH channel balance detected"
          );
        }
        proposedTokenBalance = balanceA.tokenDeposit;
      }
    } else {
      // thread exists
      if (THREAD_STATES[thread.state] === 3) {
        throw new ThreadUpdateError(methodName, "Thread is in invalid state");
      }
      if (nonce < thread.nonce + 1 && nonce !== 0) {
        // could be joining
        throw new ThreadUpdateError(methodName, "Invalid nonce");
      }
      if (
        partyA.toLowerCase() !== thread.partyA ||
        partyB.toLowerCase() !== thread.partyB
      ) {
        throw new ThreadUpdateError(methodName, "Invalid parties detected");
      }
      // verify updates dont change channel balance
      const threadEthBalance = Web3.utils
        .toBN(thread.weiBalanceA)
        .add(Web3.utils.toBN(thread.weiBalanceB));
      const threadTokenBalance = Web3.utils
        .toBN(thread.tokenBalanceA)
        .add(Web3.utils.toBN(thread.tokenBalanceB));
      switch (CHANNEL_TYPES[updateType]) {
        case CHANNEL_TYPES.ETH:
          if (balanceB.weiDeposit.lt(Web3.utils.toBN(thread.weiBalanceB))) {
            throw new ThreadUpdateError(
              methodName,
              "Thread updates can only increase partyB ETH balance"
            );
          }
          proposedWeiBalance = Web3.utils
            .toBN(balanceA.weiDeposit)
            .add(balanceB.weiDeposit); // proposed balance
          break;

        case CHANNEL_TYPES.TOKEN:
          if (balanceB.tokenDeposit.lt(Web3.utils.toBN(thread.tokenBalanceB))) {
            throw new ThreadUpdateError(
              methodName,
              "Thread updates can only increase partyB token balance"
            );
          }
          proposedTokenBalance = Web3.utils
            .toBN(balanceA.tokenDeposit)
            .add(balanceB.tokenDeposit);
          break;

        case CHANNEL_TYPES.TOKEN_ETH:
          if (balanceB.weiDeposit.lt(Web3.utils.toBN(thread.weiBalanceB))) {
            throw new ThreadUpdateError(
              methodName,
              "Thread updates can only increase partyB ETH balance"
            );
          }
          if (balanceB.tokenDeposit.lt(Web3.utils.toBN(thread.tokenBalanceB))) {
            throw new ThreadUpdateError(
              methodName,
              "Thread updates can only increase partyB token balance"
            );
          }
          proposedWeiBalance = Web3.utils
            .toBN(balanceA.weiDeposit)
            .add(balanceB.weiDeposit);
          proposedTokenBalance = Web3.utils
            .toBN(balanceA.tokenDeposit)
            .add(balanceB.tokenDeposit);
          break;
        default:
          throw new ThreadUpdateError(
            methodName,
            "Invalid thread update type."
          );
      }
      if (proposedWeiBalance && !proposedWeiBalance.eq(threadEthBalance)) {
        throw new ThreadUpdateError(
          methodName,
          "Thread ETH balance cannot change"
        );
      }

      if (
        proposedTokenBalance &&
        !proposedTokenBalance.eq(threadTokenBalance)
      ) {
        throw new ThreadUpdateError(
          methodName,
          "Thread token balance cannot change"
        );
      }
    }

    // get accounts
    const accounts = await this.web3.eth.getAccounts();
    // generate and sign hash
    const state = {
      channelId,
      nonce,
      partyA,
      partyB,
      // if balance change proposed, use balance
      // else use thread balance if thread exists (will be null on open)
      // else use 0
      weiBalanceA: proposedWeiBalance
        ? balanceA.weiDeposit
        : thread
          ? Web3.utils.toBN(thread.weiBalanceA)
          : Web3.utils.toBN("0"),
      weiBalanceB: proposedWeiBalance
        ? balanceB.weiDeposit
        : thread
          ? Web3.utils.toBN(thread.weiBalanceB)
          : Web3.utils.toBN("0"),
      tokenBalanceA: proposedTokenBalance
        ? balanceA.tokenDeposit
        : thread
          ? Web3.utils.toBN(thread.tokenBalanceA)
          : Web3.utils.toBN("0"),
      tokenBalanceB: proposedTokenBalance
        ? balanceB.tokenDeposit
        : thread
          ? Web3.utils.toBN(thread.tokenBalanceB)
          : Web3.utils.toBN("0"),
      weiBond: proposedWeiBalance ? proposedWeiBalance : Web3.utils.toBN("0"),
      tokenBond: proposedTokenBalance
        ? proposedTokenBalance
        : Web3.utils.toBN("0")
    };

    const hash = Connext.createThreadStateUpdateFingerprint(state);
    console.log("signing:", JSON.stringify(state));
    let sig;
    if (signer && unlockedAccountPresent) {
      sig = await this.web3.eth.sign(hash, signer);
    } else if (signer) {
      sig = await this.web3.eth.personal.sign(hash, signer);
    } else if (unlockedAccountPresent) {
      sig = await this.web3.eth.sign(hash, accounts[0]);
    } else {
      sig = await this.web3.eth.personal.sign(hash, accounts[0]);
    }
    console.log("sig:", sig);
    return sig;
  }

  /**
   * Creates a hash of the thread initial states provided.
   *
   * @example
   * const threadInitialStates = await connext.getThreadInitialStates(channelId)
   * const threadRootHash = Connext.generateThreadRootHash({ threadInitialStates })
   *
   * @param {Object[]} threadInitialStates - an array of initial thread states.
   */
  static generateThreadRootHash({ threadInitialStates }) {
    const methodName = "generateThreadRootHash";
    const isArray = { presence: true, isArray: true };
    Connext.validatorsResponseToError(
      validate.single(threadInitialStates, isArray),
      methodName,
      "threadInitialStates"
    );
    const emptyRootHash =
      "0x0000000000000000000000000000000000000000000000000000000000000000";
    let threadRootHash;
    if (threadInitialStates.length === 0) {
      // reset to initial value -- no open VCs
      threadRootHash = emptyRootHash;
    } else {
      const merkle = Connext.generateMerkleTree(threadInitialStates);
      threadRootHash = Utils.bufferToHex(merkle.getRoot());
    }

    return threadRootHash;
  }

  /**
   * Creates a merkle tree of the thread initial states provided.
   *
   * @example
   * const threadInitialStates = await connext.getThreadInitialStates(channelId)
   * const mt = Connext.generateMerkleTree(threadInitialStates)
   *
   * @param {Object[]} threadInitialStates - an array of initial thread state objects
   */
  static generateMerkleTree(threadInitialStates) {
    const methodName = "generateMerkleTree";
    const isArray = { presence: true, isArray: true };
    Connext.validatorsResponseToError(
      validate.single(threadInitialStates, isArray),
      methodName,
      "threadInitialStates"
    );
    if (threadInitialStates.length === 0) {
      throw new Error("Cannot create a Merkle tree with 0 leaves.");
    }
    const emptyRootHash =
      "0x0000000000000000000000000000000000000000000000000000000000000000";
    let merkle;
    let elems = threadInitialStates.map(threadInitialState => {
      // vc0 is the initial state of each vc
      // hash each initial state and convert hash to buffer
      const hash = Connext.createThreadStateUpdateFingerprint(
        threadInitialState
      );
      const vcBuf = Utils.hexToBuffer(hash);
      return vcBuf;
    });
    if (elems.length % 2 !== 0) {
      // cant have odd number of leaves
      elems.push(Utils.hexToBuffer(emptyRootHash));
    }
    merkle = new MerkleTree.default(elems);

    return merkle;
  }

  // HELPER FUNCTIONS

  // ***************************************
  // ******** CONTRACT HANDLERS ************
  // ***************************************

  /**
   * Calls createChannel on the Channel Manager contract.
   *
   * @example
   * // wallet must approve token transfer to contract
   * // before creating a TOKEN or ETH-TOKEN channel
   * const channelId = Connext.getNewChannelId()
   * const initialDeposits = {
   *    weiDeposit: Web3.utils.toBN('100'),
   *    tokenDeposit: Web3.utils.toBN('100'),
   * }
   * const challenge = 3600
   * const tokenAddress = "0xaa..."
   * await connext.crateChannelContractHandler({ initialDeposits, channelId, challenge, tokenAddress })
   *
   * @param {Object} params - the method object
   * @param {String} params.hubAddress - (optional) defaults to the address supplied on init
   * @param {String} params.channelId - channelId, should be generated using Connext static functions
   * @param {Object} params.initialDeposits - ,
   * @param {Number} params.challenge - challenge period in seconds
   * @param {String} params.tokenAddress - (optional) tokenAddress for the tokens you would like to bond in the channel. Do not supply for an ETH only channel
   * @param {String} params.sender - (optional) the account that will create the channel (channel.partyA). Defaults to accounts[0]
   *
   * @returns {Promise} resolves to the result of the contract call
   */
  async createChannelContractHandler({
    hubAddress = this.hubAddress,
    channelId,
    initialDeposits,
    challenge,
    channelType,
    tokenAddress = null,
    sender = null
  }) {
    const methodName = "createChannelContractHandler";
    // validate
    const isHexStrict = { presence: true, isHexStrict: true };
    const isAddress = { presence: true, isAddress: true };
    const isPositiveInt = { presence: true, isPositiveInt: true };
    const isValidDepositObject = { presence: true, isValidDepositObject: true };
    Connext.validatorsResponseToError(
      validate.single(hubAddress, isAddress),
      methodName,
      "hubAddress"
    );
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    Connext.validatorsResponseToError(
      validate.single(initialDeposits, isValidDepositObject),
      methodName,
      "initialDeposits"
    );
    Connext.validatorsResponseToError(
      validate.single(challenge, isPositiveInt),
      methodName,
      "challenge"
    );
    if (tokenAddress) {
      Connext.validatorsResponseToError(
        validate.single(tokenAddress, isAddress),
        methodName,
        "tokenAddress"
      );
    }
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }

    // verify partyA !== partyI
    if (sender === hubAddress) {
      throw new ChannelOpenError(
        methodName,
        "Cannot open a channel with yourself"
      );
    }

    let result, token, tokenApproval;
    switch (CHANNEL_TYPES[channelType]) {
      case CHANNEL_TYPES.ETH: // ETH
        tokenAddress = "0x0";
        result = await this.channelManagerInstance.methods
          .createChannel(channelId, hubAddress, challenge, tokenAddress, [
            initialDeposits.weiDeposit,
            Web3.utils.toBN("0")
          ])
          .send({
            from: sender,
            value: initialDeposits.weiDeposit,
            gas: 750000
          });
        break;
      case CHANNEL_TYPES.TOKEN: // TOKEN
        // approve token transfer
        token = new this.web3.eth.Contract(tokenAbi, tokenAddress);
        tokenApproval = await token.methods
          .approve(hubAddress, initialDeposits.tokenDeposit)
          .send({
            from: sender,
            gas: 750000
          });
        if (tokenApproval) {
          result = await this.channelManagerInstance.methods
            .createChannel(channelId, hubAddress, challenge, tokenAddress, [
              Web3.utils.toBN("0"),
              initialDeposits.tokenDeposit
            ])
            .send({
              from: sender,
              gas: 750000
            });
        } else {
          throw new ChannelOpenError(methodName, "Token transfer failed.");
        }
        break;
      case CHANNEL_TYPES.TOKEN_ETH: // ETH/TOKEN
        // approve token transfer
        token = new this.web3.eth.Contract(tokenAbi, tokenAddress);
        tokenApproval = await token.approve.call(
          hubAddress,
          initialDeposits.tokenDeposit,
          {
            from: sender
          }
        );
        if (tokenApproval) {
          result = await this.channelManagerInstance.methods
            .createChannel(channelId, hubAddress, challenge, tokenAddress, [
              initialDeposits.weiDeposit,
              initialDeposits.tokenDeposit
            ])
            .send({
              from: sender,
              value: initialDeposits.weiDeposit,
              gas: 750000
            });
        } else {
          throw new ChannelOpenError(methodName, "Token transfer failed.");
        }
        break;
      default:
        throw new ChannelOpenError(methodName, "Invalid channel type");
    }

    if (!result.transactionHash) {
      throw new ContractError(
        methodName,
        301,
        "Transaction failed to broadcast"
      );
    }

    if (!result.blockNumber) {
      throw new ContractError(
        methodName,
        302,
        result.transactionHash,
        "Transaction failed"
      );
    }

    return result;
  }

  /**
   * Users should use this to recover bonded funds if the hub fails to join the ledger channel within the challenge window.
   *
   * @param {String} channelId - channel id the hub did not join
   * @param {String} sender - (optional) who is calling the transaction (defaults to accounts[0]). Should be partyA in unjoined channel
   * @returns {Promise} resolves to the result of the contract call
   */
  async channelOpenTimeoutContractHandler(channelId, sender = null) {
    const methodName = "ChannelOpenTimeoutContractHandler";
    // validate
    const isAddress = { presence: true, isAddress: true };
    const isHexStrict = { presence: true, isHexStrict: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }
    // verify requires
    const channel = await this.getChannelById(channelId);
    if (CHANNEL_STATES[channel.status] !== CHANNEL_STATES.LCS_OPENING) {
      throw new ChannelOpenError(methodName, "Channel is in incorrect state");
    }

    if (channel.partyA.toLowerCase() !== sender.toLowerCase()) {
      throw new ContractError(
        methodName,
        "Caller must be partyA in ledger channel"
      );
    }

    // TO DO: THROW ERROR IF NOT CORRECT TIME
    // otherwise contract will throw error

    const result = await this.channelManagerInstance.methods
      .channelOpenTimeout(channelId)
      .send({
        from: sender,
        gas: 470000
      });

    if (!result.transactionHash) {
      throw new ContractError(
        methodName,
        301,
        "Transaction failed to broadcast"
      );
    }

    if (!result.blockNumber) {
      throw new ContractError(
        methodName,
        302,
        result.transactionHash,
        "Transaction failed"
      );
    }

    return result;
  }

  /**
   * Calls the contracts "deposit" method to deposit into an open channel. Wallet should approve the transfer to the contract of any deposited tokens before calling this method.
   *
   * You can deposit wei or tokens, but should call deposit separately to deposit both into a channel.
   *
   * @param {Object} params - the method object
   * @param {Object} params.deposits - the channel deposits
   * @param {BN} params.deposits.weiDeposit - (optional) wei deposit into channel
   * @param {BN} params.deposits.tokenDeposit - (optional) token deopsit into channel
   * @param {String} params.sender - (optional) the sender of the deposit. Defaults to accounts[0]
   * @param {String} params.recipient - (optional) the recipient of the deposit. Defaults to sender or accounts[0]
   *
   * @returns {Promise} resolves to the result of the contract call
   */
  async depositContractHandler({
    channelId,
    deposits,
    sender = null,
    recipient = sender
  }) {
    const methodName = "depositContractHandler";
    // validate
    const isHexStrict = { presence: true, isHexStrict: true };
    const isValidDepositObject = { presence: true, isValidDepositObject: true };
    const isAddress = { presence: true, isAddress: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    Connext.validatorsResponseToError(
      validate.single(deposits, isValidDepositObject),
      methodName,
      "deposits"
    );
    const accounts = await this.web3.eth.getAccounts();
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      sender = accounts[0].toLowerCase();
    }
    if (recipient) {
      Connext.validatorsResponseToError(
        validate.single(recipient, isAddress),
        methodName,
        "recipient"
      );
    } else {
      // unspecified, defaults to active account
      recipient = sender;
    }

    // verify requires --> already checked in deposit() fn, necessary?
    const channel = await this.getChannelById(channelId);
    if (CHANNEL_STATES[channel.status] !== CHANNEL_STATES.LCS_OPENED) {
      throw new ContractError(methodName, "Channel is not open");
    }
    if (
      recipient.toLowerCase() !== channel.partyA.toLowerCase() &&
      recipient.toLowerCase() !== channel.partyI.toLowerCase()
    ) {
      throw new ContractError(
        methodName,
        "Recipient is not a member of the ledger channel"
      );
    }

    // determine deposit type
    const { weiDeposit, tokenDeposit } = deposits;
    let depositType;
    if (weiDeposit && tokenDeposit) {
      // token and eth
      depositType = Object.keys(CHANNEL_TYPES)[2];
    } else if (tokenDeposit) {
      depositType = Object.keys(CHANNEL_TYPES)[1];
    } else if (weiDeposit) {
      depositType = Object.keys(CHANNEL_TYPES)[0];
    }

    let result;
    switch (CHANNEL_TYPES[depositType]) {
      case CHANNEL_TYPES.ETH:
        // call contract method
        result = await this.channelManagerInstance.methods
          .deposit(
            channelId, // PARAM NOT IN CONTRACT YET, SHOULD BE
            recipient,
            deposits.weiDeposit,
            false
          )
          .send({
            from: sender,
            value: deposits.weiDeposit,
            gas: 1000000
          });
        break;
      case CHANNEL_TYPES.TOKEN:
        // must pre-approve transfer
        result = await this.channelManagerInstance.methods
          .deposit(
            channelId, // PARAM NOT IN CONTRACT YET, SHOULD BE
            recipient,
            deposits.tokenDeposit,
            false
          )
          .send({
            from: sender,
            gas: 1000000
          });

        break;
      default:
        throw new ChannelUpdateError(
          methodName,
          `Invalid deposit type detected`
        );
    }

    if (!result.transactionHash) {
      throw new ContractError(
        methodName,
        301,
        "Transaction failed to broadcast"
      );
    }

    if (!result.blockNumber) {
      throw new ContractError(
        methodName,
        302,
        result.transactionHash,
        "Transaction failed"
      );
    }
    return result;
  }

  /**
   * Calls consensusCloseChannel on the ChannelManager contract.
   *
   * @example
   * // generate final state sigParams
   * const sig = await connext.createChannelStateUpdate(sigParams);
   * const { sigI } = await connext.fastCloseChannelHandler({
   *   sig,
   *   channelId: channel.channelId
   * });
   * await connext.conensusCloseChannelContractHandler({
   *   channelId: sigParams.channelId,
   *   nonce: sigParams.nonce,
   *   balanceA: sigParams.balanceA,
   *   balanceI: sigParams.balanceI,
   *   sigA,
   *   sigI
   * })
   *
   * @param {Object} params - the method object
   * @param {Number} params.nonce - the closing channel nonce
   * @param {Object} params.balanceA - the closing partyA balance
   * @param {BN} params.balanceA.weiDeposit - (optional) final wei balance of partyA in channel
   * @param {BN} params.balanceA.tokenDeposit - (optional) final token balance of partyA in channel
   * @param {Object} params.balanceI - final balance of hub in channel
   * @param {BN} params.balanceI.weiDeposit - (optional) final wei balance of hub in channel
   * @param {BN} params.balanceI.tokenDeposit - (optional) final token balance of hub in channel
   * @param {String} params.sigI - the hub's closing signature with the fast close flag
   * @param {String} params.sigA - partyA's closing signature with the fast close flag
   * @param {String} params.sender - (optional) the sender of the contract call, defaults to accounts[0]
   *
   * @returns {Promise} resolves to the result of the contract call
   */
  async consensusCloseChannelContractHandler({
    channelId,
    nonce,
    balanceA,
    balanceI,
    sigA,
    sigI,
    sender = null
  }) {
    const methodName = "consensusCloseChannelContractHandler";
    // validate
    const isHexStrict = { presence: true, isHexStrict: true };
    const isPositiveInt = { presence: true, isPositiveInt: true };
    const isValidDepositObject = { presence: true, isValidDepositObject: true };
    const isHex = { presence: true, isHex: true };
    const isAddress = { presence: true, isAddress: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    Connext.validatorsResponseToError(
      validate.single(nonce, isPositiveInt),
      methodName,
      "nonce"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceA, isValidDepositObject),
      methodName,
      "balanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceI, isValidDepositObject),
      methodName,
      "balanceI"
    );
    Connext.validatorsResponseToError(
      validate.single(sigA, isHex),
      methodName,
      "sigA"
    );
    Connext.validatorsResponseToError(
      validate.single(sigI, isHex),
      methodName,
      "sigI"
    );
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }
    // verify sigs
    const emptyRootHash = Connext.generateThreadRootHash({
      threadInitialStates: []
    });
    let state = {
      sig: sigI,
      isClose: true,
      channelId,
      nonce,
      numOpenThread: 0,
      threadRootHash: emptyRootHash,
      partyA: sender,
      partyI: this.hubAddress,
      weiBalanceA: balanceA.weiDeposit
        ? balanceA.weiDeposit
        : Web3.utils.toBN("0"),
      weiBalanceI: balanceI.weiDeposit
        ? balanceI.weiDeposit
        : Web3.utils.toBN("0"),
      tokenBalanceA: balanceA.tokenDeposit
        ? balanceA.tokenDeposit
        : Web3.utils.toBN("0"),
      tokenBalanceI: balanceI.tokenDeposit
        ? balanceI.tokenDeposit
        : Web3.utils.toBN("0")
    };
    let signer = Connext.recoverSignerFromChannelStateUpdate(state);
    if (signer.toLowerCase() !== this.hubAddress.toLowerCase()) {
      throw new ChannelCloseError(
        methodName,
        "Hub did not sign closing update"
      );
    }
    state.sig = sigA;
    signer = Connext.recoverSignerFromChannelStateUpdate(state);
    if (signer.toLowerCase() !== sender.toLowerCase()) {
      throw new ChannelCloseError(
        methodName,
        "PartyA did not sign closing update"
      );
    }

    const result = await this.channelManagerInstance.methods
      .consensusCloseChannel(
        channelId,
        nonce,
        [
          state.weiBalanceA,
          state.weiBalanceI,
          state.tokenBalanceA,
          state.tokenBalanceI
        ],
        sigA,
        sigI
      )
      .send({
        from: sender,
        gas: 1000000
      });

    if (!result.transactionHash) {
      throw new ContractError(
        methodName,
        301,
        "Transaction failed to broadcast"
      );
    }

    if (!result.blockNumber) {
      throw new ContractError(
        methodName,
        302,
        result.transactionHash,
        "Transaction failed"
      );
    }

    return result;
  }

  /**
   * Calls joinChannel on the Channel Manager contract with the provided deposits. If no deposits are provided, joins with 0 deposits.
   *
   * The wallet must approve the transfer of the deposited tokens to the Channel Manager contract before calling this function.
   *
   * Calling this function will also serve you to serve as a "hub" in the contract.
   *
   * @example
   * // approve token transfers
   * const { channelId } = await connext.getChannelByPartyA("0x3ae...")
   * await connext.joinChannelContractHandler({ channelId })
   *
   * @param {Object} params - the method object
   * @param {String} params.channelId - the channelId of the channel you are joining
   * @param {Object} params.deposits - (optional) the deposits you are joining the channel with. Default value is 0.
   * @param {BN} params.deposits.weiDeposit - (optional) initial wei deposit into channel
   * @param {BN} params.deposits.tokenDeposit - (optional) initial token deposit into channel
   *
   * @returns {Promise} resolves to the result of the contract call
   */
  async joinChannelContractHandler({
    channelId,
    deposits = null,
    sender = null
  }) {
    const methodName = "joinChannelContractHandler";
    const isAddress = { presence: true, isAddress: true };
    const isHexStrict = { presence: true, isHexStrict: true };
    const isValidDepositObject = { presence: true, isValidDepositObject: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    if (deposit) {
      Connext.validatorsResponseToError(
        validate.single(deposits, isValidDepositObject),
        methodName,
        "deposits"
      );
    } else {
      deposit = {
        tokenDeposit: Web3.utils.toBN("0"),
        weiDeposit: Web3.utils.toBN("0")
      };
    }
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    }
    const channel = await this.getChannelById(channelId);
    if (!channel) {
      // hub does not have lc, may be chainsaw issues
      throw new ChannelOpenError(
        methodName,
        "Channel is not openChanneled with hub"
      );
    }
    if (sender && sender.toLowerCase() === channel.partyA) {
      throw new ChannelOpenError(
        methodName,
        "Cannot create channel with yourself"
      );
    }

    if (sender && sender !== channel.partyI) {
      throw new ChannelOpenError(methodName, "Incorrect channel counterparty");
    }

    if (CHANNEL_STATES[channel.state] !== CHANNEL_STATES.OPENED) {
      throw new ChannelOpenError(methodName, "Channel is not in correct state");
    }
    const result = await this.channelManagerInstance.methods
      .joinChannel(channelId, [
        deposit.weiDeposit ? deposit.weiDeposit : "0",
        deposit.tokenDeposit ? deposit.tokenDeposit : "0"
      ])
      .send({
        from: sender || this.hubAddress, // can also be accounts[0], easier for testing
        value: deposit.weiDeposit ? deposit.weiDeposit : "0",
        gas: 3000000 // FIX THIS, WHY HAPPEN, TRUFFLE CONFIG???
      });

    if (!result.transactionHash) {
      throw new ContractError(
        methodName,
        301,
        "Transaction failed to broadcast"
      );
    }

    if (!result.blockNumber) {
      throw new ContractError(
        methodName,
        302,
        result.transactionHash,
        "Transaction failed"
      );
    }
    return result;
  }

  /**
   * Calls updateChannelState on the Channel Manager contract. Should be called if there is a dispute when fast closing a channel, or when you are beginning to dispute a thread.
   *
   * @example
   * // generate final state sigParams
   * const sig = await connext.createChannelStateUpdate(sigParams);
   * const { sigI } = await connext.fastCloseChannelHandler({
   *   sig,
   *   channelId: channel.channelId
   * });
   * if (!sigI) {
   *  const { channelId, nonce, numOpenThread, balanceA, balanceI, threadRootHash } = sigParams
   *  await connext.this.updateChannelStateContractHandler({ channelId, nonce, numOpenThread, balanceA, balanceI, threadRootHash })
   * }
   *
   * @param {Object} params - the method object
   * @param {String} params.channelId - ID of the channel you are disputing
   * @param {Number} params.nonce - the nonce of the state you are submitting to the contract
   * @param {Number} params.numOpenThread - the number of open threads in that channel state
   * @param {String} params.threadRootHash - root hash of the initial thread states for active threads in this channel
   * @param {Object} params.balanceA - partyA balance
   * @param {BN} params.balanceA.weiDeposit - (optional) wei balance of partyA in channel
   * @param {BN} params.balanceA.tokenDeposit - (optional) token balance of partyA in channel
   * @param {Object} params.balanceI - balance of hub in channel
   * @param {BN} params.balanceI.weiDeposit - (optional) wei balance of hub in channel
   * @param {BN} params.balanceI.tokenDeposit - (optional) token balance of hub in channel
   * @param {String} params.sigI - the hub signature on the state
   * @param {String} params.sigA - partyA's signature on the state
   * @param {String} params.sender - (optional) sender of the contract call. Defaults to accounts[0]
   *
   * @returns {Promise} resolves to the result of the contract call
   */
  async updateChannelStateContractHandler({
    channelId,
    nonce,
    numOpenThread,
    threadRootHash,
    balanceA,
    balanceI,
    sigA,
    sigI,
    sender = null
  }) {
    const methodName = "updateChannelStateContractHandler";
    // validate
    const isHexStrict = { presence: true, isHexStrict: true };
    const isPositiveInt = { presence: true, isPositiveInt: true };
    const isValidDepositObject = { presence: true, isValidDepositObject: true };
    const isHex = { presence: true, isHex: true };
    const isAddress = { presence: true, isAddress: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    Connext.validatorsResponseToError(
      validate.single(nonce, isPositiveInt),
      methodName,
      "nonce"
    );
    Connext.validatorsResponseToError(
      validate.single(numOpenThread, isPositiveInt),
      methodName,
      "numOpenThread"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceA, isValidDepositObject),
      methodName,
      "balanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceI, isValidDepositObject),
      methodName,
      "balanceI"
    );
    Connext.validatorsResponseToError(
      validate.single(threadRootHash, isHex),
      methodName,
      "threadRootHash"
    );
    Connext.validatorsResponseToError(
      validate.single(sigA, isHex),
      methodName,
      "sigA"
    );
    Connext.validatorsResponseToError(
      validate.single(sigI, isHex),
      methodName,
      "sigI"
    );
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }

    const weiBalanceA = balanceA.weiDeposit
      ? balanceA.weiDeposit
      : Web3.utils.toBN("0");
    const weiBalanceI = balanceI.weiDeposit
      ? balanceI.weiDeposit
      : Web3.utils.toBN("0");

    const tokenBalanceA = balanceA.tokenDeposit
      ? balanceA.tokenDeposit
      : Web3.utils.toBN("0");
    const tokenBalanceI = balanceI.tokenDeposit
      ? balanceI.tokenDeposit
      : Web3.utils.toBN("0");

    const result = await this.channelManagerInstance.methods
      .updateChannelState(
        channelId,
        [
          nonce,
          numOpenThread,
          weiBalanceA,
          weiBalanceI,
          tokenBalanceA,
          tokenBalanceI
        ],
        Web3.utils.padRight(threadRootHash, 64),
        sigA,
        sigI
      )
      .send({
        from: sender,
        gas: "6721975"
      });
    if (!result.transactionHash) {
      throw new ContractError(
        methodName,
        301,
        "Transaction failed to broadcast"
      );
    }

    if (!result.blockNumber) {
      throw new ContractError(
        methodName,
        302,
        result.transactionHash,
        "Transaction failed"
      );
    }
    return result;
  }

  /**
   * Calls initThreadState on the Channel Manager contract. Should be called if there is a dispute when closing a thread, after updateChannelState has timed out.
   *
   *
   * @param {Object} params - the method object
   * @param {String} params.subchanId - ID of the your subchannel in thread
   * @param {String} params.threadId - ID of the thread you are disputing
   * @param {String} params.proof - (optional) the proof the thread is in the on-chain root hash of the channel. If not provided, it is generated.
   * @param {String} params.partyA - partyA in thread (payor)
   * @param {String} params.partyB - partyB in thread (payee)
   * @param {Object} params.balanceA - partyA balance
   * @param {BN} params.balanceA.weiDeposit - (optional) wei balance of partyA in channel
   * @param {BN} params.balanceA.tokenDeposit - (optional) token balance of partyA in channel
   * @param {String} params.sigA - partyA's signature on the initial thread state
   * @param {String} params.sender - (optional) sender of the contract call. Defaults to accounts[0]
   *
   * @returns {Promise} resolves to the result of the contract call
   */
  async initThreadContractHandler({
    subchanId,
    threadId,
    proof = null,
    partyA,
    partyB,
    balanceA,
    sigA,
    sender = null
  }) {
    const methodName = "initThreadContractHandler";
    // validate
    const isAddress = { presence: true, isAddress: true };
    const isHexStrict = { presence: true, isHexStrict: true };
    const isValidDepositObject = { presence: true, isValidDepositObject: true };
    const isHex = { presence: true, isHex: true };
    Connext.validatorsResponseToError(
      validate.single(subchanId, isHexStrict),
      methodName,
      "subchanId"
    );
    Connext.validatorsResponseToError(
      validate.single(threadId, isHexStrict),
      methodName,
      "threadId"
    );
    Connext.validatorsResponseToError(
      validate.single(partyA, isAddress),
      methodName,
      "partyA"
    );
    Connext.validatorsResponseToError(
      validate.single(partyB, isAddress),
      methodName,
      "partyB"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceA, isValidDepositObject),
      methodName,
      "balanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(sigA, isHex),
      methodName,
      "sigA"
    );
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }
    const weiBalanceA = balanceA.weiDeposit
      ? balanceA.weiDeposit
      : Web3.utils.toBN("0");
    const tokenBalanceA = balanceA.tokenDeposit
      ? balanceA.tokenDeposit
      : Web3.utils.toBN("0");

    let merkle, stateHash;
    if (proof === null) {
      // generate proof from channel
      stateHash = Connext.createThreadStateUpdateFingerprint({
        channelId: threadId,
        nonce: 0,
        partyA,
        partyB,
        weiBalanceA,
        weiBalanceB: Web3.utils.toBN("0"),
        tokenBalanceA,
        tokenBalanceB: Web3.utils.toBN("0"),
        weiBond: weiBalanceA,
        tokenBond: tokenBalanceA
      });
      const threadInitialStates = await this.getThreadInitialStates(subchanId);
      merkle = Connext.generateMerkleTree(threadInitialStates);
      let mproof = merkle.proof(Utils.hexToBuffer(stateHash));

      proof = [];
      for (var i = 0; i < mproof.length; i++) {
        proof.push(Utils.bufferToHex(mproof[i]));
      }

      proof.unshift(stateHash);

      proof = Utils.marshallState(proof);
    }

    const results = await this.channelManagerInstance.methods
      .initThreadState(
        subchanId,
        threadId,
        proof,
        partyA,
        partyB,
        [weiBalanceA, tokenBalanceA],
        [
          weiBalanceA,
          Web3.utils.toBN("0"),
          tokenBalanceA,
          Web3.utils.toBN("0")
        ],
        sigA
      )
      // .estimateGas({
      //   from: sender,
      // })
      .send({
        from: sender,
        gas: 6721975
      });
    if (!results.transactionHash) {
      throw new Error(`[${methodName}] initVCState transaction failed.`);
    }
    if (!results.transactionHash) {
      throw new ContractError(
        methodName,
        301,
        "Transaction failed to broadcast"
      );
    }

    if (!results.blockNumber) {
      throw new ContractError(
        methodName,
        302,
        results.transactionHash,
        "Transaction failed"
      );
    }
    return results;
  }

  /**
   * Calls settleThread on the Channel Manager contract. Should be called if there is a dispute when closing a thread, after initThread has timed out.
   *
   *
   * @param {Object} params - the method object
   * @param {String} params.subchanId - ID of the your subchannel in thread
   * @param {String} params.threadId - ID of the thread you are disputing
   * @param {Number} params.nonce - nonce of the state you are putting on-chain
   * @param {String} params.partyA - partyA in thread (payor)
   * @param {String} params.partyB - partyB in thread (payee)
   * @param {Object} params.balanceA - partyA balance
   * @param {BN} params.balanceA.weiDeposit - (optional) wei balance of partyA in channel
   * @param {BN} params.balanceA.tokenDeposit - (optional) token balance of partyA in channel
   * @param {Object} params.balanceB - partyB balance
   * @param {BN} params.balanceB.weiDeposit - (optional) wei balance of partyB in channel
   * @param {BN} params.balanceB.tokenDeposit - (optional) token balance of partyB in channel
   * @param {String} params.sigA - partyA's signature on the provided thread state
   * @param {String} params.sender - (optional) sender of the contract call. Defaults to accounts[0]
   *
   * @returns {Promise} resolves to the result of the contract call
   */
  async settleThreadContractHandler({
    subchanId,
    threadId,
    nonce,
    partyA,
    partyB,
    balanceA,
    balanceB,
    sigA,
    sender = null
  }) {
    const methodName = "settleThreadContractHandler";
    // validate
    const isAddress = { presence: true, isAddress: true };
    const isPositiveInt = { presence: true, isPositiveInt: true };
    const isHexStrict = { presence: true, isHexStrict: true };
    const isValidDepositObject = { presence: true, isValidDepositObject: true };
    const isHex = { presence: true, isHex: true };
    Connext.validatorsResponseToError(
      validate.single(subchanId, isHexStrict),
      methodName,
      "subchanId"
    );
    Connext.validatorsResponseToError(
      validate.single(threadId, isHexStrict),
      methodName,
      "threadId"
    );
    Connext.validatorsResponseToError(
      validate.single(nonce, isPositiveInt),
      methodName,
      "nonce"
    );
    Connext.validatorsResponseToError(
      validate.single(partyA, isAddress),
      methodName,
      "partyA"
    );
    Connext.validatorsResponseToError(
      validate.single(partyB, isAddress),
      methodName,
      "partyB"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceA, isValidDepositObject),
      methodName,
      "balanceA"
    );
    Connext.validatorsResponseToError(
      validate.single(balanceB, isValidDepositObject),
      methodName,
      "balanceB"
    );
    Connext.validatorsResponseToError(
      validate.single(sigA, isHex),
      methodName,
      "sigA"
    );
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }

    const weiBalanceA = balanceA.weiDeposit
      ? balanceA.weiDeposit
      : Web3.utils.toBN("0");
    const weiBalanceB = balanceB.weiDeposit
      ? balanceB.weiDeposit
      : Web3.utils.toBN("0");

    const tokenBalanceA = balanceA.tokenDeposit
      ? balanceA.tokenDeposit
      : Web3.utils.toBN("0");
    const tokenBalanceB = balanceB.tokenDeposit
      ? balanceB.tokenDeposit
      : Web3.utils.toBN("0");

    const results = await this.channelManagerInstance.methods
      .settleThread(
        subchanId,
        threadId,
        nonce,
        partyA,
        partyB,
        [weiBalanceA, weiBalanceB, tokenBalanceA, tokenBalanceB],
        sigA
      )
      .send({
        from: sender,
        gas: 6721975
      });
    if (!results.transactionHash) {
      throw new ContractError(
        methodName,
        301,
        "Transaction failed to broadcast"
      );
    }

    if (!results.blockNumber) {
      throw new ContractError(
        methodName,
        302,
        results.transactionHash,
        "Transaction failed"
      );
    }
    return results;
  }

  /**
   * Calls closeThread on the Channel Manager contract. Reintroduces the funds to their respective channels. Should be called after the settleThread dispute time has elapsed.
   *
   * @param {Object} params - the method object
   * @param {String} params.channelId - the ID of the disputer's channel
   * @param {String} params.threadId - the ID of the disputed thread
   * @param {String} params.sender - (optional) the sender of the contract call, defaults to accounts[0]
   *
   * @returns {Promise} resolves to the result of the contract call
   */
  async closeThreadContractHandler({ channelId, threadId, sender = null }) {
    const methodName = "closeThreadContractHandler";
    const isHexStrict = { presence: true, isHexStrict: true };
    const isAddress = { presence: true, isAddress: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    Connext.validatorsResponseToError(
      validate.single(threadId, isHexStrict),
      methodName,
      "threadId"
    );
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }
    const results = await this.channelManagerInstance.methods
      .closeThread(channelId, threadId)
      .send({
        from: sender
      });
    if (!results.transactionHash) {
      throw new ContractError(
        methodName,
        301,
        "Transaction failed to broadcast"
      );
    }

    if (!results.blockNumber) {
      throw new ContractError(
        methodName,
        302,
        results.transactionHash,
        "Transaction failed"
      );
    }
    return results;
  }

  /**
   * Calls byzantineCloseChannel on the Channel Manager contract. Withdraws the funds from, and closes out, a disputed channel. Should be called after the updateChannelState dispute time has elapsed, and when there are no threads remaining open.
   *
   * @param {Object} params - the method object
   * @param {String} params.channelId - the ID of the disputer's channel
   * @param {String} params.threadId - the ID of the disputed thread
   * @param {String} params.sender - (optional) the sender of the contract call, defaults to accounts[0]
   *
   * @returns {Promise} resolves to the result of the contract call
   */
  async byzantineCloseChannelContractHandler({ channelId, sender = null }) {
    const methodName = "byzantineCloseChannelContractHandler";
    const isHexStrict = { presence: true, isHexStrict: true };
    const isAddress = { presence: true, isAddress: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    if (sender) {
      Connext.validatorsResponseToError(
        validate.single(sender, isAddress),
        methodName,
        "sender"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      sender = accounts[0].toLowerCase();
    }
    const results = await this.channelManagerInstance.methods
      .byzantineCloseChannel(channelId)
      .send({
        from: sender,
        gas: "470000"
      });
    if (!results.transactionHash) {
      throw new ContractError(
        methodName,
        301,
        "Transaction failed to broadcast"
      );
    }

    if (!results.blockNumber) {
      throw new ContractError(
        methodName,
        302,
        results.transactionHash,
        "Transaction failed"
      );
    }
    return results;
  }

  // ***************************************
  // ********** ERROR HELPERS **************
  // ***************************************

  static validatorsResponseToError(validatorResponse, methodName, varName) {
    if (validatorResponse !== undefined) {
      throw new ParameterValidationError(
        methodName,
        varName,
        validatorResponse
      );
    }
  }

  // ***************************************
  // *********** INGRID GETTERS ************
  // ***************************************

  /**
   * Requests the unjoined threads that have been initiated. All threads are unidirectional, and only the reciever of payments may have unjoined threads.
   *
   * In reality, partyB does not have to explicitly join threads as they are unidirectional, so all threads may be unjoined.
   *
   * @param {String} partyB - (optional) ETH address of party who has yet to join threads.
   *
   * @returns {Promise} resolves to an array of unjoined virtual channel objects
   */
  async getUnjoinedThreads(partyB = null) {
    const methodName = "getUnjoinedThreads";
    const isAddress = { presence: true, isAddress: true };
    if (partyB) {
      Connext.validatorsResponseToError(
        validate.single(partyB, isAddress),
        methodName,
        "partyB"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      partyB = accounts[0].toLowerCase();
    }
    const response = await this.networking.get(
      `virtualchannel/address/${partyB.toLowerCase()}/opening`
    );
    return response.data;
  }

  /**
   * Returns the thread state at a given nonce.
   *
   * @param {Object} params - the method object
   * @param {String} params.threadId - the ID of the thread
   * @param {Number} params.nonce - the desired state's nonce
   *
   * @returns {Promise} resolves to the thread state at the given nonce
   */
  async getThreadStateByNonce({ threadId, nonce }) {
    const methodName = "getThreadStateByNonce";
    const isHexStrict = { presence: true, isHexStrict: true };
    const isPositiveInt = { presence: true, isPositiveInt: true };
    Connext.validatorsResponseToError(
      validate.single(threadId, isHexStrict),
      methodName,
      "threadId"
    );
    Connext.validatorsResponseToError(
      validate.single(nonce, isPositiveInt),
      methodName,
      "nonce"
    );
    const response = await this.networking.get(
      `thread/${threadId}/update/${nonce}`
    );
    return response.data;
  }

  /**
   * Returns the channel state at a given nonce.
   *
   * @param {Object} params - the method object
   * @param {String} params.channel - the ID of the channel
   * @param {Number} params.nonce - the desired state's nonce
   *
   * @returns {Promise} resolves to the channel state at the given nonce
   */
  async getChannelStateByNonce({ channelId, nonce }) {
    const methodName = "getChannelStateByNonce";
    const isHexStrict = { presence: true, isHexStrict: true };
    const isPositiveInt = { presence: true, isPositiveInt: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    Connext.validatorsResponseToError(
      validate.single(nonce, isPositiveInt),
      methodName,
      "nonce"
    );
    const response = await this.networking.get(
      `channel/${channelId}/update/${nonce}`
    );
    return response.data;
  }

  /**
   * Returns the latest channel state.
   *
   * @param {String} channelId - the ID of the thread
   *
   * @returns {Promise} resolves to the latest channel state
   */
  async getLatestChannelState(channelId) {
    // lcState == latest ingrid signed state
    const methodName = "getLatestChannelState";
    const isHexStrict = { presence: true, isHexStrict: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );

    const response = await this.networking.get(
      `channel/${channelId}/update/latest`
    );
    return response.data;
  }

  /**
   * Returns an array of the threads associated with the given channel.
   *
   * @param {String} channelId - ID of the ledger channel
   * @returns {Promise} resolves to an array of thread objects
   */
  async getThreadsByChannelId(channelId) {
    const methodName = "getThreadsByChannelId";
    const isHexStrict = { presence: true, isHexStrict: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );

    const response = await this.networking.get(`channel/${channelId}/threads`);
    return response.data;
  }

  /**
   * Returns the thread.
   *
   * @param {String} threadId - the ID of the thread
   * @returns {Promise} resolves to the thread object
   */
  async getThreadById(threadId) {
    const methodName = "getThreadById";
    const isHexStrict = { presence: true, isHexStrict: true };
    Connext.validatorsResponseToError(
      validate.single(threadId, isHexStrict),
      methodName,
      "threadId"
    );
    try {
      const response = await this.networking.get(`thread/${threadId}`);
      return response.data;
    } catch (e) {
      if (e.status === 404) {
        return null;
      } else {
        throw e;
      }
    }
  }

  /**
   * Returns the threads between the two parties. If there are no threads, returns null.
   *
   * @param {Object} params - the method object
   * @param {String} params.partyA - ETH address of partyA in virtual channel
   * @param {String} params.partyB - ETH address of partyB in virtual channel
   * @returns {Promise} resolves to the thread
   */
  async getThreadByParties({ partyA, partyB }) {
    const methodName = "getThreadByParties";
    const isAddress = { presence: true, isAddress: true };
    Connext.validatorsResponseToError(
      validate.single(partyA, isAddress),
      methodName,
      "partyA"
    );
    Connext.validatorsResponseToError(
      validate.single(partyB, isAddress),
      methodName,
      "partyB"
    );
    try {
      const openResponse = await this.networking.get(
        `thread/a/${partyA.toLowerCase()}/b/${partyB.toLowerCase()}`
      );
      if (openResponse.data && openResponse.data.length === 0) {
        return null;
      } else if (openResponse.data && openResponse.data.length === 1) {
        return openResponse.data[0];
      } else {
        return openResponse.data;
      }
    } catch (e) {
      if (e.status === 404) {
        return null;
      } else {
        throw e;
      }
    }
  }

  /**
   * Returns an object representing a channel.
   *
   * @param {String} channelId - the ledger channel id
   * @returns {Promise} resolves to the ledger channel object
   */
  async getChannelById(channelId) {
    const methodName = "getChannelById";
    const isHexStrict = { presence: true, isHexStrict: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    try {
      const res = await this.networking.get(`channel/${channelId}`);
      return res.data;
    } catch (e) {
      if (e.status === 404) {
        return null;
      }
      throw e;
    }
  }

  /**
   * Returns the channel between partyA and the hub.
   *
   * @param {String} partyA - (optional) partyA in ledger channel. Default is accounts[0]
   * @returns {Promise} resolves to channel object
   */
  async getChannelByPartyA(partyA = null) {
    const methodName = "getChannelByPartyA";
    const isAddress = { presence: true, isAddress: true };
    if (partyA !== null) {
      Connext.validatorsResponseToError(
        validate.single(partyA, isAddress),
        methodName,
        "partyA"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      partyA = accounts[0];
    }
    try {
      const response = await this.networking.get(
        `channel/a/${partyA.toLowerCase()}`
      );
      if (response.data && response.data.length === 0) {
        return null;
      } else if (response.data.length === 1) {
        return response.data[0];
      } else {
        return response.data;
      }
    } catch (e) {
      if (e.status === 404) {
        return null;
      } else {
        throw e;
      }
    }
  }

  /**
   * Returns the latest thread state of the given threadId.
   *
   * @param {String} threadId - ID of thread
   * @returns {Promise} resolves to thread state
   */
  async getLatestThreadState(threadId) {
    // validate params
    const methodName = "getLatestThreadState";
    const isHexStrict = { presence: true, isHexStrict: true };
    Connext.validatorsResponseToError(
      validate.single(threadId, isHexStrict),
      methodName,
      "threadId"
    );
    const response = await this.networking.get(
      `thread/${threadId}/update/latest`
    );
    return response.data;
  }

  /**
   * Returns the initial thread states for all open threads associated with the channelId.
   *
   * @param {String} channelId - ID of channel
   * @returns {Promise} resolves to an array of initial thread states
   */
  async getThreadInitialStates(channelId) {
    // validate params
    const methodName = "getThreadInitialStates";
    const isHexStrict = { presence: true, isHexStrict: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    const response = await this.networking.get(
      `channel/${channelId}/threadInitialStates`
    );
    return response.data;
  }

  /**
   * Returns the initial state of the thread
   *
   * @param {String} threadId - ID of thread
   * @returns {Promise} resolves to a thread state object
   */
  async getThreadInitialState(threadId) {
    // validate params
    const methodName = "getThreadInitialState";
    const isHexStrict = { presence: true, isHexStrict: true };
    Connext.validatorsResponseToError(
      validate.single(threadId, isHexStrict),
      methodName,
      "threadId"
    );
    const response = await this.networking.get(`thread/${threadId}/update/0`);
    return response.data;
  }

  // ***************************************
  // *********** INGRID HELPERS ************
  // ***************************************

  /**
   * Requests hub deposits into a given channel. Hub must have sufficient balance in the "B" subchannel to cover the thread balance of "A".
   *
   * This function is to be used if the hub has insufficient balance in the channel to create proposed threads.
   *
   * @param {Object} params - the method object
   * @param {String} params.channelId - id of the ledger channel
   * @param {Object} params.deposit - the requested hub deposit
   * @param {Object} params.deposit.weiDeposit - (optional) the requested hub wei deposit
   * @param {Object} params.deposit.tokenDeposit - (optional) the requested hub token deposit
   * @returns {Promise} resolves to the transaction hash of Ingrid calling the deposit function
   */
  async requestHubDeposit({ channelId, deposit }) {
    const methodName = "requestHubDeposit";
    const isHexStrict = { presence: true, isHexStrict: true };
    const isValidDepositObject = { presence: true, isValidDepositObject: true };
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    Connext.validatorsResponseToError(
      validate.single(deposit, isValidDepositObject),
      methodName,
      "deposit"
    );
    const accountBalance = await this.web3.eth.getBalance(this.hubAddress);
    if (
      deposit.weiDeposit &&
      deposit.weiDeposit.gt(Web3.utils.toBN(accountBalance))
    ) {
      throw new ChannelUpdateError(
        methodName,
        "Hub does not have sufficient ETH balance for requested deposit"
      );
    }
    const response = await this.networking.post(
      `channel/${channelId}/requestdeposit`,
      {
        weiDeposit: deposit.weiDeposit ? deposit.weiDeposit.toString() : "0",
        tokenDeposit: deposit.tokenDeposit
          ? deposit.tokenDeposit.toString()
          : "0"
      }
    );
    return response.data.txHash;
  }

  /**
   * Posts a request to the hub to close a thread.
   *
   * @param {Object} params
   * @param {String} params.sig - the sig on the proposed subchannel update
   * @param {String} params.threadId - ID of the thread you are closing
   * @param {String} params.signer - (optional) signer of the update (should be partyA in thread)
   *
   * @returns {Promise} resolves to true if the thread was closed, false if it was not
   */
  async fastCloseThreadHandler({ sig, threadId, signer = null }) {
    // validate params
    const methodName = "fastCloseThreadHandler";
    const isHex = { presence: true, isHex: true };
    const isHexStrict = { presence: true, isHexStrict: true };
    const isAddress = { presence: true, isAddress: true };
    Connext.validatorsResponseToError(
      validate.single(sig, isHex),
      methodName,
      "sig"
    );
    if (signer) {
      Connext.validatorsResponseToError(
        validate.single(signer, isAddress),
        methodName,
        "signer"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      signer = accounts[0].toLowerCase();
    }
    Connext.validatorsResponseToError(
      validate.single(threadId, isHexStrict),
      methodName,
      "threadId"
    );

    const response = await this.networking.post(`thread/${threadId}/close`, {
      sig,
      signer
    });
    return (
      THREAD_STATES[response.data.status] !==
      Object.keys(THREAD_STATES)[THREAD_STATES.SETTLED]
    );
  }

  /**
   * Posts a request to the hub to cosign a final channel update with the fast close flag. Hub will only cosign if there are no threads open, and all updates are in sync.
   *
   * @param {Object} params
   * @param {String} params.sig - the sig on the proposed subchannel update
   * @param {String} params.channelId - ID of the channel you are closing
   *
   * @returns {Promise} resolves to the final cosigned state
   */
  async fastCloseChannelHandler({ sig, channelId }) {
    // validate params
    const methodName = "fastCloseChannelHandler";
    const isHexStrict = { presence: true, isHexStrict: true };
    const isHex = { presence: true, isHex: true };
    Connext.validatorsResponseToError(
      validate.single(sig, isHex),
      methodName,
      "sig"
    );
    Connext.validatorsResponseToError(
      validate.single(channelId, isHexStrict),
      methodName,
      "channelId"
    );
    const response = await this.networking.post(`channel/${channelId}/close`, {
      sig
    });
    return response.data;
  }

  /**
   * Creates a signed channel update when a thread is opened.
   *
   * @param {Object} params - the method object
   * @param {Object} params.threadInitialState - the initial state of the proposed thread
   * @param {Object} params.channel - the signer's subchannel of the proposed thread
   * @param {String} params.signer - (optional) signer of update. Defaults to accounts[0]
   *
   * @returns {Promise} resolves to the signature of the signer on the channel update
   */
  async createChannelUpdateOnThreadOpen({
    threadInitialState,
    subchan,
    signer = null
  }) {
    const methodName = "createChannelUpdateOnThreadOpen";
    const isThreadState = { presence: true, isThreadState: true };
    const isChannelObj = { presence: true, isChannelObj: true };
    const isAddress = { presence: true, isAddress: true };
    Connext.validatorsResponseToError(
      validate.single(threadInitialState, isThreadState),
      methodName,
      "threadInitialState"
    );
    Connext.validatorsResponseToError(
      validate.single(subchan, isChannelObj),
      methodName,
      "subchan"
    );
    if (signer) {
      Connext.validatorsResponseToError(
        validate.single(signer, isAddress),
        methodName,
        "signer"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      signer = accounts[0].toLowerCase();
    }
    // signer should always be lc partyA
    if (signer.toLowerCase() !== subchan.partyA) {
      throw new ThreadOpenError(methodName, "Invalid signer detected");
    }
    // signer should be threadInitialState partyA or threadInitialState partyB
    if (
      signer.toLowerCase() !== threadInitialState.partyA.toLowerCase() &&
      signer.toLowerCase() !== threadInitialState.partyB.toLowerCase()
    ) {
      throw new ThreadOpenError(methodName, "Invalid signer detected");
    }
    // channel must be open
    if (CHANNEL_STATES[subchan.status] !== CHANNEL_STATES.JOINED) {
      throw new ThreadOpenError(methodName, "Invalid subchannel state");
    }

    // thread state 0 validation
    if (threadInitialState.nonce !== 0) {
      throw new ThreadOpenError(methodName, "Thread nonce is nonzero");
    }
    // check that balanceA of channel is sufficient to create thread
    if (
      threadInitialState.balanceA.weiDeposit &&
      Web3.utils
        .toBN(subchan.weiBalanceA)
        .lt(threadInitialState.balanceA.weiDeposit)
    ) {
      throw new ThreadOpenError(
        methodName,
        "Insufficient ETH deposit detected for balanceA"
      );
    }
    if (
      threadInitialState.balanceA.tokenDeposit &&
      Web3.utils
        .toBN(subchan.tokenBalanceA)
        .lt(threadInitialState.balanceA.tokenDeposit)
    ) {
      throw new ThreadOpenError(
        methodName,
        "Insufficient token deposit detected for balanceA"
      );
    }
    // verify balanceB for both is 0
    if (
      threadInitialState.balanceB.weiDeposit &&
      !threadInitialState.balanceB.weiDeposit.isZero()
    ) {
      throw new ThreadOpenError(
        methodName,
        "The ETH balanceB must be 0 when creating thread."
      );
    }
    if (
      threadInitialState.balanceB.tokenDeposit &&
      !threadInitialState.balanceB.tokenDeposit.isZero()
    ) {
      throw new ThreadOpenError(
        methodName,
        "The token balanceB must be 0 when creating thread."
      );
    }
    // manipulate threadInitialState to have the right data structure
    threadInitialState.weiBalanceA = threadInitialState.balanceA.weiDeposit
      ? threadInitialState.balanceA.weiDeposit
      : Web3.utils.toBN("0");
    threadInitialState.weiBalanceB = Web3.utils.toBN("0");
    threadInitialState.tokenBalanceA = threadInitialState.balanceA.tokenDeposit
      ? threadInitialState.balanceA.tokenDeposit
      : Web3.utils.toBN("0");
    threadInitialState.tokenBalanceB = Web3.utils.toBN("0");

    threadInitialState.weiBond = threadInitialState.weiBalanceA.add(
      threadInitialState.weiBalanceB
    );
    threadInitialState.tokenBond = threadInitialState.tokenBalanceA.add(
      threadInitialState.tokenBalanceB
    );

    let threadInitialStates = await this.getThreadInitialStates(
      subchan.channelId
    );
    threadInitialStates.push(threadInitialState); // add new vc state to hash
    let newRootHash = Connext.generateThreadRootHash({
      threadInitialStates: threadInitialStates
    });

    // new LC balances should reflect the VC deposits
    // new balanceA = balanceA - (their VC balance)
    const channelweiBalanceA =
      signer.toLowerCase() === threadInitialState.partyA.toLowerCase()
        ? Web3.utils
            .toBN(subchan.weiBalanceA)
            .sub(threadInitialState.weiBalanceA) // viewer is signing LC update
        : Web3.utils
            .toBN(subchan.weiBalanceA)
            .sub(threadInitialState.weiBalanceB); // performer is signing LC update

    const channelTokenBalanceA =
      signer.toLowerCase() === threadInitialState.partyA.toLowerCase()
        ? Web3.utils
            .toBN(subchan.tokenBalanceA)
            .sub(threadInitialState.tokenBalanceA)
        : Web3.utils
            .toBN(subchan.tokenBalanceA)
            .sub(threadInitialState.tokenBalanceB);

    // new balanceI = balanceI - (counterparty VC balance)
    const channelTokenBalanceI =
      signer.toLowerCase() === threadInitialState.partyA.toLowerCase()
        ? Web3.utils
            .toBN(subchan.tokenBalanceI)
            .sub(threadInitialState.tokenBalanceB)
        : Web3.utils
            .toBN(subchan.tokenBalanceI)
            .sub(threadInitialState.tokenBalanceA);

    const channelweiBalanceI =
      signer.toLowerCase() === threadInitialState.partyA.toLowerCase()
        ? Web3.utils
            .toBN(subchan.weiBalanceI)
            .sub(threadInitialState.weiBalanceB)
        : Web3.utils
            .toBN(subchan.weiBalanceI)
            .sub(threadInitialState.weiBalanceA); //

    const updateAtoI = {
      channelId: subchan.channelId,
      nonce: subchan.nonce + 1,
      numOpenThread: threadInitialStates.length,
      threadRootHash: newRootHash,
      partyA: subchan.partyA,
      partyI: this.hubAddress,
      balanceA: {
        weiDeposit: channelweiBalanceA,
        tokenDeposit: channelTokenBalanceA
      },
      balanceI: {
        weiDeposit: channelweiBalanceI,
        tokenDeposit: channelTokenBalanceI
      },
      signer: signer,
      hubBond: {
        weiDeposit: threadInitialState.weiBalanceA.add(
          threadInitialState.weiBalanceB
        ),
        tokenDeposit: threadInitialState.tokenBalanceA.add(
          threadInitialState.tokenBalanceB
        )
      }
    };
    const sigAtoI = await this.createChannelStateUpdate(updateAtoI);
    return sigAtoI;
  }

  /**
   * Creates a signed channel update when a thread is closed.
   *
   * @param {Object} params - the method object
   * @param {Object} params.latestThreadState - the closing state of the proposed thread
   * @param {Object} params.subchan - the signer's subchannel of the thread
   * @param {String} params.signer - (optional) signer of update. Defaults to accounts[0]
   *
   * @returns {Promise} resolves to the signature of the signer on the channel update
   */
  async createChannelUpdateOnThreadClose({
    latestThreadState,
    subchan,
    signer = null
  }) {
    const methodName = "createChannelUpdateOnThreadClose";
    const isThreadState = { presence: true, isThreadState: true };
    const isChannelObj = { presence: true, isChannelObj: true };
    const isAddress = { presence: true, isAddress: true };
    Connext.validatorsResponseToError(
      validate.single(latestThreadState, isThreadState),
      methodName,
      "latestThreadState"
    );
    Connext.validatorsResponseToError(
      validate.single(subchan, isChannelObj),
      methodName,
      "subchan"
    );
    if (signer) {
      Connext.validatorsResponseToError(
        validate.single(signer, isAddress),
        methodName,
        "signer"
      );
    } else {
      const accounts = await this.web3.eth.getAccounts();
      signer = accounts[0].toLowerCase();
    }
    // must be partyA in lc
    if (signer.toLowerCase() !== subchan.partyA) {
      throw new ThreadCloseError(methodName, "Incorrect signer detected");
    }
    // must be party in vc
    if (
      signer.toLowerCase() !== latestThreadState.partyA.toLowerCase() &&
      signer.toLowerCase() !== latestThreadState.partyB.toLowerCase()
    ) {
      throw new ThreadCloseError(methodName, "Not your channel");
    }
    if (
      CHANNEL_STATES[subchan.state] !== CHANNEL_STATES.LCS_OPENED &&
      CHANNEL_STATES[subchan.state] !== CHANNEL_STATES.LCS_SETTLING
    ) {
      throw new ThreadCloseError(methodName, "Channel is in invalid state");
    }

    let threadInitialStates = await this.getThreadInitialStates(
      subchan.channelId
    );
    // array of state objects, which include the channel id and nonce
    // remove initial state of vcN
    threadInitialStates = threadInitialStates.filter(threadState => {
      return threadState.channelId !== latestThreadState.channelId;
    });
    const newRootHash = Connext.generateThreadRootHash({
      threadInitialStates: threadInitialStates
    });

    // add balance from thread to channel balance
    const subchanweiBalanceA =
      signer.toLowerCase() === latestThreadState.partyA
        ? Web3.utils
            .toBN(subchan.weiBalanceA)
            .add(Web3.utils.toBN(latestThreadState.weiBalanceA))
        : Web3.utils
            .toBN(subchan.weiBalanceA)
            .add(Web3.utils.toBN(latestThreadState.weiBalanceB));
    // add counterparty balance from thread to channel balance
    const subchanweiBalanceI =
      signer.toLowerCase() === latestThreadState.partyA
        ? Web3.utils
            .toBN(subchan.weiBalanceI)
            .add(Web3.utils.toBN(latestThreadState.weiBalanceB))
        : Web3.utils
            .toBN(subchan.weiBalanceI)
            .add(Web3.utils.toBN(latestThreadState.weiBalanceA));

    const subchanTokenBalanceA =
      signer.toLowerCase() === latestThreadState.partyA
        ? Web3.utils
            .toBN(subchan.tokenBalanceA)
            .add(Web3.utils.toBN(latestThreadState.tokenBalanceA))
        : Web3.utils
            .toBN(subchan.tokenBalanceA)
            .add(Web3.utils.toBN(latestThreadState.tokenBalanceB));

    const subchanTokenBalanceI =
      signer.toLowerCase() === latestThreadState.partyA
        ? Web3.utils
            .toBN(subchan.tokenBalanceI)
            .add(Web3.utils.toBN(latestThreadState.tokenBalanceB))
        : Web3.utils
            .toBN(subchan.tokenBalanceI)
            .add(Web3.utils.toBN(latestThreadState.tokenBalanceA));

    const updateAtoI = {
      channelId: subchan.channelId,
      nonce: subchan.nonce + 1,
      numOpenThread: threadInitialStates.length,
      threadRootHash: newRootHash,
      partyA: signer,
      partyI: this.hubAddress,
      balanceA: {
        weiDeposit: subchanweiBalanceA,
        tokenDeposit: subchanTokenBalanceA
      },
      balanceI: {
        weiDeposit: subchanweiBalanceI,
        tokenDeposit: subchanTokenBalanceI
      },
      hubBond: {
        weiDeposit: Web3.utils
          .toBN(latestThreadState.weiBalanceA)
          .add(Web3.utils.toBN(latestThreadState.weiBalanceB)),
        tokenDeposit: Web3.utils
          .toBN(latestThreadState.tokenBalanceA)
          .add(Web3.utils.toBN(latestThreadState.tokenBalanceB))
      },
      signer
    };
    const sigAtoI = await this.createChannelStateUpdate(updateAtoI);
    return sigAtoI;
  }
}

module.exports = Connext;
