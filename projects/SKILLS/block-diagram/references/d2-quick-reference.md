# D2 Quick Reference

Use these patterns when writing the canonical `.d2` source.

## Minimal left-to-right flow

```d2
direction: right

client: Client
api: API
db: Database

client -> api
api -> db
```

## Containers

```d2
direction: right

clients: Clients {
  browser: Browser
  mobile: Mobile App
}

backend: Backend {
  gateway: Gateway
  worker: Worker
}

data: Data {
  primary: Primary DB
}

clients.browser -> backend.gateway
clients.mobile -> backend.gateway
backend.gateway -> backend.worker
backend.worker -> data.primary
```

## Node style block

```d2
encoder: Feature Encoder {
  style: {
    fill: "#eef7ec"
    stroke: "#4e9c68"
  }
}
```

## Important practical rules

- Start with `direction: right` unless a top-down layout is clearly better.
- Prefer short node labels such as `Feature Encoder`, not full sentences.
- Prefer unlabeled edges by default.
- Add edge labels only for concrete semantics such as `HTTPS`, `embeddings`, or `weights`.
- Do not use generic labels such as `input`, `output`, `data`, or `result`.
- Use container titles for subsystem names and node labels for concrete components.
- Keep syntax simple. Do not rely on advanced D2 features unless the diagram actually needs them.
