"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "@/components/Markdown";

type Role = "user" | "assistant";
type Msg = { role: Role; content: string; ts: number; debug?: string };
type Chat = { id: string; title: string; messages: Msg[] };

const LS_KEY = "intelbot_chats_v1";
const STATUSES = [
  "Searching the knowledge base…",
  "Consulting the analysis engines…",
  "Cross-checking sources…",
  "Synthesising the answer…",
];

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function Home() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(STATUSES[0]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed: Chat[] = JSON.parse(raw);
        if (parsed.length) {
          setChats(parsed);
          setActiveId(parsed[0].id);
          return;
        }
      }
    } catch {}
    const c = { id: uid(), title: "New chat", messages: [] };
    setChats([c]);
    setActiveId(c.id);
  }, []);

  useEffect(() => {
    if (chats.length) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(chats));
      } catch {}
    }
  }, [chats]);

  useEffect(() => {
    if (!loading) return;
    let i = 0;
    const t = setInterval(() => {
      i = (i + 1) % STATUSES.length;
      setStatus(STATUSES[i]);
    }, 4000);
    return () => clearInterval(t);
  }, [loading]);

  const active = chats.find((c) => c.id === activeId);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages.length, loading]);

  function newChat() {
    const c = { id: uid(), title: "New chat", messages: [] };
    setChats((prev) => [c, ...prev]);
    setActiveId(c.id);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading || !active) return;
    setInput("");
    const userMsg: Msg = { role: "user", content: text, ts: Date.now() };
    setChats((prev) =>
      prev.map((c) =>
        c.id === activeId
          ? {
              ...c,
              title: c.messages.length === 0 ? text.slice(0, 42) : c.title,
              messages: [...c.messages, userMsg],
            }
          : c
      )
    );
    setLoading(true);
    setStatus(STATUSES[0]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId: activeId,
          history: active.messages,
        }),
      });
      const data = await res.json();
      const reply = (data?.reply ?? "No response.").toString();
      // Dev-only debug line (server only sends `debug` outside production).
      let debug: string | undefined;
      if (data?.debug) {
        const d = data.debug;
        debug = d.error
          ? `⚠ brain error: ${d.error}`
          : `engines: ${d.engines} · retrieved ${d.retrieved} notes · ${
              d.totalMs
            }ms\n${(d.sources ?? []).join("\n")}`;
      }
      setChats((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  { role: "assistant", content: reply, ts: Date.now(), debug },
                ],
              }
            : c
        )
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      setChats((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  { role: "assistant", content: "Error: " + msg, ts: Date.now() },
                ],
              }
            : c
        )
      );
    } finally {
      setLoading(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="hidden md:flex w-64 flex-col bg-[#0a1018] border-r border-[#1c2838]">
        <div className="p-3">
          <button
            onClick={newChat}
            className="w-full rounded-lg border border-[#2a3a52] px-3 py-2 text-sm text-left hover:bg-[#13202f] transition-colors"
          >
            + New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {chats.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`w-full truncate rounded-md px-3 py-2 text-sm text-left transition-colors ${
                c.id === activeId ? "bg-[#16263a]" : "hover:bg-[#111c29]"
              }`}
            >
              {c.title || "New chat"}
            </button>
          ))}
        </div>
        <div className="p-3 text-xs text-[#5b6b80] border-t border-[#1c2838]">
          IntelBot · Noonan
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="px-4 py-3 border-b border-[#1c2838] flex items-center gap-2">
          <span className="font-semibold">IntelBot</span>
          <span className="text-xs text-[#5b6b80] truncate">
            Noonan · grounded in your knowledge base
          </span>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto w-full px-4 py-6 space-y-6">
            {active && active.messages.length === 0 && !loading && (
              <div className="text-center text-[#5b6b80] mt-20">
                <div className="text-2xl font-semibold text-[#cdd9e8]">
                  How can I help?
                </div>
                <div className="mt-2 text-sm">
                  Ask about ASX, markets, NSW property, or anything in Noonan&apos;s
                  knowledge base.
                </div>
              </div>
            )}
            {active?.messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "flex justify-end"
                    : "flex flex-col items-start"
                }
              >
                <div
                  className={`rounded-2xl px-4 py-3 leading-relaxed text-[15px] ${
                    m.role === "user"
                      ? "bg-[#1e3a5f] max-w-[80%] whitespace-pre-wrap"
                      : "bg-[#0f1825] border border-[#1c2838] max-w-[90%]"
                  }`}
                >
                  {m.role === "assistant" ? <Markdown>{m.content}</Markdown> : m.content}
                </div>
                {m.debug && (
                  <div className="mt-1 max-w-[90%] rounded-md bg-[#0b121c] border border-[#1c2838] px-3 py-2 text-[10px] font-mono text-[#7a8da3] whitespace-pre-wrap break-all">
                    {m.debug}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-4 py-3 bg-[#0f1825] border border-[#1c2838] text-[#8aa0bb] text-sm flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-[#4a90d9] animate-pulse" />
                  {status}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-[#1c2838] p-3">
          <div className="max-w-3xl mx-auto w-full flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder="Message IntelBot…"
              className="flex-1 resize-none rounded-xl bg-[#0f1825] border border-[#2a3a52] px-4 py-3 text-sm outline-none focus:border-[#4a90d9] max-h-40"
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="rounded-xl bg-[#2b6fb3] disabled:opacity-40 px-4 py-3 text-sm font-medium hover:bg-[#357ec7] transition-colors"
            >
              Send
            </button>
          </div>
          <div className="max-w-3xl mx-auto text-center text-[10px] text-[#5b6b80] mt-2">
            Deep answers take 2–5 min. Guidance based on NSW/Australian frameworks —
            not legal advice.
          </div>
        </div>
      </main>
    </div>
  );
}
