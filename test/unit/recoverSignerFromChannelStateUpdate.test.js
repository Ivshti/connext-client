require('dotenv').config()
const chai = require('chai')
const expect = chai.expect
const Web3 = require('web3')
const fetch = require('fetch-cookie')(require('node-fetch'))

global.fetch = fetch

const Connext = require('../../src/Connext')

// named variables
// on init
const web3 = new Web3('http://localhost:8545')
let client
let ingridAddress
let ingridUrl = 'http://localhost:8080'
let contractAddress = '0xdec16622bfe1f0cdaf6f7f20437d2a040cccb0a1'
let watcherUrl = ''

// for accounts
let accounts
let partyA
let partyB

describe('recoverSignerFromChannelStateUpdateFingerprint()', function () {
  before('init client and accounts', async () => {
    accounts = await web3.eth.getAccounts()
    ingridAddress = accounts[0]
    partyA = accounts[1]
    partyB = accounts[2]
    const authJson = { token: 'SwSNTnh3LlEJg1N9iiifFgOIKq998PGA' }

    // init client instance
    client = new Connext({
      web3,
      ingridAddress,
      watcherUrl,
      ingridUrl,
      contractAddress
    })
  })

  it('should generate a hash of the input data using Web3', async () => {
    let state = {
      channelId: '0x1000000000000000000000000000000000000000000000000000000000000000',
      isClose: false,
      nonce: 0,
      openVcs: 0,
      vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
      partyA,
      partyI: ingridAddress,
      ethBalanceA: Web3.utils.toBN('1000'),
      ethBalanceI: Web3.utils.toBN('0'),
      tokenBalanceA: Web3.utils.toBN('1000'),
      tokenBalanceI: Web3.utils.toBN('0')
    }
    const hash = Connext.createChannelStateUpdateFingerprint(state)
    const sig = await client.web3.eth.sign(hash, partyA)
    state.sig = sig
    console.log('state.sig:', state.sig)
    console.log('sig:', sig)
    const signer = Connext.recoverSignerFromChannelStateUpdate(state)
    expect(signer.toLowerCase()).to.equal(partyA.toLowerCase())
  })

  describe('parameter validation', () => {
    it('should fail if it is missing sig', () => {
      const state = {
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if sig is null', () => {
      const state = {
        sig: null,
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if sig is invalid', () => {
      const state = {
        sig: 'fail',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if it is missing isClose flag', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if isClose flag is null', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: null,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if isClose flag is invalid', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: 'fail',

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if it is missing nonce', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if nonce is null', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: null,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })
    it('should fail if nonce is invalid', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 'fail',
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if no openVcs', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if null openVcs', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: null,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if invalid openVCs', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 'fail',
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if no vcRootHash', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if vcRootHash is null', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: null,
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if vcRootHash is invalid', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: 'fail',
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if no partyA', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if partyA is null', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA: null,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if partyA is invalid', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA: 'fail',
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if partyI doesnt exist', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if partyI is null', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: null,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if partyI is invalid', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: 'fail',
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if ethBalanceA doesnt exist', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if ethBalanceA is null', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: null,
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if ethBalanceA is invalid', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: 'fail',
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if ethBalanceI doesnt exist', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if ethBalanceI is null', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: null,
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if ethBalanceI is invalid', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: 'fail',
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if tokenBalanceA doesnt exist', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if tokenBalanceA is null', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: null,
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if tokenBalanceA is invalid', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: 'fail',
        tokenBalanceI: Web3.utils.toBN('0')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if tokenBalanceI doesnt exist', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000')
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if tokenBalanceI is null', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: null
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })

    it('should fail if tokenBalanceI is invalid', () => {
      const state = {
        sig: '0x0100000000000000000000000000000000000000000000000000000000000000',
        isClose: false,

        nonce: 0,
        openVcs: 0,
        vcRootHash: Connext.generateThreadRootHash({ threadInitialStates: [] }),
        partyA,
        partyI: ingridAddress,
        ethBalanceA: Web3.utils.toBN('1000'),
        ethBalanceI: Web3.utils.toBN('0'),
        tokenBalanceA: Web3.utils.toBN('1000'),
        tokenBalanceI: 'fail'
      }
      try {
        Connext.recoverSignerFromChannelStateUpdate(state)
      } catch (e) {
        expect(e.statusCode).to.equal(200)
      }
    })
  })
})
