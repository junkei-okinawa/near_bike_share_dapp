use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    env, ext_contract, log, near_bindgen, AccountId, Gas, PanicOnDefault, Promise, PromiseResult,
};

const FT_CONTRACT_ACCOUNT: &str = "sub.ft_jk.testnet"; // <- あなたのftコントラクトをデプロイしたアカウントに変更してください！
const AMOUNT_REWARD_FOR_INSPECTIONS: u128 = 15;

/// 外部コントラクト(ftコントラクト)に実装されているメソッドをトレイトで定義
#[ext_contract(ext_ft)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: String, amount: String, memo: Option<String>);
}

/// バイクの状態遷移を表します。
#[derive(BorshDeserialize, BorshSerialize)]
enum Bike {
    Available,             // 使用可能
    InUse(AccountId),      // AccountIdによって使用中
    Inspection(AccountId), // AccountIdによって点検中
}

/// コントラクトを定義します
#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct Contract {
    bikes: Vec<Bike>,
}

/// メソッドの実装です。
#[near_bindgen]
impl Contract {
    /// init関数の実装です。
    #[init]
    pub fn new(num_of_bikes: usize) -> Self {
        log!("initialize Contract with {} bikes", num_of_bikes);
        Self {
            bikes: {
                let mut bikes = Vec::new();
                for _i in 0..num_of_bikes {
                    bikes.push(Bike::Available);
                }
                bikes
            },
        }
    }

    /// バイクの数を返却します。
    pub fn num_of_bikes(&self) -> usize {
        self.bikes.len()
    }

    /// indexで指定されたバイクが使用可能かどうかを判別します。
    pub fn is_available(&self, index: usize) -> bool {
        match self.bikes[index] {
            Bike::Available => true,
            _ => false,
        }
    }

    /// indexで指定されたバイクが使用中の場合は使用者のアカウントidを返却します。
    pub fn who_is_using(&self, index: usize) -> Option<AccountId> {
        match &self.bikes[index] {
            Bike::InUse(user_id) => Some(user_id.clone()),
            _ => None,
        }
    }

    /// indexで指定されたバイクが点検中の場合は点検者のアカウントidを返却します。
    pub fn who_is_inspecting(&self, index: usize) -> Option<AccountId> {
        match &self.bikes[index] {
            Bike::Inspection(inspector_id) => Some(inspector_id.clone()),
            _ => None,
        }
    }

    // バイク 使用可 -> 使用中
    pub fn use_bike(&mut self, index: usize) {
        // env::predecessor_account_id(): このメソッドを呼び出しているアカウント名を取得
        let user_id = env::predecessor_account_id();
        log!("{} uses bike", &user_id);

        match &self.bikes[index] {
            Bike::Available => self.bikes[index] = Bike::InUse(user_id),
            _ => panic!("Bike is not available"),
        }
    }

    // バイク 使用可 -> 点検中
    pub fn inspect_bike(&mut self, index: usize) {
        let user_id = env::predecessor_account_id();
        log!("{} inspects bike", &user_id);

        match &self.bikes[index] {
            Bike::Available => self.bikes[index] = Bike::Inspection(user_id),
            _ => panic!("Bike is not available"),
        }
    }

    // バイク 使用中or点検中 -> 使用可
    pub fn return_bike(&mut self, index: usize) {
        let user_id = env::predecessor_account_id();
        log!("{} returns bike", &user_id);

        match &self.bikes[index] {
            Bike::Available => panic!("Bike is already available"),
            Bike::InUse(user) => {
                assert_eq!(user.clone(), user_id, "Fail due to wrong account");
                self.bikes[index] = Bike::Available
            }
            Bike::Inspection(inspector) => {
                assert_eq!(inspector.clone(), user_id, "Fail due to wrong account");
                Self::return_inspected_bike(index);
            }
        };
    }

