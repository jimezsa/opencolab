# Common Patterns

Choose one dominant pattern before writing the `.d2` file.

## 1. Pipeline

Use for research models, ETL, media processing, and staged workflows.

Structure:

- input
- one or more transformation stages
- output

Best when:

- data moves in one dominant direction
- each stage has a clear role

## 2. Layered System

Use for software stacks and platform architecture.

Structure:

- client or interface layer
- application or service layer
- data or infrastructure layer

Best when:

- the important story is separation of responsibilities

## 3. Client-Server

Use for apps, APIs, gateways, workers, and databases.

Structure:

- clients
- entrypoint or gateway
- business logic services
- stateful backends

Best when:

- requests fan into a service tier and then into storage or downstream systems

## 4. Event-Driven

Use for queues, streams, consumers, and asynchronous workflows.

Structure:

- producers
- queue, bus, or stream
- consumers
- stores or sinks

Best when:

- the architecture depends on decoupled asynchronous flow

## 5. Training and Inference Split

Use for ML systems where offline training and online serving should not be mixed into one vague path.

Structure:

- training data and training pipeline
- model artifact
- online inference path

Best when:

- the user mentions models, retraining, checkpoints, or serving

## 6. Overview Plus Detail

Use when one diagram would become dense or unreadable.

Structure:

- Diagram A: the high-level overview
- Diagram B: one detailed subsystem

Best when:

- there are too many blocks for a single readable view
- the architecture has one subsystem that deserves a closer look
