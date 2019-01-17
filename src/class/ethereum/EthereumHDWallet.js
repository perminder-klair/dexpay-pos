import BigNumber from 'bignumber.js';
import EthereumTx from 'ethereumjs-tx';
import Web3 from 'web3';
import ProviderEngine from 'web3-provider-engine';
import WalletSubprovider from 'web3-provider-engine/subproviders/wallet';
import { erc20Abi } from '../../utils/constants';
import findIndex from 'lodash/findIndex';
import CONF from '../../config';
import isUndefined from 'lodash/isUndefined';
import { defaultTokens } from '../../utils/constants';
import Token from '../Token';
import HDWallet from '../HDWallet';
import {
    ETHEREUM_NETWORK,
} from '../../utils/constants';


const RpcSubprovider = require('web3-provider-engine/subproviders/rpc.js')

/**
 * TODO:
 * [x] Complete HD implementation tests
 * [ ] All the fetch*() should return BigNumber
 * [ ] Check for all the inputs in function
 * 
 * NOTE: Since JS doesn't support multiple inheritance, this implamentation (for now) is duplicated in EthereumWallet
 */

export default class EthereumHDWallet extends HDWallet{
    /**
     * Accepts Valid bip32 passphrase
     * @param  {} secret=''
     */
    constructor(secret = null, address=null) {
        super(secret);
        
        this.type = 'EthereumHDWallet';
        this.name = 'ETH Wallet';
        this.networkName = ETHEREUM_NETWORK;
        this.networkUrl = 'https://mainnet.infura.io/Q1GYXZMXNXfKuURbwBWB';
        this.API_URL = 'https://api.etherscan.io/';
        this.CHAIN_ID = 1;
        this.symbol = 'ETH';
        this.nonce = 0;
        this.address = address;
        this.defaulTokenGasLimitLabel = 22000;
        this.watchOnly = !secret && address ? true : false;
        this.defaultHDpath = CONF.defaultHDpathEthereum;
        this.decimal = 18;
        this.totalBalance = 0;
        this.balance = 0;
        this.tokens = [];
        this.secret = secret;
        this.transactions = [];
        this.usedAddresses = [];

        /**
         * Should we have a pending array?
         */
      
        if( secret ) {
            this.import();
            this.setWeb3();
        }
    }

    getAddress(){
        if( this.watchOnly ) return this.address;
        return this.instanceWallet.getAddressString();
    }

    /**
     * Returns an instanciated web3 object through a web-socket URL
     *
     * @param {string} url Needs to be a WEB SOCKET!
     * @returns {object} an instanciated web3 object
     */
    getWeb3 (url = 'wss://ropsten.infura.io/_ws') {
        return new Web3(new Web3.providers.WebsocketProvider(url))
    }

    /**
     * This method should return a promise
     */
    async sync() {
        await this.loadTokensList(true);
        await this.fetchBalance();
    }

    async setWeb3() {
        const { web3, ethereum } = window

        return new Promise((resolve, reject) => {
            // for modern dapp browsers
            if (ethereum) {
                console.log(ethereum)
                ethereum.enable()
                .then(() => {
                    web3.eth.getAccounts(console.log);
                    this.web3 = new Web3(ethereum)
                    console.log('Siamo enabled')
                    this.web3.eth.getAccounts(console.log);
                    resolve();
                })
                .catch(deniedAccessMessage => {
                    const deniedAccessError = Error(deniedAccessMessage.toString())
                    console.log(deniedAccessError)
                    //deniedAccessError.code = ETHEREUM_ACCESS_DENIED
                    resolve(deniedAccessError);
                })
            // for legacy dapp browsers
            } else if (web3 && web3.currentProvider) {
                this.web3 = new Web3(web3.currentProvider)
                console.log('legacy dapp browsers')
                resolve();
            } else {
                console.log('PORCA PALETTA')
                const engine = new ProviderEngine();
                Web3.providers.HttpProvider.prototype.sendAsync = Web3.providers.HttpProvider.prototype.send
                
                if(!this.watchOnly){
                    engine.addProvider(new WalletSubprovider(this.instanceWallet, {}));
                }
        
                engine.addProvider(
                    new RpcSubprovider({
                        rpcUrl: this.networkUrl
                    }),
                );

                engine.start();
                this.web3 = new Web3(engine);
                this.web3.eth.defaultAccount = this.getAddress();
                resolve();
            }
        });
    }

    async getNetworkID() {
        return new Promise( async (resolve, reject) => {
            this.networkID = await this.web3.eth.net.getId();
            resolve(this.networkID);
        })
    }

    async getNonce() {
        return new Promise((resolve, reject) => {
            try {
                this.web3.eth.getTransactionCount(this.getAddress(), "latest", (error, nonce) => {
                if (error) {
                    reject(error);
                }
                console.log('nonce', nonce)
                this.nonce = nonce;
                resolve(this.nonce);
            });
            } catch (e) {
                reject(e);
            }
        });
    }

