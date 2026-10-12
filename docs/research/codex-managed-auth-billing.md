# Codex 管理の ChatGPT 認証と費用制約

現在の設計: 2026-10-12 に [LLM 接続設計](../design/llm-connection.md) を合意した。費用確認は利用者が担い、基盤側の確認と利用情報取得失敗による送信保留は設けない。以下の費用確認案・未決表記・検証結果は各調査時点の記録として残す。

調査日: 2026-10-06。対象: [設計 Issue #2](https://github.com/Kurarowa305/scene-craft/issues/2)。app-server の採用は利用者と合意済み。認証・更新も Codex に任せる案が、[追加課金を許容しない要件](../requirements/initial-scope.md#app)をどう満たせるか調べた。

## 調査後の採用判断

2026-10-06、利用者が自動補充無効・既存クレジットなしを確認し、Codex 管理の認証に確定した。この状態を運用前提とし、認証管理の自作を減らす。現在の決定は [ADR 0004](../adr/0004-codex-app-server-runtime.md) と [接続設計](../design/llm-connection.md) を参照する。以下は判断前の調査記録であり、「本人の現設定は未確認」等は調査時点を指す。エージェントが支払い設定を取得・変更したという意味ではない。

その後の [app-server 実接続確認](codex-app-server-connection-validation.md) では、ChatGPT 認証・通常契約枠の利用許可・クレジット残高 0 を API から確認できた。自動補充の設定確認は引き続き利用者の回答を根拠とする。

## 結論

**Codex 管理の ChatGPT ログインは、認証管理を省けるが、それだけで「契約に含まれる枠だけ」の利用にはならない。** API キー課金は別の認証経路として制限できる。一方、ChatGPT の既存 credits は契約枠を超える利用に使われ得る。利用可能なアカウントで自動補充を有効にしていれば、新しい自動請求も起こり得る。既存残高の消費、新しいcreditsの購入、API従量課金を分けて判断する必要がある。[公式credits説明](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans)

確認した公開資料には、managed ChatGPT 認証の一つのturnに対し「creditsを消費せず、含まれる枠だけを使う」と強制するRPC・設定を見つけていない。利用状況の読み取りを、この保証の代用にはできない。これは調査範囲内で未確認という意味であり、その制御がどこにも存在しないとの断定ではない。

## 確認した事実

| 問い | 公式資料から確認できたこと |
| --- | --- |
| 認証管理を任せられるか | `chatgpt` / `chatgptDeviceCode` ではCodexがOAuth・保存・自動更新を管理する。APIキー方式とは区別される。[app-server Auth endpoints](https://learn.chatgpt.com/docs/app-server#auth-endpoints) |
| API従量課金に自動で切り替わるか | 認証資料はChatGPTログインとAPIキーを別方式とし、APIキー利用をPlatformへの従量課金と説明する。上限到達時の自動切替は確認できない。`forced_login_method="chatgpt"` は認証方式を制限し、不一致の資格情報ならログアウトして終了する。[Authentication](https://learn.chatgpt.com/docs/auth#enforce-a-login-method-or-workspace) |
| ChatGPT側のcreditsを使うか | 含まれる枠の後、利用可能なcreditsで作業を継続できる。Plus/Proは追加creditsを購入できる。ChatGPT WorkとCodexは利用枠・creditsを共有する。[Pricing](https://learn.chatgpt.com/docs/pricing) |
| 枠を超えた瞬間に止まるか | 実行中のturnは、枠の上限到達後もfair use制限内で継続できるとの記載がある。途中で必ず停止するとは言えない。この継続が直ちに新しい請求を発生させる、という意味でもない。[Pricing](https://learn.chatgpt.com/docs/pricing#what-happens-when-you-hit-usage-limits) |
| 購入していなければcreditsはないか | 無料付与の例がある。学生向け施策のChatGPT creditsはCodexで契約枠を超える利用に使え、API creditsとは異なる。本人が購入していないことは残高ゼロの証拠にならない。[Codex for Students](https://learn.chatgpt.com/community/students) |
| SIWC外部アプリの設定を使えるか | SIWC設定は接続した外部アプリの利用と上限を管理する。外部アプリへのcredits利用許可をCodex managedログインにも適用できるとは記載されていない。[Sign in with ChatGPT](https://learn.chatgpt.com/docs/sign-in-with-chatgpt) |
| 利用状況を取得できるか | app-serverには `account/rateLimits/read` と更新通知があり、枠・リセット時刻・返される場合のcredits詳細を取得できる。`account/usage/read` はtoken活動の集計である。[app-server Rate limits / Token usage](https://learn.chatgpt.com/docs/app-server#auth-endpoints) |

## 区別すべき四つの条件

1. **API従量課金を使わない:** APIキー認証・別providerへの誤接続を防ぐ条件。ChatGPT側creditsの消費はこれだけでは防げない。
2. **新しい支払いを起こさない:** creditsの購入・自動補充・その他の追加支払いを許さない条件。購入済み残高の消費とは別である。
3. **creditsを一切消費しない:** 購入済み・無料付与を含め、契約に含まれる通常枠だけで使う条件。現在の「契約内のみ」をこの意味で扱うなら、新たな支払いがなくてもcredits利用は許容しない。
4. **上限時に停止する:** サーバーの枠判定を受けた後の新規実行を止め、依頼と途中状態を保存する条件。実行中turnの継続や、枠の読み取りから推論までの状態変化も考慮する。

以上はscene-craftの費用要件を分解した設計上の整理である。無料creditsを許すか等の要件緩和を、今回の調査だけで合意済みにはしない。

## 自動購入・残高ゼロの追加確認

- **自動補充は存在する:** 対応アカウントでは、ChatGPTのSettings > UsageまたはCodexのUsage & Billingから有効化できる。設定閾値を下回ると、設定した目標残高まで既定の支払方法へ自動請求される。月額上限は自動補充用で、一回限りの購入には適用されない。提供条件・既定値・本人の現設定は別途確認が必要。[公式credits説明](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans)
- **自動補充offとcredits不使用は別:** 前者は補充購入を止める条件であり、既にある残高の消費を止める保証ではない。SIWC外部アプリのcredits設定も、managed Codexの自動補充設定として転用しない。
- **ゼロは厳密な支出境界ではない:** 正残高で開始したtaskが並行利用による枯渇後に終わると負残高になり、後の購入・自動補充がその相殺へ充てられる場合がある。残高ゼロ表示だけで未精算分もないとは断言できない。[公式credits説明](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans)
- **設計上の推論:** 自動補充off・残高確認は支出リスクを減らすが、無料付与・他の購入・設定変更・実行中taskとの時間差を排除せず、契約枠限定を保証しない。
- **企業向け上限:** Enterprise/Eduのusage budget APIは確認できたが、対象は企業・教育workspaceである。個人Pro用のno-credits設定として転用しない。[公式usage budget例](https://developers.openai.com/cookbook/examples/chatgpt/daily_usage_limits/readme)

## 読み取りAPIは課金防止の保証になるか

**ならない。** 残量の読み取りは観測であり、次の推論の課金方式指定や利用枠の予約ではない。この区別はAPIの機能と同じアカウントでの並行利用から導く設計上の推論である。事前確認直後に別のCodex/Workセッションが枠を消費したり、一つの長いturnが複数の推論を行ったりすることを、事前確認だけでは止められない。

対象版0.160.0の生成schemaでは、`GetAccountRateLimitsResponse` に `ordinaryUsageAllowed: boolean | null`、`accountId`、`rateLimitsByLimitId`、`CreditsSnapshot` に `balance: string | null`、`hasCredits`、`unlimited` がある。`ordinaryUsageAllowed` が不明なときに、使用率やリセット時刻から利用可能と推定しない。これらはschemaの読み取り確認であり、利用者の実残高は取得していない。

`ordinaryUsageAllowed=true` を「当該turnでcreditsを使わない」という証明として扱う根拠は確認できない。`balance=null` もゼロを意味しない。`account/usage/read` の累積token数から将来の請求を確定することもできない。[app-server の利用状況API](https://learn.chatgpt.com/docs/app-server#auth-endpoints)

## managed認証を採用する場合の提案条件

以下は実装・合意前の提案であり、現在のscene-craftがこれを実装済みという意味ではない。

- **API課金経路の制限:** 専用のCodex実行設定を持ち、`forced_login_method="chatgpt"`、意図したprovider・アカウントを固定する。APIキーや別provider用資格情報を子プロセスへ継承せず、APIキーへのログイン・自動フォールバックをアプリに実装しない。[認証制限](https://learn.chatgpt.com/docs/auth#enforce-a-login-method-or-workspace)、[設定一覧](https://learn.chatgpt.com/docs/config-file/config-reference)
- **人間によるアカウント側確認:** managed Codexに適用されるcredits消費・購入・補充条件を確認する。以前合意したSIWC外部アプリ設定の確認だけでは代用しない。設定を確認できなければ「契約枠だけを保証」と表示しない。
- **監視と停止:** 開始前・アカウント変更時の認証種別、plan、枠、取得できるcredits情報を確認し、不明・想定外なら新規実行を止める。上限通知後は新しいturnや通常再試行を止め、人間の再開を待つ。ただしこれは監視による制限であり、サービス側のno-credits強制を代替しない。
- **厳密な契約枠限定:** 既存creditsも絶対に使わない条件を維持するなら、managed経路に適用されるサービス側の消費拒否設定が確認できるまでは費用条件の充足を確定しない。認証を簡略化できる利点と、この未確認事項を分けて決定する。

app-server採用自体を否定する調査結果ではない。**managed認証で保証できる認証経路と、まだ保証できないcredits不使用を分ける**ことが必要である。自作OAuthを避けたいという希望だけで費用条件を緩めない。

## 根拠と調査境界

一次資料は [Pricing](https://learn.chatgpt.com/docs/pricing)、[Authentication](https://learn.chatgpt.com/docs/auth)、[app-server](https://learn.chatgpt.com/docs/app-server)、[Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)、[SIWC利用者向け設定](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)、[無料creditsの公式例](https://learn.chatgpt.com/community/students)、[企業向けusage budget例](https://developers.openai.com/cookbook/examples/chatgpt/daily_usage_limits/readme)。当初の公式3ドメイン調査では自動補充の詳細が不足したため、Pricingが案内する[OpenAI Help Centerの個人プランcredits説明](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans)へ追加調査の範囲を広げた。

利用者の認証・残高・支払い設定・会話は読み取らず、推論・ログイン・購入・補充・設定変更も行っていない。将来のサービス変更や、今回参照していない個別契約の条件まで保証する資料ではない。
