# Conference Map

Use this reference to choose a starter template. These templates are
venue-aware, not a substitute for verified official conference files.

## Selection Rules

1. Preserve the existing template when editing an existing paper.
2. Use a bundled exact family when the user names one.
3. Use a close family when the venue is known but not bundled.
4. Use `generic-paper`, `generic-survey`, or `generic-technical-report` when no
   venue is known.
5. Do not claim official compliance unless the exact official template is
   bundled, user-supplied, or otherwise verified.

## Venue Families

| User venue | Canonical venue | Template family | Notes |
| --- | --- | --- | --- |
| ICLR, ICRL | ICLR | `iclr` | Treat `ICRL` as a likely typo only when context is ML conference writing. |
| NeurIPS, NIPS | NeurIPS | `neurips` | Non-official starter unless official files are supplied. |
| ICML | ICML | `icml` | Non-official starter unless official files are supplied. |
| CVPR | CVPR | `cvpr` | Computer-vision starter. |
| ICCV, ECCV, WACV, BMVC | ICCV/ECCV family | `iccv-eccv` | Use for two-column CV-style drafts. |
| ACL, EMNLP, NAACL, COLING, EACL | ACL family | `acl` | NLP/LLM writing starter. |
| AAAI, IJCAI, ECAI | AAAI/IJCAI family | `aaai` | General AI writing starter. |
| KDD, SIGIR, WSDM, RecSys, CIKM, WWW, The WebConf | ACM family | `acm` | Data mining, IR, recommender, and web venues. |
| ACM MM, CHI, CSCW, UIST, IUI | ACM family | `acm` | Multimedia and HCI venues. |
| ICRA, IROS, ICASSP, ICME, ISBI | IEEE family | `ieee` | Robotics, audio, multimedia, and imaging venues. |
| MLSys | Generic paper | `generic-paper` | Use unless a user supplies official MLSys files. |
| MICCAI, MIDL | Generic paper | `generic-paper` | Use unless a medical-imaging template is supplied. |
| SIGGRAPH, SIGGRAPH Asia, Eurographics, 3DV | Generic technical report | `generic-technical-report` | Graphics papers often need specific official templates. |
| USENIX Security, IEEE S&P, CCS, NDSS, PETS | Generic paper | `generic-paper` | Use unless the user supplies venue files. |

## Document Type Fallbacks

| Request | Template |
| --- | --- |
| "paper", "draft", "submission" | `generic-paper` |
| "survey", "literature review", "deep-research summary" | `generic-survey` |
| "technical report", "experiment report", "internal report" | `generic-technical-report` |

