"""Capture the agreed UI prototype, without adding or changing its UI.
Usage: python capture.py /absolute/path/to/extracted/prototype --output OUTPUT
Source: 5298534c2939aa44683baa6ebd3ced8285801466
Requires Playwright and Chromium. Only the prototype's in-memory actions run.
"""
from pathlib import Path
from contextlib import contextmanager
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
import argparse, json, struct
from playwright.sync_api import sync_playwright

SOURCE = '5298534c2939aa44683baa6ebd3ced8285801466'

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

@contextmanager
def serve(root):
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root)))
    thread = Thread(target=server.serve_forever, daemon=True); thread.start()
    try: yield f'http://127.0.0.1:{server.server_port}/'
    finally: server.shutdown(); server.server_close()

def capture(root, output, chromium):
    output.mkdir(parents=True, exist_ok=True)
    metadata = []
    with serve(root) as url, sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chromium, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width':1512,'height':960}, device_scale_factor=1)
        errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
        page.clock.install(time=1793597400000)
        def reset():
            page.goto(url); page.locator('.main-chat').wait_for(); page.wait_for_timeout(80)
        def click(action, key=None):
            selector=f'[data-action="{action}"]' + (f'[data-key="{key}"]' if key else '')
            page.locator(selector).first.click()
        def tab(kind):
            click('tab-menu'); page.locator(f'[data-action="choose-tab"][data-kind="{kind}"]').click()
        def send(text):
            page.locator('#main-input').fill(text); click('send'); page.wait_for_timeout(80)
        def scenario(key):
            click('demo');click('scenario',key);click('demo')
        def settings(kind='backup'):
            click('settings')
            if kind!='backup': click('settings-page',kind)
        def shot(name, selector, title):
            node=page.locator(selector).first
            node.screenshot(path=str(output/(name+'.png')), animations='disabled')
            width,height=struct.unpack('>II',(output/(name+'.png')).read_bytes()[16:24]); metadata.append({'file':name+'.png','title':title,'width':width,'height':height,'source_commit':SOURCE})
            if errors: raise RuntimeError(errors)
            print(name, flush=True)
        reset(); shot('overview','.shell','作品一覧・メインチャット・成果物タブ')
        reset(); click('tab-menu'); shot('tab-chooser','.inspector','新しいタブの種類選択')
        reset(); click('new-project'); shot('new-work','#dialog','作品名・制作意図・作風版・既存ファイルの指定')
        reset(); page.locator('.project-new-chat').first.click(); shot('new-chat','.main-chat','新しいチャットとエージェント・モデルの選択')
        reset(); shot('composer','.composer-area','成果物を選択した入力欄と送信設定')
        reset(); click('attachment-menu'); shot('attachments','.main-chat','成果物の選択とコンピューターからの添付')
        reset(); shot('preview','.preview-wrap','保存状態に対応する成果物のプレビュー')
        reset(); send('この案を採用して'); shot('adoption','.main-chat','具体的な案を採用する会話')
        reset(); send('ベンチの位置を手修正しました。ここまでを記録して'); shot('manual-record','.main-chat','制作ファイルと作業内容を登録する会話')
        reset(); tab('side'); shot('side-chat','.inspector','相談専用のサイドチャット')
        reset(); tab('side'); page.locator('#side-input').fill('Blenderでベンチを動かす方法は？'); click('side-send'); shot('side-stop','.inspector','相談の回答中に表示する停止操作')
        reset(); tab('history'); shot('history','.inspector','保存状態の分岐と理由を表示する制作履歴')
        reset(); tab('history'); click('reference','plants'); send('ここに戻して'); shot('restore','.workspace-body','履歴の保存状態を参照した復元の確認')
        reset(); tab('history'); click('reference','plants'); send('ここから別作品を作って'); shot('derive','.shell','保存状態を起点にした派生作品の作成')
        reset(); tab('guards'); shot('guards','.inspector','保護対象・項目と継続的な解除')
        reset(); tab('guards'); scenario('conflict'); shot('protection-conflict','.workspace-body','保護一覧と依頼限定許可を確認する会話')
        reset(); scenario('start'); shot('running','.shell','チャットの処理中アイコンと入力欄の停止ボタン')
        reset(); scenario('start'); click('stop'); page.clock.run_for(1000); shot('stopped','.workspace-body','停止完了と明示的な再開を待つ会話')
        reset(); scenario('unknown'); shot('unknown','.shell','状態確認が必要なチャットと照合の案内')
        reset(); scenario('offline'); shot('offline','.workspace-body','LLM利用不可時の記録として送信')
        reset(); scenario('preview-failure'); send('ベンチを手修正したので、ここまでを記録して'); page.locator('#main-messages [data-action="artifact"]').last.click(); shot('missing-preview','.workspace-body','プレビュー未取得でも保持する本文と制作ファイル')
        reset(); tab('style'); shot('style','.inspector','制作意図・作風の版・採用方針の確認')
        reset(); settings('runtime'); shot('versions','#dialog','エージェント定義の版とGit保存先')
        reset(); click('reflection'); shot('reflection-picker','#dialog','全履歴を振り返る対象作品の選択')
        reset(); click('reflection'); click('create-reflection'); shot('reflection-result','.main-chat','根拠付きの振り返りと方針の検討')
        reset(); settings(); shot('backup','#dialog','全体バックアップとバックアップからの復元')
        reset(); settings(); click('backup'); shot('backup-result','#dialog','バックアップ操作の結果表示')
        reset(); scenario('start'); settings(); click('backup'); shot('backup-busy','#dialog','安全な停止と照合が必要なバックアップ')
        reset(); settings(); click('restore-backup'); shot('backup-restore','#dialog','空の保存先への復元と別途認証の案内')
        reset(); settings('data'); shot('saved-data','#dialog','採用中の保護と未採用の制作実体の管理')
        reset(); settings('data'); click('delete-artifact','plants'); shot('delete-confirm','#dialog','制作実体の削除対象と復元への影響の確認')
        reset(); settings('data'); click('delete-artifact','plants'); click('confirm-delete-artifact'); click('close-dialog'); shot('deleted-preview','.preview-wrap','削除した制作実体の可用性表示')
        reset(); settings('runtime'); click('migrate'); shot('migration','#dialog','保存形式の移行前に示す退避と容量の確認')
        reset(); send('先ほどの手修正の理由を補記して'); shot('amend-reason','.main-chat','理由の補記・訂正を受け付ける会話')
        (output/'screenshots.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2)+'\n')
        browser.close()
    return metadata

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('prototype',type=Path);parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parent);parser.add_argument('--chromium',default='/usr/bin/chromium');args=parser.parse_args()
    capture(args.prototype.resolve(),args.output.resolve(),args.chromium)
