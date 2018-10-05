import BN from "bn.js";

export = Connext;

declare class Connext {
  constructor(opts: Connext.ConnextOptions);

  openChannel(initialDeposit: Connext.BalanceOptions): Promise<any>;

  deposit(amount: Connext.BalanceOptions): Promise<any>;

  closeChannel(): Promise<any>;

  withdraw(): Promise<any>;

  openThread(opts: Connext.OpenThreadOptions): Promise<any>;

  joinThread(channelId: string): Promise<any>;

  updateChannel(opts: Connext.UpdateChannelOptions): Promise<any>;

  updateThread(opts: Connext.UpdateThreadOptions): Promise<any>;

  cosignBalanceUpdate(
    opts: Connext.CosignBalanceUpdateOptions
  ): Promise<string>;

  closeThread(threadId: string): Promise<any>;

  closeThreads(threadIds: string[]): Promise<any>;

  static createChannelStateUpdateFingerprint(
    opts: Connext.FingerprintChannelUpdate
  ): string;

  static recoverSignerFromChannelStateUpdate(
    opts: Connext.RecoverChannelUpdate
  ): string;

  static createThreadStateUpdateFingerprint(
    opts: Connext.FingerprintThreadUpdate
  ): string;

  static recoverSignerFromThreadStateUpdate(
    opts: Connext.RecoverThreadUpdate
  ): string;

  static generateThreadRootHash(
    threadInitialStates: Connext.ThreadInitialStates
  ): string;

  static generateMerkleTree(
    threadInitialStates: Connext.FingerprintThreadUpdate[]
  ): string;
}

declare namespace Connext {
  export interface ConnextOptions {
    web3: any;
    hubAddress: string;
    watcherUrl: string;
    hubUrl: string;
    contractAddress: string;
  }

  export interface BalanceOptions {
    tokenDeposit: BN;
    ethDeposit: BN;
  }

  export interface OpenThreadOptions {
    to: string;
    deposit: BalanceOptions;
  }

  export interface UpdateChannelOptions {
    channelId: string;
    balanceA: BalanceOptions;
    balanceB: BalanceOptions;
  }

  export interface UpdateThreadOptions {
    threadId: string;
    balanceA: BalanceOptions;
    balanceB: BalanceOptions;
  }

  export interface CosignBalanceUpdateOptions {
    channelId: string;
    nonce: BalanceOptions;
  }

  export interface FingerprintChannelUpdate {
    isClose: boolean;
    channelId: string;
    nonce: number;
    numOpenThread: number;
    threadRootHash: string;
    partyA: string;
    partyI: string;
    weiBalanceA: BN;
    weiBalanceI: BN;
    tokenBalanceA: BN;
    tokenBalanceI: BN;
  }

  export interface RecoverChannelUpdate extends FingerprintChannelUpdate {
    sig: string;
  }

  export interface FingerprintThreadUpdate {
    channelId: string;
    nonce: number;
    partyA: string;
    partyB: string;
    weiBalanceA: BN;
    weiBalanceB: BN;
    tokenBalanceA: BN;
    tokenBalanceB: BN;
    weiBond: BN;
    tokenBond: BN;
  }

  export interface RecoverThreadUpdate extends FingerprintThreadUpdate {
    sig: string;
  }

  export interface ThreadInitialStates {
    threadInitialStates: FingerprintThreadUpdate[];
  }

  export interface Channel {
    channelId: string;
  }
}
