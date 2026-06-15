# stock-tool

株価チャートとテクニカル指標を確認できるローカルWebツールです。

## Features

- Yahoo Financeの公開データを使った株価チャート表示
- 銘柄検索
- 移動平均、RSI、MACD、ボリンジャーバンドなどの指標表示
- PER、PBR、配当利回りなどのファンダメンタル情報表示
- ウォッチリストと比較表示

## Requirements

- Node.js 18 or later

## Setup

```bash
npm install
npm start
```

起動後、ブラウザで `http://localhost:3300` を開きます。

## Deploy to Vercel

VercelでこのリポジトリをImportします。

- Framework Preset: Other
- Build Command: 空欄のままでOK
- Output Directory: 空欄のままでOK
- Install Command: `npm install`

デプロイ後に発行されるURLをスマホで開けます。

## Notes

このツールは投資判断を保証するものではありません。表示される情報は参考用途として扱ってください。
