import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Bot, Check, LoaderCircle, MessageSquareText, Pencil, Plus, Send, Trash2, UserRound, X } from "lucide-react"
import SearchableSelect from "../components/SearchableSelect"

type ProviderId = "openai" | "claude" | "gemini"
type ChatSummary = { id: string; title: string; provider: ProviderId; model: string; created_at: string; updated_at?: string | null }
type PlanRow = { company: string; tier: string; priority: string; remarks: string; careers_page: string }
type PlanData = { id: string; name: string; key: string; rows: PlanRow[]; sources?: { title?: string; url: string; snippet?: string }[]; hidden?: boolean }
type ChatMessage = { role: string; content: string; metadata?: { is_plan?: boolean; plan_id?: string; plan?: PlanData; sources?: PlanData["sources"] } }

const fallbackProviderModels: Record<ProviderId, string[]> = {
    openai: ["gpt-5.2", "gpt-5-mini", "gpt-4.1"],
    claude: ["claude-sonnet-5", "claude-haiku-4-5"],
    gemini: ["gemini-2.5-flash"],
}
const providerLabels: Record<ProviderId, string> = { openai: "OpenAI", claude: "Claude", gemini: "Gemini" }
const welcomeMessage = (name: string) => `Hi ${name || "there"}, I'm Plan Preppy. Let's create a focused job search plan together. Which roles, locations, or companies should we start with?`
const timeLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""