    async waitForTx(txHash) {
        return new Promise((resolve, reject) => {
                let checked = 0;
                const handle = setInterval(() => {
                    this.web3.eth.getTransactionReceipt(txHash).then((resp) => {
                        if(resp != null && resp.blockNumber > 0) {
                            clearInterval(handle);
                            console.log('resp', resp)
                            resolve(resp);
                        } else {
                            checked++;
                            console.log('Not mined', checked)

                            if(checked > 50) {
                                clearInterval(handle);
                                reject('Not mined')
                            }
                        }
                    }) 
                }, 5000);
            }
        );
    }

    async checkTokenAllowanceForAddress(benificiay, tokenAddress=null) {
        if( isUndefined(benificiay) || tokenAddress === '' ) throw new Error(`tokenAddress: is undefined`);

        return new Promise( async (resolve, reject) => {
                const token = new this.web3.eth.Contract(erc20Abi, tokenAddress);
                console.log('token', token)
                const allowance = await token.methods.allowance(this.getAddress(), benificiay).call()
                console.log('allowance', allowance)
                resolve(allowance);
            }
        );
    }

    async sendSignedTransaction(signedTx) {
        return new Promise((resolve, reject) => {
            try {
                this.web3.eth.sendSignedTransaction('0x' + signedTx.toString('hex'), (error, tx) => {
                if (error) {
                    console.log('err', error);
                    reject(error);
                }
                console.log('tx', tx)
                resolve(tx);
            });
            } catch (e) {
                reject(e);
            }
        });
    }

