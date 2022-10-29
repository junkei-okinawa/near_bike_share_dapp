import React, { useEffect, useState } from "react";

import "./assets/css/global.css";

import {
  login,
  logout,
  num_of_bikes,
  is_available,
  who_is_using,
  who_is_inspecting,
  inspect_bike,
  return_bike,
  ft_balance_of,
  storage_balance_of,
  storage_deposit,
  storage_unregister,
  ft_transfer,
  amount_to_use_bike,
  ft_transfer_call,
} from "./assets/js/near/utils";

export default function App() {
  const [isBikeLoading, setBikeLoading] = useState(false);
  /** バイクの情報をフロント側で保持するための配列です */
  const [allBikeInfo, setAllBikeInfo] = useState([]);
  /**
   * bikeInfoオブジェクトを定義します.
   * allBikeInfoはbikeInfoオブジェクトの配列となります.
   * 各属性はログインアカウントと連携した情報になります.
   * available:  ログインアカウントはバイクを使用可能か否か
   * in_use:     同じく使用中か否か
   * inspection: 同じく点検中か否か
   */
  const initialBikeInfo = async () => {
    return { available: false, in_use: false, inspection: false };
  };

  /** どの画面を描画するのかの状態を定義しています */
  const RenderingStates = {
    SIGN_IN: "sign_in",
    REGISTRATION: "registration",
    HOME: "home",
    TRANSACTION: "transaction",
  };
  /** useStateを利用して描画する状態を保持します */
  const [renderingState, setRenderingState] = useState(RenderingStates.HOME);

  /** 残高表示する際に利用します */
  const [showBalance, setShowBalance] = useState(false);
  const [balanceInfo, setBalanceInfo] = useState({});
  const initialBalanceInfo = async () => {
    return { account_id: "", balance: 0 };
  };

  /** コントラクト側で定義されている, バイクを使うのに必要なftを保持します */
  const [amountToUseBike, setAmountToUseBike] = useState(0);

  const bikeImg = require("./assets/img/bike.png");

  // 初回レンダリング時の処理.
  // サイン後にもブラウザのページがリロードされるので, この内容が実行されます.
  useEffect(() => {
    /** バイクを使用するために必要なftの量を取得しセットします。 */
    const initAmountToUseBike = async () => {
      const amount = await amount_to_use_bike(); // <- amount_to_use_bike()使用
      setAmountToUseBike(BigInt(amount));
    };

    /** renderingStateを初期化します */
    const initRenderingState = async () => {
      if (!window.walletConnection.isSignedIn()) {
        setRenderingState(RenderingStates.SIGN_IN);
      } else {
        const is_registered = await isRegistered(window.accountId);
        if (!is_registered) {
          setRenderingState(RenderingStates.REGISTRATION);
        }
      }
    };

    /** allBikeInfoを初期化します */
    const InitAllBikeInfo = async () => {
      setBikeLoading(true);
      const num = await num_of_bikes();
      console.log("Num of bikes:", num);

      let new_bikes = [];
      for (let i = 0; i < num; i++) {
        const bike = await createBikeInfo(i);
        new_bikes.push(bike);
      }

      setAllBikeInfo(new_bikes);
      console.log("Set bikes: ", new_bikes);
      setBikeLoading(false);
    };

    initAmountToUseBike();
    initRenderingState();
    InitAllBikeInfo();
  }, []);


  /** 指定されたindexのバイク情報をフロント用に整形して返却します. */
  const createBikeInfo = async (index) => {
    let bike = await initialBikeInfo();
    await is_available(index).then((is_available) => {
      if (is_available) {
        bike.available = is_available;
        return bike;
      }
    });
    await who_is_using(index).then((user_id) => {
      // サインインしているユーザのアカウントidと同じであればユーザは使用中なので
      // 使用中をtrueに変更します。
      if (window.accountId === user_id) {
        bike.in_use = true;
        return bike;
      }
    });
    await who_is_inspecting(index).then((inspector_id) => {
      // サインインしているユーザのアカウントidと同じであればユーザは点検中なので
      // 点検中をtrueに変更します。
      if (window.accountId === inspector_id) {
        bike.inspection = true;
      }
    });
    return bike;
  };

  /** バイクを使用, バイク情報を更新します。 */
  // const useBikeThenUpdateInfo = async (index) => {
  //   console.log("Use bike");
  //   // 処理中は画面を切り替えるためにrenderingStatesを変更します。
  //   setRenderingState(RenderingStates.TRANSACTION);

  //   try {
  //     await use_bike(index);
  //   } catch (e) {
  //     alert(e);
  //   }
  //   await updateBikeInfo(index);

  //   setRenderingState(RenderingStates.HOME);
  // };

  /** バイクを使用, バイク情報を更新します。 */
  const transferFtToUseBike = async (index) => {
    console.log("Transfer ft to use bike");

    // 不要なトランザクションを避けるためにユーザの残高を確認
    const balance = await ft_balance_of(window.accountId);

    if (balance < amountToUseBike) {
      alert(amountToUseBike + "ft is required to use the bike");
    } else {
      try {
        ft_transfer_call(index, amountToUseBike.toString());
        // bikeコントラクト側で指定バイクの使用処理が実行されます.
        // トランザクションへのサイン後は画面がリロードされます.
      } catch (e) {
        alert(e);
      }
    }
  };

  /** バイクを点検, バイク情報を更新します。 */
  const inspectBikeThenUpdateInfo = async (index) => {
    console.log("Inspect bike");
    setRenderingState(RenderingStates.TRANSACTION);

    try {
      await inspect_bike(index);
    } catch (e) {
      alert(e);
    }
    await updateBikeInfo(index);

    setRenderingState(RenderingStates.HOME);
  };

  /** バイクを返却, バイク情報を更新します。 */
  const returnBikeThenUpdateInfo = async (index) => {
    console.log("Return bike");
    setRenderingState(RenderingStates.TRANSACTION);

    try {
      await return_bike(index);
    } catch (e) {
      alert(e);
    }
    await updateBikeInfo(index);

    setRenderingState(RenderingStates.HOME);
  };

  /** 特定のバイク情報を更新してallBikeInfoにセットします。 */
  const updateBikeInfo = async (index) => {
    const new_bike = await createBikeInfo(index);

    allBikeInfo[index] = new_bike;
    setAllBikeInfo(allBikeInfo);
    console.log("Update bikes: ", allBikeInfo);
  };

  /** account_idがftコントラクトに登録しているかを判別します。 */
  const isRegistered = async (account_id) => {
    const balance = await storage_balance_of(account_id);
    console.log("user's storage balance: ", balance);

    // ストレージ残高にnullが返ってくる場合は未登録を意味します.
    if (balance === null) {
      console.log("account is not yet registered");
      return false;
    } else {
      return true;
    }
  };

  /** ftコントラクトに登録します。 */
  const newUserRegister = async () => {
    try {
      await storage_deposit();
    } catch (e) {
      alert(e);
    }
  };

  /** account_idのft残高を取得し, 残高表示用オブジェクトbalanceInfoにセットします。 */
  const prepareBalanceInfo = async (account_id) => {
    const balance = await ft_balance_of(account_id);

    let balance_info = await initialBalanceInfo();
    balance_info.account_id = account_id;
    balance_info.balance = balance;

    setBalanceInfo(balance_info);
    setShowBalance(true);
  };

  // サインインしているアカウント情報のurlをログに表示
  console.log(
    "see:",
    `https://explorer.testnet.near.org/accounts/${window.accountId}`
  );
  // コントラクトのアカウント情報のurlをログに表示
  console.log(
    "see:",
    `https://explorer.testnet.near.org/accounts/${window.contract.contractId}`
  );

  /** サインアウトボタンの表示に使用します。 */
  const signOutButton = () => {
    return (
      <button className="link" style={{ float: "right" }} onClick={logout}>
        Sign out
      </button>
    );
  };

  /** 登録解除ボタンの表示に使用します。 */
  const unregisterButton = () => {
    return (
      <button
        className="link"
        style={{ float: "right" }}
        onClick={storage_unregister}
      >
        Unregister
      </button>
    );
  };

  /** サインイン画面を表示します。 */
  const requireSignIn = () => {
    return (
      <div>
        <main>
          <p style={{ textAlign: "center", marginTop: "2.5em" }}>
            <button onClick={login}>Sign in</button>
          </p>
        </main>
      </div>
    );
  };

  /** 登録画面を表示します。 */
  const requireRegistration = () => {
    return (
      <div>
        {signOutButton()}
        <div style={{ textAlign: "center" }}>
          <h5>
            Registration in ft contract is required before using the bike app
          </h5>
        </div>
        <main>
          <p style={{ textAlign: "center", marginTop: "2.5em" }}>
            <button onClick={newUserRegister}>storage deposit</button>
          </p>
        </main>
      </div>
    );
  };

  /** 画面のヘッダー部分の表示に使用します。 */
  const header = () => {
    return <h1>Hello {window.accountId} !</h1>;
  };

  /** トランザクション中の画面を表示します。 */
  const transaction = () => {
    return (
      <div>
        {header()}
        <main>
          <p> in process... </p>
        </main>
      </div>
    );
  };

  // useのonClickでtransferFtToUseBikeを使用するように変更
  const bikeContents = () => {
    return (
      <>
        {isBikeLoading ? (
          <p>Loding bike data ...</p>
        ) : (
          <div>
            {allBikeInfo.map((bike, index) => {
              return (
                <div class="bike" style={{ display: "flex" }}>
                  <div class="bike_img">
                    <img src={bikeImg} />
                  </div>
                  <div class="bike_index">: {index}</div>
                  <button
                    // ボタンを無効化する条件を定義
                    disabled={!bike.available}
                    onClick={() => transferFtToUseBike(index)} // <- 変更！
                  >
                    use
                  </button>
                  <button
                    // ボタンを無効化する条件を定義
                    disabled={!bike.available}
                    onClick={() => inspectBikeThenUpdateInfo(index)}
                  >
                    inspect
                  </button>
                  <button
                    // ボタンを無効化する条件を定義。
                    // ログインユーザがバイクを使用も点検もしていない場合は使用できないようにしています。
                    disabled={!bike.in_use && !bike.inspection}
                    onClick={() => returnBikeThenUpdateInfo(index)}
                  >
                    return
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  };

  /** 残高表示に使用します。 */
  const checkBalance = () => {
    return (
      <div class="balance_content">
        <button onClick={() => prepareBalanceInfo(window.accountId)}>
          check my balance
        </button>
        <button
          style={{ marginTop: "0.1em" }}
          onClick={() => prepareBalanceInfo(window.contract.contractId)}
        >
          check contract's balance
        </button>
        <span>or</span>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const { fieldset, account } = event.target.elements;
            const account_to_check = account.value;
            fieldset.disabled = true;
            try {
              await prepareBalanceInfo(account_to_check);
            } catch (e) {
              alert(e);
            }
            fieldset.disabled = false;
          }}
        >
          <fieldset id="fieldset">
            <div style={{ display: "flex" }}>
              <input autoComplete="off" id="account" placeholder="account id" />
              <button style={{ borderRadius: "0 5px 5px 0" }}>check</button>
            </div>
          </fieldset>
        </form>
        {showBalance && (
          <div>
            <p>{balanceInfo.account_id}'s</p>
            <p>balance: {balanceInfo.balance}</p>
          </div>
        )}
      </div>
    );
  };

  /** ftの送信部分の表示に使用します。 */
  const transferFt = () => {
    return (
      <div>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const { fieldset, account } = event.target.elements;
            const account_to_transfer = account.value;
            fieldset.disabled = true;
            try {
              await ft_transfer(account_to_transfer, amountToUseBike.toString());
            } catch (e) {
              alert(e);
            }
            fieldset.disabled = false;
          }}
        >
          <fieldset id="fieldset">
            <label
              htmlFor="account"
              style={{
                display: "block",
                color: "var(--gray)",
                marginBottom: "0.5em",
                marginTop: "1em",
              }}
            >
              give someone {amountToUseBike.toString()} ft
            </label>
            <div style={{ display: "flex" }}>
              <input
                autoComplete="off"
                id="account"
                style={{ flex: 1 }}
                placeholder="account id"
              />
              <button style={{ borderRadius: "0 5px 5px 0" }}>transfer</button>
            </div>
          </fieldset>
        </form>
      </div>
    );
  };

  /** ホーム画面を表示します。 */
  const home = () => {
    return (
      <div>
        {signOutButton()}
        {unregisterButton()}
        {header()}
        <main>
          {bikeContents()}
          {checkBalance()}
          {transferFt()}
        </main>
      </div>
    );
  };

  /** renderingStateに適した画面を表示します。 */
  switch (renderingState) {
    case RenderingStates.SIGN_IN:
      return <div>{requireSignIn()}</div>;

    case RenderingStates.REGISTRATION:
      return <div>{requireRegistration()}</div>;

    case RenderingStates.TRANSACTION:
      return <div>{transaction()}</div>;

    case RenderingStates.HOME:
      return <div>{home()}</div>;
  }
}