export default function ChatPage() {
    const { chatId } = useParams()
    const navigate = useNavigate()
    const [conversations, setConversations] = useState<ChatSummary[]>([])
    const [profileName, setProfileName] = useState("")
    const [missingProfileFields, setMissingProfileFields] = useState<string[]>(["skills", "work preference", "preferred locations"])
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [input, setInput] = useState("")
    const [loadingList, setLoadingList] = useState(true)
    const [loadingChat, setLoadingChat] = useState(false)
    const [sending, setSending] = useState(false)
    const [mobileListOpen, setMobileListOpen] = useState(false)
    const [configured, setConfigured] = useState<Record<ProviderId, boolean>>({ openai: false, claude: false, gemini: false })
    const [providerModels, setProviderModels] = useState<Record<ProviderId, string[]>>(fallbackProviderModels)
    const [title, setTitle] = useState("")
    const [provider, setProvider] = useState<ProviderId>("gemini")
    const [model, setModel] = useState(fallbackProviderModels.gemini[0])
    const [creating, setCreating] = useState(false)
    const [createError, setCreateError] = useState("")
    const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
    const [editingName, setEditingName] = useState("")
    const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null)
    const [chatActionError, setChatActionError] = useState("")
    const [promotedPlans, setPromotedPlans] = useState<string[]>([])
    const [promotionError, setPromotionError] = useState("")
    const [savingPlanId, setSavingPlanId] = useState<string | null>(null)
    const [planSaveNotice, setPlanSaveNotice] = useState("")
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)

    const loadConversations = useCallback(async () => {
        const response = await fetch("/api/chats")
        if (!response.ok) throw new Error("Could not load conversations.")
        setConversations(await response.json())
    }, [])

    useEffect(() => {
        loadConversations().catch((error) => console.error(error)).finally(() => setLoadingList(false))
        fetch("/api/profile").then((response) => response.json()).then((data) => {
            setProfileName(typeof data.name === "string" ? data.name.trim() : "")
            const missing: string[] = []
            if (!Array.isArray(data.skills) || !data.skills.length) missing.push("at least one skill")
            if (!data.job_preference) missing.push("a work preference")
            if (!Array.isArray(data.preferred_locations) || !data.preferred_locations.length) missing.push("at least one preferred location")
            setMissingProfileFields(missing)
        }).catch(() => {})
        fetch("/api/settings").then((response) => response.json()).then((data) => {
            const registry = (data.models || fallbackProviderModels) as Record<string, { models?: string[]; default_model?: string }>
            const nextProviderModels = Object.fromEntries(
                (Object.keys(fallbackProviderModels) as ProviderId[]).map((key) => [key, registry[key]?.models || fallbackProviderModels[key] || []]),
            ) as Record<ProviderId, string[]>
            setProviderModels(nextProviderModels)
            const next = {
                openai: Boolean(data.providers?.openai?.configured),
                claude: Boolean(data.providers?.claude?.configured),
                gemini: Boolean(data.providers?.gemini?.configured),
            }
            setConfigured(next)
            const first = (["gemini", "openai", "claude"] as ProviderId[]).find((id) => next[id])
            if (first) {
                const defaultModel = nextProviderModels[first]?.[0] || fallbackProviderModels[first][0]
                setProvider(first)
                setModel(defaultModel)
            }
        }).catch(() => { })
    }, [loadConversations])

    useEffect(() => {
        if (!chatId) {
            setMessages([])
            setLoadingChat(false)
            return
        }
        let cancelled = false
        setLoadingChat(true)
        fetch(`/api/chats/${chatId}`).then(async (response) => {
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data.detail || "Could not load this conversation.")
            if (cancelled) return
            setMessages(data.messages?.length
                ? data.messages.map((message: ChatMessage) => ({ role: message.role, content: message.content, metadata: message.metadata }))
                : [{ role: "assistant", content: welcomeMessage(profileName) }])
        }).catch((error) => { if (!cancelled) console.error(error) }).finally(() => { if (!cancelled) setLoadingChat(false) })
        return () => { cancelled = true }
    }, [chatId, profileName])

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])
    useEffect(() => {
        const textarea = inputRef.current
        if (!textarea) return
        textarea.style.height = "auto"
        textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
    }, [input])

    const openCreateDialog = () => { setCreateError(""); setTitle(""); setMobileListOpen(false); navigate("/plans/create") }

    const createConversation = async (event: React.FormEvent) => {
        event.preventDefault()
        if (missingProfileFields.length) {
            setCreateError("Complete your required profile details before starting a conversation.")
            return
        }
        if (!configured[provider]) { setCreateError(`Add your ${providerLabels[provider]} API key in LLM settings first.`); return }
        setCreating(true)
        setCreateError("")
        try {
            const response = await fetch("/api/chats", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: title.trim(), provider, model }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data.detail || "Could not start this conversation.")
            const created: ChatSummary = { id: data.chat_id, title: data.title, provider: data.provider, model: data.model, created_at: new Date().toISOString() }
            setConversations((current) => [created, ...current.filter((chat) => chat.id !== created.id)])
            setTitle("")
            navigate(`/plans/create/${created.id}`)
        } catch (error) {
            setCreateError(error instanceof Error ? error.message : "Could not start this conversation.")
        } finally { setCreating(false) }
    }

    const sendMessage = async (event: React.FormEvent) => {
        event.preventDefault()
        if (missingProfileFields.length) return
        if (!input.trim() || !chatId || sending) return
        const userMessage = input.trim()
        setInput("")
        setMessages((current) => [...current, { role: "user", content: userMessage }, { role: "assistant", content: "" }])
        setSending(true)
        try {
            const response = await fetch(`/api/chats/${chatId}/message`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: userMessage }),
            })
            if (!response.ok) {
                const data = await response.json().catch(() => ({}))
                if (String(data.detail || "").toLowerCase().includes("complete your profile")) {
                    fetch("/api/profile").then((profileResponse) => profileResponse.json()).then((profile) => {
                        const missing: string[] = []
                        if (!Array.isArray(profile.skills) || !profile.skills.length) missing.push("at least one skill")
                        if (!profile.job_preference) missing.push("a work preference")
                        if (!Array.isArray(profile.preferred_locations) || !profile.preferred_locations.length) missing.push("at least one preferred location")
                        setMissingProfileFields(missing.length ? missing : ["required profile details"])
                    }).catch(() => setMissingProfileFields(["required profile details"]))
                }
                throw new Error(data.detail || "Could not send your message.")
            }
            if (!response.body) throw new Error("No response stream was returned.")
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ""
            while (true) {
                const { value, done } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                const parts = buffer.split("\n\n")
                buffer = parts.pop() || ""
                for (const part of parts) {
                    if (!part.startsWith("data: ")) continue
                    let event: { type: string; content?: string; message?: string; is_plan?: boolean; plan?: PlanData }
                    try { event = JSON.parse(part.slice(6)) } catch { continue }
                    if (event.type === "text") {
                        setMessages((current) => {
                            const next = [...current]
                            next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + (event.content || "") }
                            return next
                        })
                    } else if (event.type === "done") {
                        setMessages((current) => {
                            const next = [...current]
                            if (next.length) {
                                const existing = next[next.length - 1]
                                const plan = event.is_plan && event.plan ? event.plan : existing.metadata?.plan
                                next[next.length - 1] = {
                                    ...existing,
                                    content: plan ? "I’ve prepared the plan below. Review the companies, edit any details, then move it to Job Plans." : event.content || existing.content,
                                    metadata: plan ? { is_plan: true, plan_id: plan.id, plan, sources: plan.sources } : existing.metadata,
                                }
                            }
                            return next
                        })
                    } else if (event.type === "plan" && event.plan) {
                        const plan = event.plan
                        setMessages((current) => {
                            const next = [...current]
                            if (next.length) next[next.length - 1] = { ...next[next.length - 1], content: "I’ve prepared the plan below. Review the companies, edit any details, then move it to Job Plans.", metadata: { is_plan: true, plan_id: plan.id, plan, sources: plan.sources } }
                            return next
                        })
                    } else if (event.type === "error") throw new Error(event.message || "The agent could not complete this request.")
                }
            }
            void loadConversations()
        } catch (error) {
            const message = error instanceof Error ? error.message : "Something went wrong. Please try again."
            setMessages((current) => {
                const next = [...current]
                if (next.length && next[next.length - 1].role === "assistant" && !next[next.length - 1].content) next.pop()
                return [...next, { role: "assistant", content: `I couldn’t complete that request: ${message}` }]
            })
        } finally { setSending(false) }
    }

    const promotePlan = async (planId: string) => {
        setPromotionError("")
        try {
            const response = await fetch(`/api/plans/${planId}/promote`, { method: "PATCH" })
            if (!response.ok) throw new Error("Could not add the plan. Please try again.")
            setPromotedPlans((current) => current.includes(planId) ? current : [...current, planId])
            navigate(`/plans/${planId}`)
        } catch (error) { setPromotionError(error instanceof Error ? error.message : "Could not add the plan.") }
    }

    const editPlanRow = (messageIndex: number, rowIndex: number, field: keyof PlanRow, value: string) => {
        setMessages((current) => current.map((message, index) => {
            if (index !== messageIndex || !message.metadata?.plan) return message
            const rows = message.metadata.plan.rows.map((row, i) => i === rowIndex ? { ...row, [field]: value } : row)
            return { ...message, metadata: { ...message.metadata, plan: { ...message.metadata.plan, rows } } }
        }))
    }

    const saveChatPlan = async (plan: PlanData) => {
        setSavingPlanId(plan.id)
        setPlanSaveNotice("")
        try {
            const response = await fetch(`/api/plans/${plan.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: plan.rows }) })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data.detail || "Could not save plan edits.")
            setPlanSaveNotice("Plan changes saved.")
        } catch (error) { setPlanSaveNotice(error instanceof Error ? error.message : "Could not save plan edits.") }
        finally { setSavingPlanId(null) }
    }

    const saveConversationName = async (event: React.FormEvent, conversation: ChatSummary) => {
        event.preventDefault()
        const nextTitle = editingName.trim()
        if (!nextTitle) return
        setChatActionError("")
        try {
            const response = await fetch(`/api/chats/${conversation.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: nextTitle }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data.detail || "Could not rename this conversation.")
            setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, title: data.title } : item))
            setEditingConversationId(null)
            setEditingName("")
        } catch (error) { setChatActionError(error instanceof Error ? error.message : "Could not rename this conversation.") }
    }

    const deleteConversation = async (conversation: ChatSummary) => {
        setChatActionError("")
        try {
            const response = await fetch(`/api/chats/${conversation.id}`, { method: "DELETE" })
            if (!response.ok) {
                const data = await response.json().catch(() => ({}))
                throw new Error(data.detail || "Could not delete this conversation.")
            }
            setConversations((current) => current.filter((item) => item.id !== conversation.id))
            setDeletingConversationId(null)
            if (chatId === conversation.id) navigate("/plans/create")
        } catch (error) { setChatActionError(error instanceof Error ? error.message : "Could not delete this conversation.") }
    }

    const conversationList = <>
        <div className="border-b border-zinc-100 px-4 pb-4 pt-5">
            <div className="mb-3"><h2 className="text-sm font-semibold text-zinc-900">Chats</h2><p className="mt-1 text-[11px] text-zinc-500">Your conversations</p></div>
            <button type="button" onClick={openCreateDialog} className="flex w-full items-center justify-center gap-2 bg-zinc-950 px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-zinc-800"><Plus className="h-4 w-4" />New conversation</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {chatActionError && <p role="alert" className="m-1 border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-800">{chatActionError}</p>}
            {loadingList ? <div className="flex justify-center py-8"><LoaderCircle className="h-4 w-4 animate-spin text-zinc-400" /></div>
                : conversations.length === 0 ? <div className="px-3 py-8 text-center"><MessageSquareText className="mx-auto h-5 w-5 text-zinc-300" /><p className="mt-3 text-xs font-medium text-zinc-700">No conversations yet</p><p className="mt-1 text-[11px] leading-5 text-zinc-500">Start one to plan your job search with AI.</p><button onClick={openCreateDialog} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-900 hover:underline"><Plus className="h-3.5 w-3.5" />Start conversation</button></div>
                    : conversations.map((conversation) => <div key={conversation.id} className={`group mb-1 border transition ${conversation.id === chatId ? "border-zinc-300 bg-zinc-100" : "border-transparent hover:border-zinc-200 hover:bg-zinc-50"}`}>
                        {editingConversationId === conversation.id ? <form onSubmit={(event) => void saveConversationName(event, conversation)} className="flex items-center gap-1.5 p-2">
                            <input autoFocus aria-label="Conversation name" maxLength={100} value={editingName} onChange={(event) => setEditingName(event.target.value)} className="min-w-0 flex-1 border border-zinc-300 bg-white px-2 py-2 text-xs outline-none focus:border-zinc-900" />
                            <button type="submit" aria-label="Save conversation name" disabled={!editingName.trim()} className="grid h-8 w-8 shrink-0 place-items-center bg-zinc-950 text-white disabled:opacity-40"><Check className="h-3.5 w-3.5" /></button>
                            <button type="button" aria-label="Cancel rename" onClick={() => { setEditingConversationId(null); setEditingName("") }} className="grid h-8 w-8 shrink-0 place-items-center text-zinc-500 hover:bg-zinc-200"><X className="h-3.5 w-3.5" /></button>
                        </form> : <div className="flex items-center gap-1">
                            <Link to={`/plans/create/${conversation.id}`} onClick={() => setMobileListOpen(false)} className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-3">
                                <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center ${conversation.id === chatId ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-500"}`}><MessageSquareText className="h-3.5 w-3.5" /></span>
                                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-zinc-800">{conversation.title || "Untitled conversation"}</span><span className="mt-1 block truncate text-[10px] text-zinc-500">{providerLabels[conversation.provider] || "AI"} · {conversation.model}</span></span>
                                <time className="shrink-0 pt-0.5 text-[10px] text-zinc-400">{timeLabel(conversation.updated_at || conversation.created_at)}</time>
                            </Link>
                            <div className="flex shrink-0 items-center pr-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                                <button type="button" title="Rename conversation" aria-label={`Rename ${conversation.title}`} onClick={() => { setEditingName(conversation.title); setEditingConversationId(conversation.id); setDeletingConversationId(null); setChatActionError("") }} className="grid h-8 w-8 place-items-center text-zinc-500 hover:bg-zinc-200 hover:text-zinc-950"><Pencil className="h-3.5 w-3.5" /></button>
                                <button type="button" title="Delete conversation" aria-label={`Delete ${conversation.title}`} onClick={() => { setDeletingConversationId(conversation.id); setEditingConversationId(null); setChatActionError("") }} className="grid h-8 w-8 place-items-center text-zinc-500 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                        </div>}
                        {deletingConversationId === conversation.id && <div className="flex items-center justify-between border-t border-zinc-200 px-3 py-2"><span className="text-[11px] text-zinc-600">Delete this chat?</span><span className="flex gap-1.5"><button type="button" onClick={() => setDeletingConversationId(null)} className="px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-200">Cancel</button><button type="button" onClick={() => void deleteConversation(conversation)} className="bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700">Delete</button></span></div>}
                    </div>)}
        </div>
        <div className="border-t border-zinc-100 px-4 py-3"><Link to="/" className="inline-flex items-center gap-2 text-xs font-medium text-zinc-500 hover:text-zinc-900"><ArrowLeft className="h-3.5 w-3.5" />Back to plans</Link></div>
    </>

    return <div className="relative grid h-[calc(100dvh-180px)] min-h-[520px] grid-cols-1 overflow-hidden bg-white md:h-screen md:min-h-0 md:grid-cols-[minmax(0,1fr)_360px]">
        {mobileListOpen && <button aria-label="Close conversations panel" onClick={() => setMobileListOpen(false)} className="fixed inset-0 z-30 bg-zinc-950/30 md:hidden" />}
        {mobileListOpen && <aside className="fixed inset-y-0 right-0 z-40 flex w-[min(88vw,340px)] flex-col border-l border-zinc-200 bg-white shadow-2xl md:hidden"><div className="flex justify-end border-b border-zinc-100 px-3 py-2"><button onClick={() => setMobileListOpen(false)} aria-label="Close conversations" className="p-2 text-zinc-500"><X className="h-4 w-4" /></button></div>{conversationList}</aside>}

        <section className="relative flex min-h-0 min-w-0 flex-col bg-[#f8f9fb]">
            <button type="button" onClick={() => setMobileListOpen(true)} className="absolute left-3 top-3 z-10 inline-flex items-center gap-2 border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50 md:hidden"><MessageSquareText className="h-3.5 w-3.5" /><span>Chats</span></button>
            {!chatId ? <div className="flex flex-1 items-center justify-center overflow-y-auto p-5 sm:p-8">
                <div className="w-full max-w-lg">
                    <div className="mb-6 text-center">
                        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">AI plan builder</p>
                        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">Hi {profileName || "there"}</h1>
                        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-600">Let’s create a plan for your next move. Name this chat and choose the model you want to plan with.</p>
                    </div>
                    {missingProfileFields.length > 0 && <div role="alert" className="mb-4 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">Complete your profile to start chatting</p><p className="mt-1">Add {missingProfileFields.join(", ")} on your profile, save it, then come back here.</p><Link to="/profile" className="mt-2 inline-flex font-semibold underline underline-offset-2">Open Profile</Link></div>}
                    <form onSubmit={(event) => void createConversation(event)} className="border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
                        <label htmlFor="conversation-title" className="mb-1.5 block text-xs font-semibold text-zinc-700">Conversation name</label>
                        <input id="conversation-title" required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} className="mb-4 w-full border border-zinc-300 px-3.5 py-3 text-sm outline-none transition focus:border-zinc-900" placeholder="Give this conversation a name" />
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div><label htmlFor="conversation-provider" className="mb-1.5 block text-xs font-semibold text-zinc-700">Provider</label><SearchableSelect id="conversation-provider" value={provider} onChange={(value) => { const next = value as ProviderId; setProvider(next); setModel(providerModels[next][0]) }} placeholder="Search providers" options={(["openai", "claude", "gemini"] as ProviderId[]).map((id) => ({ value: id, label: `${providerLabels[id]}${configured[id] ? " · ready" : " · key needed"}` }))} /></div>
                            <div><label htmlFor="conversation-model" className="mb-1.5 block text-xs font-semibold text-zinc-700">Model</label><SearchableSelect id="conversation-model" value={model} onChange={setModel} placeholder="Search models" options={providerModels[provider].map((id) => ({ value: id, label: id }))} /></div>
                        </div>
                        {!configured[provider] && <p className="mt-3 text-xs leading-5 text-amber-700">Add a {providerLabels[provider]} API key in <Link to="/llm-settings" className="font-semibold underline underline-offset-2">LLM settings</Link> before starting.</p>}
                        {createError && <p role="alert" className="mt-4 border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">{createError}{createError.toLowerCase().includes("profile") && <> <Link to="/profile" className="font-semibold underline underline-offset-2">Open profile</Link></>}</p>}
                        <button disabled={creating || !configured[provider] || missingProfileFields.length > 0} className="mt-5 flex w-full items-center justify-center gap-2 bg-zinc-950 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50">{creating && <LoaderCircle className="h-4 w-4 animate-spin" />}{creating ? "Starting conversation…" : "Start conversation"}</button>
                    </form>
                    <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[11px] text-zinc-400">{["Personalized with your profile", "You can keep multiple chats"].map((tip) => <span key={tip} className="inline-flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-zinc-300" />{tip}</span>)}</div>
                </div>
            </div> : <>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
                    <div className="mx-auto max-w-3xl space-y-6">
                        {missingProfileFields.length > 0 && <div role="alert" className="border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">Complete your profile to continue this chat</p><p className="mt-1">Add {missingProfileFields.join(", ")} on your profile and save it before sending messages.</p><Link to="/profile" className="mt-2 inline-flex font-semibold underline underline-offset-2">Open Profile</Link></div>}
                        {loadingChat ? <div className="flex justify-center py-12"><LoaderCircle className="h-5 w-5 animate-spin text-zinc-400" /></div> : messages.map((message, index) => <div key={`${chatId}-${index}`} className={`flex w-full items-start gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                            {message.role !== "user" && <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-950 text-white" aria-label="AI assistant"><Bot className="h-4 w-4" /></span>}
                            <div className={`min-w-0 whitespace-pre-wrap text-sm leading-7 ${message.role === "user" ? "max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-zinc-900" : "max-w-[calc(100%-44px)] py-1.5 text-zinc-800 sm:max-w-[calc(100%-52px)]"}`}>
                                {message.metadata?.is_plan && message.metadata.plan ? <p className="mb-2 text-sm leading-6 text-zinc-700">{message.content || "Review the plan below, then move it to Job Plans."}</p> : message.content || (sending && index === messages.length - 1 ? <span className="inline-flex items-center gap-2 text-zinc-400"><span className="h-1.5 w-1.5 animate-pulse bg-zinc-400" /><span className="h-1.5 w-1.5 animate-pulse bg-zinc-400 [animation-delay:100ms]" /><span className="h-1.5 w-1.5 animate-pulse bg-zinc-400 [animation-delay:200ms]" /></span> : null)}
                                {message.role === "assistant" && message.metadata?.is_plan && message.metadata.plan && (() => {
                                    const plan = message.metadata.plan
                                    const promoted = promotedPlans.includes(plan.id) || plan.hidden === false
                                    return <div className="mt-4 max-w-full overflow-hidden border border-zinc-200 bg-white text-zinc-900 shadow-sm">
                                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3"><div><p className="text-sm font-semibold">{plan.name}</p><p className="mt-0.5 text-xs text-zinc-500">{plan.rows.length} companies · {plan.rows.length}/200 maximum</p></div><button type="button" onClick={() => void saveChatPlan(plan)} disabled={savingPlanId === plan.id} className="border border-zinc-300 px-3 py-2 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-50">{savingPlanId === plan.id ? "Saving…" : "Save edits"}</button></div>
                                        <p className="px-4 pt-3 text-xs text-zinc-500">Edit any cell below. Careers pages marked “-” could not be verified.</p>
                                        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead className="bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-500"><tr>{["Company", "Tier", "Priority", "Notes", "Careers page"].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>{plan.rows.map((row, rowIndex) => <tr key={`${row.company}-${rowIndex}`} className="border-t border-zinc-100"><td className="p-1"><input aria-label="Company" value={row.company} onChange={(event) => editPlanRow(index, rowIndex, "company", event.target.value)} className="w-full min-w-32 border border-transparent px-2 py-2 outline-none focus:border-zinc-300" /></td><td className="p-1"><select aria-label="Tier" value={row.tier} onChange={(event) => editPlanRow(index, rowIndex, "tier", event.target.value)} className="border border-transparent px-2 py-2 outline-none focus:border-zinc-300">{["T1", "T2", "T3", "T4", "T5"].map((value) => <option key={value}>{value}</option>)}</select></td><td className="p-1"><select aria-label="Priority" value={row.priority} onChange={(event) => editPlanRow(index, rowIndex, "priority", event.target.value)} className="border border-transparent px-2 py-2 outline-none focus:border-zinc-300">{["High", "Medium", "Low"].map((value) => <option key={value}>{value}</option>)}</select></td><td className="p-1"><input aria-label="Notes" value={row.remarks} onChange={(event) => editPlanRow(index, rowIndex, "remarks", event.target.value)} className="w-full min-w-40 border border-transparent px-2 py-2 outline-none focus:border-zinc-300" /></td><td className="p-1"><input aria-label="Careers page" value={row.careers_page} onChange={(event) => editPlanRow(index, rowIndex, "careers_page", event.target.value)} className="w-full min-w-48 border border-transparent px-2 py-2 outline-none focus:border-zinc-300" /></td></tr>)}</tbody></table></div>
                                        {plan.sources?.length ? <div className="border-t border-zinc-200 px-4 py-3"><p className="text-xs font-semibold">Sources searched</p><ul className="mt-2 space-y-1">{plan.sources.map((source, sourceIndex) => <li key={`${source.url}-${sourceIndex}`}><a href={source.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-700 underline underline-offset-2">{source.title || source.url}</a></li>)}</ul></div> : null}
                                        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 px-4 py-3"><button type="button" disabled={promoted} onClick={() => void promotePlan(plan.id)} className="bg-zinc-950 px-4 py-2 text-xs font-semibold text-white disabled:bg-emerald-700">{promoted ? "In Job Plans" : "Move to Job Plans"}</button>{promoted && <Link to={`/plans/${plan.id}`} className="text-xs font-semibold text-zinc-700 underline">Open plan</Link>}{promotionError && <p role="alert" className="text-xs text-red-700">{promotionError}</p>}{planSaveNotice && <p role="status" className="text-xs text-zinc-600">{planSaveNotice}</p>}</div>
                                    </div>
                                })()}
                            </div>
                            {message.role === "user" && <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-200 text-zinc-700" aria-label="You"><UserRound className="h-4 w-4" /></span>}
                        </div>)}
                        <div ref={messagesEndRef} />
                    </div>
                </div>
                <div className="shrink-0 bg-[#f8f9fb] px-3 pb-3 pt-2 sm:px-6 sm:pb-5">
                    <form onSubmit={sendMessage} className="relative mx-auto max-w-3xl rounded-2xl border border-zinc-300 bg-white shadow-sm transition focus-within:border-zinc-400 focus-within:shadow-md">
                        <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} disabled={sending || missingProfileFields.length > 0} rows={1} placeholder={missingProfileFields.length ? "Complete your profile to continue" : "Message Plan Preppy…"} className="block max-h-40 min-h-[58px] w-full resize-none bg-transparent py-[18px] pl-4 pr-14 text-sm leading-5 outline-none placeholder:text-zinc-400 disabled:opacity-60" />
                        <button type="submit" aria-label="Send message" disabled={sending || missingProfileFields.length > 0 || !input.trim()} className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-xl bg-zinc-950 text-white transition hover:bg-zinc-700 disabled:opacity-40"><Send className="h-4 w-4" /></button>
                    </form>
                    <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-zinc-400">Plan Preppy can make better suggestions when your profile is up to date.</p>
                </div>
            </>}
        </section>

        <aside className="hidden min-w-0 flex-col border-l border-zinc-200 bg-white md:flex">{conversationList}</aside>

    </div>
}