    async getGasPrice() {
        return new Promise((resolve, reject) => {
            try {
            this.web3.eth.getGasPrice((error, price) => {
                if (error) {
                    reject(error);
                }
                this.gasPrice = this.web3.utils.fromWei(price.toString(), 'ether');
                resolve(price);
            });
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * return BigNumber
     */
    async fetchBalance() {
        return new Promise((resolve, reject) => {
            this.web3.eth.getBalance(this.getAddress()).then( weiBalance => {
            const balance = this.web3.utils.fromWei(weiBalance, 'ether');
            this.balance = parseFloat(balance);
            resolve(balance);
            }).catch(error => {
                console.log('error', error)
                reject(error)
            })
        });
    }

    /**
     * return Number
     */
    async fetchERC20Balance(contractAddress, decimals = 18) {
        if( isUndefined(contractAddress) || contractAddress === '' ) throw new Error(`contractAddress: is undefined`);

        const idx = this.findTokenIdx(contractAddress);
        const tokenDecimals = this.tokens[idx].decimals;
        return new Promise((resolve, reject) => {
          this.web3.eth
            .contract(erc20Abi)
            .at(contractAddress)
            .balanceOf(this.getAddress(), (error, decimalsBalance) => {
              if (error) {
                console.error(error);
                reject(error);
              }
              const balance = decimalsBalance / Math.pow(10, tokenDecimals);
              this.tokens[idx].balance = balance;
              this.tokens[idx].balanceDecimals = decimalsBalance;

              resolve(balance);
            });
        });
    }

    getERC20Balance(contractAddress) {
        if( isUndefined(contractAddress) || contractAddress === '' ) throw new Error(`contractAddress: is undefined`);

        const idx = this.findTokenIdx(contractAddress);
        return this.tokens[idx].balance;
    }

    findTokenIdx(contractAddress) {
        if( isUndefined(contractAddress) || contractAddress === '' ) throw new Error(`contractAddress: is undefined`);
        let idx = findIndex(this.tokens, function(o) { 
            if(!o.isNative){
                return o.contractAddress.toString().toLowerCase().trim() === contractAddress.toString().toLowerCase().trim(); 
            }
        });
        
        if( idx < 0) {
            // Token does not exist
            this.tokens.push(
                new Token(contractAddress.toString().toLowerCase().trim())
            )
            idx = findIndex(this.tokens, function(o) { 
                if(!o.isNative){
                    return o.contractAddress.toString().toLowerCase().trim() === contractAddress.toString().toLowerCase().trim(); 
                }
            });
        }
        return idx;
    }

    async fetchTransactions() {
        await this.fetchEthTransactions();
        return this.transactions;
    }

    async fetchEthTransactions() {
        let networkUrl = `${this.API_URL}api?module=account&action=txlist&address=${this.getAddress()}&startblock=0&endblock=99999999&sort=desc&apikey=YourApiKeyToken`;
        return fetch(networkUrl)
          .then(response => response.json())
          .then(res => res.result)
          .then(transactions => {
            this._lastPolling = (new Date()).getTime();
            this.transactions = transactions.filter( o => o.value !== '0').map(t => ({
              from: t.from,
              timestamp: t.timeStamp,
              transactionHash: t.hash,
              type: t.type,
              value: parseFloat(this.web3.utils.fromWei(t.value, 'ether')).toFixed(5),
            }));
            return this.transactions;
          }).catch(e => console.log(e));
    }

    getERC20Transactions(contractAddress) {
        if( isUndefined(contractAddress) || contractAddress === '' ) throw new Error(`contractAddress: is undefined`);

        const idx = this.findTokenIdx(contractAddress);
        return this.tokens[idx].transactions;
    }

    async fetchERC20Transactions(contractAddress) {
        if( isUndefined(contractAddress) || contractAddress === '' ) throw new Error(`contractAddress: is undefined`);
        const url = `https://blockscout.com/eth/mainnet/api?module=account&action=tokentx&address=${this.getAddress()}&contractaddress=${contractAddress}&sort=desc`;
        return fetch(url)
          .then(response => response.json())
          .then(data => {
            const idx = findIndex(this.tokens, ['contractAddress', contractAddress]);
            this.tokens[idx]._lastPolling = (new Date()).getTime(); 
            this.tokens[idx].transactions = (data.result || []).map(t => {
              return {
                from: t.from,
                timestamp: t.timestamp,
                transactionHash: t.hash,
                symbol: t.tokenSymbol,
                type: 'transfer',
                value: (
                  parseInt(t.value, 10) / Math.pow(10, t.tokenDecimal)
                ).toFixed(2),
              };
            });
        });
    }
    
    // TODO tests
    async loadTokensList(pruneCache=false) {
        if( this.tokens.length > 0 && pruneCache === false ) return this.tokens;

        //const url = `https://blockscout.com/eth/mainnet/api?module=account&action=tokenlist&address=${this.getAddress()}`;
        return fetch(`https://api.ethplorer.io/getAddressInfo/${this.getAddress()}?apiKey=freekey`)
            .then(response => response.json())
            .then(data => {
                if (!data.tokens) {
                    return;
                }
                const tokens = data.tokens.map(token => {
                    const tokenDecimal = parseInt(token.tokenInfo.decimals, 10);
                    const balance = parseFloat(new BigNumber(token.balance).div(new BigNumber(10).pow( tokenDecimal )).toString());

                    //console.log(`${token.tokenInfo.symbol}: ${balance}`)
                    
                    return new Token(
                        token.tokenInfo.address,
                        tokenDecimal,
                        token.tokenInfo.name,
                        token.tokenInfo.symbol,
                        `https://raw.githubusercontent.com/TrustWallet/tokens/master/images/${token.tokenInfo.address}.png`,
                        token.tokenInfo.price,
                        balance,
                        new BigNumber(token.balance)
                    )
                });

                const coin = defaultTokens[0];
                coin.balance = this.balance;
                this.tokens = tokens;
                return this.tokens;
            });
    }

    // TODO tests
    /**
     * Send an ETH transaction to the given address with the given amount
     *
     * @param {String} toAddress
     * @param {String} amount
     */
    sendTransaction(
        { contractAddress, decimals, isNative },
        toAddress,
        amount,
        gasLimit = 21000, 
        gasPrice = 21
      ) {
        
        if ( isNative ) {
          return this.sendCoinTransaction(toAddress, amount, gasLimit, gasPrice);
        }
    
        return this.sendERC20Transaction(
          contractAddress,
          decimals,
          toAddress,
          amount,
          gasLimit
        );
      }
    

    // TODO tests
    /**
     * Send an ETH transaction to the given address with the given amount
     *
     * @param {String} toAddress
     * @param {String} amount
     */
    async sendCoinTransaction(toAddress, amount) {
        return new Promise((resolve, reject) => {
            this.web3.eth.sendTransaction(
                {
                    to: toAddress,
                    value: this.web3.utils.toWei(amount.toString()),
                }, 
                (error, transaction) => {
                    if (error) {
                        reject(error);
                    }

                    this._lastPolling = null;
                    this.transactions.push(transaction);
                    resolve(transaction);
                },
            );
        });
    }

    // TODO tests
    /**
     * Send an ETH erc20 transaction to the given address with the given amount
     *
     * @param {String} toAddress
     * @param {String} amount
     */
    async sendERC20Transaction(contractAddress, decimals, toAddress, amount, gasLimit) {
        console.log('gasLimit', gasLimit)
        return new Promise((resolve, reject) => {
            const token = new this.web3.eth.Contract(erc20Abi, contractAddress);
            
            token
                .methods
                .transfer(toAddress, amount * Math.pow(10, decimals))
                .send({from: this.getAddress(), gasLimit: gasLimit}, (error, transaction) => {
                        if (error) {
                            reject(error);
                        }

                        resolve(transaction);
                    }
                );
            }
        );
    }

    async estimateERC20Transaction({ contractAddress, isNative, decimals }, toAddress, amount) {
        return new Promise( async (resolve, reject) => {

            console.log('estimateERC20Transaction', [
                contractAddress,
                isNative,
                decimals,
                toAddress
            ])
            if ( isNative ) {
                resolve(21000);
                return;
            }

            const token = new this.web3.eth.Contract(erc20Abi, contractAddress);
            
            const gas = await token
                                .methods
                                .transfer(toAddress, amount * Math.pow(10, decimals))
                                .estimateGas({
                                    from: this.getAddress()
                                })

            console.log('gas', gas);
            resolve(gas);
            }
        );
    }

    /**
     * Sign raw Transaction
     *
     * @param {String} toAddress
     * @param {String} amount
     */
    signRawTx(txData) {
        const tx = new EthereumTx(txData);
        const privateKeyHex = new Buffer(this.getPrivateKey(), 'hex');
        tx.sign( privateKeyHex );
        return tx.serialize();
    }
}