const { ethers } = require("ethers")
const UNISWAP = require("@uniswap/sdk")
const { Token, WETH, Fetcher, Route, Trade, TokenAmount, TradeType, Percent } = require("@uniswap/sdk");
const { getAddress } = require("ethers/lib/utils");
const {PRIVATE_KEY2} = require('./env.js')
const { UNISWAP_ROUTER_ADDRESS, ETH_TOKEN_ADDRESS, TUSD_TOKEN_ADDRESS, ERC20_ABI, UNISWAP_ROUTER_ABI, NETWORK, PROJECT_ID, ETH_QTY} = require('./constants.js');

const QUICKNODE_HTTP_ENDPOINT = `https://eth-goerli.g.alchemy.com/v2/${PROJECT_ID}`
let provider = new ethers.providers.getDefaultProvider(QUICKNODE_HTTP_ENDPOINT)

const privateKey = PRIVATE_KEY2;
const wallet = new ethers.Wallet(privateKey, provider)

UNISWAP_ROUTER_CONTRACT = new ethers.Contract(UNISWAP_ROUTER_ADDRESS, UNISWAP_ROUTER_ABI, provider)

const TUSD = new Token(
  UNISWAP.ChainId.GÖRLI,
  "0x60450439A3d91958E9Dae0918FC4e0d59a77f896",
  18
);

async function swapTokens(token1, token2, amount, slippage = "2000") {

  try {
    const pair = await Fetcher.fetchPairData(token1, token2, provider);
    const route = await new Route([pair], token2);
    let amountIn = ethers.utils.parseEther(amount.toString());
    amountIn = amountIn.toString()

    const slippageTolerance = new Percent(slippage, "10000");

    const trade = new Trade(
      route,
      new TokenAmount(token2, amountIn),
      TradeType.EXACT_INPUT
    );

    const amountOutMin = trade.minimumAmountOut(slippageTolerance).raw;
    const amountOutMinHex = ethers.BigNumber.from(amountOutMin.toString()).toHexString();
    const path = [token2.address, token1.address];
    const to = wallet.address;
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const value = trade.inputAmount.raw;
    const valueHex = await ethers.BigNumber.from(value.toString()).toHexString();

    const rawTxn = await UNISWAP_ROUTER_CONTRACT.populateTransaction.swapExactETHForTokens(amountOutMinHex, path, to, deadline, {
      value: valueHex,
      // gasLimit: '0x23419' //144409
    })

    let sendTxn = (await wallet).sendTransaction(rawTxn)


    let reciept = (await sendTxn).wait()

    if (reciept) {
      console.log(" - Transaction is mined - " + '\n'
        + "Transaction Hash:", (await sendTxn).hash
        + '\n' + "Block Number: "
        + (await reciept).blockNumber + '\n'
        + "Navigate to https://goerli.etherscan.io/txn/"
      + (await sendTxn).hash, "to see your transaction")
    } else {
      console.log("Error submitting transaction")
    }

  } catch (e) {
    console.log(e)
  }
}

swapTokens(TUSD, WETH[TUSD.chainId], .002) //first argument = token we want, second = token we have, the amount we want

