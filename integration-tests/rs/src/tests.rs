use near_sdk::json_types::U128;
use near_units::{parse_near};
use serde_json::json;
use workspaces::prelude::*;
use workspaces::{network::Sandbox, Account, Contract, Worker, AccountId};

const BIKE_WASM_FILEPATH: &str = "../../out/main.wasm";
const FT_CONTRACT_ACCOUNT: &str = "sub.ft_jk.testnet";

const FT_TOTAL_SUPPLY: u128 = 1000;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // テスト環境の初期化
    let worker = workspaces::sandbox().await?;

    // 各コントラクトの用意
    let bike_wasm = std::fs::read(BIKE_WASM_FILEPATH)?;
    let bike_contract = worker.dev_deploy(&bike_wasm).await?;
    let ft_contract = pull_contract(&worker).await?;

    // テストに使うアカウントを用意
    let owner = worker.root_account().unwrap();
    let bob = owner
        .create_subaccount(&worker, "bob")
        .initial_balance(parse_near!("100 N"))
        .transact()
        .await?
        .into_result()?;

    // コントラクトの初期化
    ft_contract
        .call(&worker, "new_default_meta")
        .args_json(serde_json::json!({
            "owner_id": owner.id(),
            "total_supply": FT_TOTAL_SUPPLY.to_string(),
        }))?
        .transact()
        .await?;
    bike_contract
        .call(&worker, "new")
        .args_json(serde_json::json!({
            "num_of_bikes": 5
        }))?
        .transact()
        .await?;
    bike_contract
        .as_account()
        .call(&worker, ft_contract.id(), "storage_deposit")
        .args_json(serde_json::json!({
            "account_id": bike_contract.id()
        }))?
        .deposit(1250000000000000000000)
        .gas(300000000000000)
        .transact()
        .await?;

    // テスト実施
    test_transfer_ft_to_user_inspected_bike(&owner, &bob, &ft_contract, &bike_contract, &worker).await?;
    Ok(())
}

/// 既にデプロイされているコントラクトを取得します。
async fn pull_contract(worker: &Worker<Sandbox>) -> anyhow::Result<Contract> {
    let testnet = workspaces::testnet_archival().await?;
    let contract_id: AccountId = FT_CONTRACT_ACCOUNT.parse()?;

    let contract = worker
        .import_contract(&contract_id, &testnet)
        .initial_balance(parse_near!("1000 N"))
        .transact()
        .await?;

    Ok(contract)
}

/// バイクを点検をしてくれたユーザへ報酬を支払えているかのテストを行います。
async fn test_transfer_ft_to_user_inspected_bike(
    owner: &Account,
    user: &Account,
    ft_contract: &Contract,
    bike_contract: &Contract,
    worker: &Worker<Sandbox>,
) -> anyhow::Result<()> {
    let remuneration_amount = 15;
    let test_bike_index = 0;

    // userのストレージ登録
    user.call(&worker, ft_contract.id(), "storage_deposit")
        .args_json(serde_json::json!({
            "account_id": user.id()
        }))?
        .deposit(1250000000000000000000)
        .gas(300000000000000)
        .transact()
        .await?;

    // bike_contractのFTの用意
    // ownerからbike_contractへftを転送
    owner
        .call(&worker, ft_contract.id(), "ft_transfer")
        .args_json(serde_json::json!({
            "receiver_id": bike_contract.id(),
            "amount": "50".to_string()
        }))?
        .deposit(1)
        .transact()
        .await?;

    // この時点でのuserの残高確認
    let user_balance: U128 = ft_contract
        .call(&worker, "ft_balance_of")
        .args_json(json!({"account_id": user.id()}))?
        .transact()
        .await?
        .json()?;
    assert_eq!(user_balance.0, 0);

    // ユーザによってバイクを点検
    user.call(&worker, bike_contract.id(), "inspect_bike")
        .args_json(serde_json::json!({
            "index": test_bike_index,
        }))?
        .gas(300000000000000)
        .transact()
        .await?;

    // 点検中のuserの残高確認
    let user_balance: U128 = ft_contract
        .call(&worker, "ft_balance_of")
        .args_json(json!({"account_id": user.id()}))?
        .transact()
        .await?
        .json()?;
    assert_eq!(user_balance.0, 0);

    // バイクを返却
    user.call(&worker, bike_contract.id(), "return_bike")
        .args_json(serde_json::json!({
            "index": test_bike_index,
        }))?
        .gas(300000000000000)
        .transact()
        .await?;

    // バイク返却後のuserの残高が増えていることを確認
    let user_balance: U128 = ft_contract
        .call(&worker, "ft_balance_of")
        .args_json(json!({"account_id": user.id()}))?
        .transact()
        .await?
        .json()?;
    assert_eq!(user_balance.0, remuneration_amount);

    println!("      Passed ✅ test_transfer_ft_to_user_inspected_bike");
    Ok(())
}