//console.log(document.cookie.toString());

function ResponseError(status, data) {
    if (this instanceof ResponseError) {
        this.data = data;
        this.status = status;
    } else
        return new ResponseError(status, data);
}

function responseParse(response, json_ = true) {
    return new Promise((resolve, reject) => {
        if (!response.ok)
            response.text()
            .then(result => reject(ResponseError(response.status, result)))
            .catch(error => reject(error));
        else if (json_)
            response.json()
            .then(result => resolve(result))
            .catch(error => reject(error));
        else
            response.text()
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
}

function getAccount() {
    return new Promise((resolve, reject) => {
        fetch('/account')
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}

function getBuyList() {
    return new Promise((resolve, reject) => {
        fetch('/list-buyorders')
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}

function getSellList() {
    return new Promise((resolve, reject) => {
        fetch('/list-sellorders')
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}

function getTransactionList() {
    return new Promise((resolve, reject) => {
        fetch('/list-transactions')
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}

function signUp(privKey, sid) {
    return new Promise((resolve, reject) => {
        let pubKey = floCrypto.getPubKeyHex(privKey);
        let floID = floCrypto.getFloID(pubKey);
        let sign = floCrypto.signData(sid, privKey);
        console.log(privKey, pubKey, floID, sid)
        fetch("/signup", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    floID,
                    pubKey,
                    sign
                })
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    })

}

function login(privKey, sid, rememberMe = false) {
    return new Promise((resolve, reject) => {
        let pubKey = floCrypto.getPubKeyHex(privKey);
        let floID = floCrypto.getFloID(pubKey);
        if (!floID || !floCrypto.verifyPrivKey(privKey, floID))
            return reject("Invalid Private key");
        let sign = floCrypto.signData(sid, privKey);
        fetch("/login", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    floID,
                    sign,
                    saveSession: rememberMe
                })
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    })
}

function logout() {
    return new Promise((resolve, reject) => {
        fetch("/logout")
            .then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error))
    })
}

function buy(quantity, max_price) {
    return new Promise((resolve, reject) => {
        if (typeof quantity !== "number" || quantity <= 0)
            return reject(`Invalid quantity (${quantity})`);
        else if (typeof max_price !== "number" || max_price <= 0)
            return reject(`Invalid max_price (${max_price})`);
        fetch('/buy', {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    quantity,
                    max_price
                })
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error))
    })

}

function sell(quantity, min_price) {
    return new Promise((resolve, reject) => {
        if (typeof quantity !== "number" || quantity <= 0)
            return reject(`Invalid quantity (${quantity})`);
        else if (typeof min_price !== "number" || min_price <= 0)
            return reject(`Invalid min_price (${min_price})`);
        fetch('/sell', {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    quantity,
                    min_price
                })
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error))
    })

}

function cancelOrder(type, id) {
    return new Promise((resolve, reject) => {
        if (type !== "buy" && type !== "sell")
            return reject(`Invalid type (${type}): type should be sell (or) buy`);
        fetch('/cancel', {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    orderType: type,
                    orderID: id
                })
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error))
    })
}