# ADR-0004: PostgreSQL as Initial Primary Storage

## Status

Accepted

## Context

Sessions, messages, runs, memories and audit records require durable relational storage.

## Decision

Use PostgreSQL as the initial primary database.

## Consequences

- Strong relational model
- Mature ecosystem
- JSON support
- Easy operational deployment

Vector retrieval remains an optional separate concern.
