# ADR-0005: Separate Gateway from Agent Runtime

## Status

Accepted

## Context

BanglaClaw should support multiple channels without coupling channel logic to agent reasoning.

## Decision

Keep Gateway/Channels separate from the LangGraph Agent Runtime.

## Consequences

A Telegram request, web request and CLI request can use the same agent runtime without platform-specific reasoning logic.
