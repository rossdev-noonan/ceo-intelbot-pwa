"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "@/components/Markdown";
import SettingsModal from "@/components/SettingsModal";
import ProjectModal from "@/components/ProjectModal";
import Sources, { DebugTracePanel } from "@/components/Sources";
import FlowLibrary from "@/components/FlowLibrary";
import FlowBuilder from "@/components/FlowBuilder";
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
  saveToSharePoint,
  exportSlug,
} from "@/lib/export";
import {
  DEFAULT_SETTINGS,
  DEFAULT_CONNECTORS,
  DEPTHS,
  defaultFlow,
  type Depth,
  type Flow,
  type Project,
  type Settings,
} from "@/lib/uiTypes";

type Role = "user" | "assistant";
type Msg = {
  role: Role;
  content: string;
  ts: number;
  debug?: string;
  id?: string;
  attachmentNames?: string[];
  images?: string[];
  sources?: { n: number; file: string; heading: string }[]; // KB sources (clean Sources UI)
  links?: string[]; // web source URLs
  truncated?: boolean; // paused at the output limit — offer Continue
};
type Attachment = { name: string; text: string };
type Chat = { id: string; title: string; projectId: string; messages: Msg[]; flowId?: string };

// Max files + images that can be attached to a single message.
const MAX_UPLOADS = 10;

const LS_KEY = "intelbot_chats_v1";
const LS_PROJECTS = "intelbot_projects_v1";
const LS_SETTINGS = "intelbot_settings_v1";
const LS_FLOWS = "intelbot_flows_v1";

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
  "rounded-md border border-[var(--border-2)] px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] transition-colors";

// One-time reads from localStorage, run as useState lazy initializers below.
// On the server (no window) they return the same defaults the UI rendered with
// before, so nothing is read during SSR; the real values are read on the first
// client render. This replaces the old mount effects that hydrated via setState
// (cascading-render lint violations) while keeping the load-once behaviour.
function loadInitialData(): {
  projects: Project[];
  settings: Settings;
  chats: Chat[];
  activeId: string;
} {
  if (typeof window === "undefined") {
    return { projects: [], settings: DEFAULT_SETTINGS, chats: [], activeId: "" };
  }

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
        debugMode: p.debugMode ?? false,
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

  return { projects: projs, settings: st, chats: cs, activeId: cs[0].id };
}

function loadFlows(): Flow[] {
  if (typeof window === "undefined") return [];
  try {
    const f = JSON.parse(localStorage.getItem(LS_FLOWS) || "[]");
    if (Array.isArray(f)) return f;
  } catch {}
  return [];
}

function loadTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  const t = localStorage.getItem("intelbot_theme");
  return t === "light" || t === "dark" ? t : "dark";
}

function loadSidebarOpen(): boolean {
  // Sidebar starts open on desktop, closed on mobile.
  if (typeof window === "undefined") return false;
  return window.innerWidth >= 768;
}

