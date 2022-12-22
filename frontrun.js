var Web3 = require('web3');
var fetch = require('node-fetch');
var Tx = require('ethereumjs-tx').Transaction;

const { UNISWAP_ROUTER_ADDRESS, ETH_TOKEN_ADDRESS, TUSD_TOKEN_ADDRESS, ERC20_ABI, UNISWAP_ROUTER_ABI, NETWORK, PROJECT_ID, ETH_QTY} = require('./constants.js');
const {USER_ACCOUNT, PRIVATE_KEY1} = require('./env.js')
const { ethers } = require("ethers")
const UNISWAP = require("@uniswap/sdk")
const { Token, WETH, Fetcher, Route, Trade, TokenAmount, TradeType, Percent } = require("@uniswap/sdk");

const NETWORK_URL = `https://${NETWORK}.g.alchemy.com/v2/${PROJECT_ID}`
const web3 = new Web3(new Web3.providers.HttpProvider(NETWORK_URL));
let provider = new ethers.providers.getDefaultProvider(NETWORK_URL)

// 获取 uniswap 合约实例
UNISWAP_ROUTER_CONTRACT = new ethers.Contract(UNISWAP_ROUTER_ADDRESS, UNISWAP_ROUTER_ABI, provider)
// 获取 TUSD 合约实例
ERC20_CONTRACT = new ethers.Contract(TUSD_TOKEN_ADDRESS, ERC20_ABI, provider)

// 函数选择器
const swapExactTokensForETH = '0x18cbafe5';
const swapExactETHForTokens = '0x7ff36ab5';
const ETH_DECIMALS = 18;
const TUSD_DECIMALS = 18;
// 想买的 TUSD
const TUSD_QTY = 1;
// 想卖的 ETH
const ETH_QTY_WEI = ETH_QTY * 10 ** ETH_DECIMALS;
// 触发抢跑运行攻击的阈值
const THRESHOLD = 1;
// Gas price
const GAS_PRICE = 'medium';
// one gwei
// 需要增加的gasPrice
const ONE_GWEI = 1e9;
// max gas price
const MAX_GAS_PRICE = 50000000000;

const wallet = new ethers.Wallet(PRIVATE_KEY1, provider)

// 标识抢跑是否成功
var succeed = false;

var subscription;

async function main() {
  // 获得交易以前的代币余额
  let tokenBalanceBefore = await getTokenBalance(TUSD_TOKEN_ADDRESS);
  // 监控待处理交易
  const web3Ws = new Web3(new Web3.providers.WebsocketProvider(`wss://${NETWORK}.g.alchemy.com/v2/${PROJECT_ID}`));
  subscription = web3Ws.eth.subscribe('pendingTransactions', function (error, result) {
  }).on("data", async function (transactionHash) {
    let transaction = await web3.eth.getTransaction(transactionHash);
    // 过滤和进行抢跑
    await handleTransaction(transaction);

    if (succeed) {
      console.log('\n' + "Front-running attack succeed.");
      // 出售 token
      let tokenBalanceAfter = await getTokenBalance(TUSD_TOKEN_ADDRESS);
      let srcAmount = (tokenBalanceAfter - tokenBalanceBefore) / (10 ** TUSD_DECIMALS);
      console.log("Get " + srcAmount + " Tokens." + '\n');
      console.log("Begin selling the tokens.");
      await performTrade(TUSD_TOKEN_ADDRESS, ETH_TOKEN_ADDRESS, srcAmount);
      console.log("End.")
      process.exit();
    }
  })
}

async function handleTransaction(transaction) {
  // 选出对应的交易
  if (transaction.to == UNISWAP_ROUTER_ADDRESS && await isPending(transaction.hash)) {
    console.log("Found pending uniswap network transaction", transaction);
  } else {
    return
  }
  // 计算gas
  let gasPrice = parseInt(transaction['gasPrice']);
  let newGasPrice = gasPrice + ONE_GWEI;
  if (newGasPrice > MAX_GAS_PRICE) {
    newGasPrice = MAX_GAS_PRICE;
  }

  // 判断符合触发抢跑交易的条件后，再进行抢跑
  if (triggersFrontRun(transaction)) {
    //取消注册
    subscription.unsubscribe();
    console.log('Perform front running attack...');
    //执行抢跑交易
    await performTrade(ETH_TOKEN_ADDRESS, TUSD_TOKEN_ADDRESS, ETH_QTY, newGasPrice);
    // 等待抢跑交易成功，并更改状态
    console.log("wait until the honest transaction is done...");
    while (await isPending(transaction.hash)) { }
    succeed = true;
  }
}

// 判断是否能触发抢跑交易
function triggersFrontRun(transaction) {
  let data = parseTx(transaction.input);
  let method = data[0],
  params = data[1];

  if (method == swapExactETHForTokens) {
    console.log(params)
    let srcAddr = params[5], srcAmount = params[0], toAddr = params[6];
    // console.log()
    return (srcAddr == ETH_TOKEN_ADDRESS) &&
      (toAddr == TUSD_TOKEN_ADDRESS) && (srcAmount >= THRESHOLD)
  }
  return false
}