    /// 点検中から返却に変更する際の挙動を定義します。
    /// 点検をしてくれたユーザに報酬(ft)を支払い, コールバックで返却処理をします。
    pub fn return_inspected_bike(index: usize) -> Promise {
        let contract_id = FT_CONTRACT_ACCOUNT.parse().unwrap();
        let amount = AMOUNT_REWARD_FOR_INSPECTIONS.to_string();
        let receiver_id = env::predecessor_account_id().to_string();

        log!(
            "{} transfer to {}: {} FT",
            env::current_account_id(),
            &receiver_id,
            &amount
        );

        // cross contract call (contract_idのft_transfer()メソッドを呼び出す)
        ext_ft::ext(contract_id)
            .with_attached_deposit(1)
            .ft_transfer(receiver_id, amount, None)
            .then(
                // callback (自身のcallback_return_bike()メソッドを呼び出す)
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas(3_000_000_000_000))
                    .callback_return_bike(index),
            )
    }

    /// cross contract call の結果を元に処理を条件分岐します。
    // #[private]: predecessor(このメソッドを呼び出しているアカウント)とcurrent_account(このコントラクトのアカウント)が同じことをチェックするマクロです.
    // callbackの場合, コントラクトが自身のメソッドを呼び出すことを期待しています.
    #[private]
    pub fn callback_return_bike(&mut self, index: usize) {
        assert_eq!(env::promise_results_count(), 1, "This is a callback method");
        match env::promise_result(0) {
            PromiseResult::NotReady => unreachable!(),
            PromiseResult::Failed => panic!("Fail cross-contract call"),
            // 成功時のみBikeを返却(使用可能に変更)
            PromiseResult::Successful(_) => self.bikes[index] = Bike::Available,
        }
    }
}

#[cfg(test)]
mod tests {
    // テスト環境の構築に必要なものをインポート
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    // Contractのモジュールをインポート
    use super::*;

    // VMContextBuilderのテンプレートを用意
    // VMContextBuilder: テスト環境(モックされたブロックチェーン)をcontext(テスト材料)をもとに変更できるインターフェース
    fn get_context(predecessor_account_id: AccountId) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(accounts(0)) // accounts(0): テスト用のアカウントリストの中の0番アカウントを取得します.
            .signer_account_id(predecessor_account_id.clone())
            .predecessor_account_id(predecessor_account_id);
        builder
    }

    #[test]
    fn check_default() {
        let mut context = get_context(accounts(1)); // 0以外の番号のアカウントでコントラクトを呼び出します.
        testing_env!(context.build()); // テスト環境を初期化
        let init_num = 5;
        let contract = Contract::new(init_num);

        // view関数の実行のみ許可する環境に初期化
        testing_env!(context.is_view(true).build());

        assert_eq!(contract.num_of_bikes(), init_num);
        for i in 0..init_num {
            assert!(contract.is_available(i))
        }
    }

    // accounts(1)がバイクを点検した後,
    // バイクはaccounts(1)によって点検中になっているかを確認
    #[test]
    fn check_inspecting_account() {
        let mut context = get_context(accounts(1));
        testing_env!(context.build());
        let mut contract = Contract::new(5);

        let test_index = contract.bikes.len() - 1;
        contract.inspect_bike(test_index);

        testing_env!(context.is_view(true).build());

        for i in 0..contract.num_of_bikes() {
            if i == test_index {
                assert_eq!(accounts(1), contract.who_is_inspecting(i).unwrap());
            } else {
                assert!(contract.is_available(i))
            }
        }
    }

    // 別のアカウントが点検中に使用可能に変更->パニックを起こすか確認
    #[test]
    // パニックを起こすべきテストであることを示す注釈
    // expectedを追加することでパニック時のメッセージもテストできる
    #[should_panic(expected = "Fail due to wrong account")]
    fn return_by_other_account() {
        let mut context = get_context(accounts(1));
        testing_env!(context.build());
        let mut contract = Contract::new(5);

        contract.inspect_bike(0);

        testing_env!(context.predecessor_account_id(accounts(2)).build());
        contract.return_bike(0);
    }
}
