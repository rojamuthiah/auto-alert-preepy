import { useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ArrowUpRight, BriefcaseBusiness, ChevronDown, FileSpreadsheet, FileText, LoaderCircle, Plus, Sparkles, Upload, X } from "lucide-react"
import SearchableSelect from "../components/SearchableSelect"

type Plan = { id: string; name: string; key: string; row_count: number; created_at: string }
type PlanDetail = { id: string; name: string; key: string; rows: Array<{ company: string; tier: string; priority: string; careers_page: string; remarks?: string }> }
type ChannelSummary = { configured: boolean; enabled: boolean }
type WorkflowDraft = { plan_id: string; name: string; target_roles: string[]; experience: number; frequency: string; channel: string; provider: string; model: string; initial_start_time: string }

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
const roleOptions = ["Software Engineer", "Frontend Engineer", "Backend Engineer", "Full Stack Engineer", "Data Engineer", "Data Analyst", "QA Engineer", "Product Manager", "DevOps Engineer", "Machine Learning Engineer", "Security Engineer"]
const frequencyOptions = [
    { value: "every_2_hours", label: "Every 2 hours" },
    { value: "every_3_hours", label: "Every 3 hours" },
    { value: "every_6_hours", label: "Every 6 hours" },
    { value: "every_12_hours", label: "Every 12 hours" },
    { value: "every_24_hours", label: "Every 24 hours" },
]
const fallbackProviderModels: Record<string, string[]> = {
    gemini: ["gemini-2.5-flash"],
    openai: ["gpt-5.2", "gpt-5-mini", "gpt-4.1"],
    claude: ["claude-sonnet-5", "claude-haiku-4-5"],
}

