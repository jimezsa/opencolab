# Document Types and Build Setup

Use the smallest document structure that answers the user's request.

## Paper Draft

Recommended sections:

- abstract
- introduction
- related work
- method
- experiments
- limitations
- conclusion

Use this when the user asks for a conference paper, arXiv-style paper, method
paper, or experiment-backed manuscript.

## Survey or Research Summary

Recommended sections:

- executive summary
- scope and corpus
- taxonomy
- method comparison
- benchmark or evidence table
- open problems
- references

Use this for `deep-research`, `pro-research`, or `fast-research` outputs.

## Technical Report

Recommended sections:

- summary
- background
- system or method description
- evidence and experiments
- recommendations
- limitations

Use this for internal research notes, experiment reports, and non-submission
PDF deliverables.

## Local LaTeX Build Requirements

Prefer `latexmk`:

```bash
latexmk -v
```

Common install options:

```bash
# macOS full install
brew install --cask mactex

# macOS smaller install
brew install --cask basictex
sudo tlmgr update --self
sudo tlmgr install latexmk

# Debian or Ubuntu
sudo apt-get update
sudo apt-get install -y latexmk texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended

# Fedora
sudo dnf install latexmk texlive-scheme-medium

# Arch Linux
sudo pacman -S texlive-binextra texlive-latexrecommended texlive-latexextra
```

On Windows, install MiKTeX or TeX Live, enable package installation, ensure the
TeX binary directory is on `PATH`, and verify with `latexmk -v`.

Do not run installation commands without explicit user approval.
