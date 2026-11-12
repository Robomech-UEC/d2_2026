import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useDispatch } from 'react-redux';
import type { Command, Request, ServerMessage } from '../../shared/model.js';
import { receiveSnapshot } from './store.js';

type Connection = { connected: boolean; offset: number; error: string | null; dismissError: () => void; send: (command: Command) => Promise<void> };
const Context = createContext<Connection | null>(null);
export function ConnectionProvider({ children }: { children: ReactNode }) {
  const dispatch = useDispatch();
  const socket = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>());
  const [connected, setConnected] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout>;
    let pingTimer: ReturnType<typeof setInterval>;
    function rejectPending() {
      pending.current.forEach(p => { clearTimeout(p.timeout); p.reject(new Error('接続が切れました。再接続後に最新の状態を確認してください。')); });
      pending.current.clear();
    }
    function connect() {
      if (disposed) return;
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      socket.current = ws;
      const ping = () => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', sentAt: Date.now() })); };
      ws.onopen = () => { ping(); pingTimer = setInterval(ping, 15_000); };
      ws.onmessage = event => {
        if (disposed) return;
        const message = JSON.parse(event.data as string) as ServerMessage;
        if (message.type === 'welcome' || message.type === 'state') {
          dispatch(receiveSnapshot(message.state));
          if (message.type === 'welcome') { setOffset(message.time - Date.now()); setConnected(true); }
        } else if (message.type === 'pong') setOffset(message.time - (message.sentAt + Date.now()) / 2);
        else if (message.type === 'ack' || message.type === 'error') {
          const item = message.requestId ? pending.current.get(message.requestId) : undefined;
          if (item && message.requestId) {
            clearTimeout(item.timeout); pending.current.delete(message.requestId);
            if (message.type === 'ack') item.resolve(); else item.reject(new Error(message.message));
          }
          if (message.type === 'error') setError(message.message);
        }
      };
      ws.onclose = () => {
        clearInterval(pingTimer); rejectPending();
        if (!disposed) { setConnected(false); reconnect = setTimeout(connect, 1000); }
      };
      ws.onerror = () => ws.close();
    }
    connect();
    const requests = pending.current;
    return () => { disposed = true; clearTimeout(reconnect); clearInterval(pingTimer); socket.current?.close(); requests.forEach(p => { clearTimeout(p.timeout); p.reject(new Error('画面を終了しました。')); }); requests.clear(); };
  }, [dispatch]);
  async function send(command: Command) {
    const ws = socket.current;
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) throw new Error('サーバに再接続してから操作してください。');
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { pending.current.delete(requestId); const message = '応答を確認できませんでした。最新の個数を確認してから操作してください。'; setError(message); reject(new Error(message)); }, 15_000);
      pending.current.set(requestId, { resolve, reject, timeout });
      const request: Request = { type: 'command', requestId, command };
      ws.send(JSON.stringify(request));
    });
  }
  return <Context.Provider value={{ connected, offset, error, dismissError: () => setError(null), send }}>{children}</Context.Provider>;
}
export function useConnection() { const context = useContext(Context); if (!context) throw new Error('ConnectionProvider missing'); return context; }
export function useNow() {
  const { offset } = useConnection();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(timer); }, []);
  return now + offset;
}