export default function Home() {
  // Read projects/settings/chats from localStorage once (lazy init). The four
  // values are interdependent (chats are re-homed onto valid project ids), so
  // they're computed together here rather than in four separate initializers.
  const [initial] = useState(loadInitialData);
  const [chats, setChats] = useState<Chat[]>(initial.chats);
  const [projects, setProjects] = useState<Project[]>(initial.projects);
  const [settings, setSettings] = useState<Settings>(initial.settings);
  const [activeId, setActiveId] = useState<string>(initial.activeId);
  const [input, setInput] = useState("");
  // Per-chat so a stream in one chat doesn't block sending in another.
  const [loadingChats, setLoadingChats] = useState<Record<string, boolean>>({});
  const [streamingChats, setStreamingChats] = useState<Record<string, boolean>>({});
  const [statusByChat, setStatusByChat] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"team" | "agent" | "hybrid">("team");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectModal, setProjectModal] = useState<{ project: Project; isNew: boolean } | null>(null);
  const [flows, setFlows] = useState<Flow[]>(loadFlows);
  const [flowsOpen, setFlowsOpen] = useState(false);
  const [flowModal, setFlowModal] = useState<{ flow: Flow; isNew: boolean } | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [images, setImages] = useState<string[]>([]); // pasted/attached image data URLs
  const [theme, setTheme] = useState<"dark" | "light">(loadTheme);
  const [sidebarOpen, setSidebarOpen] = useState(loadSidebarOpen);
  const [listening, setListening] = useState(false);
  // False during SSR + the first client paint; flips true after mount. Gates the
  // render below so localStorage-derived state (chats/flows/sidebar/theme) never
  // causes a server/client hydration mismatch.
  const [hydrated, setHydrated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mount flag — the one intentional setState-in-effect: it runs once after
  // hydration so the client-only initial state can render mismatch-free.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);

  // Auto-grow the composer so long queries are fully visible (no input cap).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 192) + "px"; // matches max-h-48
  }, [input]);

  // Theme: apply to <html> + persist on every change. The saved preference is
  // read once via the loadTheme() lazy initializer above.
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    try {
      localStorage.setItem("intelbot_theme", theme);
    } catch {}
  }, [theme]);

  // Projects/settings/chats are loaded once via the loadInitialData() lazy
  // initializer above (with migration to the project model). These effects only
  // persist later changes back to localStorage.
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

  // FLOWs: loaded once via the loadFlows() lazy initializer above; this effect
  // persists later changes. It SKIP-AND-ARMS on its first (mount) run so it
  // never rewrites storage on load — important because corrupt stored JSON
  // reads back as [] and we must not overwrite it with "[]". Deleting the last
  // flow still persists (that's a post-mount change).
  const flowsLoaded = useRef(false);
  useEffect(() => {
    if (!flowsLoaded.current) {
      flowsLoaded.current = true;
      return;
    }
    try {
      localStorage.setItem(LS_FLOWS, JSON.stringify(flows));
    } catch (e) {
      console.warn("FLOWs not saved (storage full?)", e);
      alert("Couldn't save FLOWs — browser storage is full. Remove some FLOW knowledge documents.");
    }
  }, [flows]);

  // Deleting a FLOW also detaches it from its chats (history stays; the ⚡
  // marker and overrides disappear instead of dangling).
  function deleteFlow(f: Flow) {
    setFlows((prev) => prev.filter((x) => x.id !== f.id));
    setChats((prev) => prev.map((c) => (c.flowId === f.id ? { ...c, flowId: undefined } : c)));
  }

  function saveFlow(f: Flow) {
    setFlows((prev) => (prev.some((x) => x.id === f.id) ? prev.map((x) => (x.id === f.id ? f : x)) : [f, ...prev]));
  }

  // Run FLOW: a fresh chat bound to the specialist.
  function runFlow(f: Flow) {
    const pid = activeProject?.id ?? projects[0]?.id;
    if (!pid) return;
    const c: Chat = { id: uid(), title: "New chat", projectId: pid, messages: [], flowId: f.id };
    setChats((prev) => [c, ...prev]);
    setActiveId(c.id);
    setFlowsOpen(false);
    setSidebarOpen(false);
  }

  const active = chats.find((c) => c.id === activeId);
  const activeFlow = active?.flowId ? flows.find((f) => f.id === active.flowId) : undefined;
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
    const run = () => {
      const container = scrollRef.current;
      const el = container?.querySelector(`[data-msg-id="${id}"]`) as HTMLElement | null;
      if (container && el) container.scrollTop = Math.max(0, el.offsetTop - 12);
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
    // Fallbacks: the empty→messages layout switch (and streaming re-renders)
    // can mount the scroll container a tick later.
    setTimeout(run, 120);
    setTimeout(run, 350);
  }

  // Pin the LATEST question to the top whenever a new question is asked or the
  // chat is switched. Keyed on the question id (not the streaming answer) so it
  // fires once per question and runs AFTER React mounts the scroll container.
  const lastUserMsgId = active?.messages.filter((m) => m.role === "user").slice(-1)[0]?.id;
  useEffect(() => {
    if (lastUserMsgId) scrollQuestionToTop(lastUserMsgId);
  }, [lastUserMsgId, activeId]);

  // Follow the stream only when the user is already near the bottom (spec:
  // never yank the view away from someone reading higher up).
  const activeIdRef = useRef(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  function followStreamScroll(chatId: string) {
    if (chatId !== activeIdRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
  }

  function newChat(projectId?: string) {
    const pid = projectId ?? activeProject?.id ?? projects[0]?.id;
    if (!pid) return;
    const c = { id: uid(), title: "New chat", projectId: pid, messages: [] };
    setChats((prev) => [c, ...prev]);
    setActiveId(c.id);
    setCollapsed((prev) => ({ ...prev, [pid]: false }));
    setSidebarOpen(false);
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
    if ((!text && !attachments.length && !images.length) || !active || loadingChats[active.id]) return;
    if (!text) {
      if (images.length && attachments.length) text = "Analyse the attached files and image(s).";
      else if (images.length) text = images.length > 1 ? "What's in these images?" : "What's in this image?";
      else text = `Please analyse the attached file(s): ${attachments.map((a) => a.name).join(", ")}.`;
    }
    const chatId = active.id; // capture — the user may switch chats mid-stream
    const sentAttachments = attachments;
    const sentImages = images;
    setInput("");
    setAttachments([]);
    setImages([]);
    const userMsg: Msg = {
      role: "user",
      content: text,
      ts: Date.now(),
      id: uid(),
      attachmentNames: sentAttachments.length ? sentAttachments.map((a) => a.name) : undefined,
      images: sentImages.length ? sentImages : undefined,
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

    let acc = "";
    let received = false; // any delta/done arrived?
    let kbSources: { n: number; file: string; heading: string }[] = [];
    let webLinks: string[] = [];
    // CRITICAL: decide push-vs-update INSIDE the updater by message id. React
    // runs updaters asynchronously (and may re-run them), so a call-time flag
    // like the old `started` raced and made the first delta OVERWRITE the last
    // message — i.e. the user's question — instead of appending the answer.
    const upsert = (content: string, extra?: Partial<Msg>) => {
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== chatId) return c;
          const msgs = [...c.messages];
          const idx = msgs.findIndex((m) => m.id === assistantId);
          const patch: Msg = {
            role: "assistant",
            content,
            ts: idx >= 0 ? msgs[idx].ts : Date.now(),
            id: assistantId,
            sources: kbSources.length ? kbSources : undefined,
            links: webLinks.length ? webLinks : undefined,
            ...extra,
          };
          if (idx >= 0) msgs[idx] = { ...msgs[idx], ...patch };
          else msgs.push(patch);
          return { ...c, messages: msgs };
        })
      );
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId: chatId,
          history,
          // A FLOW can pin its own engine/tools/depth; otherwise header rules.
          mode: activeFlow && activeFlow.engine !== "auto" ? activeFlow.engine : mode,
          instructions: combinedInstructions,
          connectors: activeFlow
            ? { ...settings.connectors, web: activeFlow.webSearch, vaultDepth: activeFlow.vaultDepth }
            : settings.connectors,
          depth: activeFlow && activeFlow.depth !== "default" ? activeFlow.depth : settings.depth,
          flow: activeFlow
            ? {
                name: activeFlow.name,
                description: activeFlow.description,
                role: activeFlow.role,
                goal: activeFlow.goal,
                rules: activeFlow.rules,
                tone: activeFlow.tone,
                outputFormat: activeFlow.outputFormat,
                avoid: activeFlow.avoid,
                knowledge: activeFlow.knowledge,
              }
            : undefined,
          attachments: sentAttachments.length ? sentAttachments : undefined,
          images: sentImages.length ? sentImages : undefined,
          debug: settings.debugMode || undefined,
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
            truncated?: boolean;
            sources?: { n: number; file: string; heading: string }[];
            urls?: string[];
            debug?: { engines?: string; retrieved?: number; totalMs?: number; sources?: string[] };
          };
          try {
            evt = JSON.parse(t);
          } catch {
            continue;
          }
          if (evt.type === "status") {
            setStatusByChat((p) => ({ ...p, [chatId]: evt.stage ?? "" }));
          } else if (evt.type === "sources") {
            kbSources = evt.sources ?? [];
          } else if (evt.type === "links") {
            webLinks = [...new Set([...webLinks, ...(evt.urls ?? [])])];
          } else if (evt.type === "delta") {
            acc += evt.text ?? "";
            received = true;
            setStreamingChats((p) => ({ ...p, [chatId]: true }));
            upsert(acc, { debug: debugStr });
            followStreamScroll(chatId);
          } else if (evt.type === "error") {
            acc += (acc ? "\n\n" : "") + "⚠ " + (evt.error ?? "error");
            received = true;
            upsert(acc, { debug: debugStr });
          } else if (evt.type === "done") {
            received = true;
            const d = evt.debug;
            if (d) {
              debugStr = `engines: ${d.engines} · retrieved ${d.retrieved} notes · ${d.totalMs}ms\n${(
                d.sources ?? []
              ).join("\n")}`;
            }
            upsert(acc, { debug: debugStr, truncated: !!evt.truncated });
          }
        }
      }
      if (!received) upsert("No response.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      upsert((acc ? acc + "\n\n" : "") + "Error: " + msg);
    } finally {
      setLoadingChats((p) => ({ ...p, [chatId]: false }));
      setStreamingChats((p) => ({ ...p, [chatId]: false }));
    }
  }

  // Resume an answer that paused at the output limit: stream the continuation
  // straight into the SAME message — no new bubbles, numbering preserved.
  async function continueAnswer(msgId: string) {
    const chat = chats.find((c) => c.id === activeId);
    if (!chat || loadingChats[chat.id]) return;
    const chatId = chat.id;
    const idx = chat.messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    const base = chat.messages[idx].content;
    let question = "";
    for (let i = idx - 1; i >= 0; i--) {
      if (chat.messages[i].role === "user") {
        question = chat.messages[i].content;
        break;
      }
    }
    // Continuations keep the FLOW persona (behaviour fields only — the
    // continue pipeline works from the draft tail, not knowledge docs).
    const contFlow = chat.flowId ? flows.find((f) => f.id === chat.flowId) : undefined;

    setLoadingChats((p) => ({ ...p, [chatId]: true }));
    setStatusByChat((p) => ({ ...p, [chatId]: "Continuing from where it stopped…" }));
    const patch = (content: string, extra?: Partial<Msg>) =>
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? { ...c, messages: c.messages.map((m) => (m.id === msgId ? { ...m, content, ...extra } : m)) }
            : c
        )
      );
    patch(base, { truncated: false });

    let acc = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Continue.",
          conversationId: chatId,
          continuation: {
            tail: base.slice(-12000),
            question,
            // Fence parity over the FULL draft (the tail window may miss the
            // opener) — keeps the model from emitting a stray ``` at the seam.
            openFence: (base.match(/^```/gm) ?? []).length % 2 === 1,
          },
          instructions: combinedInstructions,
          flow: contFlow
            ? {
                name: contFlow.name,
                description: contFlow.description,
                role: contFlow.role,
                goal: contFlow.goal,
                rules: contFlow.rules,
                tone: contFlow.tone,
                outputFormat: contFlow.outputFormat,
                avoid: contFlow.avoid,
              }
            : undefined,
          connectors: settings.connectors,
          depth: settings.depth,
          debug: settings.debugMode || undefined,
        }),
      });
      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          let evt: { type: string; text?: string; error?: string; truncated?: boolean };
          try {
            evt = JSON.parse(t);
          } catch {
            continue;
          }
          if (evt.type === "delta") {
            acc += evt.text ?? "";
            setStreamingChats((p) => ({ ...p, [chatId]: true }));
            patch(base + acc);
            followStreamScroll(chatId);
          } else if (evt.type === "error") {
            patch(base + acc + "\n\n⚠ " + (evt.error ?? "error"));
          } else if (evt.type === "done") {
            patch(base + acc, { truncated: !!evt.truncated });
          }
        }
      }
    } catch (e) {
      patch(base + acc + "\n\n⚠ Continue failed: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setLoadingChats((p) => ({ ...p, [chatId]: false }));
      setStreamingChats((p) => ({ ...p, [chatId]: false }));
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = ""; // allow re-picking the same file(s)
    if (!list.length) return;

    // Bound the whole selection by the remaining capacity (images + files).
    const remaining = MAX_UPLOADS - (attachments.length + images.length);
    if (remaining <= 0) {
      alert(`You can attach up to ${MAX_UPLOADS} items at once. Remove some first.`);
      return;
    }
    const toAdd = list.slice(0, remaining);
    if (list.length > toAdd.length) {
      alert(`Limit is ${MAX_UPLOADS} items — added the first ${toAdd.length}, skipped ${list.length - toAdd.length}.`);
    }

    for (const file of toAdd) {
      if (file.size > 30 * 1024 * 1024) {
        alert(`"${file.name}" is too large (max 30MB).`);
        continue;
      }
      if (file.type.startsWith("image/")) {
        addImageFile(file);
        continue;
      }
      setAttaching(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/extract", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({ error: "Bad response" }));
        if (!res.ok || data.error) alert(`${data.error || "Could not read that file."} (${file.name})`);
        else setAttachments((prev) => [...prev, { name: data.name, text: data.text }]);
      } catch (err) {
        alert(`Upload failed for ${file.name}: ` + (err instanceof Error ? err.message : "error"));
      } finally {
        setAttaching(false);
      }
    }
  }

  function addImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setImages((prev) => [...prev, reader.result as string]);
    };
    reader.readAsDataURL(file);
  }

  // Paste images straight into the chat (Alt+PrtScreen → Ctrl+V, copy-image, etc.).
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    let slots = MAX_UPLOADS - (attachments.length + images.length);
    let handled = false;
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        handled = true;
        if (slots <= 0) continue;
        const f = it.getAsFile();
        if (f) {
          addImageFile(f);
          slots--;
        }
      }
    }
    if (handled) e.preventDefault();
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Voice dictation via the browser Speech Recognition API (Chrome/Edge).
  function toggleMic() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      alert("Voice input isn't supported in this browser. Use Chrome or Edge.");
      return;
    }
    const rec = new SR();
    rec.lang = "en-AU";
    rec.interimResults = true;
    rec.continuous = true;
    const startText = input ? input.trim() + " " : "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      setInput(startText + txt);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
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
          disabled ? "text-[var(--muted-2)] cursor-not-allowed" : "text-[var(--text)] hover:bg-[var(--hover)]"
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
          c.id === activeId ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]"
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
            className="flex-1 min-w-0 bg-transparent px-3 py-2 text-sm outline-none border border-[var(--accent)] rounded-md"
          />
        ) : (
          <button
            onClick={() => {
              setActiveId(c.id);
              setSidebarOpen(false);
            }}
            onDoubleClick={() => startRename(c.id, c.title)}
            title="Double-click to rename"
            className="flex-1 min-w-0 truncate px-3 py-2 text-sm text-left"
          >
            {c.flowId ? "⚡ " : ""}
            {c.title || "New chat"}
          </button>
        )}
        {loadingChats[c.id] && (
          <span
            className="mr-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)] animate-pulse group-hover:hidden"
            title="Working…"
          />
        )}
        {editingId !== c.id && (
          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity pr-1">
            <button onClick={() => startRename(c.id, c.title)} title="Rename" className="rounded p-1 text-[var(--muted-2)] hover:text-[var(--text)]">
              ✎
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete chat "${c.title || "New chat"}"?`)) deleteChat(c.id);
              }}
              title="Delete"
              className="rounded p-1 text-[var(--muted-2)] hover:text-[var(--danger)]"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    );
  }

  // The ChatGPT-style composer pill (used centered on an empty chat, or at the
  // bottom once there are messages).
  function composer() {
    return (
      <div className="mx-auto w-full max-w-3xl">
        {(attachments.length > 0 || attaching) && (
          <div className="ib-pop mb-2 flex flex-wrap gap-2">
            {attachments.map((a, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-2)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text)]"
              >
                <span className="max-w-[180px] truncate">📎 {a.name}</span>
                <button
                  onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-[var(--muted-2)] hover:text-[var(--danger)]"
                  title="Remove"
                >
                  ✕
                </button>
              </span>
            ))}
            {attaching && (
              <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-2)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--muted)]">
                📎 Reading file…
              </span>
            )}
          </div>
        )}
        {images.length > 0 && (
          <div className="ib-pop mb-2 flex flex-wrap gap-2">
            {images.map((src, idx) => (
              <div key={idx} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="attachment" className="h-16 w-16 rounded-lg border border-[var(--border-2)] object-cover" />
                <button
                  onClick={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-[var(--panel)] border border-[var(--border-2)] text-[var(--muted)] hover:text-[var(--danger)] text-xs leading-none"
                  title="Remove image"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept=".pdf,.docx,.xlsx,.xls,.pptx,.zip,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,.log,.css,.scss,.sql,.toml,.ini,.js,.jsx,.ts,.tsx,.py,.rb,.php,.java,.go,.rs,.c,.h,.cpp,.cs,.sh,text/*,image/*"
          onChange={onPickFile}
        />
        <div className="flex items-end gap-1 rounded-[26px] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
          <details className="relative">
            <summary
              title="Add"
              className="flex h-9 w-9 items-center justify-center rounded-full text-xl leading-none text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden"
            >
              +
            </summary>
            <div className="ib-pop absolute bottom-full left-0 mb-2 w-56 rounded-lg border border-[var(--border-2)] bg-[var(--panel)] p-1 shadow-xl z-20">
              {menuItem("📎 Attach files (PDF, Office, ZIP, code…)", () => fileRef.current?.click())}
              {menuItem(`🌐 Web search: ${settings.connectors.web ? "On" : "Off"}`, () =>
                setSettings((s) => ({ ...s, connectors: { ...s.connectors, web: !s.connectors.web } }))
              )}
              {menuItem("🧠 Deep research (Pro)", () => setSettings((s) => ({ ...s, depth: "pro" })))}
            </div>
          </details>
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
            rows={1}
            placeholder="Message IntelBot…  (paste an image to analyse it)"
            className="flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none max-h-48 overflow-y-auto"
          />
          <button
            onClick={toggleMic}
            title={listening ? "Stop recording" : "Voice input"}
            className={`flex h-9 w-9 items-center justify-center rounded-full ${
              listening ? "text-red-400 bg-[var(--hover)] animate-pulse" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            }`}
          >
            {listening ? "⏹" : "🎙"}
          </button>
          <button
            onClick={send}
            disabled={activeLoading || (!input.trim() && attachments.length === 0 && images.length === 0)}
            title="Send"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-30"
          >
            ↑
          </button>
        </div>
        <div className="text-center text-[10px] text-[var(--muted-2)] mt-2">
          Deep answers take 2–5 min. Guidance based on NSW/Australian frameworks — not legal advice.
        </div>
      </div>
    );
  }

  // Render nothing until mounted: server HTML and the first client render are
  // both this empty shell, so they match; the real UI paints once hydrated.
  if (!hydrated) return <div className="h-screen w-screen bg-[var(--bg)]" />;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Mobile backdrop — fades in/out, stays mounted so it can animate both ways. */}
      <div
        aria-hidden
        onClick={() => setSidebarOpen(false)}
        className={`fixed inset-0 z-30 bg-black/50 md:hidden transition-opacity duration-300 ${
          sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />
      {/* Sidebar — slides on mobile (translate), collapses width on desktop. */}
      <aside
        className={`fixed md:static z-40 h-full w-64 flex flex-col bg-[var(--sidebar)] overflow-hidden transition-all duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0 md:w-64" : "-translate-x-full md:translate-x-0 md:w-0"
        }`}
      >
        <div className="p-3 space-y-2">
          <button
            onClick={() => newChat()}
            className="w-full rounded-lg border border-[var(--border-2)] px-3 py-2 text-sm text-left hover:bg-[var(--hover)] transition-colors"
          >
            + New chat
          </button>
          <button
            onClick={newProject}
            className="w-full rounded-lg px-3 py-1.5 text-xs text-left text-[var(--muted)] hover:bg-[var(--hover)] transition-colors"
          >
            + New project
          </button>
          <button
            onClick={() => setFlowsOpen(true)}
            className="w-full rounded-lg px-3 py-1.5 text-xs text-left text-[var(--muted)] hover:bg-[var(--hover)] transition-colors"
          >
            ⚡ FLOWs
            {flows.length > 0 && <span className="ml-1 text-[var(--muted-2)]">({flows.length})</span>}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-2">
          {projects.map((p) => {
            const pchats = chats.filter((c) => c.projectId === p.id);
            const isCollapsed = collapsed[p.id];
            return (
              <div key={p.id}>
                <div className="group flex items-center rounded-md px-1 hover:bg-[var(--panel)]">
                  <button
                    onClick={() => setCollapsed((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                    className="flex-1 min-w-0 flex items-center gap-1 px-1 py-1.5 text-left"
                  >
                    <span className="text-[var(--muted-2)] text-[10px] w-3">{isCollapsed ? "▸" : "▾"}</span>
                    <span className="truncate text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                      {p.name}
                    </span>
                    <span className="text-[10px] text-[var(--muted-2)]">{pchats.length}</span>
                  </button>
                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => newChat(p.id)} title="New chat in project" className="rounded p-1 text-[var(--muted-2)] hover:text-[var(--text)]">
                      ＋
                    </button>
                    <button onClick={() => setProjectModal({ project: p, isNew: false })} title="Project settings" className="rounded p-1 text-[var(--muted-2)] hover:text-[var(--text)]">
                      ✎
                    </button>
                    <button onClick={() => deleteProject(p.id)} title="Delete project" className="rounded p-1 text-[var(--muted-2)] hover:text-[var(--danger)]">
                      ✕
                    </button>
                  </div>
                </div>
                {!isCollapsed && (
                  <div className="space-y-1 pl-2 mt-1">
                    {pchats.length === 0 && (
                      <div className="px-3 py-1 text-xs text-[var(--muted-2)]">No chats yet</div>
                    )}
                    {pchats.map((c) => chatRow(c))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-[var(--border)] flex items-center justify-between">
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-md px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] transition-colors"
          >
            ⚙ Settings &amp; Connectors
          </button>
          <span className="text-xs text-[var(--muted-2)]">Noonan</span>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="px-3 sm:px-4 py-2 sm:py-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="rounded-md px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            title="Toggle sidebar"
          >
            ☰
          </button>
          <span className="font-semibold">IntelBot</span>
          {activeFlow ? (
            <button
              onClick={() => setFlowModal({ flow: activeFlow, isNew: false })}
              title={`${activeFlow.description}\nClick to edit this FLOW.`}
              className="flex min-w-0 items-center gap-1 rounded-full border border-[var(--border-2)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--text)] hover:border-[var(--accent)] transition-colors"
            >
              <span>{activeFlow.icon}</span>
              <span className="truncate max-w-[140px]">{activeFlow.name}</span>
            </button>
          ) : (
            <span className="hidden lg:inline text-xs text-[var(--muted-2)] truncate">
              {activeProject ? activeProject.name : "Noonan"} · grounded in your knowledge base
            </span>
          )}
          <div className="ml-auto flex items-center gap-2 text-xs">
            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="rounded-lg border border-[var(--border-2)] px-2 py-1.5 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            {(() => {
              // Custom dropdown (not native <select>) so the open menu uses the
              // brand red for the selected item — native popups render their own
              // blue highlight on Windows that CSS can't reliably override.
              const depthPinned = !!activeFlow && activeFlow.depth !== "default";
              const effectiveDepth = depthPinned ? (activeFlow!.depth as Depth) : settings.depth;
              const curLabel = DEPTHS.find((d) => d.id === effectiveDepth)?.label ?? "Auto";
              return (
                <details className="relative">
                  <summary
                    title={
                      depthPinned
                        ? `Pinned by the "${activeFlow!.name}" FLOW`
                        : DEPTHS.find((d) => d.id === settings.depth)?.hint
                    }
                    className={`flex items-center gap-1 rounded-lg border border-[var(--border-2)] bg-[var(--panel)] px-2 py-1.5 text-[var(--text)] select-none list-none [&::-webkit-details-marker]:hidden ${
                      depthPinned
                        ? "opacity-50 pointer-events-none cursor-not-allowed"
                        : "cursor-pointer hover:border-[var(--accent)]"
                    }`}
                  >
                    {curLabel}
                    <span className="text-[10px] text-[var(--muted-2)]">▾</span>
                  </summary>
                  <div className="ib-pop absolute right-0 z-30 mt-1 w-36 rounded-lg border border-[var(--border-2)] bg-[var(--panel)] p-1 shadow-xl">
                    {DEPTHS.map((d) => (
                      <button
                        key={d.id}
                        title={d.hint}
                        onClick={(e) => {
                          setSettings((s) => ({ ...s, depth: d.id }));
                          (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                        }}
                        className={`block w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                          settings.depth === d.id
                            ? "bg-[var(--accent)] text-white"
                            : "text-[var(--text)] hover:bg-[var(--hover)]"
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </details>
              );
            })()}
            {(() => {
              // A FLOW that pins its engine greys the toggle out (the pin wins
              // in send()) — controls must never look active while ignored.
              const pinned = !!activeFlow && activeFlow.engine !== "auto";
              const shown = pinned ? (activeFlow!.engine as "team" | "agent" | "hybrid") : mode;
              const btn = (id: "team" | "agent" | "hybrid", label: string, hint: string) => (
                <button
                  onClick={() => setMode(id)}
                  disabled={pinned}
                  title={pinned ? `Engine pinned by the "${activeFlow!.name}" FLOW` : hint}
                  className={`rounded-md px-2.5 py-1 transition-colors disabled:cursor-not-allowed ${
                    shown === id
                      ? `bg-[var(--accent)] text-white ${pinned ? "opacity-60" : ""}`
                      : `text-[var(--muted)] ${pinned ? "opacity-40" : "hover:text-[var(--text)]"}`
                  }`}
                >
                  {label}
                </button>
              );
              return (
                <div className="flex items-center rounded-lg border border-[var(--border-2)] p-0.5">
                  {btn(
                    "team",
                    "Teams",
                    "Teams — swarm collaboration for complex work: three models fan out in parallel and a synthesiser merges them. Best for strategy, complex analysis and competing viewpoints."
                  )}
                  {btn(
                    "agent",
                    "Agents",
                    "Agents — step-by-step relay built for efficient execution: Perplexity researches → GPT synthesises → Claude QAs and formats the final. Best for cost-efficient, repeatable, structured outputs."
                  )}
                  {btn(
                    "hybrid",
                    "Hybrid",
                    "Hybrid — research-first AI comparison with final decision making: Perplexity researches once, GPT + Claude draft in parallel, GPT compares and merges the final answer. Best for high-value answers needing accuracy and polish."
                  )}
                </div>
              );
            })()}
          </div>
        </header>

        {active && active.messages.length === 0 && !activeLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 pb-16">
            {activeFlow ? (
              <>
                <div className="text-4xl">{activeFlow.icon}</div>
                <h1 className="mt-2 text-2xl sm:text-3xl font-semibold text-[var(--text)]">{activeFlow.name}</h1>
                <p className="mt-2 mb-6 max-w-md text-sm text-[var(--muted-2)] text-center">
                  {activeFlow.description || "A specialist FLOW."}
                  {activeFlow.knowledge.length > 0 && (
                    <span className="block mt-1 text-[var(--muted-2)]">
                      📄 {activeFlow.knowledge.length} knowledge document{activeFlow.knowledge.length > 1 ? "s" : ""} loaded
                    </span>
                  )}
                </p>
              </>
            ) : (
              <>
                <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--text)]">How can I help?</h1>
                <p className="mt-2 mb-6 text-sm text-[var(--muted-2)] text-center">
                  Ask about NSW property, tenancy law, or anything in Noonan&apos;s knowledge base.
                </p>
              </>
            )}
            {composer()}
          </div>
        ) : (
        <>
        <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto w-full px-4 py-6 space-y-6">
            {active?.messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start"}>
                <div
                  data-msg-id={m.id}
                  className={`leading-relaxed text-[15px] ${
                    m.role === "user"
                      ? "rounded-2xl px-4 py-2.5 bg-[var(--user-bubble)] text-white max-w-[85%] whitespace-pre-wrap"
                      : "w-full max-w-full"
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
                          {m.images?.length ? (
                            <div className="mb-2 flex flex-wrap gap-2">
                              {m.images.map((src, k) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img key={k} src={src} alt="attachment" className="max-h-48 rounded-lg border border-white/20 object-contain" />
                              ))}
                            </div>
                          ) : null}
                          {m.attachmentNames?.length ? (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {m.attachmentNames.map((n, k) => (
                                <span
                                  key={k}
                                  className="inline-flex items-center gap-1.5 rounded-md bg-[var(--hover)] px-2 py-1 text-xs text-[var(--accent-text)]"
                                >
                                  📎 {n}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className={long && !exp ? "max-h-28 overflow-hidden" : ""}>
                            {m.content}
                          </div>
                          {long && (
                            <button
                              onClick={() =>
                                m.id && setExpanded((p) => ({ ...p, [m.id!]: !exp }))
                              }
                              className="mt-1 text-xs text-[var(--accent-text)] hover:underline"
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
                          <div className="ib-pop absolute z-20 mt-1 w-40 rounded-lg border border-[var(--border-2)] bg-[var(--panel)] p-1 shadow-xl">
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
                            {menuItem("☁ Save to SharePoint", async () => {
                              const r = await saveToSharePoint(
                                `${exportSlug(title)}.md`,
                                m.content,
                                "text/markdown;charset=utf-8"
                              );
                              if (r.ok && r.webUrl) window.open(r.webUrl, "_blank");
                              else alert(`Save failed: ${r.error ?? "unknown error"}`);
                            })}
                          </div>
                        </details>
                      </div>
                    );
                  })()}
                {/* Paused at the output limit — clean continuation, no silent truncation. */}
                {m.role === "assistant" && m.truncated && !activeLoading && (
                  <div className="ib-pop mt-2 flex items-center gap-2 rounded-lg border border-[var(--border-2)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
                    <span>⏸ Long answer — paused at a clean stopping point.</span>
                    <button
                      onClick={() => m.id && continueAnswer(m.id)}
                      className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-white hover:bg-[var(--accent-hover)] transition-colors"
                    >
                      Continue
                    </button>
                  </div>
                )}
                {/* Clean Sources UI — replaces the raw notes/URL dump. */}
                {m.role === "assistant" &&
                  m.content &&
                  !(activeLoading && i === (active?.messages.length ?? 0) - 1) &&
                  (m.sources?.length || m.links?.length) ? (
                  <Sources kb={m.sources ?? []} web={m.links ?? []} />
                ) : null}
                {/* Engine trace — developers only, behind the Settings toggle. */}
                {settings.debugMode && m.debug && <DebugTracePanel trace={m.debug} />}
              </div>
            ))}
            {activeLoading && !activeStreaming && (
              <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)] animate-pulse" />
                {activeStatus}
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>
        <div className="px-3 pb-3 pt-1">{composer()}</div>
        </>
        )}
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
      {flowsOpen && (
        <FlowLibrary
          flows={flows}
          setFlows={setFlows}
          onRun={runFlow}
          onEdit={(f) => setFlowModal({ flow: f, isNew: false })}
          onCreate={() =>
            setFlowModal({
              flow: { ...defaultFlow(), id: uid(), createdAt: Date.now(), updatedAt: Date.now() },
              isNew: true,
            })
          }
          onDelete={deleteFlow}
          onClose={() => setFlowsOpen(false)}
        />
      )}
      {flowModal && (
        <FlowBuilder
          flow={flowModal.flow}
          isNew={flowModal.isNew}
          onSave={saveFlow}
          onClose={() => setFlowModal(null)}
        />
      )}
    </div>
  );
}
