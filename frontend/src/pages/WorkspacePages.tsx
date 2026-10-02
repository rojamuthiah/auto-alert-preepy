import { FormEvent, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Activity, ArrowUpRight, Bell, LoaderCircle, Workflow, KeyRound, Play, Pause, Pencil, Trash2 } from "lucide-react"

type Trace = { id: string; type: string; source: string; payload: Record<string, unknown>; created_at: string }
type WorkflowAlert = { id: string; company?: string; title?: string; target_role?: string; experience?: string; url?: string; workflow_id?: string; created_at?: string; delivered?: boolean }
type Workflow = { id: string; name: string; plan_name?: string; channel: string; target_roles: string[]; experience: number; frequency: string; provider?: string; model?: string; enabled: boolean; status: string; last_error?: string | null; next_run_at?: string | null; created_at?: string | null; run_count?: number; notification_count?: number }
type WorkflowRun = { id: string; run_id?: string; run_at?: string; jobs_fetched?: number; notifications_sent?: number; status?: string; errors?: string[]; company?: string; title?: string; target_role?: string; experience?: string; url?: string; delivered?: boolean; created_at?: string; delivered_at?: string }
type ModelRegistry = Record<string, { models?: string[]; default_model?: string }>

const fallbackModelRegistry: ModelRegistry = {
    gemini: { default_model: "gemini-2.5-flash", models: ["gemini-2.5-flash"] },
    openai: { default_model: "gpt-5.2", models: ["gpt-5.2", "gpt-5-mini", "gpt-4.1"] },
    claude: { default_model: "claude-sonnet-5", models: ["claude-sonnet-5", "claude-haiku-4-5"] },
}

const frequencyLabels: Record<string, string> = {
    every_2_hours: "Every 2 hours",
    every_3_hours: "Every 3 hours",
    every_6_hours: "Every 6 hours",
    every_12_hours: "Every 12 hours",
    every_24_hours: "Every 24 hours",
}

