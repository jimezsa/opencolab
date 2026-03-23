# 🐙 OpenColab

<p align="center">
  <img src="docs/assets/header.png" alt="OpenColab Header" width="550" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-In%20Progress-orange?style=for-the-badge" alt="Project status: In progress">
  <img src="https://img.shields.io/badge/Node-22%2B-339933?logo=node.js&logoColor=white&style=for-the-badge" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/pnpm-9%2B-F69220?logo=pnpm&logoColor=white&style=for-the-badge" alt="pnpm 9+">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

_Accelerating Scientific Discovery_ — Turn one researcher into an always-on autonomous research lab that investigates, builds, and publishes.

## Features

- ✅ Deep Research skills for paper search, grounded QA, figure extraction, summaries, and D2 block diagrams.
- ✅ provider runtime support for OpenAI, Anthropic, Gemini, MiniMax, and xAI.
- ✅⏳ Multi-project, multi-agent local workspace with CLI and Telegram control.
- ⏳ Coming: run experiments on Google Colab notebooks or external GPU servers.
- ⏳ Coming: LaTeX-format paper generation.

**Note:** OpenColab is an early-stage, actively evolving project. Features and documentation are rapidly improving—feedback and contributions are welcome!

It combines strategic guidance, parallel investigation, and rigorous synthesis so ideas can move from hypothesis to evidence faster.
The vision is an always-on lab where the research-agent expert group leads execution with discipline, while the human defines initial goals and supports with coordination, key decisions, and key activities.

Check [docs/VISION.md](docs/VISION.md) to see project direction.

## How It Works

```text
+-----------------------+
| Human (Assistant)     | <-------------|
+-----------+-----------+               |
            ^                           |
            |                           |
            v                           |
+-----------------------+               |
| Shared goals and plan |               |
+-----------+-----------+               |
            ^                           |
            |                           |
            v                           |
+-----------------------+      +------------------+
| Professor (Lead)      | <--> | Beginner Student |
| coordinates execution |      | naive questions  |
+-----------+-----------+      +--------+---------+
            ^                           |
            |                           v
            v
+-----------------------------------------------+
| PhD Students                                  |
| A: literature  B: experiments  C: synthesis   |
+-----------+-----------------------------------+
            ^
            |
            v
+-----------------------+
| Feedback to Human     |
+-----------------------+
```

Current minimalistic Architecture:

`Telegram -> Gateway -> Active Project -> Active Agent`

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/jimezsa/opencolab/main/install.sh | bash
```

The installer clones OpenColab to `~/.opencolab`, creates `~/.local/bin/opencolab`, and updates your shell PATH profile when needed.
On macOS, if `opencolab` is not immediately available, run:

```bash
source ~/.zprofile
```

## Quickstart (Recommended)

Run interactive first-run setup:

```bash
opencolab ignite
```

`ignite` initializes state, lets you choose or create a project, configures the active provider and model, optionally stores built-in tool keys, and walks through Telegram setup and pairing.

Then start the local gateway:

```bash
opencolab gateway start --port 4646
```

`gateway start` runs as a background service by default on macOS/Linux. If you want to run it in the active terminal process, use:

```bash
opencolab gateway start --foreground true --port 4646
```

## Technical Guide

For provider auth modes, manual `git clone` setup, gateway and webhook behavior, command reference, agent contract, configuration, and development commands, see [TECHNICAL.md](TECHNICAL.md).

## Inspiration

- openclaw: https://github.com/openclaw/openclaw
- nanoclaw: https://github.com/qwibitai/nanoclaw

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

- `PageIndex`: https://github.com/VectifyAI/PageIndex - used by the shared `pageindex-grounded` workflow for grounded local paper QA.
- `d2`: https://github.com/terrastruct/d2 - used by the shared `block-diagram` workflow for deterministic diagram generation.
- `PyMuPDF`: https://github.com/pymupdf/PyMuPDF - used by the shared `pdf-figure-extract` workflow for local PDF figure extraction.
