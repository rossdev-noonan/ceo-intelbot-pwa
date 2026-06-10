"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "@/components/Markdown";
import SettingsModal from "@/components/SettingsModal";
import ProjectModal from "@/components/ProjectModal";
import {
  downloadMarkdown,
  downloadCsv,
  markdownTablesToCsv,
  printAnswer,
  downloadHtml,
  downloadWord,
  downloadExcel,
  downloadText,
  downloadJson,
} from "@/lib/export";
import {
  DEFAULT_SETTINGS,
  DEFAULT_CONNECTORS,
  DEPTHS,
  type Depth,
  type Project,
  type Settings,
} from "@/lib/uiTypes";

type Role = "user" | "assistant";
type Msg = { role: Role; content: string; ts: number; debug?: string; id?: string; attachmentName?: string };
type Attachment = { name: string; text: string };
type Chat = { id: string; title: string; projectId: string; messages: Msg[] };

const LS_KEY = "intelbot_chats_v1";
const LS_PROJECTS = "intelbot_projects_v1";
const LS_SETTINGS = "intelbot_settings_v1";

const STATUSES = [
  "Searching the knowledge base…",
  "Consulting the analysis engines…",
  "Cross-checking sources…",
  "Synthesising the answer…",
];

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const EXPORT_BTN =
  "rounded-md border border-[#243449] px-2 py-1 text-[#8aa0bb] hover:bg-[#13202f] hover:text-[#cdd9e8] transition-colors";

