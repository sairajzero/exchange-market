'use strict';
/* FLO Blockchain Operator to send/receive data from blockchain using API calls*/
//version 2.2.1
(function(GLOBAL) {
    const floBlockchainAPI = GLOBAL.floBlockchainAPI = {

        util: {
            serverList: floGlobals.apiURL[floGlobals.blockchain].slice(0),
            curPos: floCrypto.randInt(0, floGlobals.apiURL[floGlobals.blockchain].length - 1),
            fetch_retry: function(apicall, rm_flosight) {
                return new Promise((resolve, reject) => {
                    let i = this.serverList.indexOf(rm_flosight)
                    if (i != -1) this.serverList.splice(i, 1);
                    this.curPos = floCrypto.randInt(0, this.serverList.length - 1);
                    this.fetch_api(apicall)
                        .then(result => resolve(result))
                        .catch(error => reject(error));
                })
            },
            fetch_api: function(apicall) {
                return new Promise((resolve, reject) => {
                    if (this.serverList.length === 0)
                        reject("No floSight server working");
                    else {
                        let flosight = this.serverList[this.curPos];
                        fetch(flosight + apicall).then(response => {
                            if (response.ok)
                                response.json().then(data => resolve(data));
                            else {
                                this.fetch_retry(apicall, flosight)
                                    .then(result => resolve(result))
                                    .catch(error => reject(error));
                            }
                        }).catch(error => {
                            this.fetch_retry(apicall, flosight)
                                .then(result => resolve(result))
                                .catch(error => reject(error));
                        })
                    }
                })
            },

            current: function() {
                return this.serverList[this.curPos];
            }
        },

        //Promised function to get data from API
        promisedAPI: function(apicall) {
            return new Promise((resolve, reject) => {
                //console.log(apicall);
                this.util.fetch_api(apicall)
                    .then(result => resolve(result))
                    .catch(error => reject(error));
            });
        },

        //Get balance for the given Address
        getBalance: function(addr) {
            return new Promise((resolve, reject) => {
                this.promisedAPI(`api/addr/${addr}/balance`)
                    .then(balance => resolve(parseFloat(balance)))
                    .catch(error => reject(error));
            });
        },

        //Write Data into blockchain
        writeData: function(senderAddr, data, privKey, receiverAddr = floGlobals.adminID, strict_utxo = true) {
            return new Promise((resolve, reject) => {
                if (typeof data != "string")
                    data = JSON.stringify(data);
                this.sendTx(senderAddr, receiverAddr, floGlobals.sendAmt, privKey, data, strict_utxo)
                    .then(txid => resolve(txid))
                    .catch(error => reject(error));
            });
        },

        //Send Tx to blockchain 
        sendTx: function(senderAddr, receiverAddr, sendAmt, privKey, floData = '', strict_utxo = true) {
            return new Promise((resolve, reject) => {
                if (!floCrypto.validateASCII(floData))
                    return reject("Invalid FLO_Data: only printable ASCII characters are allowed");
                else if (!floCrypto.validateAddr(senderAddr))
                    return reject(`Invalid address : ${senderAddr}`);
                else if (!floCrypto.validateAddr(receiverAddr))
                    return reject(`Invalid address : ${receiverAddr}`);
                else if (privKey.length < 1 || !floCrypto.verifyPrivKey(privKey, senderAddr))
                    return reject("Invalid Private key!");
                else if (typeof sendAmt !== 'number' || sendAmt <= 0)
                    return reject(`Invalid sendAmt : ${sendAmt}`);

                //get unconfirmed tx list
                this.promisedAPI(`api/addr/${senderAddr}`).then(result => {
                    this.readTxs(senderAddr, 0, result.unconfirmedTxApperances).then(result => {
                        let unconfirmedSpent = {};
                        for (let tx of result.items)
                            if (tx.confirmations == 0)
                                for (let vin of tx.vin)
                                    if (vin.addr === senderAddr) {
                                        if (Array.isArray(unconfirmedSpent[vin.txid]))
                                            unconfirmedSpent[vin.txid].push(vin.vout);
                                        else
                                            unconfirmedSpent[vin.txid] = [vin.vout];
                                    }
                        //get utxos list
                        this.promisedAPI(`api/addr/${senderAddr}/utxo`).then(utxos => {
                            //form/construct the transaction data
                            var trx = bitjs.transaction();
                            var utxoAmt = 0.0;
                            var fee = floGlobals.fee;
                            for (var i = utxos.length - 1;
                                (i >= 0) && (utxoAmt < sendAmt + fee); i--) {
                                //use only utxos with confirmations (strict_utxo mode)
                                if (utxos[i].confirmations || !strict_utxo) {
                                    if (utxos[i].txid in unconfirmedSpent && unconfirmedSpent[utxos[i].txid].includes(utxos[i].vout))
                                        continue; //A transaction has already used this utxo, but is unconfirmed.
                                    trx.addinput(utxos[i].txid, utxos[i].vout, utxos[i].scriptPubKey);
                                    utxoAmt += utxos[i].amount;
                                };
                            }
                            if (utxoAmt < sendAmt + fee)
                                reject("Insufficient FLO balance!");
                            else {
                                trx.addoutput(receiverAddr, sendAmt);
                                var change = utxoAmt - sendAmt - fee;
                                if (change > 0)
                                    trx.addoutput(senderAddr, change);
                                trx.addflodata(floData.replace(/\n/g, ' '));
                                var signedTxHash = trx.sign(privKey, 1);
                                this.broadcastTx(signedTxHash)
                                    .then(txid => resolve(txid))
                                    .catch(error => reject(error))
                            }
                        }).catch(error => reject(error))
                    }).catch(error => reject(error))
                }).catch(error => reject(error))
            });
        },

        //merge all UTXOs of a given floID into a single UTXO
        mergeUTXOs: function(floID, privKey, floData = '') {
            return new Promise((resolve, reject) => {
                if (!floCrypto.validateAddr(floID))
                    return reject(`Invalid floID`);
                if (!floCrypto.verifyPrivKey(privKey, floID))
                    return reject("Invalid Private Key");
                if (!floCrypto.validateASCII(floData))
                    return reject("Invalid FLO_Data: only printable ASCII characters are allowed");
                var trx = bitjs.transaction();
                var utxoAmt = 0.0;
                var fee = floGlobals.fee;
                this.promisedAPI(`api/addr/${floID}/utxo`).then(utxos => {
                    for (var i = utxos.length - 1; i >= 0; i--)
                        if (utxos[i].confirmations) {
                            trx.addinput(utxos[i].txid, utxos[i].vout, utxos[i].scriptPubKey);
                            utxoAmt += utxos[i].amount;
                        }
                    trx.addoutput(floID, utxoAmt - fee);
                    trx.addflodata(floData.replace(/\n/g, ' '));
                    var signedTxHash = trx.sign(privKey, 1);
                    this.broadcastTx(signedTxHash)
                        .then(txid => resolve(txid))
                        .catch(error => reject(error))
                }).catch(error => reject(error))
            })
        },

        /**Write data into blockchain from (and/or) to multiple floID
         * @param  {Array} senderPrivKeys List of sender private-keys
         * @param  {string} data FLO data of the txn
         * @param  {Array} receivers List of receivers
         * @param  {boolean} preserveRatio (optional) preserve ratio or equal contribution
         * @return {Promise}
         */
        writeDataMultiple: function(senderPrivKeys, data, receivers = [floGlobals.adminID], preserveRatio = true) {
            return new Promise((resolve, reject) => {
                if (!Array.isArray(senderPrivKeys))
                    return reject("Invalid senderPrivKeys: SenderPrivKeys must be Array");
                if (!preserveRatio) {
                    let tmp = {};
                    let amount = (floGlobals.sendAmt * receivers.length) / senderPrivKeys.length;
                    senderPrivKeys.forEach(key => tmp[key] = amount);
                    senderPrivKeys = tmp;
                }
                if (!Array.isArray(receivers))
                    return reject("Invalid receivers: Receivers must be Array");
                else {
                    let tmp = {};
                    let amount = floGlobals.sendAmt;
                    receivers.forEach(floID => tmp[floID] = amount);
                    receivers = tmp
                }
                if (typeof data != "string")
                    data = JSON.stringify(data);
                this.sendTxMultiple(senderPrivKeys, receivers, data)
                    .then(txid => resolve(txid))
                    .catch(error => reject(error))
            })
        },

        /**Send Tx from (and/or) to multiple floID
         * @param  {Array or Object} senderPrivKeys List of sender private-key (optional: with coins to be sent)
         * @param  {Object} receivers List of receivers with respective amount to be sent
         * @param  {string} floData FLO data of the txn
         * @return {Promise}
         */
        sendTxMultiple: function(senderPrivKeys, receivers, floData = '') {
            return new Promise((resolve, reject) => {
                if (!floCrypto.validateASCII(floData))
                    return reject("Invalid FLO_Data: only printable ASCII characters are allowed");
                let senders = {},
                    preserveRatio;
                //check for argument validations
                try {
                    let invalids = {
                        InvalidSenderPrivKeys: [],
                        InvalidSenderAmountFor: [],
                        InvalidReceiverIDs: [],
                        InvalidReceiveAmountFor: []
                    }
                    let inputVal = 0,
                        outputVal = 0;
                    //Validate sender privatekeys (and send amount if passed)
                    //conversion when only privateKeys are passed (preserveRatio mode)
                    if (Array.isArray(senderPrivKeys)) {
                        senderPrivKeys.forEach(key => {
                            try {
                                if (!key)
                                    invalids.InvalidSenderPrivKeys.push(key);
                                else {
                                    let floID = floCrypto.getFloID(key);
                                    senders[floID] = {
                                        wif: key
                                    }
                                }
                            } catch (error) {
                                invalids.InvalidSenderPrivKeys.push(key)
                            }
                        })
                        preserveRatio = true;
                    }
                    //conversion when privatekeys are passed with send amount
                    else {
                        for (let key in senderPrivKeys) {
                            try {
                                if (!key)
                                    invalids.InvalidSenderPrivKeys.push(key);
                                else {
                                    if (typeof senderPrivKeys[key] !== 'number' || senderPrivKeys[key] <= 0)
                                        invalids.InvalidSenderAmountFor.push(key);
                                    else
                                        inputVal += senderPrivKeys[key];
                                    let floID = floCrypto.getFloID(key);
                                    senders[floID] = {
                                        wif: key,
                                        coins: senderPrivKeys[key]
                                    }
                                }
                            } catch (error) {
                                invalids.InvalidSenderPrivKeys.push(key)
                            }
                        }
                        preserveRatio = false;
                    }
                    //Validate the receiver IDs and receive amount
                    for (let floID in receivers) {
                        if (!floCrypto.validateAddr(floID))
                            invalids.InvalidReceiverIDs.push(floID);
                        if (typeof receivers[floID] !== 'number' || receivers[floID] <= 0)
                            invalids.InvalidReceiveAmountFor.push(floID);
                        else
                            outputVal += receivers[floID];
                    }
                    //Reject if any invalids are found
                    for (let i in invalids)
                        if (!invalids[i].length)
                            delete invalids[i];
                    if (Object.keys(invalids).length)
                        return reject(invalids);
                    //Reject if given inputVal and outputVal are not equal
                    if (!preserveRatio && inputVal != outputVal)
                        return reject(`Input Amount (${inputVal}) not equal to Output Amount (${outputVal})`);
                } catch (error) {
                    return reject(error)
                }
                //Get balance of senders
                let promises = [];
                for (let floID in senders)
                    promises.push(this.getBalance(floID));
                Promise.all(promises).then(results => {
                    let totalBalance = 0,
                        totalFee = floGlobals.fee,
                        balance = {};
                    //Divide fee among sender if not for preserveRatio
                    if (!preserveRatio)
                        var dividedFee = totalFee / Object.keys(senders).length;
                    //Check if balance of each sender is sufficient enough
                    let insufficient = [];
                    for (let floID in senders) {
                        balance[floID] = parseFloat(results.shift());
                        if (isNaN(balance[floID]) || (preserveRatio && balance[floID] <= totalFee) ||
                            (!preserveRatio && balance[floID] < senders[floID].coins + dividedFee))
                            insufficient.push(floID);
                        totalBalance += balance[floID];
                    }
                    if (insufficient.length)
                        return reject({
                            InsufficientBalance: insufficient
                        })
                    //Calculate totalSentAmount and check if totalBalance is sufficient
                    let totalSendAmt = totalFee;
                    for (floID in receivers)
                        totalSendAmt += receivers[floID];
                    if (totalBalance < totalSendAmt)
                        return reject("Insufficient total Balance");
                    //Get the UTXOs of the senders
                    let promises = [];
                    for (floID in senders)
                        promises.push(this.promisedAPI(`api/addr/${floID}/utxo`));
                    Promise.all(promises).then(results => {
                        let wifSeq = [];
                        var trx = bitjs.transaction();
                        for (floID in senders) {
                            let utxos = results.shift();
                            let sendAmt;
                            if (preserveRatio) {
                                let ratio = (balance[floID] / totalBalance);
                                sendAmt = totalSendAmt * ratio;
                            } else
                                sendAmt = senders[floID].coins + dividedFee;
                            let wif = senders[floID].wif;
                            let utxoAmt = 0.0;
                            for (let i = utxos.length - 1;
                                (i >= 0) && (utxoAmt < sendAmt); i--) {
                                if (utxos[i].confirmations) {
                                    trx.addinput(utxos[i].txid, utxos[i].vout, utxos[i].scriptPubKey);
                                    wifSeq.push(wif);
                                    utxoAmt += utxos[i].amount;
                                }
                            }
                            if (utxoAmt < sendAmt)
                                return reject("Insufficient balance:" + floID);
                            let change = (utxoAmt - sendAmt);
                            if (change > 0)
                                trx.addoutput(floID, change);
                        }
                        for (floID in receivers)
                            trx.addoutput(floID, receivers[floID]);
                        trx.addflodata(floData.replace(/\n/g, ' '));
                        for (let i = 0; i < wifSeq.length; i++)
                            trx.signinput(i, wifSeq[i], 1);
                        var signedTxHash = trx.serialize();
                        this.broadcastTx(signedTxHash)
                            .then(txid => resolve(txid))
                            .catch(error => reject(error))
                    }).catch(error => reject(error))
                }).catch(error => reject(error))
            })
        },

        //Broadcast signed Tx in blockchain using API
        broadcastTx: function(signedTxHash) {
            return new Promise((resolve, reject) => {
                if (signedTxHash.length < 1)
                    return reject("Empty Signature");
                var url = this.util.serverList[this.util.curPos] + 'api/tx/send';
                fetch(url, {
                    method: "POST",
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: `{"rawtx":"${signedTxHash}"}`
                }).then(response => {
                    if (response.ok)
                        response.json().then(data => resolve(data.txid.result));
                    else
                        response.text().then(data => resolve(data));
                }).catch(error => reject(error));
            })
        },

        getTx: function(txid) {
            return new Promise((resolve, reject) => {
                this.promisedAPI(`api/tx/${txid}`)
                    .then(response => resolve(response))
                    .catch(error => reject(error))
            })
        },

        //Read Txs of Address between from and to
        readTxs: function(addr, from, to) {
            return new Promise((resolve, reject) => {
                this.promisedAPI(`api/addrs/${addr}/txs?from=${from}&to=${to}`)
                    .then(response => resolve(response))
                    .catch(error => reject(error))
            });
        },

        //Read All Txs of Address (newest first)
        readAllTxs: function(addr) {
            return new Promise((resolve, reject) => {
                this.promisedAPI(`api/addrs/${addr}/txs?from=0&to=1`).then(response => {
                    this.promisedAPI(`api/addrs/${addr}/txs?from=0&to=${response.totalItems}0`)
                        .then(response => resolve(response.items))
                        .catch(error => reject(error));
                }).catch(error => reject(error))
            });
        },

        /*Read flo Data from txs of given Address
        options can be used to filter data
        limit       : maximum number of filtered data (default = 1000, negative  = no limit)
        ignoreOld   : ignore old txs (default = 0)
        sentOnly    : filters only sent data
        receivedOnly: filters only received data
        pattern     : filters data that with JSON pattern
        filter      : custom filter funtion for floData (eg . filter: d => {return d[0] == '$'})
        tx          : (boolean) resolve tx data or not (resolves an Array of Object with tx details)
        sender      : flo-id(s) of sender
        receiver    : flo-id(s) of receiver
        */
        readData: function(addr, options = {}) {
            options.limit = options.limit || 0;
            options.ignoreOld = options.ignoreOld || 0;
            if (typeof options.sender === "string") options.sender = [options.sender];
            if (typeof options.receiver === "string") options.receiver = [options.receiver];
            return new Promise((resolve, reject) => {
                this.promisedAPI(`api/addrs/${addr}/txs?from=0&to=1`).then(response => {
                    var newItems = response.totalItems - options.ignoreOld;
                    this.promisedAPI(`api/addrs/${addr}/txs?from=0&to=${newItems*2}`).then(response => {
                        if (options.limit <= 0)
                            options.limit = response.items.length;
                        var filteredData = [];
                        let numToRead = response.totalItems - options.ignoreOld,
                            unconfirmedCount = 0;
                        for (let i = 0; i < numToRead && filteredData.length < options.limit; i++) {
                            if (!response.items[i].confirmations) { //unconfirmed transactions
                                unconfirmedCount++;
                                numToRead++;
                                continue;
                            }
                            if (options.pattern) {
                                try {
                                    let jsonContent = JSON.parse(response.items[i].floData);
                                    if (!Object.keys(jsonContent).includes(options.pattern))
                                        continue;
                                } catch (error) {
                                    continue;
                                }
                            }
                            if (options.sentOnly) {
                                let flag = false;
                                for (let vin of response.items[i].vin)
                                    if (vin.addr === addr) {
                                        flag = true;
                                        break;
                                    }
                                if (!flag) continue;
                            }
                            if (Array.isArray(options.sender)) {
                                let flag = false;
                                for (let vin of response.items[i].vin)
                                    if (options.sender.includes(vin.addr)) {
                                        flag = true;
                                        break;
                                    }
                                if (!flag) continue;
                            }
                            if (options.receivedOnly) {
                                let flag = false;
                                for (let vout of response.items[i].vout)
                                    if (vout.scriptPubKey.addresses[0] === addr) {
                                        flag = true;
                                        break;
                                    }
                                if (!flag) continue;
                            }
                            if (Array.isArray(options.receiver)) {
                                let flag = false;
                                for (let vout of response.items[i].vout)
                                    if (options.receiver.includes(vout.scriptPubKey.addresses[0])) {
                                        flag = true;
                                        break;
                                    }
                                if (!flag) continue;
                            }
                            if (options.filter && !options.filter(response.items[i].floData))
                                continue;

                            if (options.tx) {
                                let d = {}
                                d.txid = response.items[i].txid;
                                d.time = response.items[i].time;
                                d.blockheight = response.items[i].blockheight;
                                d.data = response.items[i].floData;
                                filteredData.push(d);
                            } else
                                filteredData.push(response.items[i].floData);
                        }
                        resolve({
                            totalTxs: response.totalItems - unconfirmedCount,
                            data: filteredData
                        });
                    }).catch(error => {
                        reject(error);
                    });
                }).catch(error => {
                    reject(error);
                });
            });
        }
    }
})(typeof global !== "undefined" ? global : window);