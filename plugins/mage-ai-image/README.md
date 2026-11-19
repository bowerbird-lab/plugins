# Mage AI Image (`official.mage-ai-image`)

Edit images in Bowerbird using the [Mage API v1](https://docs.mage.space/api/overview).

## Features

- **Image Editing (Mage API v1)**: Automatically fetches image-editing models from `GET /v1/architectures` (e.g. Flux 2, GPT Image 2, Mango, Nano Banana 2, Seedream, Guava), handles inline base64 or signed `POST /v1/uploads` for large files, submits with `Idempotency-Key`, polls `status_url`, and supports cancellation.
- **Standalone Window & Inspector Panel**: Launch in a dedicated AI Studio window or run edits inline from the right-hand Inspector.
- **Safe Save & Overwrite with Backup**: Save edited outputs as a new asset, or overwrite the original after confirmation while backing up the previous file in the same item directory (`items/<id>/`) and recording version history in `metadata.json` for easy restore or deletion.

## Setup

1. Create an API key in [Mage API Dashboard](https://www.mage.space/api?tab=api-keys).
2. Open **Bowerbird → Settings → Plugins → Mage AI Image** and paste your API key (`mage_sk_...`).