export default function Home() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  // Per-chat so a stream in one chat doesn't block sending in another.
  const [loadingChats, setLoadingChats] = useState<Record<string, boolean>>({});
  const [streamingChats, setStreamingChats] = useState<Record<string, boolean>>({});
  const [statusByChat, setStatusByChat] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"team" | "agent">("team");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectModal, setProjectModal] = useState<{ project: Project; isNew: boolean } | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attaching, setAttaching] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-grow the composer so long queries are fully visible (no input cap).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 192) + "px"; // matches max-h-48
  }, [input]);

  // Load projects, settings, and chats (with migration to the project model).
  useEffect(() => {
    let projs: Project[] = [];
    try {
      projs = JSON.parse(localStorage.getItem(LS_PROJECTS) || "[]");
    } catch {}
    if (!Array.isArray(projs) || projs.length === 0) {
      projs = [{ id: uid(), name: "General", instructions: "" }];
    }
    const defaultPid = projs[0].id;

    let st: Settings = DEFAULT_SETTINGS;
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      if (raw) {
        const p = JSON.parse(raw);
        st = {
          globalInstructions: p.globalInstructions ?? "",
          connectors: { ...DEFAULT_CONNECTORS, ...(p.connectors || {}) },
          depth: p.depth ?? "auto",
        };
      }
    } catch {}

    let cs: Chat[] = [];
    try {
      cs = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch {}
    if (!Array.isArray(cs)) cs = [];
    const pids = new Set(projs.map((p) => p.id));
    cs = cs.map((c) => ({
      ...c,
      projectId: c.projectId && pids.has(c.projectId) ? c.projectId : defaultPid,
    }));
    if (cs.length === 0) {
      cs = [{ id: uid(), title: "New chat", projectId: defaultPid, messages: [] }];
    }

    setProjects(projs);
    setSettings(st);
    setChats(cs);
    setActiveId(cs[0].id);
  }, []);

  useEffect(() => {
    if (chats.length) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(chats));
      } catch {}
    }
  }, [chats]);

  useEffect(() => {
    if (projects.length) {
      try {
        localStorage.setItem(LS_PROJECTS, JSON.stringify(projects));
      } catch {}
    }
  }, [projects]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
    } catch {}
  }, [settings]);

  const active = chats.find((c) => c.id === activeId);
  const activeLoading = active ? !!loadingChats[active.id] : false;
  const activeStreaming = active ? !!streamingChats[active.id] : false;
  const activeStatus = (active ? statusByChat[active.id] : "") || STATUSES[0];
  const activeProject = projects.find((p) => p.id === active?.projectId) ?? projects[0];
  const combinedInstructions = [settings.globalInstructions, activeProject?.instructions]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join("\n\n");

  // Pin a question near the top of the view (ChatGPT-style) so it stays visible
  // while the answer streams below it. Sets scrollTop directly on the container
  // (reliable — scrollIntoView fought the streaming re-renders).
  function scrollQuestionToTop(id: string) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const container = scrollRef.current;
        const el = container?.querySelector(`[data-msg-id="${id}"]`) as HTMLElement | null;
        if (container && el) container.scrollTop = Math.max(0, el.offsetTop - 12);
      })
    );
  }

  // When switching INTO a chat, bring its latest question to the top so the view
  // reads as a conversation (question above answer), not just a wall of answer.
  useEffect(() => {
    if (!active) return;
    const lastUser = [...active.messages].reverse().find((m) => m.role === "user");
    if (lastUser?.id) scrollQuestionToTop(lastUser.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  function newChat(projectId?: string) {
    const pid = projectId ?? activeProject?.id ?? projects[0]?.id;
    if (!pid) return;
    const c = { id: uid(), title: "New chat", projectId: pid, messages: [] };
    setChats((prev) => [c, ...prev]);
    setActiveId(c.id);
    setCollapsed((prev) => ({ ...prev, [pid]: false }));
  }

  function deleteChat(id: string) {
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (id === activeId) {
        if (next.length) {
          setActiveId(next[0].id);
        } else {
          const pid = activeProject?.id ?? projects[0]?.id ?? uid();
          const c = { id: uid(), title: "New chat", projectId: pid, messages: [] };
          setActiveId(c.id);
          return [c];
        }
      }
      return next;
    });
  }

  function startRename(id: string, current: string) {
    setEditingId(id);
    setEditingTitle(current === "New chat" ? "" : current);
  }

  function commitRename() {
    const id = editingId;
    if (!id) return;
    const title = editingTitle.trim();
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title: title || c.title } : c)));
    setEditingId(null);
    setEditingTitle("");
  }

  function newProject() {
    setProjectModal({ project: { id: uid(), name: "", instructions: "" }, isNew: true });
  }

  function saveProject(p: Project, isNew: boolean) {
    setProjects((prev) => (prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]));
    if (isNew) {
      const c = { id: uid(), title: "New chat", projectId: p.id, messages: [] };
      setChats((prev) => [c, ...prev]);
      setActiveId(c.id);
    }
  }

  function deleteProject(id: string) {
    if (projects.length <= 1) {
      alert("You need at least one project.");
      return;
    }
    if (!confirm("Delete this project? Its chats move to another project.")) return;
    const remaining = projects.filter((p) => p.id !== id);
    const fallback = remaining[0].id;
    setProjects(remaining);
    setChats((prev) => prev.map((c) => (c.projectId === id ? { ...c, projectId: fallback } : c)));
  }

  async function send() {
    let text = input.trim();
    if ((!text && !attachment) || !active || loadingChats[active.id]) return;
    if (!text && attachment) text = `Please analyse the attached document "${attachment.name}".`;
    const chatId = active.id; // capture — the user may switch chats mid-stream
    const sentAttachment = attachment;
    setInput("");
    setAttachment(null);
    const userMsg: Msg = {
      role: "user",
      content: text,
      ts: Date.now(),
      id: uid(),
      attachmentName: sentAttachment?.name,
    };
    const assistantId = uid();
    const history = active.messages;
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId
          ? {
              ...c,
              title: c.messages.length === 0 ? text.slice(0, 42) : c.title,
              messages: [...c.messages, userMsg],
            }
          : c
      )
    );
    setLoadingChats((p) => ({ ...p, [chatId]: true }));
    setStreamingChats((p) => ({ ...p, [chatId]: false }));
    setStatusByChat((p) => ({ ...p, [chatId]: STATUSES[0] }));
    scrollQuestionToTop(userMsg.id!);

    let started = false;
    let acc = "";
    const upsert = (content: string, debug?: string) => {
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== chatId) return c;
          const msgs = [...c.messages];
          if (started) {
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content, debug };
          } else {
            msgs.push({ role: "assistant", content, ts: Date.now(), debug, id: assistantId });
          }
          return { ...c, messages: msgs };
        })
      );
      started = true;
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId: chatId,
          history,
          mode,
          instructions: combinedInstructions,
          connectors: settings.connectors,
          depth: settings.depth,
          attachment: sentAttachment ?? undefined,
        }),
      });
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let debugStr: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          let evt: {
            type: string;
            stage?: string;
            text?: string;
            error?: string;
            debug?: { engines?: string; retrieved?: number; totalMs?: number; sources?: string[] };
          };
          try {
            evt = JSON.parse(t);
          } catch {
            continue;
          }
          if (evt.type === "status") {
            setStatusByChat((p) => ({ ...p, [chatId]: evt.stage ?? "" }));
          } else if (evt.type === "delta") {
            acc += evt.text ?? "";
            setStreamingChats((p) => ({ ...p, [chatId]: true }));
            upsert(acc, debugStr);
          } else if (evt.type === "error") {
            acc += (acc ? "\n\n" : "") + "⚠ " + (evt.error ?? "error");
            upsert(acc, debugStr);
          } else if (evt.type === "done") {
            const d = evt.debug;
            if (d) {
              debugStr = `engines: ${d.engines} · retrieved ${d.retrieved} notes · ${d.totalMs}ms\n${(
                d.sources ?? []
              ).join("\n")}`;
              upsert(acc, debugStr);
            }
          }
        }
      }
      if (!started) upsert("No response.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      upsert((acc ? acc + "\n\n" : "") + "Error: " + msg);
    } finally {
      setLoadingChats((p) => ({ ...p, [chatId]: false }));
      setStreamingChats((p) => ({ ...p, [chatId]: false }));
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setAttaching(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({ error: "Bad response" }));
      if (!res.ok || data.error) alert(data.error || "Could not read that file.");
      else setAttachment({ name: data.name, text: data.text });
    } catch (err) {
      alert("Upload failed: " + (err instanceof Error ? err.message : "error"));
    } finally {
      setAttaching(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function getMsgEl(id?: string): HTMLElement | null {
    return id ? (document.querySelector(`[data-msg-id="${id}"]`) as HTMLElement | null) : null;
  }
  function getTables(el: HTMLElement | null): string[] {
    if (!el) return [];
    return [...el.querySelectorAll("table")].map((t) => t.outerHTML);
  }
  function menuItem(
    label: string,
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void,
    disabled = false
  ) {
    return (
      <button
        key={label}
        disabled={disabled}
        onClick={(e) => {
          onClick(e);
          (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
        }}
        className={`block w-full text-left rounded px-2 py-1.5 ${
          disabled ? "text-[#42536b] cursor-not-allowed" : "text-[#cdd9e8] hover:bg-[#16263a]"
        }`}
      >
        {label}
      </button>
    );
  }

  function chatRow(c: Chat) {
    return (
      <div
        key={c.id}
        className={`group flex items-center rounded-md transition-colors ${
          c.id === activeId ? "bg-[#16263a]" : "hover:bg-[#111c29]"
        }`}
      >
        {editingId === c.id ? (
          <input
            autoFocus
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setEditingId(null);
                setEditingTitle("");
              }
            }}
            placeholder="Chat name"
            className="flex-1 min-w-0 bg-transparent px-3 py-2 text-sm outline-none border border-[#2b6fb3] rounded-md"
          />
        ) : (
          <button
            onClick={() => setActiveId(c.id)}
            onDoubleClick={() => startRename(c.id, c.title)}
            title="Double-click to rename"
            className="flex-1 min-w-0 truncate px-3 py-2 text-sm text-left"
          >
            {c.title || "New chat"}
          </button>
        )}
        {loadingChats[c.id] && (
          <span
            className="mr-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[#4a90d9] animate-pulse group-hover:hidden"
            title="Working…"
          />
        )}
        {editingId !== c.id && (
          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity pr-1">
            <button onClick={() => startRename(c.id, c.title)} title="Rename" className="rounded p-1 text-[#6b7d94] hover:text-[#cdd9e8]">
              ✎
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete chat "${c.title || "New chat"}"?`)) deleteChat(c.id);
              }}
              title="Delete"
              className="rounded p-1 text-[#6b7d94] hover:text-[#e2728a]"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="hidden md:flex w-64 flex-col bg-[#0a1018] border-r border-[#1c2838]">
        <div className="p-3 space-y-2">
          <button
            onClick={() => newChat()}
            className="w-full rounded-lg border border-[#2a3a52] px-3 py-2 text-sm text-left hover:bg-[#13202f] transition-colors"
          >
            + New chat
          </button>
          <button
            onClick={newProject}
            className="w-full rounded-lg px-3 py-1.5 text-xs text-left text-[#8aa0bb] hover:bg-[#13202f] transition-colors"
          >
            + New project
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-2">
          {projects.map((p) => {
            const pchats = chats.filter((c) => c.projectId === p.id);
            const isCollapsed = collapsed[p.id];
            return (
              <div key={p.id}>
                <div className="group flex items-center rounded-md px-1 hover:bg-[#0d1622]">
                  <button
                    onClick={() => setCollapsed((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                    className="flex-1 min-w-0 flex items-center gap-1 px-1 py-1.5 text-left"
                  >
                    <span className="text-[#5b6b80] text-[10px] w-3">{isCollapsed ? "▸" : "▾"}</span>
                    <span className="truncate text-xs font-semibold uppercase tracking-wide text-[#7a8da3]">
                      {p.name}
                    </span>
                    <span className="text-[10px] text-[#4a5a70]">{pchats.length}</span>
                  </button>
                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => newChat(p.id)} title="New chat in project" className="rounded p-1 text-[#6b7d94] hover:text-[#cdd9e8]">
                      ＋
                    </button>
                    <button onClick={() => setProjectModal({ project: p, isNew: false })} title="Project settings" className="rounded p-1 text-[#6b7d94] hover:text-[#cdd9e8]">
                      ✎
                    </button>
                    <button onClick={() => deleteProject(p.id)} title="Delete project" className="rounded p-1 text-[#6b7d94] hover:text-[#e2728a]">
                      ✕
                    </button>
                  </div>
                </div>
                {!isCollapsed && (
                  <div className="space-y-1 pl-2 mt-1">
                    {pchats.length === 0 && (
                      <div className="px-3 py-1 text-xs text-[#4a5a70]">No chats yet</div>
                    )}
                    {pchats.map((c) => chatRow(c))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-[#1c2838] flex items-center justify-between">
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-md px-2 py-1 text-xs text-[#8aa0bb] hover:bg-[#13202f] hover:text-[#cdd9e8] transition-colors"
          >
            ⚙ Settings &amp; Connectors
          </button>
          <span className="text-xs text-[#5b6b80]">Noonan</span>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="px-4 py-3 border-b border-[#1c2838] flex items-center gap-2">
          <span className="font-semibold">IntelBot</span>
          <span className="hidden sm:inline text-xs text-[#5b6b80] truncate">
            {activeProject ? activeProject.name : "Noonan"} · grounded in your knowledge base
          </span>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <select
              value={settings.depth}
              onChange={(e) => setSettings((s) => ({ ...s, depth: e.target.value as Depth }))}
              title={DEPTHS.find((d) => d.id === settings.depth)?.hint}
              className="rounded-lg border border-[#243449] bg-[#0d1622] px-2 py-1.5 text-[#cdd9e8] outline-none hover:border-[#2b6fb3] cursor-pointer"
            >
              {DEPTHS.map((d) => (
                <option key={d.id} value={d.id} className="bg-[#0d1622]">
                  {d.label}
                </option>
              ))}
            </select>
            <div className="flex items-center rounded-lg border border-[#243449] p-0.5">
              <button
                onClick={() => setMode("team")}
                title="Three models (GPT-5.5 + Claude + Perplexity) fan out and a synthesiser merges them."
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  mode === "team" ? "bg-[#1e3a5f] text-white" : "text-[#8aa0bb] hover:text-[#cdd9e8]"
                }`}
              >
                Team
              </button>
              <button
                onClick={() => setMode("agent")}
                title="Agent uses tools (vault search, web search, fetch any website incl. competitors) to research before answering."
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  mode === "agent" ? "bg-[#1e3a5f] text-white" : "text-[#8aa0bb] hover:text-[#cdd9e8]"
                }`}
              >
                Agent
              </button>
            </div>
          </div>
        </header>

        <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto w-full px-4 py-6 space-y-6">
            {active && active.messages.length === 0 && !activeLoading && (
              <div className="text-center text-[#5b6b80] mt-20">
                <div className="text-2xl font-semibold text-[#cdd9e8]">How can I help?</div>
                <div className="mt-2 text-sm">
                  Ask about NSW property, tenancy law, or anything in Noonan&apos;s knowledge base.
                </div>
              </div>
            )}
            {active?.messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start"}>
                <div
                  data-msg-id={m.id}
                  className={`rounded-2xl px-4 py-3 leading-relaxed text-[15px] ${
                    m.role === "user"
                      ? "bg-[#1e3a5f] max-w-[80%] whitespace-pre-wrap"
                      : "bg-[#0f1825] border border-[#1c2838] max-w-[90%]"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <Markdown>{m.content}</Markdown>
                  ) : (
                    (() => {
                      const long = m.content.length > 420;
                      const exp = m.id ? expanded[m.id] : false;
                      return (
                        <>
                          {m.attachmentName && (
                            <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[#16263a] px-2 py-1 text-xs text-[#9ccbf7]">
                              📎 {m.attachmentName}
                            </div>
                          )}
                          <div className={long && !exp ? "max-h-28 overflow-hidden" : ""}>
                            {m.content}
                          </div>
                          {long && (
                            <button
                              onClick={() =>
                                m.id && setExpanded((p) => ({ ...p, [m.id!]: !exp }))
                              }
                              className="mt-1 text-xs text-[#9ccbf7] hover:underline"
                            >
                              {exp ? "Show less ▲" : "Show more ▼"}
                            </button>
                          )}
                        </>
                      );
                    })()
                  )}
                </div>
                {m.role === "assistant" &&
                  m.content &&
                  !(activeLoading && i === (active?.messages.length ?? 0) - 1) &&
                  (() => {
                    const q = active?.messages[i - 1]?.content;
                    const title = (q || active?.title || "intelbot-answer").slice(0, 60);
                    const hasTables = markdownTablesToCsv(m.content) !== null;
                    return (
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                        <button className={EXPORT_BTN} onClick={() => navigator.clipboard?.writeText(m.content)}>
                          Copy
                        </button>
                        <details className="relative">
                          <summary
                            className={`${EXPORT_BTN} cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden`}
                          >
                            ⬇ Download
                          </summary>
                          <div className="absolute z-20 mt-1 w-40 rounded-lg border border-[#243449] bg-[#0d1622] p-1 shadow-xl">
                            {menuItem("PDF", () => {
                              const el = getMsgEl(m.id);
                              if (el) printAnswer(el.innerHTML, title, q);
                            })}
                            {menuItem("Word (.doc)", () => {
                              const el = getMsgEl(m.id);
                              if (el) downloadWord(el.innerHTML, title, q);
                            })}
                            {menuItem(
                              "Excel (.xls)",
                              () => downloadExcel(getTables(getMsgEl(m.id)), title),
                              !hasTables
                            )}
                            {menuItem("HTML", () => {
                              const el = getMsgEl(m.id);
                              if (el) downloadHtml(el.innerHTML, title, q);
                            })}
                            {menuItem("Markdown (.md)", () => downloadMarkdown(m.content, title))}
                            {menuItem("Text (.txt)", () => {
                              const el = getMsgEl(m.id);
                              downloadText(el ? el.innerText : m.content, title);
                            })}
                            {menuItem("CSV", () => downloadCsv(m.content, title), !hasTables)}
                            {menuItem("JSON", () => downloadJson(m.content, title, q))}
                          </div>
                        </details>
                      </div>
                    );
                  })()}
                {m.debug && (
                  <div className="mt-1 max-w-[90%] rounded-md bg-[#0b121c] border border-[#1c2838] px-3 py-2 text-[10px] font-mono text-[#7a8da3] whitespace-pre-wrap break-all">
                    {m.debug}
                  </div>
                )}
              </div>
            ))}
            {activeLoading && !activeStreaming && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-4 py-3 bg-[#0f1825] border border-[#1c2838] text-[#8aa0bb] text-sm flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-[#4a90d9] animate-pulse" />
                  {activeStatus}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-[#1c2838] p-3">
          {(attachment || attaching) && (
            <div className="max-w-3xl mx-auto w-full mb-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-[#2a3a52] bg-[#0f1825] px-3 py-1.5 text-xs text-[#cdd9e8]">
                📎 {attaching ? "Reading file…" : attachment?.name}
                {attachment && (
                  <button
                    onClick={() => setAttachment(null)}
                    className="text-[#6b7d94] hover:text-[#e2728a]"
                    title="Remove"
                  >
                    ✕
                  </button>
                )}
              </span>
            </div>
          )}
          <div className="max-w-3xl mx-auto w-full flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".pdf,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,.log,text/*"
              onChange={onPickFile}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={attaching}
              title="Attach a document (PDF or text)"
              className="rounded-xl border border-[#2a3a52] px-3 py-3 text-sm text-[#8aa0bb] hover:bg-[#13202f] hover:text-[#cdd9e8] disabled:opacity-40 transition-colors"
            >
              📎
            </button>
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder="Message IntelBot…  (Shift+Enter for a new line)"
              className="flex-1 resize-none rounded-xl bg-[#0f1825] border border-[#2a3a52] px-4 py-3 text-sm outline-none focus:border-[#4a90d9] max-h-48 overflow-y-auto"
            />
            <button
              onClick={send}
              disabled={activeLoading || (!input.trim() && !attachment)}
              className="rounded-xl bg-[#2b6fb3] disabled:opacity-40 px-4 py-3 text-sm font-medium hover:bg-[#357ec7] transition-colors"
            >
              Send
            </button>
          </div>
          <div className="max-w-3xl mx-auto text-center text-[10px] text-[#5b6b80] mt-2">
            Deep answers take 2–5 min. Guidance based on NSW/Australian frameworks — not legal advice.
          </div>
        </div>
      </main>

      {settingsOpen && (
        <SettingsModal settings={settings} onSave={setSettings} onClose={() => setSettingsOpen(false)} />
      )}
      {projectModal && (
        <ProjectModal
          project={projectModal.project}
          isNew={projectModal.isNew}
          onSave={(p) => saveProject(p, projectModal.isNew)}
          onClose={() => setProjectModal(null)}
        />
      )}
    </div>
  );
}
