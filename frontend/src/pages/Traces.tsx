import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Activity, ArrowUpRight, Bot, CheckCircle2, Clock3, GitBranch, LoaderCircle, MessageSquareText, Workflow } from "lucide-react"

type Trace = { id: string; type: string; source: string; payload: Record<string, any>; created_at: string }
type Overview = { total: number; counts_by_type: Record<string, number>; model_usage: { models: number; requests: number; successes: number; errors: number; input_tokens: number; output_tokens: number }; last_activity?: string | null; langfuse_configured: boolean; langfuse_base_url?: string | null }

const dateLabel = (value: string) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
const traceTitle = (trace: Trace) => trace.source.replace(/^(api:|mcp:)/, "").replace(/_/g, " ")

export default function TracesPage() {
    const [searchParams] = useSearchParams()
    const [overview, setOverview] = useState<Overview | null>(null)
    const [traces, setTraces] = useState<Trace[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const workflowId = searchParams.get("workflow_id")
    const runId = searchParams.get("run_id")

    useEffect(() => {
        const query = new URLSearchParams({ limit: "200" })
        if (workflowId) query.set("workflow_id", workflowId)
        if (runId) query.set("run_id", runId)

        Promise.all([
            fetch("/api/traces/overview").then(async (r) => { if (!r.ok) throw new Error("Could not load trace summary."); return r.json() }),
            fetch(`/api/traces?${query.toString()}`).then(async (r) => { if (!r.ok) throw new Error("Could not load traces."); return r.json() }),
        ]).then(([summary, events]) => { setOverview(summary); setTraces(events) }).catch((e) => setError(e.message)).finally(() => setLoading(false))
    }, [workflowId, runId])

    const conversations = traces.filter((item) => item.type === "conversation")
    const workflows = traces.filter((item) => item.type === "workflow")
    const cards = [
        { label: "All trace events", value: overview?.total ?? 0, icon: Activity },
        { label: "Conversations", value: overview?.counts_by_type?.conversation ?? 0, icon: MessageSquareText },
        { label: "Model requests", value: overview?.model_usage?.requests ?? 0, icon: Bot },
        { label: "Model errors", value: overview?.model_usage?.errors ?? 0, icon: GitBranch },
    ]

    return <div className="min-h-screen bg-[#f7f8fa] px-6 py-10 md:px-10"><div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500"><Activity className="h-4 w-4" /> Observability</div><h1 className="text-3xl font-semibold tracking-tight text-zinc-950 md:text-4xl">Traces</h1><p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">{workflowId && runId ? `Filtered to workflow ${workflowId.slice(-6)} and run ${runId.slice(0, 12)}` : "A global view of conversations, model routing, tool calls, and application activity."}</p></div><div className={`inline-flex items-center gap-2 border px-3 py-2 text-xs font-semibold ${overview?.langfuse_configured ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-zinc-200 bg-white text-zinc-500"}`}><span className={`h-2 w-2 ${overview?.langfuse_configured ? "bg-emerald-500" : "bg-zinc-300"}`} />Langfuse {overview?.langfuse_configured ? "connected" : "not configured"}{overview?.langfuse_configured && overview.langfuse_base_url && <a href={overview.langfuse_base_url} target="_blank" rel="noreferrer" aria-label="Open Langfuse" className="ml-1"><ArrowUpRight className="h-3.5 w-3.5" /></a>}</div></div>
        {error && <div role="alert" className="mb-5 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
        <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, icon: Icon }) => <div key={label} className="border border-zinc-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-medium text-zinc-500">{label}</span><Icon className="h-4 w-4 text-zinc-400" /></div><p className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950">{loading ? <span className="inline-block h-7 w-12 animate-pulse bg-zinc-100" /> : value.toLocaleString("en-IN")}</p></div>)}</div>
        <section className="mb-8 overflow-hidden border border-zinc-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4"><div><h2 className="text-sm font-semibold text-zinc-950">Global event stream</h2><p className="mt-0.5 text-xs text-zinc-500">Latest application, model, and tool events</p></div>{loading && <LoaderCircle className="h-4 w-4 animate-spin text-zinc-400" />}</div>{!loading && traces.length === 0 ? <div className="px-6 py-12 text-center text-sm text-zinc-500">No traces yet. Start a conversation to see the first events.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead className="bg-zinc-50"><tr>{["Event", "Type", "Details", "Time"].map((heading) => <th key={heading} className="border-b border-zinc-200 px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{heading}</th>)}</tr></thead><tbody>{traces.slice(0, 30).map((trace) => <tr key={trace.id} className="border-b border-zinc-100 last:border-0"><td className="px-5 py-3.5 text-sm font-medium capitalize text-zinc-900">{traceTitle(trace)}</td><td className="px-5 py-3.5"><span className="bg-zinc-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">{trace.type}</span></td><td className="max-w-xs truncate px-5 py-3.5 text-xs text-zinc-500">{trace.payload?.provider ? `${trace.payload.provider} · ${trace.payload.model || ""} ${trace.payload.state ? `· ${trace.payload.state}` : ""}` : trace.payload?.chat_id ? `Conversation ${String(trace.payload.chat_id).slice(-6)}` : JSON.stringify(trace.payload)}</td><td className="whitespace-nowrap px-5 py-3.5 text-xs text-zinc-400">{dateLabel(trace.created_at)}</td></tr>)}</tbody></table></div>}</section>

        <div className="grid gap-6 xl:grid-cols-2"><section className="border border-zinc-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4"><div><h2 className="text-sm font-semibold text-zinc-950">Conversation traces</h2><p className="mt-0.5 text-xs text-zinc-500">Completed AI conversation turns and their model sessions</p></div><MessageSquareText className="h-4 w-4 text-zinc-400" /></div>{conversations.length ? <div className="divide-y divide-zinc-100">{conversations.map((trace) => <Link key={trace.id} to={trace.payload?.chat_id ? `/plans/create/${trace.payload.chat_id}` : "/"} className="flex items-center gap-3 px-5 py-4 hover:bg-zinc-50"><span className="grid h-9 w-9 shrink-0 place-items-center bg-indigo-50 text-indigo-700"><Bot className="h-4 w-4" /></span><span className="min-w-0 flex-1"><b className="block text-sm font-medium text-zinc-900">{trace.payload?.user_message || "AI plan conversation"}</b><span className="mt-1 block truncate text-xs text-zinc-500">{trace.payload?.assistant_response_length ?? 0} response characters · {trace.payload?.chat_id ? `Chat ${String(trace.payload.chat_id).slice(-6)}` : "No chat ID"}</span></span><time className="shrink-0 text-[11px] text-zinc-400">{dateLabel(trace.created_at)}</time><ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" /></Link>)}</div> : <div className="px-6 py-10 text-center"><MessageSquareText className="mx-auto h-5 w-5 text-zinc-300" /><p className="mt-3 text-sm font-medium text-zinc-700">No conversation traces yet</p><p className="mt-1 text-xs text-zinc-500">Conversation activity will appear here after a turn completes.</p></div>}</section>
            <section className="border border-zinc-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4"><div><h2 className="text-sm font-semibold text-zinc-950">Workflow traces</h2><p className="mt-0.5 text-xs text-zinc-500">Automation run history</p></div><Workflow className="h-4 w-4 text-zinc-400" /></div>{workflows.length ? <div className="divide-y divide-zinc-100">{workflows.map((trace) => <div key={trace.id} className="flex items-center gap-3 px-5 py-4"><span className="grid h-9 w-9 place-items-center bg-amber-50 text-amber-700"><CheckCircle2 className="h-4 w-4" /></span><span className="min-w-0 flex-1"><b className="block text-sm font-medium text-zinc-900">{traceTitle(trace)}</b><span className="block truncate text-xs text-zinc-500">{JSON.stringify(trace.payload)}</span></span><time className="shrink-0 text-[11px] text-zinc-400">{dateLabel(trace.created_at)}</time></div>)}</div> : <div className="px-6 py-10 text-center"><Clock3 className="mx-auto h-5 w-5 text-zinc-300" /><p className="mt-3 text-sm font-medium text-zinc-700">Workflow traces will come later</p><p className="mt-1 text-xs text-zinc-500">This section is ready for workflow instrumentation when that feature is built.</p></div>}</section></div>
    </div></div>
}
