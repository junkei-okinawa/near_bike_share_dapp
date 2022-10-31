import { Worker, NEAR, NearAccount } from 'near-workspaces';
import anyTest, { TestFn } from 'ava'

// import { Near, Account, Contract } from 'near-api-js'
// import { nearConfig } from './config'
// import { truncate } from 'fs';

const BIKE_WASM_FILEPATH: string = "../out/main.wasm";
const FT_CONTRACT_ACCOUNT: string = "sub.ft_jk.testnet";

const FT_TOTAL_SUPPLY: number = 1000;

const test = anyTest as TestFn<{
  worker: Worker;
  accounts: Record<string, any>;
}>

test.beforeEach(async (t) => {
  // テスト環境の初期化
  const worker = await Worker.init();

  // 各コントラクトの用意
  const owner = worker.rootAccount;
  const ftContract = await owner.importContract({
    testnetContract: FT_CONTRACT_ACCOUNT,
    isSubAccount: true,
    initialBalance: NEAR.parse('1000 N').toJSON(),
  });
  const bikeContract = await owner.devDeploy(BIKE_WASM_FILEPATH);

  // テストに使うアカウントを用意
  const bob = await owner.createSubAccount("bob", {
    initialBalance: NEAR.parse("100 N").toJSON(),
  });
  const alice = await owner.createSubAccount("alice", {
    initialBalance: NEAR.parse("100 N").toJSON(),
  });

  // コントラクトの初期化
  await owner.call(ftContract, 'new_default_meta',
    {
      "owner_id": owner.accountId,
      "total_supply": String(FT_TOTAL_SUPPLY),
    });
  await owner.call(bikeContract, 'new',
    {
      "num_of_bikes": 5,
    });
  await bikeContract.call(ftContract.accountId, 'storage_deposit',
    {
      "account_id": bikeContract.accountId,
    },
    {
      attachedDeposit: "1250000000000000000000",
      gas: "300000000000000",
    });

  // workerとaccountをテスト実行ように保存
  t.context.worker = worker;
  t.context.accounts = {
    owner,
    bikeContract,
    ftContract,
    alice,
    bob,
  };
})

test.afterEach(async t => {
  await t.context.worker.tearDown().catch(error => {
    console.log('Failed to tear down the worker:', error);
  });
});

test('test transfer ft to user inspected bike', async (t) => {
  const {
    owner,
    bikeContract,
    ftContract,
    bob,
  } = t.context.accounts;
  let user = bob;
  let remunerationAmount = 15;
  let testBikeIndex = 0;

  // userのストレージ登録
  await user.call(ftContract.accountId, 'storage_deposit',
    {
      "account_id": user.accountId,
    },
    {
      attachedDeposit: "1250000000000000000000",
      gas: "300000000000000",
    });

  // bikeContractのFTの用意
  // ownerからbikeContractへftを転送
  await owner.call(ftContract.accountId, "ft_transfer",
    {
      "receiver_id": bikeContract.accountId,
      "amount": "50"
    },
    {
      attachedDeposit: '1'
    });

  // この時点でのuserの残高確認
  let userBalance: string;
  userBalance = await owner.call(
    ftContract,
    "ft_balance_of",
    {
      "account_id": user.accountId,
    });
  t.is(userBalance, "0");

  // ユーザによってバイクを点検
  await user.call(bikeContract.accountId, "inspect_bike",
    {
      "index": testBikeIndex,
    },
    {
      gas: "300000000000000",
    });

  // 点検中のuserの残高確認
  userBalance = await owner.call(
    ftContract,
    "ft_balance_of",
    {
      "account_id": user.accountId,
    });
  t.is(userBalance, "0");

  // バイクを返却
  await user.call(bikeContract.accountId, "return_bike",
    {
      "index": testBikeIndex,
    },
    {
      gas: "300000000000000",
    });

  // バイク返却後のuserの残高が増えていることを確認
  userBalance = await owner.call(
    ftContract,
    "ft_balance_of",
    {
      "account_id": user.accountId,
    });
  t.is(userBalance, String(remunerationAmount));

  console.info("      Passed ✅ test transfer ft to user inspected bike");
});

test('test transfer call to use bike', async (t) => {
  const {
    owner,
    bikeContract,
    ftContract,
    alice,
  } = t.context.accounts;
  let user = alice;
  let userInitialAmount = 100;
  let testBikeIndex = 0;

  //あらかじめbikeコントラクトのテスト開始時の残高を取得。
  let bikeContractInitialBalance: string = await owner.call(
    ftContract,
    "ft_balance_of",
    {
      "account_id": bikeContract.accountId,
    });

  // バイクの使用に必要なftの量を取得
  let amountToUseBike: string = await owner.call(
    bikeContract,
    "amount_to_use_bike",
    {}
  );

  // userのストレージ登録
  await user.call(ftContract.accountId, 'storage_deposit',
    {
      "account_id": user.accountId,
    },
    {
      attachedDeposit: "1250000000000000000000",
      gas: "300000000000000",
    });

  // userのftの用意
  // ownerからユーザへftを転送
  await owner.call(ftContract.accountId, "ft_transfer",
    {
      "receiver_id": user.accountId,
      "amount": String(userInitialAmount),
    },
    {
      attachedDeposit: "1",
    });

  // bikeContractへft送信し, バイクの使用を申請します
  await user.call(ftContract.accountId, "ft_transfer_call",
    {
      "receiver_id": bikeContract.accountId,
      "amount": String(amountToUseBike),
      "msg": String(testBikeIndex),
    },
    {
      attachedDeposit: "1",
      gas: "300000000000000",
    });

  // バイクの使用者がuserであるか確認
  let bikeUserId: NearAccount = await owner.call(bikeContract, "who_is_using",
    {
      "index": testBikeIndex,
    });
  t.is(user.accountId, bikeUserId);

  // ユーザはバイクを返却
  await user.call(bikeContract.accountId, "return_bike",
    {
      "index": testBikeIndex,
    },
    {
      gas: "300000000000000",
    });

  // バイク返却後のuserの残高の確認
  let userBalance: string = await owner.call(ftContract, "ft_balance_of",
    {
      "account_id": user.accountId,
    });
  t.is(Number(userBalance), Number(userInitialAmount) - Number(amountToUseBike));

  // bike_contractの残高の確認
  let bikeContractBalance: string = await owner.call(ftContract, "ft_balance_of",
    {
      "account_id": bikeContract.accountId,
    });
  t.is(Number(bikeContractBalance), Number(bikeContractInitialBalance) + Number(amountToUseBike));

  console.info("      Passed ✅ test transfer call to use bike");
});