require("dotenv").config();
const chai = require("chai");
const expect = chai.expect;
const Web3 = require("web3");
const fetch = require("fetch-cookie")(require("node-fetch"));
const interval = require("interval-promise");
const Connext = require("../src/Connext");

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

global.fetch = fetch;

// named variables
// on init
const web3 = new Web3(process.env.ETH_NODE_URL);
let client;
let hubAddress;
let hubUrl = process.env.HUB_URL;
let contractAddress = process.env.CONTRACT_ADDRESS;

// for accounts
let partyA, partyB;

// for initial ledger channel states
let subchanAI, subchanBI; // channel ids
let chanA, chanB; // channel objects

let threadIdA; // thread Ids
let threadA; // thread objects

// for interrupted testing
subchanAI =
  "0x1eb482101155b3a9de17ff8a97c5b2b296e8527b77d5689db4535af1d849ae60";
subchanBI =
  "0x5ed05cf4d8c605358f8bd83fa4028b2ccb9c14b5a48a4c0c4971dbd2eebf4631";
// threadIdA =
//   "0x44c2defb7ed4907d302e7aea9221abd153df82efeed00857237774b0db115165";

describe("Connext happy case testing on testnet hub", () => {
  before("init the client", async () => {
    const accounts = await web3.eth.getAccounts();
    hubAddress = accounts[0];
    partyA = accounts[1];
    partyB = accounts[2];

    client = new Connext({
      web3,
      hubAddress,
      hubUrl,
      contractAddress
    });
  });

  describe.skip("openChannel", () => {
    const initialDeposits = {
      weiDeposit: Web3.utils.toBN(Web3.utils.toWei("6", "ether"))
    };

    const challenge = 3600;

    it("should open a channel between partyA and the hub", async () => {
      subchanAI = await client.openChannel({
        initialDeposits,
        challenge,
        sender: partyA
      });
      // ensure lc is in the database
      await interval(async (iterationNumber, stop) => {
        chanA = await client.getChannelById(subchanAI);
        if (chanA != null) {
          stop();
        }
      }, 2000);
      expect(chanA.channelId).to.be.equal(subchanAI);
      expect(chanA.state).to.be.equal(CHANNEL_STATES.CHANNEL_OPENED);
    }).timeout(45000);

    it("partyA should have initialDeposit in channel", async () => {
      const weiBalanceA = Web3.utils.toBN(chanA.weiBalanceA);
      expect(weiBalanceA.eq(initialDeposits.weiDeposit)).to.equal(true);
    });

    it("hub should have 0 balance in channel", async () => {
      const weiBalanceI = Web3.utils.toBN(chanA.weiBalanceI);
      expect(weiBalanceI.eq(Web3.utils.toBN("0"))).to.equal(true);
    });

    it("should open a channel between partyB and the hub", async () => {
      const initialDeposits = {
        weiDeposit: Web3.utils.toBN(Web3.utils.toWei("0", "ether"))
      };
      subchanBI = await client.openChannel({
        initialDeposits,
        challenge,
        sender: partyB
      });
      // ensure lc is in the database
      await interval(async (iterationNumber, stop) => {
        chanB = await client.getChannelById(subchanBI);
        if (chanB != null) {
          stop();
        }
      }, 2000);
      expect(chanB.channelId).to.be.equal(subchanBI);
      expect(chanB.state).to.be.equal(CHANNEL_STATES.CHANNEL_OPENED);
    }).timeout(45000);

    it("partyB should have 0 in channel", async () => {
      const weiBalanceA = Web3.utils.toBN(chanB.weiBalanceA);
      expect(weiBalanceA.eq(Web3.utils.toBN("0"))).to.equal(true);
    });

    it("hub should have 0 balance in channel", async () => {
      const weiBalanceI = Web3.utils.toBN(chanB.weiBalanceI);
      expect(weiBalanceI.eq(Web3.utils.toBN("0"))).to.equal(true);
    });
  });

  describe.skip("requestJoinChannel", () => {
    let hubDeposit;
    it("should request that the hub join channel A", async () => {
      hubDeposit = {
        weiDeposit: Web3.utils.toBN("0"),
        tokenDeposit: Web3.utils.toBN("0")
      };
      const response = await client.requestJoinChannel({
        hubDeposit,
        channelId: subchanAI
      });
      expect(response).to.exist;
    });

    it("should wait for the hub to join channel A", async () => {
      // ensure channel is in the database
      await interval(async (iterationNumber, stop) => {
        chanA = await client.getChannelById(subchanAI);
        if (
          chanA.status !== Object.keys(CHANNEL_STATES)[CHANNEL_STATES.OPENED]
        ) {
          stop();
        }
      }, 2000);
      expect(chanA.status).to.be.equal(
        Object.keys(CHANNEL_STATES)[CHANNEL_STATES.JOINED]
      );
      expect(
        Web3.utils.toBN(chanA.weiBalanceI).eq(hubDeposit.weiDeposit)
      ).to.equal(true);
    }).timeout(6000);

    it("should request that the hub join channel B", async () => {
      hubDeposit = {
        weiDeposit: Web3.utils.toBN(Web3.utils.toWei("5", "ether")),
        tokenDeposit: Web3.utils.toBN("0")
      };
      // const response = await client.requestJoinChannel({
      //   hubDeposit,
      //   channelId: subchanBI
      // })
      // expect(response).to.exist

      // CALL DIRECTLY ON CONTRACT WHILE HUB DOWN
      // ChannelManager.deployed().then(i => i.joinChannel( '0x5ed05cf4d8c605358f8bd83fa4028b2ccb9c14b5a48a4c0c4971dbd2eebf4631' , ['5000000000000000000', '0'], { from: '0x58E95845A3C2740f4B1B4C639A75aDA64Ef0b72F', value: '5000000000000000000' }))

      const {
        transactionHash,
        status
      } = await client.channelManagerInstance.methods
        .joinChannel(subchanBI, [
          hubDeposit.weiDeposit.toString(),
          hubDeposit.tokenDeposit.toString()
        ])
        .send({ from: hubAddress, value: hubDeposit.weiDeposit.toString() });
      console.log("joinChannel txHash:", transactionHash);
      expect(transactionHash).to.exist;
      expect(status).to.equal(true);
    });

    it("should wait for the hub to join channel B", async () => {
      // ensure channel is in the database
      await interval(async (iterationNumber, stop) => {
        chanB = await client.getChannelById(subchanBI);
        if (
          chanB.status !== Object.keys(CHANNEL_STATES)[CHANNEL_STATES.OPENED]
        ) {
          stop();
        }
      }, 2000);
      expect(chanB.status).to.be.equal(
        Object.keys(CHANNEL_STATES)[CHANNEL_STATES.JOINED]
      );
      expect(
        Web3.utils.toBN(chanB.weiBalanceI).eq(hubDeposit.weiDeposit)
      ).to.equal(true);
    }).timeout(6000);
  });

  describe.skip("updateChannel", () => {
    it("should send an ETH balance update from client to hub", async () => {
      const balanceA = {
        weiDeposit: Web3.utils.toBN(Web3.utils.toWei("5", "ether"))
      };
      const balanceB = {
        weiDeposit: Web3.utils.toBN(Web3.utils.toWei("1", "ether"))
      };

      chanA = await client.getChannelById(subchanAI);

      // partyA should be optional sender param that is default null
      const response = await client.updateChannel({
        channelId: subchanAI,
        balanceA,
        balanceB,
        sender: partyA
      });
      chanA = await client.getChannelById(subchanAI);
      expect(
        Web3.utils.toBN(chanA.weiBalanceA).eq(balanceA.weiDeposit)
      ).to.equal(true);
      expect(
        Web3.utils.toBN(chanA.weiBalanceI).eq(balanceB.weiDeposit)
      ).to.equal(true);
      expect(chanA.nonce).to.equal(1);
    });
  });

  describe.skip("openThread", () => {
    const initialDeposit = {
      weiDeposit: Web3.utils.toBN(Web3.utils.toWei("1", "ether"))
    };
    it("should open a thread between partyA and partyB", async () => {
      chanB = await client.getChannelById(subchanBI);
      chanA = await client.getChannelById(subchanAI);
      threadIdA = await client.openThread({
        to: partyB,
        sender: partyA,
        deposit: initialDeposit
      });
      threadA = await client.getThreadById(threadIdA);
      console.log(threadA);
      expect(threadA.threadId).to.equal(threadIdA);
      expect(THREAD_STATES[threadA.status]).to.equal(THREAD_STATES.OPENED);
      expect(
        Web3.utils.toBN(threadA.weiBalanceA).eq(initialDeposit.weiDeposit)
      ).to.equal(true);
      expect(
        Web3.utils.toBN(threadA.weiBalanceB).eq(Web3.utils.toBN("0"))
      ).to.equal(true);
    });

    it("should decrease partyA channel balance by thread balanceA", async () => {
      const prevBal = Web3.utils.toBN(chanA.weiBalanceA);
      const expectedBal = prevBal.sub(Web3.utils.toBN(threadA.weiBalanceA));
      chanA = await client.getChannelById(subchanAI);
      expect(expectedBal.eq(Web3.utils.toBN(chanA.weiBalanceA))).to.equal(true);
    });

    it("should decrease partyI channelB balance by thread balanceA", async () => {
      const prevBal = Web3.utils.toBN(chanB.weiBalanceI);
      const expectedBal = prevBal.sub(Web3.utils.toBN(threadA.weiBalanceA));
      chanB = await client.getChannelById(subchanBI);
      expect(expectedBal.eq(Web3.utils.toBN(chanB.weiBalanceI))).to.equal(true);
    });
  });

  describe.skip("updateThread", () => {
    // DON'T HAVE THESE CLIENT METHODS YET
    it("should send a state update from partyA to partyB", async () => {
      // ideally, would take a payment object of the following form
      const balDiff = Web3.utils.toBN(Web3.utils.toWei("0.1", "ether"));
      threadA = await client.getThreadById(threadIdA);
      const expectedNonce = threadA.nonce + 1;
      const balanceA = {
        weiDeposit: Web3.utils.toBN(threadA.weiBalanceA).sub(balDiff)
      };
      const balanceB = {
        weiDeposit: Web3.utils.toBN(threadA.weiBalanceB).add(balDiff)
      };

      // partyA should be optional sender param that is default null
      const response = await client.updateThread({
        threadId: threadIdA,
        balanceA,
        balanceB,
        sender: partyA
      });
      threadA = await client.getThreadById(threadIdA);
      expect(
        Web3.utils.toBN(threadA.weiBalanceA).eq(balanceA.weiDeposit)
      ).to.equal(true);
      expect(
        Web3.utils.toBN(threadA.weiBalanceB).eq(balanceB.weiDeposit)
      ).to.equal(true);
      expect(threadA.nonce).to.equal(expectedNonce);
    });

    it("partyA should properly sign the proposed update", async () => {
      const state = await client.getLatestThreadState(threadIdA);
      const weiBalanceA = Web3.utils.toBN(state.weiBalanceA);
      const weiBalanceB = Web3.utils.toBN(state.weiBalanceB);
      const tokenBalanceA = Web3.utils.toBN(state.tokenBalanceA);
      const tokenBalanceB = Web3.utils.toBN(state.tokenBalanceB);
      const signer = Connext.recoverSignerFromThreadStateUpdate({
        sig: state.sigA,
        channelId: threadIdA,
        nonce: state.nonce,
        partyA: partyA,
        partyB: partyB,
        weiBalanceA,
        weiBalanceB,
        tokenBalanceA,
        tokenBalanceB,
        weiBond: weiBalanceB.add(weiBalanceA),
        tokenBond: tokenBalanceA.add(tokenBalanceB)
      });
      expect(signer.toLowerCase()).to.equal(partyA.toLowerCase());
    });

    it("should be able to send multiple simultaneous updates from partyA to partyB", async () => {
      const balDiff = Web3.utils.toBN(Web3.utils.toWei("0.1", "ether"));
      threadA = await client.getThreadById(threadIdA);
      let balanceA = {
        weiDeposit: Web3.utils.toBN(threadA.weiBalanceA)
      };
      let balanceB = {
        weiDeposit: Web3.utils.toBN(threadA.weiBalanceB)
      };
      for (let i = 0; i < 3; i++) {
        balanceA.weiDeposit = balanceA.weiDeposit.sub(balDiff);
        balanceB.weiDeposit = balanceB.weiDeposit.add(balDiff);
        await client.updateThread({
          balanceA,
          balanceB,
          threadId: threadIdA,
          sender: partyA
        });
      }
      threadA = await client.getThreadById(threadIdA);
      expect(
        balanceA.weiDeposit.eq(Web3.utils.toBN(threadA.weiBalanceA))
      ).to.equal(true);
      expect(
        balanceB.weiDeposit.eq(Web3.utils.toBN(threadA.weiBalanceB))
      ).to.equal(true);
    });
  });

  describe.skip("closeThread", () => {
    it("should close the thread between A and B", async () => {
      threadA = await client.getThreadByParties({ partyA, partyB });
      // const response = await client.closeThread(threadA.threadId, partyA);
      // get threadA
      threadA = await client.getThreadById(threadA.threadId);
      expect(THREAD_STATES[threadA.status]).to.equal(THREAD_STATES.SETTLED);
    });

    it("should increase partyA channel balance by remainder of thread balanceA", async () => {
      // get objs
      chanA = await client.getChannelByPartyA(partyA);
      // calculate expected balance
      let prevState = await client.getChannelStateByNonce({
        channelId: chanA.channelId,
        nonce: chanA.nonce - 1
      });
      const expectedBalA = Web3.utils
        .toBN(prevState.weiBalanceA)
        .add(Web3.utils.toBN(threadA.weiBalanceA));
      expect(expectedBalA.eq(Web3.utils.toBN(chanA.weiBalanceA))).to.equal(
        true
      );
    });

    it("should increase partyB channel by remainder of thread balanceB", async () => {
      // get objs
      chanB = await client.getChannelByPartyA(partyB);
      // calculate expected balance
      let prevState = await client.getChannelStateByNonce({
        channelId: subchanBI,
        nonce: chanB.nonce - 1
      });
      const expectedBalA = Web3.utils
        .toBN(prevState.weiBalanceA)
        .add(Web3.utils.toBN(threadA.weiBalanceB));
      expect(expectedBalA.eq(Web3.utils.toBN(chanB.weiBalanceA))).to.equal(
        true
      );
    });

    it("should increase hub channelA balance by remainder of thread balanceB", async () => {
      // calculate expected balance
      let prevState = await client.getChannelStateByNonce({
        channelId: chanA.channelId,
        nonce: chanA.nonce - 1
      });
      const expectedBalI = Web3.utils
        .toBN(prevState.weiBalanceI)
        .add(Web3.utils.toBN(threadA.weiBalanceB));
      expect(expectedBalI.eq(Web3.utils.toBN(chanA.weiBalanceI))).to.equal(
        true
      );
    });

    it("should increase hub channelB balance by remainder of thread balanceA", async () => {
      let prevState = await client.getChannelStateByNonce({
        channelId: subchanBI,
        nonce: chanB.nonce - 1
      });
      const expectedBalI = Web3.utils
        .toBN(prevState.weiBalanceI)
        .add(Web3.utils.toBN(threadA.weiBalanceA));
      expect(expectedBalI.eq(Web3.utils.toBN(chanB.weiBalanceI))).to.equal(
        true
      );
    });
  });

  describe("closeChannel", () => {
    let prevBalA, finalBalA, prevBalI, finalBalI;

    it("should close the channel between partyA and the hub", async () => {
      prevBalA = await client.web3.eth.getBalance(partyA);
      prevBalI = await client.web3.eth.getBalance(hubAddress);
      // send tx
      const response = await client.closeChannel(partyA);
      const tx = await client.web3.eth.getTransaction(response);
      expect(tx.to.toLowerCase()).to.equal(contractAddress);
      expect(tx.from.toLowerCase()).to.equal(partyA.toLowerCase());
    }).timeout(8000);

    it("should increase partyA wallet balance by channel balanceA", async () => {
      chanA = await client.getChannelByPartyA(partyA);
      const expected = Web3.utils.fromWei(
        Web3.utils.toBN(chanA.weiBalanceA).add(Web3.utils.toBN(prevBalA)),
        "ether"
      );
      finalBalA = Web3.utils.fromWei(
        await client.web3.eth.getBalance(partyA),
        "ether"
      );
      expect(Math.round(expected)).to.equal(Math.round(finalBalA));
    });

    it("should increase hub wallet balance by channel balanceI", async () => {
      const expected = Web3.utils.fromWei(
        Web3.utils.toBN(chanA.weiBalanceI).add(Web3.utils.toBN(prevBalI)),
        "ether"
      );
      finalBalI = Web3.utils.fromWei(
        await client.web3.eth.getBalance(hubAddress),
        "ether"
      );
      expect(Math.round(expected)).to.equal(Math.round(finalBalI));
    });

    it("should close the channel between partyB and the hub", async () => {
      prevBalA = await client.web3.eth.getBalance(partyA);
      prevBalI = await client.web3.eth.getBalance(hubAddress);
      // send tx
      const response = await client.closeChannel(partyA);
      const tx = await client.web3.eth.getTransaction(response);
      expect(tx.to.toLowerCase()).to.equal(contractAddress);
      expect(tx.from.toLowerCase()).to.equal(partyA.toLowerCase());
    });

    it("should increase partyA wallet balance by channel balanceA", async () => {
      chanB = await client.getChannelByPartyA(partyB);
      const expected = Web3.utils.fromWei(
        Web3.utils.toBN(chanB.weiBalanceA).add(Web3.utils.toBN(prevBalA)),
        "ether"
      );
      finalBalA = Web3.utils.fromWei(
        await client.web3.eth.getBalance(partyB),
        "ether"
      );
      expect(Math.round(expected)).to.equal(Math.round(finalBalA));
    });

    it("should increase hub wallet balance by channel balanceB", async () => {
      const expected = Web3.utils.fromWei(
        Web3.utils.toBN(chanB.weiBalanceI).add(Web3.utils.toBN(prevBalI)),
        "ether"
      );
      finalBalI = Web3.utils.fromWei(
        await client.web3.eth.getBalance(hubAddress),
        "ether"
      );
      expect(Math.round(expected)).to.equal(Math.round(finalBalI));
    });
  });
});