export default function JobPlansPage() {
    const [plans, setPlans] = useState<Plan[]>([])
    const [loading, setLoading] = useState(true)
    const [menuOpen, setMenuOpen] = useState(false)
    const [importOpen, setImportOpen] = useState(false)
    const [workflowOpen, setWorkflowOpen] = useState(false)
    const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
    const [planDetail, setPlanDetail] = useState<PlanDetail | null>(null)
    const [channelState, setChannelState] = useState<{ email: ChannelSummary; whatsapp: ChannelSummary }>({ email: { configured: false, enabled: false }, whatsapp: { configured: false, enabled: false } })
    const [providerModels, setProviderModels] = useState<Record<string, string[]>>(fallbackProviderModels)
    const [workflowDraft, setWorkflowDraft] = useState<WorkflowDraft>({
        plan_id: "",
        name: "",
        target_roles: [],
        experience: 3,
        frequency: "every_12_hours",
        channel: "email",
        provider: "gemini",
        model: "gemini-2.5-flash",
        initial_start_time: "",
    })
    const [wizardStep, setWizardStep] = useState(0)
    const [savingWorkflow, setSavingWorkflow] = useState(false)
    const [workflowError, setWorkflowError] = useState("")
    const [name, setName] = useState("")
    const [key, setKey] = useState("")
    const [file, setFile] = useState<File | null>(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState("")
    const [toast, setToast] = useState("")
    const fileRef = useRef<HTMLInputElement>(null)
    const navigate = useNavigate()

    const availableWorkflowChannels = Object.entries(channelState)
        .filter(([, info]) => info.configured && info.enabled)
        .map(([key]) => key)

    const loadPlans = async () => {
        const response = await fetch("/api/plans")
        if (!response.ok) throw new Error("Could not load plans")
        setPlans(await response.json())
    }

    const loadChannels = async () => {
        const response = await fetch("/api/channels")
        const data = await response.json().catch(() => ({ email: { configured: false, enabled: false }, whatsapp: { configured: false, enabled: false } }))
        if (!response.ok) throw new Error(data.detail || "Could not read channels")
        setChannelState(data)
    }

    useEffect(() => {
        const loadModelRegistry = async () => {
            try {
                const response = await fetch("/api/settings")
                if (!response.ok) return
                const data = await response.json().catch(() => ({ models: fallbackProviderModels }))
                const registry = data.models || fallbackProviderModels
                const nextModels = Object.fromEntries(
                    Object.entries(registry as Record<string, { models?: string[]; default_model?: string }>).map(([provider, info]) => [provider, Array.isArray(info?.models) ? info.models : fallbackProviderModels[provider] || []]),
                )
                if (Object.keys(nextModels).length) {
                    setProviderModels(nextModels)
                    const firstProvider = Object.keys(nextModels)[0]
                    const defaultModel = nextModels[firstProvider]?.[0] || "gemini-2.5-flash"
                    setWorkflowDraft((current) => ({
                        ...current,
                        provider: current.provider && nextModels[current.provider] ? current.provider : firstProvider,
                        model: current.model && (nextModels[current.provider] || []).includes(current.model) ? current.model : defaultModel,
                    }))
                }
            } catch {
                setProviderModels(fallbackProviderModels)
            }
        }

        Promise.all([
            loadPlans(),
            loadChannels(),
            loadModelRegistry(),
        ]).catch((e) => setError(e.message)).finally(() => setLoading(false))
    }, [])

    const openImport = () => {
        setMenuOpen(false); setImportOpen(true); setError(""); setFile(null); setName(""); setKey("")
    }

    const openWorkflowModal = async (plan: Plan) => {
        setSelectedPlan(plan)
        setWorkflowDraft({
            plan_id: plan.id,
            name: plan.name,
            target_roles: [],
            experience: 3,
            frequency: "every_12_hours",
            channel: "email",
            provider: "gemini",
            model: "gemini-2.5-flash",
            initial_start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16),
        })
        setWizardStep(0)
        setWorkflowError("")
        setWorkflowOpen(true)
        try {
            const [detailResponse, channelResponse] = await Promise.all([
                fetch(`/api/plans/${plan.id}`),
                fetch("/api/channels"),
            ])
            if (detailResponse.ok) setPlanDetail(await detailResponse.json())
            if (channelResponse.ok) {
                const channelData = await channelResponse.json()
                setChannelState(channelData)
                const preferred = channelData.email.enabled ? "email" : channelData.whatsapp.enabled ? "whatsapp" : "email"
                setWorkflowDraft((current) => ({ ...current, channel: preferred }))
            }
        } catch {
            setWorkflowError("Could not prepare this workflow. Please try again.")
        }
    }

    const selectFile = (picked: File | undefined) => {
        if (!picked) return
        if (!picked.name.toLowerCase().endsWith(".xlsx")) { setError("Choose an Excel .xlsx file."); return }
        setFile(picked)
        if (!name) { const nextName = picked.name.replace(/\.xlsx$/i, "").replace(/[_-]+/g, " "); setName(nextName); setKey(slugify(nextName)) }
        setError("")
    }

    const importPlan = async (event: React.FormEvent) => {
        event.preventDefault()
        if (!file) { setError("Select an Excel file to continue."); return }
        setSaving(true); setError("")
        try {
            const form = new FormData(); form.append("name", name); form.append("key", key); form.append("file", file)
            const response = await fetch("/api/plans/import", { method: "POST", body: form })
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.detail || "Could not import this plan.")
            await loadPlans(); setImportOpen(false); setToast("Plan imported")
            window.setTimeout(() => setToast(""), 2600)
        } catch (e) { setError(e instanceof Error ? e.message : "Could not import this plan.") }
        finally { setSaving(false) }
    }

    const saveWorkflow = async () => {
        if (!selectedPlan) return
        if (!workflowDraft.target_roles.length) { setWorkflowError("Select at least one target role."); return }
        if (!availableWorkflowChannels.length) { setWorkflowError("Enable an email or WhatsApp channel before saving this workflow."); return }
        setSavingWorkflow(true); setWorkflowError("")
        try {
            const payload = {
                plan_id: selectedPlan.id,
                name: workflowDraft.name || selectedPlan.name,
                target_roles: workflowDraft.target_roles,
                experience: Number(workflowDraft.experience),
                frequency: workflowDraft.frequency,
                channel: availableWorkflowChannels.includes(workflowDraft.channel) ? workflowDraft.channel : availableWorkflowChannels[0],
                provider: workflowDraft.provider,
                model: workflowDraft.model,
                initial_start_time: workflowDraft.initial_start_time ? new Date(workflowDraft.initial_start_time).toISOString() : undefined,
            }
            const response = await fetch("/api/workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data.detail || "Could not create workflow.")
            setWorkflowOpen(false); setToast("Workflow added")
            window.setTimeout(() => setToast(""), 2600)
        } catch (e) { setWorkflowError(e instanceof Error ? e.message : "Could not create workflow.") }
        finally { setSavingWorkflow(false) }
    }

    const rolePreview = workflowDraft.target_roles.length ? workflowDraft.target_roles.join(", ") : "None selected"

    return <div className="min-h-screen bg-[#f7f8fa] px-6 py-10 md:px-10">
        <div className="mx-auto max-w-6xl">
            <div className="mb-10 flex flex-wrap items-end justify-between gap-5">
                <div>
                    <div className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500"><BriefcaseBusiness className="h-4 w-4" /> Your job search</div>
                    <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 md:text-4xl">Job plans</h1>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">Organize target companies and keep your job search moving with a clear plan.</p>
                </div>
                <div className="relative">
                    <button type="button" onClick={() => setMenuOpen((open) => !open)} className="inline-flex items-center gap-2 bg-zinc-950 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800"><Plus className="h-4 w-4" /> Create a plan <ChevronDown className="h-4 w-4 opacity-80" /></button>
                    {menuOpen && <>
                        <button aria-label="Close create plan menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} />
                        <div className="absolute right-0 z-20 mt-2 w-72 border border-zinc-200 bg-white p-2 shadow-xl">
                            <button onClick={() => { setMenuOpen(false); setError(""); navigate("/plans/create") }} className="flex w-full gap-3 p-3 text-left hover:bg-zinc-50"><span className="grid h-9 w-9 shrink-0 place-items-center bg-violet-50 text-violet-700"><Sparkles className="h-4 w-4" /></span><span><b className="block text-sm">Create with AI</b><span className="mt-1 block text-xs leading-5 text-zinc-500">Open your conversations and build a plan with AI.</span></span></button>
                            <button onClick={openImport} className="flex w-full gap-3 p-3 text-left hover:bg-zinc-50"><span className="grid h-9 w-9 shrink-0 place-items-center bg-emerald-50 text-emerald-700"><FileSpreadsheet className="h-4 w-4" /></span><span><b className="block text-sm">Upload Excel file</b><span className="mt-1 block text-xs leading-5 text-zinc-500">Import a company list using our template.</span></span></button>
                        </div>
                    </>}
                </div>
            </div>

            {error && !importOpen && <div role="alert" className="mb-5 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
            {loading ? <div className="grid gap-4 md:grid-cols-2"><div className="h-40 animate-pulse bg-zinc-200" /><div className="h-40 animate-pulse bg-zinc-200" /></div>
                : plans.length === 0 ? <section className="border border-dashed border-zinc-300 bg-white px-6 py-16 text-center shadow-sm md:px-12">
                    <div className="mx-auto mb-5 grid h-14 w-14 place-items-center bg-zinc-100 text-zinc-700"><BriefcaseBusiness className="h-6 w-6" /></div>
                    <h2 className="text-xl font-semibold text-zinc-950">Your first plan starts here</h2>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">Build a target list with AI using your profile, or import companies you already have in a spreadsheet.</p>
                    <button onClick={() => setMenuOpen(true)} className="mt-6 inline-flex items-center gap-2 bg-zinc-950 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800"><Plus className="h-4 w-4" /> Create a plan</button>
                    <p className="mt-5 text-xs text-zinc-400">Your profile details can help personalize the AI plan.</p>
                </section> : <>
                    <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold text-zinc-700">All plans <span className="ml-1 text-zinc-400">{plans.length}</span></h2></div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{plans.map((plan) => <div key={plan.id} className="group border border-zinc-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md">
                        <Link to={`/plans/${plan.id}`} className="block">
                            <div className="mb-5 flex items-start justify-between"><span className="grid h-10 w-10 place-items-center bg-indigo-50 text-indigo-700"><BriefcaseBusiness className="h-5 w-5" /></span><ArrowUpRight className="h-4 w-4 text-zinc-400 transition group-hover:text-zinc-900" /></div>
                            <h3 className="truncate text-lg font-semibold text-zinc-950">{plan.name}</h3><p className="mt-1 truncate text-xs text-zinc-500">{plan.key}</p>
                            <div className="mt-6 flex items-center justify-between border-t border-zinc-100 pt-4"><span className="text-sm text-zinc-500">Target companies</span><span className="bg-zinc-100 px-2.5 py-1 text-sm font-semibold text-zinc-800">{plan.row_count}</span></div>
                            <p className="mt-3 text-xs text-zinc-400">Created {new Date(plan.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                        </Link>
                        <div className="mt-4 border-t border-zinc-100 pt-4">
                            <button type="button" onClick={() => void openWorkflowModal(plan)} className="inline-flex items-center gap-2 bg-zinc-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-zinc-800">Add to workflow</button>
                        </div>
                    </div>)}</div>
                </>}
        </div>

        {importOpen && <div className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setImportOpen(false) }}>
            <form onSubmit={importPlan} className="w-full max-w-lg border border-zinc-200 bg-white p-6 shadow-2xl md:p-8">
                <div className="mb-6 flex items-start justify-between"><div><span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Import a plan</span><h2 className="mt-2 text-2xl font-semibold">Upload Excel file</h2></div><button type="button" onClick={() => setImportOpen(false)} className="p-2 text-zinc-500 hover:bg-zinc-100" aria-label="Close"><X className="h-4 w-4" /></button></div>
                <label className="mb-1.5 block text-sm font-medium">Plan name</label><input required value={name} onChange={(e) => { setName(e.target.value); if (!key || key === slugify(name)) setKey(slugify(e.target.value)) }} className="mb-4 w-full border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-zinc-900" placeholder="e.g. Product roles in Bengaluru" />
                <label className="mb-1.5 block text-sm font-medium">Plan key</label><input required value={key} onChange={(e) => setKey(slugify(e.target.value))} className="mb-4 w-full border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-zinc-900" placeholder="product-roles-bengaluru" />
                <div className="mb-4 border border-dashed border-zinc-300 bg-zinc-50 p-5 text-center"><input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => selectFile(e.target.files?.[0])} /><button type="button" onClick={() => fileRef.current?.click()} className="mx-auto flex items-center gap-2 text-sm font-semibold text-zinc-800"><Upload className="h-4 w-4" />{file ? file.name : "Choose .xlsx file"}</button><p className="mt-1 text-xs text-zinc-500">Up to 5 MB · max 200 company rows</p></div>
                <a href="/api/plans/sample.xlsx" className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-700 underline underline-offset-4"><FileText className="h-3.5 w-3.5" /> Download sample with expected columns</a>
                <p className="mt-2 text-xs leading-5 text-zinc-500">Required: company, tier (T1–T5), priority (High/Medium/Low), and careers_page URL. Optional: remarks.</p>
                {error && <p role="alert" className="mt-4 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
                <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setImportOpen(false)} className="border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700">Cancel</button><button disabled={saving} className="inline-flex items-center gap-2 bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}{saving ? "Importing…" : "Import plan"}</button></div>
            </form>
        </div>}

        {workflowOpen && selectedPlan && <div className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setWorkflowOpen(false) }}>
            <div className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl md:p-8">
                <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Workflow setup</span>
                        <h2 className="mt-2 text-2xl font-semibold text-zinc-950">Add {selectedPlan.name}</h2>
                    </div>
                    <button type="button" onClick={() => setWorkflowOpen(false)} className="rounded-full border border-zinc-200 p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800" aria-label="Close"><X className="h-4 w-4" /></button>
                </div>

                <div className="mb-7 grid gap-2 sm:grid-cols-3">
                    {["Roles", "Experience", "Schedule"].map((label, index) => <div key={label} className={`rounded-full border px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] ${wizardStep === index ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-zinc-50 text-zinc-500"}`}>{label}</div>)}
                </div>

                {wizardStep === 0 && <div>
                    <p className="mb-3 text-sm text-zinc-600">Choose the jobs to match across the company career pages in this plan.</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {roleOptions.map((role) => {
                            const active = workflowDraft.target_roles.includes(role)
                            return <button key={role} type="button" onClick={() => {
                                setWorkflowDraft((current) => {
                                    const next = current.target_roles.includes(role)
                                        ? current.target_roles.filter((item) => item !== role)
                                        : [...current.target_roles, role]
                                    return { ...current, target_roles: next }
                                })
                                setWorkflowError("")
                            }} className={`rounded-xl border px-3 py-3 text-left text-sm font-medium transition ${active ? "border-zinc-900 bg-zinc-950 text-white shadow-sm" : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-100"}`}>
                                {role}
                            </button>
                        })}
                    </div>
                    <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-600">
                        Selected: <span className="font-semibold text-zinc-900">{rolePreview}</span>
                    </div>
                    {planDetail && <div className="mt-4 text-xs text-zinc-500">{planDetail.rows.length} target companies loaded from this plan.</div>}
                </div>}

                {wizardStep === 1 && <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
                    <label className="block text-sm font-medium text-zinc-700">Minimum experience required</label>
                    <div className="mt-3 flex items-center gap-3">
                        <input type="number" min={0} max={40} value={workflowDraft.experience} onChange={(event) => setWorkflowDraft((current) => ({ ...current, experience: Number(event.target.value) || 0 }))} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 text-base text-zinc-900 outline-none transition focus:border-zinc-900" />
                        <span className="text-sm font-medium text-zinc-500">years</span>
                    </div>
                    <p className="mt-3 text-sm text-zinc-500">Use a whole number such as 3 for 3 years, or 8 for 8 years.</p>
                </div>}

                {wizardStep === 2 && <div className="space-y-5">
                    <div>
                        <label className="mb-2 block text-sm font-medium text-zinc-700">AI provider</label>
                        <SearchableSelect id="workflow-provider" value={workflowDraft.provider} onChange={(value) => {
                            const provider = value as string
                            const nextModel = providerModels[provider]?.[0] || "gemini-2.5-flash"
                            setWorkflowDraft((current) => ({ ...current, provider, model: nextModel }))
                        }} options={Object.entries(providerModels).map(([provider, models]) => ({ value: provider, label: `${provider === "openai" ? "OpenAI" : provider === "claude" ? "Claude" : "Gemini"} (${models[0] || "default"})` }))} placeholder="Choose a provider" />
                    </div>
                    <div>
                        <label className="mb-2 block text-sm font-medium text-zinc-700">AI model</label>
                        <SearchableSelect id="workflow-model" value={workflowDraft.model} onChange={(value) => setWorkflowDraft((current) => ({ ...current, model: value }))} options={((providerModels[workflowDraft.provider] || [workflowDraft.model || "gemini-2.5-flash"]).map((id) => ({ value: id, label: id })))} placeholder="Choose a model" />
                    </div>
                    <div>
                        <label className="mb-2 block text-sm font-medium text-zinc-700">Frequency</label>
                        <SearchableSelect id="workflow-frequency" value={workflowDraft.frequency} onChange={(value) => setWorkflowDraft((current) => ({ ...current, frequency: value }))} options={frequencyOptions} placeholder="Choose a frequency" />
                    </div>
                    <div>
                        <label className="mb-2 block text-sm font-medium text-zinc-700">Initial start time</label>
                        <input type="datetime-local" value={workflowDraft.initial_start_time} onChange={(event) => setWorkflowDraft((current) => ({ ...current, initial_start_time: event.target.value }))} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-900" />
                    </div>
                    <div>
                        <label className="mb-2 block text-sm font-medium text-zinc-700">Delivery channel</label>
                        {availableWorkflowChannels.length ? <SearchableSelect id="workflow-channel" value={workflowDraft.channel} onChange={(value) => setWorkflowDraft((current) => ({ ...current, channel: value }))} options={availableWorkflowChannels.map((channel) => ({ value: channel, label: channel === "email" ? "Email" : "WhatsApp" }))} placeholder="Select a channel" /> : <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">No enabled channels are available. Enable an email or WhatsApp channel first.</div>}
                    </div>
                </div>}

                {workflowError && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{workflowError}</p>}

                <div className="mt-7 flex items-center justify-between gap-3">
                    <button type="button" onClick={() => setWorkflowOpen(false)} className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100">Cancel</button>
                    <div className="flex gap-2">
                        {wizardStep > 0 && <button type="button" onClick={() => setWizardStep((step) => Math.max(step - 1, 0))} className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100">Back</button>}
                        {wizardStep < 2 ? <button type="button" onClick={() => { if (wizardStep === 0 && !workflowDraft.target_roles.length) { setWorkflowError("Select at least one target role to continue."); return } setWorkflowError(""); setWizardStep((step) => step + 1) }} className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800">Next</button>
                            : <button type="button" disabled={savingWorkflow || !availableWorkflowChannels.length || !workflowDraft.target_roles.length} onClick={() => void saveWorkflow()} className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50">{savingWorkflow && <LoaderCircle className="h-4 w-4 animate-spin" />}Save workflow</button>}
                    </div>
                </div>
            </div>
        </div>}

        {toast && <div role="status" className="fixed bottom-6 right-6 z-50 flex items-center gap-3 border border-amber-200 bg-white px-4 py-3 text-sm font-semibold text-amber-900 shadow-lg">{toast}{toast.startsWith("Please add") && <Link to="/profile" className="whitespace-nowrap underline underline-offset-2">Open profile</Link>}</div>}
    </div>
}
