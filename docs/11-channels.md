# 11 — Channels

Channels are adapters around external communication platforms.

## Interface

```ts
interface Channel {
  name: string;
  receive(): Promise<IncomingMessage>;
  send(message: OutgoingMessage): Promise<void>;
}
```

## Planned channels

- CLI
- Web
- Telegram
- WhatsApp
- Discord
- REST/WebSocket

## Message normalization

All channel-specific messages should become a common internal format before entering the Agent Runtime.