function ActivityPage({ kind }: { kind: "alerts" | "workflow" }) {
    const [items, setItems] = useState<Trace[]>([])
    const [loading, setLoading] = useState(true)
    const title = kind === "alerts" ? "Alerts" : "Workflow"
    const Icon = kind === "alerts" ? Bell : Workflow
    useEffect(() => {
        const load = async () => {
            try {
                if (kind === "alerts") {
                    const response = await fetch("/api/workflows/alerts?limit=50")
                    const data: WorkflowAlert[] = await response.json().catch(() => [])
                    const alertItems = data.map((item) => ({ id: item.id, type: "job_alert", source: "job_alert", payload: { ...item }, created_at: item.created_at || new Date().toISOString() }))
                    setItems(alertItems)
                    return
                }
                const response = await fetch("/api/traces?type=workflow&limit=100")
                const data: Trace[] = await response.json().catch(() => [])
                setItems(data)
            } catch {
                setItems([])
            } finally {
                setLoading(false)
            }
        }
        void load()
    }, [kind])
    return <div className="min-h-screen bg-[#f7f8fa] px-6 py-10 md:px-10"><div className="mx-auto max-w-5xl"><div className="mb-8 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center bg-white text-zinc-700 shadow-sm"><Icon className="h-5 w-5" /></span><div><p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1></div></div>
        <section className="border border-zinc-200 bg-white shadow-sm">{loading ? <div className="flex justify-center py-14"><LoaderCircle className="h-5 w-5 animate-spin text-zinc-400" /></div> : items.length ? <div className="divide-y divide-zinc-100">{items.map((item) => kind === "alerts" ? <article key={item.id} className="flex gap-4 px-5 py-4"><span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center bg-emerald-50 text-emerald-700"><Bell className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-zinc-900">{(item.payload.company as string) || "Company"} · {(item.payload.target_role as string) || "Role"}</p><p className="mt-1 text-sm text-zinc-700">{(item.payload.title as string) || "Position"}</p><a href={String(item.payload.url || "#")} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-zinc-500 underline underline-offset-2">Open listing</a></div><div className="shrink-0 text-right text-xs text-zinc-400"><div>{item.payload.experience ? String(item.payload.experience) : "Experience"}</div><time>{new Date(item.created_at).toLocaleString("en-IN")}</time></div></article> : <article key={item.id} className="flex items-start gap-4 px-5 py-4"><span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center bg-zinc-100 text-zinc-600"><Activity className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-zinc-900">{item.source.replace(/_/g, " ")}</p><p className="mt-1 truncate text-xs text-zinc-500">{JSON.stringify(item.payload)}</p></div><time className="shrink-0 text-xs text-zinc-400">{new Date(item.created_at).toLocaleString("en-IN")}</time></article>)}</div> : <div className="px-6 py-16 text-center"><div className="mx-auto mb-4 grid h-12 w-12 place-items-center bg-zinc-100 text-zinc-500"><Icon className="h-5 w-5" /></div><h2 className="font-semibold text-zinc-900">Nothing to show yet</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500">{kind === "alerts" ? "Latest job matches will appear here once a workflow finds a new opening." : "Workflow activity will show here as automations run."}</p></div>}</section>
    </div></div>
}

export function AlertsPage() { return <ActivityPage kind="alerts" /> }

export function WorkflowPage() {
    const navigate = useNavigate()
    const [workflows, setWorkflows] = useState<Workflow[]>([])
    const [loading, setLoading] = useState(true)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [message, setMessage] = useState("")
    const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null)
    const [runs, setRuns] = useState<Record<string, WorkflowRun[]>>({})
    const [runsLoading, setRunsLoading] = useState(false)
    const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null)
    const [editDraft, setEditDraft] = useState<Workflow | null>(null)
    const [modelRegistry, setModelRegistry] = useState<ModelRegistry>(fallbackModelRegistry)
    const [editLoading, setEditLoading] = useState(false)
    const [editError, setEditError] = useState("")
    const [channelOptions, setChannelOptions] = useState<{ value: string; label: string }[]>([])

    const loadWorkflows = async () => {
        const response = await fetch("/api/workflows")
        if (!response.ok) throw new Error("Could not load workflows")
        setWorkflows(await response.json())
    }

    const modalWorkflow = editingWorkflow
    const modalDraft = editDraft

    const EditWorkflowModal = () => {
        if (!modalWorkflow || !modalDraft) return null

        return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) { setEditingWorkflow(null); setEditDraft(null) } }}>
            <div className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
                <div className="mb-5 flex items-start justify-between gap-3">
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Edit workflow</p>
                        <h3 className="mt-2 text-2xl font-semibold text-zinc-950">{modalWorkflow.name}</h3>
                    </div>
                    <button type="button" onClick={() => { setEditingWorkflow(null); setEditDraft(null) }} className="rounded-full border border-zinc-200 p-2 text-zinc-500 hover:bg-zinc-100">×</button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="mb-2 block text-sm font-medium text-zinc-700">Name</label>
                        <input value={modalDraft.name} onChange={(event) => setEditDraft((current) => current ? { ...current, name: event.target.value } : current)} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-900" />
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-medium text-zinc-700">Target roles</label>
                        <div className="flex flex-wrap gap-2">
                            {["Software Engineer", "Frontend Engineer", "Backend Engineer", "Full Stack Engineer", "Data Engineer", "Data Analyst", "QA Engineer", "Product Manager", "DevOps Engineer", "Machine Learning Engineer", "Security Engineer"].map((role) => {
                                const active = modalDraft.target_roles.includes(role)
                                return <button key={role} type="button" onClick={() => setEditDraft((current) => {
                                    if (!current) return current
                                    const next = current.target_roles.includes(role)
                                        ? current.target_roles.filter((item) => item !== role)
                                        : [...current.target_roles, role]
                                    return { ...current, target_roles: next }
                                })} className={`rounded-xl border px-3 py-2 text-xs font-medium ${active ? "border-zinc-900 bg-zinc-950 text-white" : "border-zinc-200 bg-zinc-50 text-zinc-700"}`}>{role}</button>
                            })}
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <label className="mb-2 block text-sm font-medium text-zinc-700">Experience</label>
                            <input type="number" min={0} max={40} value={modalDraft.experience} onChange={(event) => setEditDraft((current) => current ? { ...current, experience: Number(event.target.value) || 0 } : current)} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-900" />
                        </div>
                        <div>
                            <label className="mb-2 block text-sm font-medium text-zinc-700">Frequency</label>
                            <select value={modalDraft.frequency} onChange={(event) => setEditDraft((current) => current ? { ...current, frequency: event.target.value } : current)} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-900">
                                <option value="every_2_hours">Every 2 hours</option>
                                <option value="every_3_hours">Every 3 hours</option>
                                <option value="every_6_hours">Every 6 hours</option>
                                <option value="every_12_hours">Every 12 hours</option>
                                <option value="every_24_hours">Every 24 hours</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <label className="mb-2 block text-sm font-medium text-zinc-700">Provider</label>
                            <select value={modalDraft.provider} onChange={(event) => {
                                const provider = event.target.value
                                const nextModel = modelRegistry[provider]?.models?.[0] || modalDraft.model || fallbackModelRegistry[provider]?.default_model || "gemini-2.5-flash"
                                setEditDraft((current) => current ? { ...current, provider, model: nextModel } : current)
                            }} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-900">
                                {Object.keys(modelRegistry).map((provider) => <option key={provider} value={provider}>{provider === "openai" ? "OpenAI" : provider === "claude" ? "Claude" : "Gemini"}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="mb-2 block text-sm font-medium text-zinc-700">Model</label>
                            <select value={modalDraft.model} onChange={(event) => setEditDraft((current) => current ? { ...current, model: event.target.value } : current)} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-900">
                                {((modelRegistry[modalDraft.provider || "gemini"]?.models || [modalDraft.model || fallbackModelRegistry[modalDraft.provider || "gemini"]?.default_model || "gemini-2.5-flash"]) as string[]).map((model: string) => <option key={model} value={model}>{model}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-medium text-zinc-700">Delivery channel</label>
                        {channelOptions.length ? <select value={modalDraft.channel} onChange={(event) => setEditDraft((current) => current ? { ...current, channel: event.target.value } : current)} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-900">
                            {channelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select> : <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">No enabled channels are available. Enable an email or WhatsApp channel first.</div>}
                    </div>

                    {editError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{editError}</p>}
                </div>

                <div className="mt-6 flex justify-end gap-2">
                    <button type="button" onClick={() => { setEditingWorkflow(null); setEditDraft(null) }} className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700">Cancel</button>
                    <button type="button" disabled={editLoading || !modalDraft.target_roles.length} onClick={() => void saveWorkflowEdit()} className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{editLoading && <LoaderCircle className="h-4 w-4 animate-spin" />}Save changes</button>
                </div>
            </div>
        </div>
    }

    useEffect(() => {
        const loadModelRegistry = async () => {
            try {
                const response = await fetch("/api/settings")
                if (!response.ok) return
                const data = await response.json().catch(() => ({ models: fallbackModelRegistry }))
                setModelRegistry((data.models as ModelRegistry) || fallbackModelRegistry)
            } catch {
                setModelRegistry(fallbackModelRegistry)
            }
        }

        Promise.all([
            loadWorkflows(),
            loadModelRegistry(),
        ]).catch(() => setWorkflows([])).finally(() => setLoading(false))
    }, [])

    const openRuns = async (id: string) => {
        const next = selectedWorkflowId === id ? null : id
        setSelectedWorkflowId(next)
        if (!next) return
        setRunsLoading(true)
        try {
            const response = await fetch(`/api/workflows/${id}/runs`)
            const body = await response.json().catch(() => ({ runs: [] }))
            if (!response.ok) throw new Error(body.detail || "Could not load workflow runs.")
            setRuns((current) => ({ ...current, [id]: body.runs || [] }))
        } catch (error) {
            setRuns((current) => ({ ...current, [id]: [] }))
            setMessage(error instanceof Error ? error.message : "Could not load workflow runs.")
        } finally { setRunsLoading(false) }
    }

    const triggerWorkflow = async (id: string) => {
        setBusyId(id); setMessage("")
        try {
            const response = await fetch(`/api/workflows/${id}/trigger`, { method: "PATCH" })
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.detail || "Could not trigger workflow.")
            setMessage("Workflow started successfully.")
            await loadWorkflows()
            await openRuns(id)
        } catch (error) { setMessage(error instanceof Error ? error.message : "Trigger failed.") }
        finally { setBusyId(null) }
    }

    const toggleWorkflow = async (id: string, enabled: boolean) => {
        setBusyId(id); setMessage("")
        try {
            const response = await fetch(`/api/workflows/${id}/toggle?enabled=${String(enabled)}`, { method: "PATCH" })
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.detail || "Could not update workflow.")
            setMessage(enabled ? "Workflow enabled." : "Workflow paused.")
            await loadWorkflows()
        } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update workflow.") }
        finally { setBusyId(null) }
    }

    const deleteWorkflow = async (id: string) => {
        setBusyId(id); setMessage("")
        try {
            const response = await fetch(`/api/workflows/${id}`, { method: "DELETE" })
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.detail || "Could not delete workflow.")
            setMessage("Workflow removed.")
            await loadWorkflows()
            if (selectedWorkflowId === id) setSelectedWorkflowId(null)
        } catch (error) { setMessage(error instanceof Error ? error.message : "Could not delete workflow.") }
        finally { setBusyId(null) }
    }

    const openEditWorkflow = async (workflow: Workflow) => {
        setEditingWorkflow(workflow)
        setEditDraft({ ...workflow, provider: workflow.provider || "gemini", model: workflow.model || "gemini-2.5-flash" })
        setEditError("")
        try {
            const response = await fetch("/api/channels")
            const data = await response.json().catch(() => ({ email: { configured: false, enabled: false }, whatsapp: { configured: false, enabled: false } }))
            if (!response.ok) throw new Error(data.detail || "Could not fetch channels")
            const enabledChannels = Object.entries(data)
                .filter(([, info]) => Boolean((info as { configured?: boolean; enabled?: boolean }).configured) && Boolean((info as { configured?: boolean; enabled?: boolean }).enabled))
                .map(([key]) => ({ value: key, label: key === "email" ? "Email" : "WhatsApp" }))
            setChannelOptions(enabledChannels)
        } catch {
            setChannelOptions([])
        }
    }

    const saveWorkflowEdit = async () => {
        if (!editingWorkflow || !editDraft) return
        if (!editDraft.target_roles.length) {
            setEditError("Select at least one target role.")
            return
        }
        if (!channelOptions.length && editingWorkflow.channel) {
            setEditError("Enable at least one email or WhatsApp channel before editing the workflow.")
            return
        }
        setEditLoading(true)
        setEditError("")
        try {
            const payload = {
                name: editDraft.name,
                target_roles: editDraft.target_roles,
                experience: Number(editDraft.experience),
                frequency: editDraft.frequency,
                channel: channelOptions.some((option) => option.value === editDraft.channel) ? editDraft.channel : channelOptions[0]?.value || editingWorkflow.channel,
                provider: editDraft.provider,
                model: editDraft.model,
            }
            const response = await fetch(`/api/workflows/${editingWorkflow.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.detail || "Could not update workflow.")
            setMessage("Workflow updated.")
            setEditingWorkflow(null)
            setEditDraft(null)
            await loadWorkflows()
        } catch (error) {
            setEditError(error instanceof Error ? error.message : "Could not update workflow.")
        } finally {
            setEditLoading(false)
        }
    }

    return <>
        <div className="min-h-screen bg-[#f7f8fa] px-6 py-10 md:px-10"><div className="mx-auto max-w-6xl"><div className="mb-8 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center bg-white text-zinc-700 shadow-sm"><Workflow className="h-5 w-5" /></span><div><p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">Workflow</h1></div></div>
            {message && <p role="status" className="mb-4 border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
            {loading ? <div className="flex justify-center border border-zinc-200 bg-white py-16"><LoaderCircle className="h-5 w-5 animate-spin text-zinc-400" /></div> : workflows.length === 0 ? <section className="border border-zinc-200 bg-white px-6 py-16 text-center shadow-sm"><div className="mx-auto mb-4 grid h-12 w-12 place-items-center bg-zinc-100 text-zinc-500"><Workflow className="h-5 w-5" /></div><h2 className="font-semibold text-zinc-900">No workflows yet</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-zinc-500">Add a plan to workflow from the plans page to create and schedule job alerts.</p></section> : <div className="grid gap-4 xl:grid-cols-2">{workflows.map((workflow) => <article key={workflow.id} onClick={() => void openRuns(workflow.id)} className="cursor-pointer border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-300"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{workflow.plan_name || "Plan"}</p><h2 className="mt-1 text-xl font-semibold text-zinc-950">{workflow.name}</h2></div><span className={`inline-flex items-center border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${workflow.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-zinc-200 bg-zinc-50 text-zinc-500"}`}>{workflow.enabled ? workflow.status : "Paused"}</span></div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 text-sm text-zinc-600"><div><span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Channel</span><span className="mt-1 block font-medium text-zinc-900">{workflow.channel === "email" ? "Email" : "WhatsApp"}</span></div><div><span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Experience</span><span className="mt-1 block font-medium text-zinc-900">{workflow.experience}+ years</span></div><div><span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Frequency</span><span className="mt-1 block font-medium text-zinc-900">{frequencyLabels[workflow.frequency] || workflow.frequency}</span></div><div><span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Model</span><span className="mt-1 block font-medium text-zinc-900">{workflow.provider || "gemini"} · {workflow.model || "gemini-2.5-flash"}</span></div></div>
                <div className="mt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Target roles</p>
                    <div className="mt-2 flex flex-wrap gap-2">{workflow.target_roles.length ? workflow.target_roles.map((role) => <span key={role} className="border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-700">{role}</span>) : <span className="text-xs text-zinc-500">No role selected</span>}</div>
                </div>
                {(workflow.last_error || workflow.notification_count !== undefined) && <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">{workflow.last_error ? <span className="block text-red-700">{workflow.last_error}</span> : null}<span className="block">Runs: {workflow.run_count ?? 0} · Alerts sent: {workflow.notification_count ?? 0}</span></div>}
                <div className="mt-5 flex flex-wrap gap-2">
                    <button type="button" onClick={(event) => { event.stopPropagation(); void openRuns(workflow.id) }} className="inline-flex items-center gap-2 border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700">{selectedWorkflowId === workflow.id ? "Hide runs" : "View runs"}</button>
                    <button type="button" disabled={busyId === workflow.id} onClick={(event) => { event.stopPropagation(); void triggerWorkflow(workflow.id) }} className="inline-flex items-center gap-2 bg-zinc-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Play className="h-3.5 w-3.5" />{busyId === workflow.id ? "Running..." : "Trigger now"}</button>
                    <button type="button" title="Edit workflow" disabled={busyId === workflow.id} onClick={(event) => { event.stopPropagation(); void openEditWorkflow(workflow) }} className="inline-flex items-center gap-2 border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 disabled:opacity-50"><Pencil className="h-3.5 w-3.5" />Edit</button>
                    <button type="button" disabled={busyId === workflow.id} onClick={(event) => { event.stopPropagation(); void toggleWorkflow(workflow.id, !workflow.enabled) }} className="inline-flex items-center gap-2 border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 disabled:opacity-50">{workflow.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{workflow.enabled ? "Pause" : "Resume"}</button>
                    <button type="button" disabled={busyId === workflow.id} onClick={(event) => { event.stopPropagation(); void deleteWorkflow(workflow.id) }} className="inline-flex items-center gap-2 border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Delete</button>
                </div>
                {selectedWorkflowId === workflow.id && <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="mb-3 flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Runs</p><span className="text-[10px] text-zinc-500">{(runs[workflow.id] || []).length} runs</span></div>
                    {runsLoading ? <div className="flex items-center gap-2 text-sm text-zinc-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading runs...</div> : (runs[workflow.id] || []).length === 0 ? <p className="text-sm text-zinc-500">No runs yet for this workflow.</p> : <ul className="space-y-3">{(runs[workflow.id] || []).map((run) => <li key={run.id} className="rounded-lg border border-zinc-200 bg-white p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold text-zinc-900">Run {run.run_id ? run.run_id.slice(0, 12) : run.id.slice(0, 12)}</p><p className="mt-1 text-xs text-zinc-500">{run.run_at ? new Date(run.run_at).toLocaleString("en-IN") : "Recently"}</p></div><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${run.status === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{run.status || "completed"}</span></div><div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500"><span>{run.jobs_fetched ?? 0} jobs fetched</span><span>{run.notifications_sent ?? 0} alerts</span>{run.errors && run.errors.length > 0 && <span className="text-red-600">{run.errors.length} errors</span>}</div><div className="mt-3 flex items-center justify-between"><button type="button" onClick={(event) => { event.stopPropagation(); if (run.run_id) navigate(`/traces?workflow_id=${workflow.id}&run_id=${run.run_id}`) }} className="inline-flex items-center gap-2 text-[11px] font-semibold text-zinc-700 underline underline-offset-2"><ArrowUpRight className="h-3.5 w-3.5" />View traces</button></div></li>)}</ul>}
                </div>}
            </article>)}</div>}
        </div></div>
        <EditWorkflowModal />
    </>
}

export function LlmSettingsPage() {
    const providerKeys = ["openai", "claude", "gemini"] as const
    type ProviderId = typeof providerKeys[number]
    const [configured, setConfigured] = useState<Record<ProviderId, boolean>>({ openai: false, claude: false, gemini: false })
    const [keys, setKeys] = useState<Record<ProviderId, string>>({ openai: "", claude: "", gemini: "" })
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState("")
    const [error, setError] = useState("")
    const [langfuseConfigured, setLangfuseConfigured] = useState(false)
    const [langfuseBaseUrl, setLangfuseBaseUrl] = useState("")
    const [langfusePublicKey, setLangfusePublicKey] = useState("")
    const [langfuseSecretKey, setLangfuseSecretKey] = useState("")
    const [langfuseSaving, setLangfuseSaving] = useState(false)
    useEffect(() => { fetch("/api/settings").then((r) => r.json()).then((data) => { setConfigured({ openai: Boolean(data.providers?.openai?.configured), claude: Boolean(data.providers?.claude?.configured), gemini: Boolean(data.providers?.gemini?.configured) }); setLangfuseConfigured(Boolean(data.langfuse?.configured)); setLangfuseBaseUrl(data.langfuse?.base_url || "") }).catch(() => {}) }, [])
    const save = async (event: FormEvent, provider: ProviderId) => {
        event.preventDefault(); setSaving(true); setError(""); setMessage("")
        if (!keys[provider].trim()) { setError("Enter an API key first."); setSaving(false); return }
        try {
            const response = await fetch("/api/settings/providers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [`${provider}_api_key`]: keys[provider] }) })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data.detail || "Could not save API key.")
            setConfigured((current) => ({ ...current, [provider]: true })); setKeys((current) => ({ ...current, [provider]: "" })); setMessage(`${provider === "claude" ? "Claude" : provider === "openai" ? "OpenAI" : "Gemini"} key saved`)
        } catch (e) { setError(e instanceof Error ? e.message : "Could not save API key.") }
        finally { setSaving(false) }
    }
    const saveLangfuse = async (event: FormEvent) => {
        event.preventDefault(); setError(""); setMessage("")
        if (Boolean(langfusePublicKey.trim()) !== Boolean(langfuseSecretKey.trim())) { setError("Enter both Langfuse keys to connect or replace the connection."); return }
        setLangfuseSaving(true)
        try {
            const response = await fetch("/api/settings/langfuse", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ public_key: langfusePublicKey || undefined, secret_key: langfuseSecretKey || undefined, base_url: langfuseBaseUrl }) })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data.detail || "Could not save Langfuse settings.")
            if (langfusePublicKey && langfuseSecretKey) setLangfuseConfigured(true)
            setLangfusePublicKey(""); setLangfuseSecretKey(""); setMessage("Langfuse settings saved")
        } catch (e) { setError(e instanceof Error ? e.message : "Could not save Langfuse settings.") }
        finally { setLangfuseSaving(false) }
    }
    return <div className="min-h-screen bg-[#f7f8fa] px-6 py-10 md:px-10"><div className="mx-auto max-w-5xl"><div className="mb-8 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center bg-white text-zinc-700 shadow-sm"><KeyRound className="h-5 w-5" /></span><div><p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">LLM settings</h1></div></div>
        <p className="mb-5 max-w-2xl text-sm leading-6 text-zinc-500">Add one or more providers. Keys are saved in your local settings database and are never returned to the browser after saving. Choose an enabled provider and model when you start a plan conversation.</p>
        <div className="grid gap-4 lg:grid-cols-3">{providerKeys.map((provider) => { const title = provider === "claude" ? "Claude" : provider === "openai" ? "OpenAI" : "Gemini"; return <form key={provider} onSubmit={(event) => void save(event, provider)} className="border border-zinc-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Provider</p><h2 className="mt-1 text-lg font-semibold text-zinc-950">{title}</h2></div><span className={`mt-1 h-2.5 w-2.5 ${configured[provider] ? "bg-emerald-500" : "bg-zinc-300"}`} title={configured[provider] ? "Key configured" : "Key not configured"} /> </div><p className="mt-2 min-h-10 text-xs leading-5 text-zinc-500">{configured[provider] ? "API key configured" : "Add an API key to enable this provider."}</p><label htmlFor={`${provider}-key`} className="mb-1.5 mt-4 block text-xs font-semibold text-zinc-700">{configured[provider] ? "Replace key" : "API key"}</label><input id={`${provider}-key`} type="password" autoComplete="new-password" value={keys[provider]} onChange={(e) => setKeys((current) => ({ ...current, [provider]: e.target.value }))} placeholder={`Paste ${title} API key`} className="w-full border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-zinc-900" /><button disabled={saving || !keys[provider].trim()} className="mt-4 inline-flex items-center gap-2 bg-zinc-950 px-3.5 py-2.5 text-xs font-semibold text-white disabled:opacity-40">{saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}Save {title} key</button></form> })}</div>
        <form onSubmit={(event) => void saveLangfuse(event)} className="mt-6 max-w-3xl border border-zinc-200 bg-white p-5 shadow-sm md:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Observability</p><h2 className="mt-1 text-lg font-semibold text-zinc-950">Langfuse</h2><p className="mt-1 max-w-xl text-xs leading-5 text-zinc-500">Send conversation, model, and tool traces to Langfuse Cloud or your self-hosted instance. Credentials stay in your local MongoDB settings.</p></div><span className={`border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${langfuseConfigured ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-zinc-200 bg-zinc-50 text-zinc-500"}`}>{langfuseConfigured ? "Connected config" : "Not configured"}</span></div><div className="mt-4 grid gap-3 md:grid-cols-3"><div><label htmlFor="langfuse-public" className="mb-1 block text-xs font-semibold text-zinc-700">Public key</label><input id="langfuse-public" value={langfusePublicKey} onChange={(e) => setLangfusePublicKey(e.target.value)} className="w-full border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-zinc-900" placeholder={langfuseConfigured ? "Saved · enter to replace" : "pk-lf-…"} /></div><div><label htmlFor="langfuse-secret" className="mb-1 block text-xs font-semibold text-zinc-700">Secret key</label><input id="langfuse-secret" type="password" autoComplete="new-password" value={langfuseSecretKey} onChange={(e) => setLangfuseSecretKey(e.target.value)} className="w-full border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-zinc-900" placeholder={langfuseConfigured ? "Saved · enter to replace" : "sk-lf-…"} /></div><div><label htmlFor="langfuse-url" className="mb-1 block text-xs font-semibold text-zinc-700">Base URL</label><input id="langfuse-url" value={langfuseBaseUrl} onChange={(e) => setLangfuseBaseUrl(e.target.value)} className="w-full border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-zinc-900" placeholder="https://cloud.langfuse.com" /></div></div><button disabled={langfuseSaving} className="mt-4 inline-flex items-center gap-2 bg-zinc-950 px-3.5 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{langfuseSaving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}Save Langfuse settings</button></form>
        {message && <p role="status" className="mt-4 text-sm font-medium text-emerald-700">{message}</p>}{error && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{error}</p>}
    </div></div>
}