async function performTrade(srcAddr, destAddr, srcAmount, gasPrice = null) {
  console.log('Begin transaction...');
  console.log('   detail:'+ '\n', "srcAddr : ", srcAddr)
  console.log("destAddr : ", destAddr)
  console.log("srcAmount : ", srcAmount)
  console.log("gasPrice : ", gasPrice, "\n")

  // 判断是该卖还是买
  if (srcAddr == ETH_TOKEN_ADDRESS) {
    const token1 = new Token(
      UNISWAP.ChainId.GÖRLI,
      destAddr,
      18
    );
    // console.log('execute : swapExactETHForTokens')
    await swapTokens(token1, WETH[token1.chainId], srcAmount, "2000", gasPrice, 'swapExactETHForTokens')
  }
  if (destAddr == ETH_TOKEN_ADDRESS) {
    const token2 = new Token(
      UNISWAP.ChainId.GÖRLI,
      srcAddr,
      18
    );
    // console.log('execute : swapExactTokensForETH')
    await swapTokens(WETH[token2.chainId], token2, srcAmount, "2000", gasPrice, 'swapExactTokensForETH')
  }

  // 交易完成后输出
  console.log("Transaction DONE!");
}

// 判断是否是pending中的交易
async function isPending(transactionHash) {
  return await web3.eth.getTransactionReceipt(transactionHash) == null;
}

// 解析input
function parseTx(input) {
  if (input == '0x') {
    return ['0x', []]
  }
  if ((input.length - 8 - 2) % 64 != 0) {
    throw "Data size misaligned with parse request."
  }
  let method = input.substring(0, 10);
  let numParams = (input.length - 8 - 2) / 64;
  var params = [];
  for (i = 0; i < numParams; i += 1) {
    let param = parseInt(input.substring(10 + 64 * i, 10 + 64 * (i + 1)), 16);
    params.push(param);
  }
  return [method, params]
}

// 获取对应token的余额
async function getTokenBalance(tokenAddr) {
  const TOKEN_CONTRACT = new web3.eth.Contract(ERC20_ABI, tokenAddr);
  return await TOKEN_CONTRACT.methods.balanceOf(USER_ACCOUNT).call();
}

// 进行交易，参考https://docs.uniswap.org/sdk/v2/guides/trading
async function swapTokens(token1, token2, amount, slippage, gasPrice, method0) {

  try {
    // 创建 pair 实例
    const pair = await Fetcher.fetchPairData(token1, token2, provider);
    // 指定输入token到输出token的路径
    const route = await new Route([pair], token2);
    // 将 ETH 转化为 wei
    let amountIn = ethers.utils.parseEther(amount.toString());
    amountIn = amountIn.toString()

    // 计算滑点，slippage=50意味着允许0.5%以内的价格波动
    const slippageTolerance = new Percent(slippage, "10000");

    let rawTxn;
    // console.log("method0", method0)
    // 根据卖和买进行不同的操作
    // 买
    if (method0.toString() == 'swapExactETHForTokens') {

      // 创建 swap 交易所需要的信息
      const trade = new Trade(
        route,
        new TokenAmount(token2, amountIn),
        TradeType.EXACT_INPUT
      );

      // 根据滑点，计算最少需要得到的代币数量，需要转化为十六进制
      const amountOutMin = trade.minimumAmountOut(slippageTolerance).raw;
      const amountOutMinHex = ethers.BigNumber.from(amountOutMin.toString()).toHexString();
      // 路径的数组
      const path = [token2.address, token1.address];
      // 代币接收地址
      const to = wallet.address;
      // 20分钟
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      // 需要转化为十六进制
      const value = trade.inputAmount.raw;
      const valueHex = await ethers.BigNumber.from(value.toString()).toHexString();

      console.log('execute ： swapExactETHForTokens')
      // 打包 swapExactETHForTokens 交易参数
      rawTxn = await UNISWAP_ROUTER_CONTRACT.populateTransaction.swapExactETHForTokens(amountOutMinHex, path, to, deadline, {
        value: valueHex,
        gasLimit: '0x4A519', //304409
        gasPrice: gasPrice
      })
    }

    // 卖
    if (method0.toString() == 'swapExactTokensForETH') {
      const path = [token2.address, token1.address];
      const to = wallet.address;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

      // 需要先进行 approve
      console.log("execute ： approve")
      // 打包 approve 的交易参数
      const apprawTxn = await ERC20_CONTRACT.populateTransaction.approve(UNISWAP_ROUTER_ADDRESS, amountIn, {
        value: 0,
        gasLimit: '0x23419' //144409
      })

      // 发送交易
      let appsendTxn = (await wallet).sendTransaction(apprawTxn)
      console.log("appsendTxn", appsendTxn)

      // 一旦交易被包含在 x 确认块的链中，就解析为 TransactionReceipt。
      let appreciept = (await appsendTxn).wait()
      // //记录有关 approve 已被挖掘的交易的信息。
      if (appreciept) {
        console.log(" - approve is mined - " + '\n'
          + "Transaction Hash:", (await appsendTxn).hash
          + '\n' + "Block Number: "
          + (await appreciept).blockNumber + '\n'
          + "Navigate to https://goerli.etherscan.io/txn/"
        + (await appsendTxn).hash, "to see your transaction" + '\n')
      } else {
        console.log("Error submitting transaction")
      }
      console.log('execute ： swapExactTokensForETH')

      // 打包 swapExactTokensForETH 交易参数
      rawTxn = await UNISWAP_ROUTER_CONTRACT.populateTransaction.swapExactTokensForETH(amountIn, 0, path, to, deadline, {
        value: 0,
        gasLimit: '0x4A519', //304409
        gasPrice: gasPrice
      })
    }

    //返回解析为事务的 Promise。
    let sendTxn = (await wallet).sendTransaction(rawTxn)

    // 一旦交易被包含在 x 确认块的链中，就解析为 TransactionReceipt。
    let reciept = (await sendTxn).wait()
    console.log("reciept", reciept)

    //记录有关 swap 已被挖掘的交易的信息。
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

main();
